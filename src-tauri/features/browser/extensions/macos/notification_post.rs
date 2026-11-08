// SPDX-License-Identifier: MIT
//! Building and posting one extension notification.
#![allow(clippy::disallowed_methods)] // The extension's own files and a temporary copy of an image.
use super::{
    host::MistyExtensionHost,
    notifications::{EXTENSION_KEY, NAME_KEY, SPACE_KEY},
    support::{on_main, string, to_dictionary, truthy, Handoff},
};
use block2::RcBlock;
use objc2::{rc::Retained, runtime::Bool, AllocAnyThread as _};
use objc2_foundation::{
    NSArray, NSData, NSDataBase64DecodingOptions, NSError, NSSet, NSURL, NSUUID,
};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNMutableNotificationContent, UNNotificationAction,
    UNNotificationActionOptions, UNNotificationAttachment, UNNotificationCategory,
    UNNotificationCategoryOptions, UNNotificationInterruptionLevel, UNNotificationRequest,
    UNNotificationSound, UNUserNotificationCenter,
};
use serde_json::{json, Value};
use std::cell::RefCell;

impl MistyExtensionHost {
    pub(super) fn post(
        &self,
        options: &Value,
        name: &str,
        key: &str,
        extension: &str,
        center: &Retained<UNUserNotificationCenter>,
        reply: Box<dyn FnOnce(Option<String>)>,
    ) {
        let content = UNMutableNotificationContent::new();
        content.setTitle(&string(&text(options, "title", 256)));
        content.setSubtitle(&string(&text(options, "contextMessage", 256)));
        let mut lines = vec![text(options, "message", 2048)];
        for item in options
            .get("items")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if item.is_object() {
                let field = |key: &str| item.get(key).and_then(Value::as_str).unwrap_or_default();
                lines.push(format!("{} {}", field("title"), field("message")));
            }
        }
        lines.retain(|line| !line.is_empty());
        content.setBody(&string(&lines.join("\n")));
        let silent = truthy(options.get("silent").unwrap_or(&Value::Null));
        if !silent {
            content.setSound(Some(&UNNotificationSound::defaultSound()));
        }
        let info = to_dictionary(
            &json!({EXTENSION_KEY: extension, NAME_KEY: name, SPACE_KEY: self.space(), "silent": silent}),
        );
        // SAFETY: the dictionary holds only property-list types.
        unsafe {
            content
                .setUserInfo(&*(Retained::as_ptr(&info) as *const objc2_foundation::NSDictionary))
        };
        content.setInterruptionLevel(
            if truthy(options.get("requireInteraction").unwrap_or(&Value::Null)) {
                UNNotificationInterruptionLevel::TimeSensitive
            } else {
                UNNotificationInterruptionLevel::Active
            },
        );
        content.setCategoryIdentifier(&string(&category_for(options, center)));
        let image = options.get("imageUrl").or_else(|| options.get("iconUrl"));
        if let Some(attachment) = self.attachment(image, extension) {
            content.setAttachments(&NSArray::from_retained_slice(&[attachment]));
        }
        let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
            &string(key),
            &content,
            None,
        );
        let reply = Handoff::new(reply);
        let center_again = center.clone();
        let authorized = RcBlock::new(move |granted: Bool, _failure: *mut NSError| {
            let reply = reply.clone();
            if !granted.as_bool() {
                return on_main(move || {
                    if let Some(reply) = reply.take() {
                        reply(Some("Notifications are turned off for Misty.".into()));
                    }
                });
            }
            let added = RcBlock::new(move |failure: *mut NSError| {
                let (reply, failed) = (reply.clone(), !failure.is_null());
                on_main(move || {
                    if let Some(reply) = reply.take() {
                        reply(failed.then(|| "The notification could not be shown.".to_owned()));
                    }
                });
            });
            center_again.addNotificationRequest_withCompletionHandler(&request, Some(&added));
        });
        center.requestAuthorizationWithOptions_completionHandler(
            UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
            &authorized,
        );
    }

    /// Copies an extension image or data URL into a temporary file; the system takes
    /// ownership of attachment files.
    fn attachment(
        &self,
        source: Option<&Value>,
        extension: &str,
    ) -> Option<Retained<UNNotificationAttachment>> {
        let source = source?.as_str().filter(|source| !source.is_empty())?;
        let root = self.descriptor(extension).and_then(|d| {
            d.get("runtimePath")
                .and_then(Value::as_str)
                .map(str::to_owned)
        });
        let (data, suffix): (Vec<u8>, String);
        if let Some(rest) = source.strip_prefix("data:") {
            let (head, body) = rest.split_once(',')?;
            if !head.ends_with(";base64") {
                return None;
            }
            let decoded = {
                NSData::initWithBase64EncodedString_options(
                    NSData::alloc(),
                    &string(body),
                    NSDataBase64DecodingOptions::IgnoreUnknownCharacters,
                )
            }?;
            data = decoded.to_vec();
            suffix = if source.starts_with("data:image/jpeg") {
                "jpg"
            } else if source.starts_with("data:image/gif") {
                "gif"
            } else {
                "png"
            }
            .into();
        } else if let Some(root) = root {
            let url = NSURL::URLWithString(&string(source));
            let scheme = url.as_ref().and_then(|url| url.scheme());
            let path = match (&url, scheme) {
                (Some(url), Some(scheme)) if scheme.to_string() == "webkit-extension" => {
                    url.path().map(|p| p.to_string())
                }
                (_, Some(_)) => None,
                _ => source.split('?').next().map(str::to_owned),
            }?;
            let file = string(&root)
                .stringByAppendingPathComponent(&string(&path))
                .stringByStandardizingPath()
                .to_string();
            // Only the extension's own files.
            let confined = format!("{}/", string(&root).stringByStandardizingPath());
            if !file.starts_with(&confined) {
                return None;
            }
            data = std::fs::read(&file).ok()?;
            suffix = std::path::Path::new(&file)
                .extension()
                .map_or("png".into(), |e| e.to_string_lossy().into_owned());
        } else {
            return None;
        }
        if data.is_empty() || data.len() > 10 * 1024 * 1024 {
            return None;
        }
        let copy = std::env::temp_dir().join(format!(
            "misty-notification-{}.{suffix}",
            NSUUID::new().UUIDString()
        ));
        std::fs::write(&copy, &data).ok()?;
        let url = NSURL::fileURLWithPath(&string(&copy.to_string_lossy()));
        // SAFETY: the system takes ownership of the file.
        unsafe {
            UNNotificationAttachment::attachmentWithIdentifier_URL_options_error(
                &string("image"),
                &url,
                None,
            )
        }
        .ok()
    }
}

