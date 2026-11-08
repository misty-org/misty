// SPDX-License-Identifier: MIT
//! The delegate of an extension popup window's page.
use super::{host::MistyExtensionHost, tabs::url_text};
use block2::DynBlock;
use objc2::{
    define_class, msg_send,
    rc::{Retained, Weak},
    runtime::NSObject,
    DefinedClass, MainThreadMarker, MainThreadOnly,
};

use objc2_foundation::NSObjectProtocol;
use objc2_web_kit::{
    WKNavigationAction, WKNavigationActionPolicy, WKNavigationDelegate, WKUIDelegate, WKWebView,
    WKWebViewConfiguration, WKWindowFeatures,
};
use serde_json::json;

pub(super) struct PopupDelegateState {
    host: Weak<MistyExtensionHost>,
}

define_class!(
    /// Popup pages may go to web and extension pages, as in Chrome; links meant for a new
    /// window open as Misty tabs.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[ivars = PopupDelegateState]
    pub(super) struct PopupWindowDelegate;

    unsafe impl NSObjectProtocol for PopupWindowDelegate {}

    unsafe impl WKNavigationDelegate for PopupWindowDelegate {
        #[unsafe(method(webView:decidePolicyForNavigationAction:decisionHandler:))]
        fn decide_policy(
            &self,
            _view: &WKWebView,
            action: &WKNavigationAction,
            done: &DynBlock<dyn Fn(WKNavigationActionPolicy)>,
        ) {
            // SAFETY: reads the action's request scheme.
            let scheme = unsafe { action.request().URL().and_then(|url| url.scheme()) }
                .map(|scheme| scheme.to_string().to_lowercase())
                .unwrap_or_default();
            let allowed = ["http", "https", "webkit-extension", "about", "blob", "data"]
                .contains(&scheme.as_str());
            done.call((if allowed {
                WKNavigationActionPolicy::Allow
            } else {
                WKNavigationActionPolicy::Cancel
            },));
        }
    }

    unsafe impl WKUIDelegate for PopupWindowDelegate {
        #[unsafe(method_id(webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:))]
        fn create_web_view(
            &self,
            _view: &WKWebView,
            _configuration: &WKWebViewConfiguration,
            action: &WKNavigationAction,
            _features: &WKWindowFeatures,
        ) -> Option<Retained<WKWebView>> {
            // SAFETY: reads the action's request address.
            let url = unsafe { action.request().URL() };
            if let Some(url) = url {
                let scheme = url
                    .scheme()
                    .map(|s| s.to_string().to_lowercase())
                    .unwrap_or_default();
                if scheme == "http" || scheme == "https" {
                    if let Some(host) = self.ivars().host.load() {
                        host.event("open-tab", json!({"url": url_text(&url), "private": false}));
                    }
                }
            }
            None
        }

        #[unsafe(method(webViewDidClose:))]
        fn did_close(&self, view: &WKWebView) {
            // SAFETY: closes the window that shows this view.
            if let Some(window) = view.window() {
                window.close();
            }
        }
    }
);

impl PopupWindowDelegate {
    pub(super) fn new(mtm: MainThreadMarker, host: &MistyExtensionHost) -> Retained<Self> {
        let this = mtm.alloc::<Self>().set_ivars(PopupDelegateState {
            host: Weak::new(host),
        });
        // SAFETY: NSObject's designated initializer.
        unsafe { msg_send![super(this), init] }
    }
}
