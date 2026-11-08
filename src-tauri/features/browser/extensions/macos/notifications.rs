// SPDX-License-Identifier: MIT
//! `browser.notifications` through UNUserNotificationCenter, so clicks and buttons reach
//! the extension. Misty's own app notifications go through NSUserNotification
//! (notify-rust), so this center's delegate is free for extension clicks, buttons and
//! dismissals.
use super::{
    bridge::host_for_space,
    host::{CompatReply, MistyExtensionHost},
    support::{on_main, string, to_json, truthy, Handoff},
};
use block2::{DynBlock, RcBlock};
use objc2::{
    define_class, msg_send,
    rc::Retained,
    runtime::{NSObject, ProtocolObject},
    MainThreadOnly, Message as _,
};
use objc2_foundation::{NSArray, NSBundle, NSObjectProtocol};
use objc2_user_notifications::{
    UNNotification, UNNotificationDefaultActionIdentifier, UNNotificationDismissActionIdentifier,
    UNNotificationPresentationOptions, UNNotificationResponse, UNUserNotificationCenter,
    UNUserNotificationCenterDelegate,
};
use serde_json::{json, Map, Value};
use std::{cell::RefCell, collections::HashMap};

pub(super) const EXTENSION_KEY: &str = "mistyExtension";
pub(super) const NAME_KEY: &str = "mistyNotification";
/// The Space whose extension posted it: clicks go back to that Space's host.
pub(super) const SPACE_KEY: &str = "mistySpace";

thread_local! {
    static DELEGATE: RefCell<Option<Retained<NotificationDelegate>>> = const { RefCell::new(None) };
    static OPTIONS: RefCell<HashMap<String, Value>> = RefCell::new(HashMap::new());
}

fn identifier(space: &str, extension: &str, name: &str) -> String {
    serde_json::to_string(&[space, extension, name]).unwrap_or_default()
}

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    struct NotificationDelegate;

    unsafe impl NSObjectProtocol for NotificationDelegate {}

    unsafe impl UNUserNotificationCenterDelegate for NotificationDelegate {
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn will_present(
            &self,
            _center: &UNUserNotificationCenter,
            notification: &UNNotification,
            done: &DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            let info = to_json(&notification.request().content().userInfo());
            if info.get(EXTENSION_KEY).is_none() {
                return done.call((UNNotificationPresentationOptions(0),));
            }
            // Extension notifications show while Misty is in front, as in Firefox.
            let mut options =
                UNNotificationPresentationOptions::Banner | UNNotificationPresentationOptions::List;
            if !truthy(info.get("silent").unwrap_or(&Value::Null)) {
                options |= UNNotificationPresentationOptions::Sound;
            }
            done.call((options,));
        }

        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn did_receive(
            &self,
            _center: &UNUserNotificationCenter,
            response: &UNNotificationResponse,
            done: &DynBlock<dyn Fn()>,
        ) {
            let request = response.notification().request();
            let info = to_json(&request.content().userInfo());
            let action = response.actionIdentifier().to_string();
            let request_identifier = request.identifier().to_string();
            let done = Handoff::new(done.copy());
            on_main(move || {
                route(&info, &action, &request_identifier);
                if let Some(done) = done.take() {
                    done.call(());
                }
            });
        }
    }
);

/// Sends a click, a button or a dismissal to the extension that posted the notification.
fn route(info: &Value, action: &str, request_identifier: &str) {
    let (extension, name) = (
        info.get(EXTENSION_KEY).and_then(Value::as_str),
        info.get(NAME_KEY).and_then(Value::as_str),
    );
    let host = info
        .get(SPACE_KEY)
        .and_then(Value::as_str)
        .and_then(host_for_space);
    let (Some(host), Some(extension), Some(name)) = (host, extension, name) else {
        return;
    };
    // SAFETY: WebKit-independent constants of UserNotifications.
    let (default, dismiss) = unsafe {
        (
            UNNotificationDefaultActionIdentifier.to_string(),
            UNNotificationDismissActionIdentifier.to_string(),
        )
    };
    if action == default {
        host.deliver_compat_event("notifications.onClicked", &[json!(name)], extension);
    } else if action == dismiss {
        OPTIONS.with(|options| options.borrow_mut().remove(request_identifier));
        host.deliver_compat_event(
            "notifications.onClosed",
            &[json!(name), json!(true)],
            extension,
        );
    } else if let Some(index) = action.strip_prefix("button-") {
        let index: i64 = index.parse().unwrap_or(0);
        host.deliver_compat_event(
            "notifications.onButtonClicked",
            &[json!(name), json!(index)],
            extension,
        );
    }
}

