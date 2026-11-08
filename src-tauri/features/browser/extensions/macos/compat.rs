// SPDX-License-Identifier: MIT
//! Native side of Misty's WebExtension compatibility layer.
//!
//! Each running extension gets a hidden page in its own origin
//! (`__misty_compat__/host.html`). The extension's background and pages reach it
//! over a same-origin BroadcastChannel; the page reaches Misty through a
//! reply-capable script message handler. Requests are checked against what the
//! person approved on this computer before Misty reads or changes anything.
use super::{
    host::{CompatReply, MistyExtensionHost},
    support::{string, to_json},
};
use objc2::{rc::Retained, runtime::ProtocolObject, MainThreadOnly as _, Message as _};
use objc2_foundation::{NSPoint, NSRect, NSSize, NSURLRequest, NSURL};
use objc2_web_kit::{WKScriptMessage, WKUserContentController, WKWebExtensionContext, WKWebView};
use serde_json::{json, Value};
use std::{ffi::c_void, sync::Mutex};

/// The granted permission each compatibility method requires. An empty string means any
/// extension may call it, as in Firefox. `None` means Misty does not offer the method.
pub(super) fn permission(method: &str) -> Option<&'static str> {
    if [
        "i18n.detectLanguage",
        "tabs.move",
        "tabs.group",
        "tabs.ungroup",
        "runtime.reportError",
    ]
    .contains(&method)
    {
        return Some("");
    }
    // Only the person's click opens or runs a download; no extension permission covers it.
    if method == "downloads.open" {
        return None;
    }
    let namespace = method.split('.').next().unwrap_or_default();
    [
        "notifications",
        "downloads",
        "history",
        "topSites",
        "search",
        "sessions",
        "browsingData",
        "find",
        "idle",
        "tts",
        "bookmarks",
        "tabGroups",
        "userScripts",
    ]
    .into_iter()
    .find(|candidate| *candidate == namespace)
}

/// What the native host's checks answer, for tests that can't run an extension.
pub fn compat_requires(method: &str, expected: &str) -> bool {
    permission(method) == Some(expected)
}

/// Kiri's extension transport installer (features/kiri/src/extensions/bridge.rs).
type Installer = fn(*mut c_void);
static INSTALLER: Mutex<Option<Installer>> = Mutex::new(None);

pub fn set_compat_channel(install: Installer) {
    *INSTALLER.lock().unwrap_or_else(|e| e.into_inner()) = Some(install);
}

impl MistyExtensionHost {
    fn compat_page(&self, context: &WKWebExtensionContext) -> Option<Retained<NSURL>> {
        // SAFETY: a relative URL over the extension's base.
        unsafe {
            NSURL::URLWithString_relativeToURL(
                &string("__misty_compat__/host.html"),
                Some(&context.baseURL()),
            )
        }
        .and_then(|url| url.absoluteURL())
    }

