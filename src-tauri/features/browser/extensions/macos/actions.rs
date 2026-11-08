// SPDX-License-Identifier: MIT
//! Toolbar buttons, context menus and popups of the extensions.
use super::{
    host::MistyExtensionHost,
    support::{once, string, text, to_json, Reply},
    tabs::MistyExtensionTab,
};
use base64::Engine;
use block2::RcBlock;
use objc2::{
    rc::Retained,
    runtime::{AnyObject, ProtocolObject},
    AllocAnyThread as _, MainThreadOnly as _,
};
use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSEvent, NSMenu, NSMenuItem};
use objc2_foundation::{NSDictionary, NSError, NSSize};
use objc2_web_kit::WKWebExtensionContext;
use serde_json::{json, Value};

impl MistyExtensionHost {
    /// The toolbar buttons of every extension for one tab.
    pub(super) fn actions(&self, request: &Value) -> Value {
        let tab = text(request, "tabId").and_then(|id| self.tab(id));
        let contexts: Vec<(String, Retained<WKWebExtensionContext>)> = self
            .state()
            .contexts
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        let mut actions = Vec::new();
        for (key, context) in contexts {
            // SAFETY: reads the action WebKit keeps for this tab.
            let (label, badge, enabled, icon) = unsafe {
                let action =
                    context.actionForTab(tab.as_ref().map(|tab| ProtocolObject::from_ref(&**tab)));
                let Some(action) = action else {
                    continue;
                };
                let icon = action
                    .iconForSize(NSSize::new(20.0, 20.0))
                    .and_then(|image| {
                        let tiff = image.TIFFRepresentation()?;
                        let bitmap =
                            NSBitmapImageRep::initWithData(NSBitmapImageRep::alloc(), &tiff)?;
                        let png = bitmap.representationUsingType_properties(
                            NSBitmapImageFileType::PNG,
                            &NSDictionary::new(),
                        );
                        png.map(|png| png.to_vec())
                    });
                let private_blocked = tab
                    .as_ref()
                    .and_then(|tab| tab.window())
                    .is_some_and(|w| w.is_private())
                    && !context.hasAccessToPrivateData();
                (
                    action.label().to_string(),
                    action.badgeText().to_string(),
                    action.isEnabled() && self.state().restored.contains(&key) && !private_blocked,
                    icon,
                )
            };
            let icon = icon.map_or(String::new(), |png| {
                format!(
                    "data:image/png;base64,{}",
                    base64::engine::general_purpose::STANDARD.encode(png)
                )
            });
            actions.push(json!({"id": key, "title": label, "badge": badge, "enabled": enabled, "icon": icon}));
        }
        json!({"actions": actions})
    }

