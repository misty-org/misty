// SPDX-License-Identifier: MIT
//! The hidden page that reports an extension's `storage.sync` to Misty's account.
use super::{
    host::MistyExtensionHost,
    support::{once, string, text, to_dictionary, Reply},
};
use block2::RcBlock;
use objc2::{
    rc::Retained,
    runtime::{AnyObject, ProtocolObject},
    MainThreadOnly as _,
};
use objc2_foundation::{NSError, NSPoint, NSRect, NSSize, NSURLRequest};
use objc2_web_kit::{WKContentWorld, WKUserContentController, WKWebExtensionContext, WKWebView};
use serde_json::{json, Value};

impl MistyExtensionHost {
    /// The hidden page that reports `storage.sync` changes to Misty. It gets its own
    /// script handler namespace, because context configurations can share a controller.
    pub(super) fn start_bridge(&self, identifier: &str, context: &WKWebExtensionContext) {
        let mtm = self.mtm();
        // SAFETY: configures a private view over the context's web view configuration.
        unsafe {
            let Some(config) = context.webViewConfiguration() else {
                return;
            };
            let controller = WKUserContentController::new(mtm);
            controller.addScriptMessageHandler_name(
                ProtocolObject::from_ref(self),
                &string("mistyExtensionSync"),
            );
            config.setUserContentController(&controller);
            let frame = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(1.0, 1.0));
            let bridge =
                WKWebView::initWithFrame_configuration(WKWebView::alloc(mtm), frame, &config);
            bridge.setNavigationDelegate(Some(ProtocolObject::from_ref(self)));
            self.state_mut()
                .bridges
                .insert(identifier.to_owned(), bridge.clone());
            if let Some(url) = self.bridge_url(identifier) {
                bridge.loadRequest(&NSURLRequest::requestWithURL(&url));
            }
        }
    }

    /// A message from a bridge page: its `storage.sync` is ready, changed or failed.
    pub(super) fn bridge_message(&self, message: &objc2_web_kit::WKScriptMessage) {
        // SAFETY: reads the message's frame, web view and body.
        let (main_frame, view, body, url) = unsafe {
            let frame = message.frameInfo();
            (
                frame.isMainFrame(),
                message.webView(),
                super::support::to_json(&message.body()),
                frame
                    .request()
                    .URL()
                    .and_then(|url| url.absoluteString())
                    .map(|s| s.to_string()),
            )
        };
        if !main_frame || !body.is_object() {
            return;
        }
        let Some(view) = view else {
            return;
        };
        let bridges: Vec<(String, Retained<WKWebView>)> = self
            .state()
            .bridges
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        for (identifier, bridge) in bridges {
            if !std::ptr::eq(&*bridge, &*view) {
                continue;
            }
            let expected = self
                .bridge_url(&identifier)
                .and_then(|url| url.absoluteString())
                .map(|s| s.to_string());
            if expected != url {
                return;
            }
            let kind = text(&body, "kind").unwrap_or_default();
            if ["sync-ready", "sync-change", "sync-error"].contains(&kind) {
                let session = self
                    .descriptor(&identifier)
                    .and_then(|descriptor| descriptor.get("session").cloned())
                    .unwrap_or(json!(0));
                self.event(
                    kind,
                    json!({"id": identifier, "session": session, "payload": body}),
                );
            }
            return;
        }
    }

    /// Applies replicated `storage.sync` changes through the bridge page.
    pub(super) fn apply_sync(&self, identifier: &str, changes: Value, reply: Reply) {
        let Some(bridge) = self.state().bridges.get(identifier).cloned() else {
            reply(json!({"error": "Extension sync is not ready."}));
            return;
        };
        let arguments = to_dictionary(&json!({"changes": changes}));
        let reply = once(reply);
        let completion = RcBlock::new(move |_result: *mut AnyObject, failure: *mut NSError| {
            // SAFETY: a live error or null.
            match unsafe { failure.as_ref() } {
                Some(failure) => {
                    reply(json!({"error": failure.localizedDescription().to_string()}))
                }
                None => reply(json!({})),
            }
        });
        // SAFETY: the script is constant; the handler is called once.
        unsafe {
            bridge.callAsyncJavaScript_arguments_inFrame_inContentWorld_completionHandler(
                &string("return await window.mistyApplySync(changes)"),
                Some(&arguments),
                None,
                &WKContentWorld::pageWorld(self.mtm()),
                Some(&completion),
            );
        }
    }
}
