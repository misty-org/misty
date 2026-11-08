// SPDX-License-Identifier: MIT
//! WebKit's controller callbacks and the notifications a host observes: windows,
//! popups, options pages, new tabs and windows, permission prompts.
use super::{
    host::MistyExtensionHost,
    open_tabs::downcast,
    tabs::{url_text, MistyExtensionTab, MistyExtensionWindow},
};
use block2::DynBlock;
use objc2::{rc::Retained, runtime::ProtocolObject, DefinedClass};
use objc2_app_kit::{NSAppearanceCustomization, NSPopoverBehavior, NSWindow};
use objc2_foundation::{NSArray, NSError, NSNotification, NSRectEdge, NSSet, NSString};
use objc2_web_kit::{
    WKNavigationAction, WKWebExtensionAction, WKWebExtensionContext, WKWebExtensionMatchPattern,
    WKWebExtensionWindow, WKWebView,
};
use serde_json::{json, Value};

type Completion = DynBlock<dyn Fn(*mut NSError)>;

impl MistyExtensionHost {
    /// Whether a host-owned view (a bridge or compatibility page) may navigate to this address.
    pub(super) fn allows_navigation(&self, view: &WKWebView, action: &WKNavigationAction) -> bool {
        // SAFETY: reads the action's request address.
        let url = unsafe { action.request().URL() };
        let mut allowed = url
            .as_ref()
            .is_some_and(|url| self.is_compat_navigation(view, url));
        let bridges: Vec<(String, Retained<WKWebView>)> = self
            .state()
            .bridges
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        for (identifier, bridge) in bridges {
            if !std::ptr::eq(&*bridge, view) {
                continue;
            }
            let expected = self.bridge_url(&identifier).map(|url| url_text(&url));
            allowed = url.as_ref().map(|url| url_text(url)) == expected;
            break;
        }
        allowed
    }

    pub(super) fn open_windows(
        &self,
        context: &WKWebExtensionContext,
    ) -> Retained<NSArray<ProtocolObject<dyn WKWebExtensionWindow>>> {
        let private_access = unsafe { context.hasAccessToPrivateData() };
        let mut windows: Vec<Retained<MistyExtensionWindow>> = Vec::new();
        for tab in self.all_tabs() {
            let Some(window) = tab.window() else {
                continue;
            };
            if (!window.is_private() || private_access)
                && !windows.iter().any(|seen| std::ptr::eq(&**seen, &*window))
            {
                windows.push(window);
            }
        }
        let windows: Vec<_> = windows
            .into_iter()
            .map(ProtocolObject::from_retained)
            .collect();
        NSArray::from_retained_slice(&windows)
    }

    pub(super) fn focused_window(
        &self,
        context: &WKWebExtensionContext,
    ) -> Option<Retained<ProtocolObject<dyn WKWebExtensionWindow>>> {
        let mut window = self.active_tab().and_then(|tab| tab.window());
        // An extension's own popup window counts while it's in front.
        for tab in self.all_tabs() {
            if let Some(candidate) = tab.window() {
                if candidate.ivars().popup_window.get()
                    && candidate
                        .native()
                        .is_some_and(|native| native.isKeyWindow())
                {
                    window = Some(candidate);
                }
            }
        }
        let window = window?;
        if window.is_private() && !unsafe { context.hasAccessToPrivateData() } {
            return None;
        }
        Some(ProtocolObject::from_retained(window))
    }

    /// Access the person gave was taken back in WebKit; tell the app, which owns the grants.
    pub(super) fn permissions_removed(&self, notification: &NSNotification) {
        let Some(identifier) = self.notified_extension(notification) else {
            return;
        };
        let descriptor = self.descriptor(&identifier).unwrap_or(Value::Null);
        let listed = |key: &str, name: &str| {
            descriptor
                .get(key)
                .and_then(Value::as_array)
                .is_some_and(|list| list.iter().any(|item| item.as_str() == Some(name)))
        };
        let (mut permissions, mut hosts) = (Vec::new(), Vec::new());
        // SAFETY: reads WebKit's documented user-info keys.
        unsafe {
            let info = notification.userInfo();
            let removed = info.as_ref().and_then(|info| {
                info.objectForKey(
                    objc2_web_kit::WKWebExtensionContextNotificationUserInfoKeyPermissions,
                )
            });
            if let Some(set) = removed.and_then(|value| value.downcast::<NSSet>().ok()) {
                for item in set.allObjects().iter() {
                    if let Ok(name) = item.downcast::<NSString>() {
                        if listed("permissions", &name.to_string()) {
                            permissions.push(Value::String(name.to_string()));
                        }
                    }
                }
            }
            let patterns = info.as_ref().and_then(|info| {
                info.objectForKey(
                    objc2_web_kit::WKWebExtensionContextNotificationUserInfoKeyMatchPatterns,
                )
            });
            if let Some(set) = patterns.and_then(|value| value.downcast::<NSSet>().ok()) {
                for item in set.allObjects().iter() {
                    if let Ok(pattern) = item.downcast::<WKWebExtensionMatchPattern>() {
                        let text = pattern.string().to_string();
                        if listed("hosts", &text) {
                            hosts.push(Value::String(text));
                        }
                    }
                }
            }
        }
        // Temporary activeTab access is never copied into durable account grants.
        if !permissions.is_empty() || !hosts.is_empty() {
            self.event(
                "permissions-removed",
                json!({"id": identifier, "permissions": permissions, "hosts": hosts}),
            );
        }
    }