impl MistyExtensionHost {
    /// UserNotifications requires a bundled app; `misty dev` runs a bare binary.
    fn notification_center(&self) -> Option<Retained<UNUserNotificationCenter>> {
        let bundle = NSBundle::mainBundle();
        if bundle.bundleIdentifier().is_none() || !bundle.bundlePath().to_string().ends_with(".app")
        {
            return None;
        }
        let center = UNUserNotificationCenter::currentNotificationCenter();
        let ours = DELEGATE.with(|slot| {
            let mut slot = slot.borrow_mut();
            if slot.is_none() {
                if center.delegate().is_some() {
                    return None;
                }
                let delegate: Retained<NotificationDelegate> = {
                    let this = self.mtm().alloc::<NotificationDelegate>().set_ivars(());
                    // SAFETY: NSObject's designated initializer.
                    unsafe { msg_send![super(this), init] }
                };
                center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
                *slot = Some(delegate);
            }
            slot.clone()
        })?;
        let current = center.delegate()?;
        std::ptr::eq(
            Retained::as_ptr(&current).cast::<u8>(),
            Retained::as_ptr(&ours).cast::<u8>(),
        )
        .then_some(center)
    }

    /// Answers a `notifications.*` call natively. Hands the reply back when notifications
    /// cannot be shown natively (an unbundled build), so Misty's app notifications take it.
    pub(super) fn handle_notification(
        &self,
        method: &str,
        args: &[Value],
        extension: &str,
        reply: CompatReply,
    ) -> Option<CompatReply> {
        let Some(center) = self.notification_center() else {
            return Some(reply);
        };
        let name = args
            .first()
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let key = identifier(&self.space(), extension, &name);
        match method {
            "notifications.create" | "notifications.update" => {
                let given = args
                    .get(1)
                    .filter(|given| given.is_object())
                    .cloned()
                    .unwrap_or(json!({}));
                let update = method == "notifications.update";
                let known = OPTIONS.with(|options| options.borrow().get(&key).cloned());
                if update && known.is_none() {
                    reply(Some(json!(false)), None);
                    return None;
                }
                let mut options: Map<String, Value> = match (update, known) {
                    (true, Some(Value::Object(known))) => known,
                    _ => Map::new(),
                };
                if let Value::Object(given) = given {
                    options.extend(given);
                }
                let options = Value::Object(options);
                let (this, extension, key) = (self.retain(), extension.to_owned(), key);
                self.post(
                    &options.clone(),
                    &name.clone(),
                    &key.clone(),
                    &extension.clone(),
                    &center,
                    Box::new(move |failure| {
                        if let Some(failure) = failure {
                            return reply(None, Some(failure));
                        }
                        OPTIONS.with(|stored| stored.borrow_mut().insert(key, options));
                        if !update {
                            this.deliver_compat_event(
                                "notifications.onShown",
                                &[json!(name)],
                                &extension,
                            );
                        }
                        reply(Some(if update { json!(true) } else { Value::Null }), None);
                    }),
                );
            }
            "notifications.clear" => {
                let existed = OPTIONS.with(|options| options.borrow_mut().remove(&key).is_some());
                let keys = NSArray::from_retained_slice(&[string(&key)]);
                center.removeDeliveredNotificationsWithIdentifiers(&keys);
                center.removePendingNotificationRequestsWithIdentifiers(&keys);
                if existed {
                    self.deliver_compat_event(
                        "notifications.onClosed",
                        &[json!(name), json!(false)],
                        extension,
                    );
                }
                reply(Some(json!(existed)), None);
            }
            "notifications.getAll" => {
                let (space, extension) = (self.space(), extension.to_owned());
                let reply = Handoff::new(reply);
                let delivered = RcBlock::new(
                    move |delivered: std::ptr::NonNull<NSArray<UNNotification>>| {
                        let mut all = Map::new();
                        // SAFETY: UserNotifications passes a live array.
                        for notification in unsafe { delivered.as_ref() }.iter() {
                            let info = to_json(&notification.request().content().userInfo());
                            let same = info.get(EXTENSION_KEY).and_then(Value::as_str)
                                == Some(extension.as_str())
                                && info.get(SPACE_KEY).and_then(Value::as_str)
                                    == Some(space.as_str());
                            if let (true, Some(name)) =
                                (same, info.get(NAME_KEY).and_then(Value::as_str))
                            {
                                all.insert(name.to_owned(), json!(true));
                            }
                        }
                        let reply = reply.clone();
                        on_main(move || {
                            if let Some(reply) = reply.take() {
                                reply(Some(Value::Object(all)), None);
                            }
                        });
                    },
                );
                center.getDeliveredNotificationsWithCompletionHandler(&delivered);
            }
            _ => return Some(reply),
        }
        None
    }
}
