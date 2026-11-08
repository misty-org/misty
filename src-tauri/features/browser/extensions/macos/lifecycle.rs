// SPDX-License-Identifier: MIT
//! Starting a Space's controller, and stopping what it runs.
use super::{
    host::MistyExtensionHost,
    support::{error, string},
};

use objc2::{rc::Retained, runtime::ProtocolObject, MainThreadOnly};

use objc2_foundation::NSUUID;
use objc2_web_kit::{
    WKWebExtensionController, WKWebExtensionControllerConfiguration, WKWebsiteDataStore,
};

impl MistyExtensionHost {
    /// Makes the Space's controller once, over the Space's store. A host never rebuilds it;
    /// the host is freed with the Space's last window instead.
    pub(super) fn start_with_store(&self, store: Retained<WKWebsiteDataStore>) {
        let (identifier, ready) = {
            let state = self.state();
            (
                state.controller_identifier.clone(),
                state.account.is_some() && state.controller.is_none(),
            )
        };
        if !ready {
            return;
        }
        let mtm = self.mtm();
        // SAFETY: plain configuration and controller construction on the main thread.
        let controller = unsafe {
            let uuid = NSUUID::from_string(&string(&identifier));
            let Some(uuid) = uuid else {
                return;
            };
            let config =
                WKWebExtensionControllerConfiguration::configurationWithIdentifier(&uuid, mtm);
            // Background pages and extension tabs use this store: the Space's own.
            config.setDefaultWebsiteDataStore(Some(&store));
            let controller = WKWebExtensionController::initWithConfiguration(
                WKWebExtensionController::alloc(mtm),
                &config,
            );
            controller.setDelegate(Some(ProtocolObject::from_ref(self)));
            controller
        };
        let mut state = self.state_mut();
        state.store = Some(store);
        state.controller = Some(controller);
    }

    /// Unloads everything and forgets the account; the host can be configured again.
    pub(super) fn shutdown(&self) {
        let (pending, requests, replies) = {
            let mut state = self.state_mut();
            (
                std::mem::take(&mut state.pending),
                std::mem::take(&mut state.open_requests),
                std::mem::take(&mut state.compat_replies),
            )
        };
        for (_, done) in pending {
            done(false);
        }
        for (_, done) in requests {
            done(None, Some(error("The account changed.")));
        }
        for (_, done) in replies {
            done(None, Some("The account changed.".into()));
        }
        self.state_mut().opening_tabs.clear();
        let keys: Vec<String> = self.state().contexts.keys().cloned().collect();
        for key in keys {
            self.unload(&key);
        }
        let (options, popups) = {
            let state = self.state();
            (state.options_windows.clone(), state.popup_windows.clone())
        };
        for window in options.iter().chain(popups.iter()) {
            window.close();
        }
        let mut state = self.state_mut();
        state.options_windows.clear();
        state.popup_windows.clear();
        state.descriptors.clear();
        state.load_tokens.clear();
        state.restored.clear();
        state.tabs.clear();
        state.windows.clear();
        state.pending.clear();
        state.active_tab = None;
        state.popup_tab = None;
        state.controller = None;
        state.store = None;
        state.account = None;
    }

    /// Stops one extension: its popups, bridge, compatibility page and native connections.
    pub(super) fn unload(&self, identifier: &str) {
        let (context, bridge, connections, tabs) = {
            let mut state = self.state_mut();
            state.load_tokens.remove(identifier);
            state.restored.remove(identifier);
            let context = state.contexts.remove(identifier);
            let bridge = state.bridges.remove(identifier);
            let connections = state.native_connections.remove(identifier);
            (
                context,
                bridge,
                connections,
                state.tabs.values().cloned().collect::<Vec<_>>(),
            )
        };
        if let Some(context) = &context {
            // SAFETY: closing popups of actions this context vended.
            unsafe {
                if let Some(action) = context.actionForTab(None) {
                    action.closePopup();
                }
                for tab in &tabs {
                    if let Some(action) =
                        context.actionForTab(Some(ProtocolObject::from_ref(&**tab)))
                    {
                        action.closePopup();
                    }
                }
            }
        }
        if let Some(bridge) = bridge {
            // SAFETY: the bridge's own handler namespace.
            unsafe {
                bridge
                    .configuration()
                    .userContentController()
                    .removeScriptMessageHandlerForName(&string("mistyExtensionSync"));
            }
        }
        self.stop_compat(identifier);
        for connection in connections.into_iter().flatten() {
            connection.stop();
        }
        if let (Some(context), Some(controller)) = (context, self.controller()) {
            // SAFETY: the context was loaded by this controller.
            let _ = unsafe { controller.unloadExtensionContext_error(&context) };
        }
        self.state_mut().contexts.remove(identifier);
    }
}