    pub(super) fn runtime_errors(&self, notification: &NSNotification) {
        let Some(identifier) = self.notified_extension(notification) else {
            return;
        };
        let detail = self
            .context(&identifier)
            .map(|context| {
                // SAFETY: reads the context's error list.
                unsafe { context.errors() }
                    .iter()
                    .map(|failure| failure.localizedDescription().to_string())
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .unwrap_or_default();
        self.event("runtime-error", json!({"id": identifier, "detail": detail}));
    }

    /// The running extension whose context raised this notification.
    fn notified_extension(&self, notification: &NSNotification) -> Option<String> {
        let object = notification.object()?;
        let context = object.downcast_ref::<WKWebExtensionContext>()?;
        self.identifier_of(context)
    }

    pub(super) fn popup_closed(&self) {
        // Every Space's host hears every popover close; only the one that showed a popup acts.
        let Some(key) = self.state().popup_tab.clone() else {
            return;
        };
        if let Some(view) = self.tab(&key).and_then(|tab| tab.view()) {
            if let Some(window) = view.window() {
                if window.isKeyWindow() {
                    window.makeFirstResponder(Some(&view));
                }
            }
        }
        self.state_mut().popup_tab = None;
    }

    pub(super) fn window_focused(&self, notification: &NSNotification) {
        let Some(object) = notification.object() else {
            return;
        };
        let Some(native) = object.downcast_ref::<NSWindow>() else {
            return;
        };
        for tab in self.all_tabs() {
            let Some(window) = tab.window() else {
                continue;
            };
            if window
                .native()
                .is_some_and(|candidate| std::ptr::eq(&*candidate, native))
                && tab.ivars().selected.get()
            {
                if let Some(controller) = self.controller() {
                    // SAFETY: the window conforms to WKWebExtensionWindow.
                    unsafe { controller.didFocusWindow(Some(ProtocolObject::from_ref(&*window))) };
                }
                break;
            }
        }
    }

    pub(super) fn present_popup(&self, action: &WKWebExtensionAction, done: &Completion) {
        // SAFETY: AppKit calls on the action's popover, on the main thread.
        unsafe {
            let tab_view = action
                .associatedTab()
                .and_then(|tab| downcast::<MistyExtensionTab>(&tab))
                .and_then(|tab| tab.view())
                .and_then(|view| view.window())
                .and_then(|window| window.contentView());
            let parent = self.state().popup_parent.load().or(tab_view);
            let (Some(parent), Some(popover)) = (parent, action.popupPopover()) else {
                super::tabs::call_error(done, "Open a browser tab to use this extension.");
                return;
            };
            popover.setBehavior(NSPopoverBehavior::Transient);
            // The popover's frame follows Misty's window, so a dark popup isn't ringed in light.
            if let Some(window) = parent.window() {
                popover.setAppearance(Some(&window.effectiveAppearance()));
            }
            let anchor = self.state().popup_anchor;
            popover.showRelativeToRect_ofView_preferredEdge(anchor, &parent, NSRectEdge::MinY);
        }
        done.call((std::ptr::null_mut(),));
    }

    pub(super) fn open_options_page(&self, context: &WKWebExtensionContext, done: &Completion) {
        // SAFETY: reads the manifest's options page address.
        let url = unsafe { context.optionsPageURL() };
        if let Some(url) = &url {
            self.event("open-tab", json!({"url": url_text(url), "private": false}));
        }
        match url {
            Some(_) => done.call((std::ptr::null_mut(),)),
            None => super::tabs::call_error(done, "No options page is available."),
        }
    }
}
