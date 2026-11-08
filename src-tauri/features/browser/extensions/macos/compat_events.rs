// SPDX-License-Identifier: MIT
//! Compatibility requests the app answers, and events delivered to extensions.
use super::{
    compat::permission,
    host::{CompatReply, MistyExtensionHost},
    support::{on_main_after, string, text, to_dictionary, Reply},
};
use objc2::{MainThreadOnly as _, Message as _};
use objc2_foundation::NSUUID;
use objc2_web_kit::{WKContentWorld, WKWebExtensionContext};
use serde_json::{json, Value};
use std::time::Duration;

impl MistyExtensionHost {
    /// Hands a request to the app and waits up to a minute for its answer.
    pub(super) fn forward_compat(
        &self,
        method: &str,
        args: Vec<Value>,
        identifier: &str,
        context: &WKWebExtensionContext,
        reply: CompatReply,
    ) {
        let request_id = NSUUID::new().UUIDString().to_string();
        self.state_mut()
            .compat_replies
            .insert(request_id.clone(), reply);
        // SAFETY: reads the private-data grant.
        let private_access = unsafe { context.hasAccessToPrivateData() };
        self.event(
            "compat-request",
            json!({"id": identifier, "requestId": request_id, "method": method, "args": args, "privateAccess": private_access}),
        );
        let this = self.retain();
        on_main_after(Duration::from_secs(60), move || {
            let pending = this.state_mut().compat_replies.remove(&request_id);
            if let Some(pending) = pending {
                pending(None, Some("Misty did not respond.".into()));
            }
        });
    }

    /// Handles `compat-reply` and `compat-event`; hands the reply back for other operations.
    pub(super) fn compat_request(&self, request: &Value, reply: Reply) -> Option<Reply> {
        match text(request, "operation") {
            Some("compat-reply") => {
                let pending = text(request, "requestId")
                    .and_then(|id| self.state_mut().compat_replies.remove(id));
                if let Some(pending) = pending {
                    match request.get("error").and_then(Value::as_str) {
                        Some(failure) => pending(None, Some(failure.to_owned())),
                        None => pending(
                            Some(request.get("result").cloned().unwrap_or(Value::Null)),
                            None,
                        ),
                    }
                }
                reply(json!({}));
                None
            }
            Some("compat-event") => {
                let event = text(request, "event").unwrap_or_default();
                let args: Vec<Value> = request
                    .get("args")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                if permission(event).is_none() {
                    reply(json!({"error": "Invalid extension event."}));
                    return None;
                }
                let identifiers: Vec<String> = self.state().compat_views.keys().cloned().collect();
                for identifier in identifiers {
                    if request
                        .get("id")
                        .is_some_and(|wanted| *wanted != Value::String(identifier.clone()))
                    {
                        continue;
                    }
                    let private =
                        super::support::truthy(request.get("private").unwrap_or(&Value::Null));
                    // SAFETY: reads the private-data grant.
                    if private
                        && !self
                            .context(&identifier)
                            .is_some_and(|c| unsafe { c.hasAccessToPrivateData() })
                    {
                        continue;
                    }
                    self.deliver_compat_event(event, &args, &identifier);
                }
                reply(json!({}));
                None
            }
            _ => Some(reply),
        }
    }

    /// Sends an extension API event to one extension, if its grants allow it.
    pub(super) fn deliver_compat_event(&self, event: &str, args: &[Value], identifier: &str) {
        let Some(required) = permission(event) else {
            return;
        };
        if !required.is_empty() && !self.granted(identifier, required) {
            return;
        }
        let Some(view) = self.state().compat_views.get(identifier).cloned() else {
            return;
        };
        let arguments = to_dictionary(&json!({"event": event, "args": args}));
        // SAFETY: a constant script in the compatibility page.
        unsafe {
            view.callAsyncJavaScript_arguments_inFrame_inContentWorld_completionHandler(
                &string("window.mistyCompatEvent?.(event, args)"),
                Some(&arguments),
                None,
                &WKContentWorld::pageWorld(self.mtm()),
                None,
            );
        }
    }
}