    /// Pops the extensions' context menu items for a tab at the pointer.
    pub(super) fn context_menu(&self, request: &Value) {
        let tab = text(request, "tabId").and_then(|id| self.tab(id));
        let allowed: Vec<&str> = request
            .get("allowedIds")
            .and_then(Value::as_array)
            .map(|list| list.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default();
        let menu = NSMenu::new(self.mtm());
        let contexts: Vec<(String, Retained<WKWebExtensionContext>)> = self
            .state()
            .contexts
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        for (key, context) in contexts {
            if !allowed.contains(&key.as_str()) {
                continue;
            }
            let Some(tab) = &tab else {
                continue;
            };
            // SAFETY: reads the access flag and the items WebKit builds for the tab.
            let private_blocked = tab.window().is_some_and(|w| w.is_private())
                && !unsafe { context.hasAccessToPrivateData() };
            if private_blocked || !self.state().restored.contains(&key) {
                continue;
            }
            for item in unsafe { context.menuItemsForTab(ProtocolObject::from_ref(&**tab)) }.iter()
            {
                menu.addItem(&item);
            }
        }
        if menu.numberOfItems() == 0 {
            // SAFETY: a titled, disabled item.
            let empty = unsafe {
                NSMenuItem::initWithTitle_action_keyEquivalent(
                    NSMenuItem::alloc(self.mtm()),
                    &string("No extension actions for this page"),
                    None,
                    &string(""),
                )
            };
            empty.setEnabled(false);
            menu.addItem(&empty);
        }
        menu.popUpMenuPositioningItem_atLocation_inView(None, NSEvent::mouseLocation(), None);
    }

    /// Opens an extension's action popup under the toolbar button the app named.
    pub(super) fn invoke(&self, request: &Value, context: &WKWebExtensionContext) -> Value {
        let tab = text(request, "tabId").and_then(|id| self.tab(id));
        let private_blocked = tab
            .as_ref()
            .and_then(|tab| tab.window())
            .is_some_and(|w| w.is_private())
            && !unsafe { context.hasAccessToPrivateData() };
        let Some(tab) = tab.filter(|_| !private_blocked) else {
            return json!({"error": "This extension cannot access the current tab."});
        };
        let parent = tab
            .view()
            .and_then(|view| view.window())
            .and_then(|window| window.contentView());
        let anchor = request
            .get("anchor")
            .filter(|anchor| anchor.is_object())
            .cloned()
            .unwrap_or(json!({"x": 0.94, "y": 0.04, "width": 0.02, "height": 0.02}));
        let number = |key: &str| anchor.get(key).and_then(Value::as_f64).unwrap_or(0.0);
        let size = parent
            .as_ref()
            .map_or(NSSize::ZERO, |parent| parent.bounds().size);
        {
            let mut state = self.state_mut();
            state.popup_tab = Some(tab.identifier().to_owned());
            state.popup_parent = parent
                .as_deref()
                .map(objc2::rc::Weak::new)
                .unwrap_or_default();
            state.popup_anchor = objc2_foundation::NSRect::new(
                objc2_foundation::NSPoint::new(
                    number("x") * size.width,
                    size.height * (1.0 - number("y") - number("height")),
                ),
                NSSize::new(
                    (number("width") * size.width).max(1.0),
                    (number("height") * size.height).max(1.0),
                ),
            );
        }
        // SAFETY: performs the extension's action for a tab it may access.
        unsafe { context.performActionForTab(Some(ProtocolObject::from_ref(&*tab))) };
        json!({})
    }

    /// Runs a script in the open action popup, for tests and support.
    pub(super) fn popup_evaluate(
        &self,
        request: &Value,
        context: &WKWebExtensionContext,
        identifier: &str,
        reply: Reply,
    ) {
        let refused = || json!({"error": "Open this extension's popup on the granted tab before inspecting it."});
        let tab = text(request, "tabId").and_then(|id| self.tab(id));
        let Some(tab) = tab else {
            return reply(refused());
        };
        let private_blocked = tab.window().is_some_and(|w| w.is_private())
            && !unsafe { context.hasAccessToPrivateData() };
        // SAFETY: reads the action's popup and checks it belongs to this tab and extension.
        let (view, ok) = unsafe {
            let action = context.actionForTab(Some(ProtocolObject::from_ref(&*tab)));
            let popover_shown = action
                .as_ref()
                .and_then(|a| a.popupPopover())
                .is_some_and(|p| p.isShown());
            let associated =
                action
                    .as_ref()
                    .and_then(|a| a.associatedTab())
                    .is_some_and(|associated| {
                        let any: &AnyObject = associated.as_ref();
                        std::ptr::eq(
                            any as *const AnyObject as *const u8,
                            &*tab as *const MistyExtensionTab as *const u8,
                        )
                    });
            let view = action.as_ref().and_then(|a| a.popupWebView());
            let owner = match (self.controller(), view.as_ref().and_then(|v| v.URL())) {
                (Some(controller), Some(url)) => controller.extensionContextForURL(&url),
                _ => None,
            };
            let owned = owner.is_some_and(|owner| std::ptr::eq(&*owner, context));
            (view, popover_shown && associated && owned)
        };
        let Some(view) =
            view.filter(|_| ok && !private_blocked && self.state().restored.contains(identifier))
        else {
            return reply(refused());
        };
        let reply = once(reply);
        let script = text(request, "script").unwrap_or_default().to_owned();
        let completion = RcBlock::new(move |result: *mut AnyObject, failure: *mut NSError| {
            if !failure.is_null() {
                return reply(json!({"error": "The extension popup changed. Inspect it again."}));
            }
            // SAFETY: WebKit passes a live object or null.
            let value = unsafe { result.as_ref() }.map_or(Value::Null, to_json);
            reply(json!({"result": value}));
        });
        // SAFETY: the handler is called once.
        unsafe { view.evaluateJavaScript_completionHandler(&string(&script), Some(&completion)) };
    }
}
