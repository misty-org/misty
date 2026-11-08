// SPDX-License-Identifier: MIT
//! Mirrors Misty's tab strip into the logical tabs and windows extensions see.
use super::{
    host::MistyExtensionHost,
    support::{string, text, truthy, unsigned},
    tabs::{url_text, MistyExtensionTab, MistyExtensionWindow},
};

use objc2::{rc::Retained, runtime::ProtocolObject, DefinedClass, MainThreadOnly as _};

use objc2_foundation::NSURL;
use objc2_web_kit::WKWebExtensionTabChangedProperties;
use serde_json::Value;
use std::collections::HashSet;

impl MistyExtensionHost {
    /// Mirrors Misty's tab strip into the logical tabs and windows extensions see.
    pub(super) fn layout(&self, request: &Value) {
        // Restored tabs are tracked before any controller exists; WebKit hears of them later.
        let controller = self.controller();
        let mut seen = HashSet::new();
        let items = request
            .get("tabs")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for item in &items {
            let logical = text(item, "url").and_then(|url| NSURL::URLWithString(&string(url)));
            let Some(logical) = logical else {
                continue;
            };
            let scheme = logical.scheme().map(|s| s.to_string()).unwrap_or_default();
            if !["http", "https", "webkit-extension"].contains(&scheme.as_str())
                && url_text(&logical) != "about:blank"
            {
                continue;
            }
            let key = text(item, "id").unwrap_or_default().to_owned();
            let window_id = text(item, "windowId");
            let private = truthy(item.get("private").unwrap_or(&Value::Null));
            let window_key = format!("{}:{}", window_id.unwrap_or("(null)"), u8::from(private));
            let known_window = self.state().windows.get(&window_key).cloned();
            let window = known_window.unwrap_or_else(|| {
                let window = MistyExtensionWindow::new(self.mtm(), self);
                *window.ivars().identifier.borrow_mut() = window_id.map(str::to_owned);
                window.ivars().private_window.set(private);
                self.state_mut()
                    .windows
                    .insert(window_key.clone(), window.clone());
                // SAFETY: the window conforms to WKWebExtensionWindow.
                if let Some(controller) = &controller {
                    unsafe { controller.didOpenWindow(ProtocolObject::from_ref(&*window)) };
                }
                window
            });
            let existing = self.tab(&key);
            let is_new = existing.is_none();
            let tab = existing.unwrap_or_else(|| MistyExtensionTab::new(self.mtm(), &key, self));
            let old = tab.window();
            let old_index = tab.ivars().position.get();
            *tab.ivars().window.borrow_mut() = Some(window.clone());
            if let Some(native) = tab.view().and_then(|view| view.window()) {
                *window.ivars().native.borrow_mut() = objc2::rc::Weak::new(&native);
            }
            tab.ivars()
                .position
                .set(unsigned(item.get("index").unwrap_or(&Value::Null)));
            *tab.ivars().logical_url.borrow_mut() =
                text(item, "url").and_then(|url| NSURL::URLWithString(&string(url)));
            *tab.ivars().logical_title.borrow_mut() = text(item, "title").map(string);
            tab.ivars()
                .selected
                .set(truthy(item.get("active").unwrap_or(&Value::Null)));
            let mut changed = WKWebExtensionTabChangedProperties::None;
            let muted = truthy(item.get("muted").unwrap_or(&Value::Null));
            if tab.ivars().muted.get() != muted {
                tab.ivars().muted.set(muted);
                changed |= WKWebExtensionTabChangedProperties::Muted;
            }
            let audible = truthy(item.get("audible").unwrap_or(&Value::Null));
            if tab.ivars().audible.get() != audible {
                tab.ivars().audible.set(audible);
                changed |= WKWebExtensionTabChangedProperties::PlayingAudio;
            }
            self.state_mut().tabs.insert(key.clone(), tab.clone());
            seen.insert(key.clone());
            self.register_open_tab(&tab);
            // SAFETY: tab and window objects conform to their protocols.
            if let Some(controller) = &controller {
                unsafe {
                    if !is_new && changed != WKWebExtensionTabChangedProperties::None {
                        controller.didChangeTabProperties_forTab(
                            changed,
                            ProtocolObject::from_ref(&*tab),
                        );
                    }
                    let moved = old
                        .as_ref()
                        .is_none_or(|old| !std::ptr::eq(&**old, &*window));
                    if !is_new && (moved || old_index != tab.ivars().position.get()) {
                        controller.didMoveTab_fromIndex_inWindow(
                            ProtocolObject::from_ref(&*tab),
                            old_index,
                            old.as_ref().map(|old| ProtocolObject::from_ref(&**old)),
                        );
                    }
                }
            }
            let focused = truthy(item.get("focused").unwrap_or(&Value::Null));
            if tab.ivars().selected.get()
                && focused
                && self.state().active_tab.as_deref() != Some(key.as_str())
            {
                let previous = self.active_tab();
                self.state_mut().active_tab = Some(key.clone());
                // SAFETY: tab and window objects conform to their protocols.
                if let Some(controller) = &controller {
                    unsafe {
                        controller.didActivateTab_previousActiveTab(
                            ProtocolObject::from_ref(&*tab),
                            previous
                                .as_ref()
                                .map(|previous| ProtocolObject::from_ref(&**previous)),
                        );
                        controller.didFocusWindow(Some(ProtocolObject::from_ref(&*window)));
                    }
                }
            }
        }
        let stale: Vec<Retained<MistyExtensionTab>> = self
            .all_tabs()
            .into_iter()
            .filter(|tab| !seen.contains(tab.identifier()) && tab.view().is_none())
            .collect();
        for tab in stale {
            if let Some(controller) = &controller {
                // SAFETY: the tab conforms to WKWebExtensionTab.
                unsafe {
                    controller.didCloseTab_windowIsClosing(ProtocolObject::from_ref(&*tab), false)
                };
            }
            self.state_mut().tabs.remove(tab.identifier());
        }
        let windows: Vec<(String, Retained<MistyExtensionWindow>)> = self
            .state()
            .windows
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        for (key, window) in windows {
            let used = self
                .all_tabs()
                .iter()
                .any(|tab| tab.window().is_some_and(|w| std::ptr::eq(&*w, &*window)));
            if !used {
                if let Some(controller) = &controller {
                    // SAFETY: the window conforms to WKWebExtensionWindow.
                    unsafe { controller.didCloseWindow(ProtocolObject::from_ref(&*window)) };
                }
                self.state_mut().windows.remove(&key);
            }
        }
    }
}