thread_local! {
    static CATEGORIES: RefCell<Vec<Retained<UNNotificationCategory>>> = const { RefCell::new(Vec::new()) };
}

/// A category per set of button titles; buttons report their index.
fn category_for(options: &Value, center: &UNUserNotificationCenter) -> String {
    let buttons = options
        .get("buttons")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut actions = Vec::new();
    let mut titles = Vec::new();
    for (index, button) in buttons.iter().take(2).enumerate() {
        let title = button
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !title.is_empty() {
            let title: String = title.chars().take(64).collect();
            actions.push(UNNotificationAction::actionWithIdentifier_title_options(
                &string(&format!("button-{index}")),
                &string(&title),
                UNNotificationActionOptions::Foreground,
            ));
            titles.push(title);
        }
    }
    let identifier = format!("misty-extension-{}", titles.join("\u{1F}"));
    CATEGORIES.with(|categories| {
        let mut categories = categories.borrow_mut();
        if categories
            .iter()
            .any(|category| category.identifier().to_string() == identifier)
        {
            return;
        }
        categories.push(
            UNNotificationCategory::categoryWithIdentifier_actions_intentIdentifiers_options(
                &string(&identifier),
                &NSArray::from_retained_slice(&actions),
                &NSArray::new(),
                UNNotificationCategoryOptions::CustomDismissAction,
            ),
        );
        center.setNotificationCategories(&NSSet::from_retained_slice(&categories));
    });
    identifier
}

fn text(options: &Value, field: &str, limit: usize) -> String {
    options
        .get(field)
        .and_then(Value::as_str)
        .map(|value| value.chars().take(limit).collect())
        .unwrap_or_default()
}