    pub(super) fn start_compat(&self, identifier: &str, context: &WKWebExtensionContext) {
        self.stop_compat(identifier);
        // SAFETY: configures a private hidden view over the context's configuration.
        unsafe {
            let Some(config) = context.webViewConfiguration() else {
                return;
            };
            // Like the sync bridge, the host gets its own handler namespace. Kiri owns
            // the transport; its requests return through `compat_message`.
            let controller = WKUserContentController::new(self.mtm());
            config.setUserContentController(&controller);
            let Some(install) = *INSTALLER.lock().unwrap_or_else(|e| e.into_inner()) else {
                return;
            };
            install(Retained::as_ptr(&controller).cast_mut().cast());
            let frame = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(1.0, 1.0));
            let view = WKWebView::initWithFrame_configuration(
                WKWebView::alloc(self.mtm()),
                frame,
                &config,
            );
            view.setNavigationDelegate(Some(ProtocolObject::from_ref(self)));
            self.state_mut()
                .compat_views
                .insert(identifier.to_owned(), view.clone());
            if let Some(page) = self.compat_page(context) {
                view.loadRequest(&NSURLRequest::requestWithURL(&page));
            }
        }
    }

    pub(super) fn stop_compat(&self, identifier: &str) {
        let Some(view) = self.state_mut().compat_views.remove(identifier) else {
            return;
        };
        // SAFETY: stops a view this host made and releases its handlers.
        unsafe {
            view.stopLoading();
            view.configuration()
                .userContentController()
                .removeAllScriptMessageHandlers();
        }
    }

    /// Whether a compatibility page may navigate to this address: only its own page.
    pub(super) fn is_compat_navigation(&self, view: &WKWebView, url: &NSURL) -> bool {
        let views: Vec<(String, Retained<WKWebView>)> = self
            .state()
            .compat_views
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        for (identifier, candidate) in views {
            if !std::ptr::eq(&*candidate, view) {
                continue;
            }
            let page = self
                .context(&identifier)
                .and_then(|context| self.compat_page(&context));
            return page.is_some_and(|page| page.absoluteString() == url.absoluteString());
        }
        false
    }

    /// The Space's host a compatibility page belongs to, for a script message.
    pub(super) fn owns_compat_view(&self, view: &WKWebView) -> bool {
        self.state()
            .compat_views
            .values()
            .any(|candidate| std::ptr::eq(&**candidate, view))
    }

    pub(super) fn compat_message(&self, message: &WKScriptMessage, reply: CompatReply) {
        // SAFETY: reads the message's page, frame and body.
        let (view, main_frame, url, body) = unsafe {
            (
                message.webView(),
                message.frameInfo().isMainFrame(),
                message
                    .frameInfo()
                    .request()
                    .URL()
                    .and_then(|url| url.absoluteString())
                    .map(|s| s.to_string()),
                to_json(&message.body()),
            )
        };
        let identifier = view.as_ref().and_then(|view| {
            self.state()
                .compat_views
                .iter()
                .find(|(_, v)| std::ptr::eq(&***v, &**view))
                .map(|(k, _)| k.clone())
        });
        let context = identifier.as_ref().and_then(|id| self.context(id));
        let page = context
            .as_ref()
            .and_then(|context| self.compat_page(context))
            .and_then(|p| p.absoluteString())
            .map(|s| s.to_string());
        let method = body.get("method").and_then(Value::as_str);
        let (Some(identifier), Some(context), Some(method), true) = (
            identifier,
            context,
            method,
            main_frame && url.is_some() && url == page,
        ) else {
            return reply(None, Some("Invalid extension request.".into()));
        };
        let args: Vec<Value> = body
            .get("args")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let Some(required) = permission(method) else {
            return reply(
                None,
                Some("This extension API is not available in Misty.".into()),
            );
        };
        if !required.is_empty() && !self.granted(&identifier, required) {
            return reply(
                None,
                Some(format!("The {required} permission is required.")),
            );
        }
        let first = args.first().cloned().unwrap_or(Value::Null);
        match method {
            "tts.allowed" => return reply(Some(Value::Null), None),
            "idle.queryState" => return reply(Some(self.idle_state(&first).into()), None),
            "runtime.reportError" => {
                let detail: String = first
                    .as_str()
                    .unwrap_or_default()
                    .chars()
                    .take(2000)
                    .collect();
                self.event(
                    "background-error",
                    json!({"id": identifier, "detail": detail}),
                );
                return reply(Some(Value::Null), None);
            }
            "userScripts.write" => {
                let path = self.write_user_script(&first, &identifier);
                return match path {
                    Some(path) => reply(Some(path.into()), None),
                    None => reply(None, Some("Misty could not store that user script.".into())),
                };
            }
            "i18n.detectLanguage" => return reply(Some(self.detect_language(&first)), None),
            "tabs.move" => {
                return match self.move_tab(&first, &context) {
                    Some(failure) => reply(None, Some(failure)),
                    None => reply(Some(Value::Null), None),
                };
            }
            "tabs.group" | "tabs.ungroup" => {
                // Misty's app knows tabs by their runtime ids; send those, never the extension's view of them.
                let located: Vec<Value> = first.as_array().cloned().unwrap_or_default();
                let mut ids = Vec::new();
                for item in &located {
                    match self.locate_tab(item, &context) {
                        Some(tab) => ids.push(Value::String(tab.identifier().to_owned())),
                        None => {
                            return reply(None, Some("Misty could not identify that tab.".into()))
                        }
                    }
                }
                if ids.is_empty() {
                    return reply(None, Some("Choose at least one tab.".into()));
                }
                let mut forwarded = vec![Value::Array(ids)];
                if let Some(second) = args.get(1) {
                    forwarded.push(second.clone());
                }
                return self.forward_compat(method, forwarded, &identifier, &context, reply);
            }
            "browsingData.remove" => {
                let options = if first.is_object() {
                    first.clone()
                } else {
                    json!({})
                };
                let types = args
                    .get(1)
                    .filter(|types| types.is_object())
                    .cloned()
                    .unwrap_or(json!({}));
                let flag =
                    |key: &str| super::support::truthy(types.get(key).unwrap_or(&Value::Null));
                let library = flag("history") || flag("downloads");
                let this = self.retain();
                let (method, identifier) = (method.to_owned(), identifier.clone());
                let again = args.clone();
                self.remove_website_data(
                    &options,
                    &types.clone(),
                    Box::new(move || {
                        // History and downloads belong to Misty's library; the app removes those.
                        if library {
                            this.forward_compat(&method, again, &identifier, &context, reply);
                        } else {
                            reply(Some(Value::Null), None);
                        }
                    }),
                );
                return;
            }
            _ => {}
        }
        if method.starts_with("notifications.") {
            let Some(reply) = self.handle_notification(method, &args, &identifier, reply) else {
                return;
            };
            return self.forward_compat(method, args, &identifier, &context, reply);
        }
        if method == "downloads.download" {
            if let Some(failure) = self.start_download(&first, &context) {
                return reply(None, Some(failure));
            }
            // Misty reports the new download's id once its download list has it.
        }
        self.forward_compat(method, args, &identifier, &context, reply);
    }
}
