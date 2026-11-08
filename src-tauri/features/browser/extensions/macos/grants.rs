// SPDX-License-Identifier: MIT
//! Granting an extension what the person approved, and changing grants of a running one.
use super::{
    host::MistyExtensionHost,
    support::{string, truthy},
};

use objc2::{rc::Retained, runtime::ProtocolObject, MainThreadMarker, MainThreadOnly as _};
use objc2_foundation::NSString;
use objc2_web_kit::{
    WKWebExtension, WKWebExtensionContext, WKWebExtensionContextPermissionStatus,
    WKWebExtensionMatchPattern,
};
use serde_json::{json, Value};

pub(super) fn strings(value: &Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|item| item.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

fn pattern(mtm: MainThreadMarker, text: &str) -> Option<Retained<WKWebExtensionMatchPattern>> {
    // SAFETY: parses a match pattern string; a malformed one is an error value.
    unsafe {
        WKWebExtensionMatchPattern::initWithString_error(
            WKWebExtensionMatchPattern::alloc(mtm),
            &string(text),
        )
    }
    .ok()
}

/// Whether the manifest says the extension may not run in private windows.
pub(super) fn incognito_blocked(extension: &WKWebExtension) -> bool {
    // SAFETY: reads the parsed manifest dictionary.
    let manifest = unsafe { extension.manifest() };
    manifest
        .objectForKey(&string("incognito"))
        .and_then(|value| value.downcast::<NSString>().ok())
        .is_some_and(|value| value.to_string() == "not_allowed")
}

pub(super) fn grant(
    mtm: MainThreadMarker,
    context: &WKWebExtensionContext,
    permissions: &[String],
    hosts: &[String],
) {
    // SAFETY: permission calls on a context this host owns.
    unsafe {
        for permission in permissions {
            context.setPermissionStatus_forPermission(
                WKWebExtensionContextPermissionStatus::GrantedExplicitly,
                &string(permission),
            );
        }
        for host in hosts {
            if let Some(pattern) = pattern(mtm, host) {
                context.setPermissionStatus_forMatchPattern(
                    WKWebExtensionContextPermissionStatus::GrantedExplicitly,
                    &pattern,
                );
            }
        }
    }
}

impl MistyExtensionHost {
    /// Same package, so only the grants change; the running extension is not restarted.
    pub(super) fn update_existing(
        &self,
        existing: &WKWebExtensionContext,
        previous: &Value,
        descriptor: &Value,
        identifier: &str,
    ) {
        let (old_permissions, permissions) = (
            strings(previous, "permissions"),
            strings(descriptor, "permissions"),
        );
        let (old_hosts, hosts) = (strings(previous, "hosts"), strings(descriptor, "hosts"));
        let mtm = self.mtm();
        // SAFETY: permission calls on a context this host owns.
        unsafe {
            for permission in old_permissions.iter().filter(|p| !permissions.contains(p)) {
                existing.setPermissionStatus_forPermission(
                    WKWebExtensionContextPermissionStatus::DeniedExplicitly,
                    &string(permission),
                );
            }
            for permission in &permissions {
                existing.setPermissionStatus_forPermission(
                    WKWebExtensionContextPermissionStatus::GrantedExplicitly,
                    &string(permission),
                );
            }
            for host in old_hosts.iter().filter(|h| !hosts.contains(h)) {
                if let Some(pattern) = pattern(mtm, host) {
                    existing.setPermissionStatus_forMatchPattern(
                        WKWebExtensionContextPermissionStatus::DeniedExplicitly,
                        &pattern,
                    );
                }
            }
            for host in &hosts {
                if let Some(pattern) = pattern(mtm, host) {
                    existing.setPermissionStatus_forMatchPattern(
                        WKWebExtensionContextPermissionStatus::GrantedExplicitly,
                        &pattern,
                    );
                }
            }
            let allowed = truthy(descriptor.get("privateAccess").unwrap_or(&Value::Null))
                && !incognito_blocked(&existing.webExtension());
            existing.setHasAccessToPrivateData(allowed);
        }
        if !permissions.iter().any(|p| p == "nativeMessaging") {
            let connections = self.state_mut().native_connections.remove(identifier);
            for connection in connections.into_iter().flatten() {
                connection.stop();
            }
        }
        // SAFETY: reads the context's private-data grant.
        if !unsafe { existing.hasAccessToPrivateData() } {
            for tab in self.all_tabs() {
                if tab.window().is_some_and(|window| window.is_private()) {
                    // SAFETY: closes the popup of an action this context vended.
                    unsafe {
                        if let Some(action) =
                            existing.actionForTab(Some(ProtocolObject::from_ref(&*tab)))
                        {
                            action.closePopup();
                        }
                    }
                }
            }
        }
        self.state_mut()
            .descriptors
            .insert(identifier.to_owned(), descriptor.clone());
        self.event("changed", json!({"id": identifier}));
        // Re-announce a live bridge after control changes without restarting the
        // extension's background or invalidating permission completion handlers.
        let bridge = self.state().bridges.get(identifier).cloned();
        if let Some(bridge) = bridge {
            // SAFETY: evaluates a constant script in the bridge page.
            unsafe {
                bridge.evaluateJavaScript_completionHandler(
                    &string("browser.storage.sync.get(null).then(values => window.webkit.messageHandlers.mistyExtensionSync.postMessage({kind:'sync-ready',values})); void 0"),
                    None,
                );
            }
        }
    }
}
