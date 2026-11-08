// SPDX-License-Identifier: MIT
//! A host's accessors: state reads, events to the app, and tab registration with WebKit.
use super::{
    host::MistyExtensionHost,
    state::{HostIvars, HostState},
    tabs::MistyExtensionTab,
};

use objc2::{msg_send, rc::Retained, runtime::ProtocolObject, sel, DefinedClass, MainThreadMarker};
use objc2_app_kit::{NSPopoverDidCloseNotification, NSWindowDidBecomeKeyNotification};
use objc2_foundation::NSNotificationCenter;
use objc2_web_kit::{
    WKWebExtensionContext, WKWebExtensionController, WKWebExtensionTabChangedProperties,
    WKWebsiteDataStore,
};
use serde_json::{Map, Value};
use std::{
    cell::{Ref, RefCell, RefMut},
    sync::{Arc, RwLock},
};

type Emitter = Arc<dyn Fn(Value) + Send + Sync>;
static EMITTER: RwLock<Option<Emitter>> = RwLock::new(None);

/// Where host events go (the app's extension event channel).
pub(super) fn set_emitter(emitter: Emitter) {
    *EMITTER.write().unwrap_or_else(|e| e.into_inner()) = Some(emitter);
}

impl MistyExtensionHost {
    pub(super) fn new(mtm: MainThreadMarker, space: &str) -> Retained<Self> {
        let this = mtm.alloc::<Self>().set_ivars(HostIvars {
            state: RefCell::new(HostState::new(space)),
        });
        // SAFETY: NSObject's designated initializer.
        let this: Retained<Self> = unsafe { msg_send![super(this), init] };
        let center = NSNotificationCenter::defaultCenter();
        // SAFETY: each selector is defined on this class above, takes one notification,
        // and the notification names are Foundation's and WebKit's own constants.
        unsafe {
            for (name, selector) in [
                (
                    objc2_web_kit::WKWebExtensionContextGrantedPermissionsWereRemovedNotification,
                    sel!(permissionsRemoved:),
                ),
                (
                    objc2_web_kit::WKWebExtensionContextGrantedPermissionMatchPatternsWereRemovedNotification,
                    sel!(permissionsRemoved:),
                ),
                (
                    objc2_web_kit::WKWebExtensionContextErrorsDidUpdateNotification,
                    sel!(runtimeErrors:),
                ),
                (NSPopoverDidCloseNotification, sel!(popupClosed:)),
                (NSWindowDidBecomeKeyNotification, sel!(windowFocused:)),
            ] {
                center.addObserver_selector_name_object(&this, selector, Some(name), None);
            }
        }
        this
    }

    pub(super) fn state(&self) -> Ref<'_, HostState> {
        self.ivars().state.borrow()
    }
    /// Never hold this across a call into WebKit or AppKit, which may call back into the host.
    pub(super) fn state_mut(&self) -> RefMut<'_, HostState> {
        self.ivars().state.borrow_mut()
    }

    pub(super) fn space(&self) -> String {
        self.state().space.clone()
    }
    pub(super) fn account(&self) -> Option<String> {
        self.state().account.clone()
    }
    pub(super) fn controller(&self) -> Option<Retained<WKWebExtensionController>> {
        self.state().controller.clone()
    }
    pub(super) fn store(&self) -> Option<Retained<WKWebsiteDataStore>> {
        self.state().store.clone()
    }
    pub(super) fn tab(&self, key: &str) -> Option<Retained<MistyExtensionTab>> {
        self.state().tabs.get(key).cloned()
    }
    pub(super) fn all_tabs(&self) -> Vec<Retained<MistyExtensionTab>> {
        self.state().tabs.values().cloned().collect()
    }
    pub(super) fn context(&self, identifier: &str) -> Option<Retained<WKWebExtensionContext>> {
        self.state().contexts.get(identifier).cloned()
    }
    pub(super) fn descriptor(&self, identifier: &str) -> Option<Value> {
        self.state().descriptors.get(identifier).cloned()
    }
    pub(super) fn active_tab(&self) -> Option<Retained<MistyExtensionTab>> {
        let state = self.state();
        state
            .active_tab
            .as_ref()
            .and_then(|key| state.tabs.get(key))
            .cloned()
    }
    /// The identifier of the running extension whose context this is.
    pub(super) fn identifier_of(&self, context: &WKWebExtensionContext) -> Option<String> {
        self.state()
            .contexts
            .iter()
            .find(|(_, candidate)| std::ptr::eq(&***candidate, context))
            .map(|(key, _)| key.clone())
    }
    /// Whether the extension was granted this permission by the person, as Misty recorded it.
    pub(super) fn granted(&self, identifier: &str, permission: &str) -> bool {
        self.state()
            .descriptors
            .get(identifier)
            .and_then(|descriptor| descriptor.get("permissions"))
            .and_then(Value::as_array)
            .is_some_and(|list| list.iter().any(|item| item.as_str() == Some(permission)))
    }

    /// Raises an event for the app, naming this host's Space and account.
    pub(super) fn event(&self, kind: &str, data: Value) {
        let (account, space) = {
            let state = self.state();
            (state.account.clone(), state.space.clone())
        };
        let Some(account) = account else {
            return;
        };
        let emitter = EMITTER.read().unwrap_or_else(|e| e.into_inner()).clone();
        let Some(emitter) = emitter else {
            return;
        };
        let mut event: Map<String, Value> = match data {
            Value::Object(map) => map,
            _ => Map::new(),
        };
        event.insert("kind".into(), kind.into());
        event.insert("account".into(), account.into());
        event.insert("space".into(), space.into());
        emitter(Value::Object(event));
    }

    pub(super) fn did_change_tab(
        &self,
        tab: &MistyExtensionTab,
        properties: WKWebExtensionTabChangedProperties,
    ) {
        if let Some(controller) = self.controller() {
            // SAFETY: `tab` conforms to WKWebExtensionTab and is open in this controller.
            unsafe {
                controller.didChangeTabProperties_forTab(properties, ProtocolObject::from_ref(tab))
            };
        }
    }

    /// An adapter can predate a context (restoration, installation, or a native view
    /// replacement). Merely returning it from `tabsForWebExtensionContext:` or
    /// `actionForTab:` does not make it an open tab in that context. WebKit's message
    /// routing requires an open tab, even when tabs.query and the popup can already see
    /// its URL. These notifications are idempotent; do not close and reopen the tab,
    /// which would change its extension-visible identity.
    pub(super) fn register_open_tab(&self, tab: &MistyExtensionTab) {
        let Some(window) = tab.window() else {
            return;
        };
        let Some(controller) = self.controller() else {
            return;
        };
        // SAFETY: both conform to their WebKit protocols.
        unsafe {
            controller.didOpenWindow(ProtocolObject::from_ref(&*window));
            controller.didOpenTab(ProtocolObject::from_ref(tab));
        }
    }
}
