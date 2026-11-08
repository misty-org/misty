// SPDX-License-Identifier: MIT
//! Handles the native extension tests (`features/browser/extensions/tests`) use to reach
//! inside a host. Not part of the app.
use super::{bridge::install_host, host::MistyExtensionHost, support::Reply};
use objc2::{rc::Retained, runtime::ProtocolObject, MainThreadMarker};
use objc2_web_kit::{WKWebExtensionContext, WKWebView, WKWebsiteDataStore};
use serde_json::Value;

pub use super::native_connection::{Handler, NativeConnection};

/// One Space's host, registered where the entry points find it, with an account but no
/// controller until `start`.
pub struct TestHost(Retained<MistyExtensionHost>);

impl TestHost {
    pub fn install(mtm: MainThreadMarker, space: &str, account: &str, controller_id: &str) -> Self {
        let host = MistyExtensionHost::new(mtm, space);
        {
            let mut state = host.state_mut();
            state.account = Some(account.to_owned());
            state.controller_identifier = controller_id.to_owned();
        }
        install_host(space, host.clone());
        Self(host)
    }

    pub fn request(&self, request: &Value, reply: Reply) {
        self.0.request(request, reply);
    }

    pub fn start(&self, store: Retained<WKWebsiteDataStore>) {
        self.0.start_with_store(store);
    }

    pub fn load(&self, descriptor: &Value, reply: Reply) {
        self.0.load(descriptor, reply);
    }

    pub fn store(&self) -> Option<Retained<WKWebsiteDataStore>> {
        self.0.store()
    }

    pub fn unload(&self, extension: &str) {
        self.0.unload(extension);
    }

    /// The hidden `storage.sync` page of a running extension.
    pub fn bridge(&self, extension: &str) -> Option<Retained<WKWebView>> {
        self.0.state().bridges.get(extension).cloned()
    }

    /// Whether the extension's context counts this tab as open.
    pub fn is_open_tab(&self, extension: &str, tab: &str) -> bool {
        let (Some(context), Some(tab)) = (self.0.context(extension), self.0.tab(tab)) else {
            return false;
        };
        // SAFETY: reads the context's open tabs.
        unsafe {
            context
                .openTabs()
                .containsObject(ProtocolObject::from_ref(&*tab))
        }
    }

    /// Reproduces the inconsistent state of a live failure: the action and window adapter expose
    /// a tab that is absent from the context's open tabs.
    pub fn forget_tab(&self, extension: &str, tab: &str) {
        let (Some(context), Some(tab)) = (self.0.context(extension), self.0.tab(tab)) else {
            return;
        };
        let context: &WKWebExtensionContext = &context;
        // SAFETY: the tab conforms to WKWebExtensionTab.
        unsafe {
            context.didCloseTab_windowIsClosing(ProtocolObject::from_ref(&*tab), false);
            context.actionForTab(Some(ProtocolObject::from_ref(&*tab)));
        }
    }
}
