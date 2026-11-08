// SPDX-License-Identifier: MIT
//! The entry points Misty's Rust side calls, and the per-Space hosts behind them. One host
//! per Space, keyed by the Space's key: a single shared controller would let an extension's
//! own requests carry one Space's cookies into another.
use super::{
    host::MistyExtensionHost,
    packages::{remove_controller_data, validate_package},
    support::{on_main, text, Reply},
};

use objc2::{rc::Retained, MainThreadMarker};
use objc2_foundation::{NSOperatingSystemVersion, NSProcessInfo};

use serde_json::{json, Value};
use std::{cell::RefCell, collections::HashMap};

thread_local! {
    static HOSTS: RefCell<HashMap<String, Retained<MistyExtensionHost>>> = RefCell::new(HashMap::new());
}

/// The live host of a Space, if its window is open.
pub(super) fn host_for_space(space: &str) -> Option<Retained<MistyExtensionHost>> {
    HOSTS.with(|hosts| hosts.borrow().get(space).cloned())
}

/// Registers a host the way a `configure` request would, for tests.
pub(super) fn install_host(space: &str, host: Retained<MistyExtensionHost>) {
    HOSTS.with(|hosts| hosts.borrow_mut().insert(space.to_owned(), host));
}

pub(super) fn all_hosts() -> Vec<Retained<MistyExtensionHost>> {
    HOSTS.with(|hosts| hosts.borrow().values().cloned().collect())
}

/// Whether this macOS has WebKit's extension API.
pub fn supported() -> bool {
    NSProcessInfo::processInfo().isOperatingSystemAtLeastVersion(NSOperatingSystemVersion {
        majorVersion: 15,
        minorVersion: 4,
        patchVersion: 0,
    })
}

/// Handles one request on the main queue and answers it there.
pub fn request(value: Value, reply: Reply) {
    on_main(move || {
        objc2::rc::autoreleasepool(|_| {
            if !supported() {
                return reply(
                    json!({"supported": false, "error": "Extensions require macOS 15.4 or later."}),
                );
            }
            let Some(mtm) = MainThreadMarker::new() else {
                return reply(json!({"error": "Invalid extension request."}));
            };
            if !value.is_object() {
                return reply(json!({"error": "Invalid extension request."}));
            }
            handle_request(mtm, &value, reply);
        });
    });
}

fn handle_request(mtm: MainThreadMarker, request: &Value, reply: Reply) {
    let operation = text(request, "operation").unwrap_or_default();
    let space = text(request, "space").unwrap_or_default();
    if operation == "validate" {
        return validate_package(mtm, request, reply);
    }
    if operation == "configure" && text(request, "account").unwrap_or_default().is_empty() {
        // Signing out stops every Space's host.
        for host in all_hosts() {
            if host.account().is_some() {
                host.event("runtime-reset", json!({}));
            }
            host.shutdown();
        }
        HOSTS.with(|hosts| hosts.borrow_mut().clear());
        return reply(json!({"supported": true}));
    }
    if space.is_empty() {
        return reply(json!({"error": "Extensions run in a Space."}));
    }
    if operation == "release-space" || operation == "remove-space" {
        // The Space's last window closed, or the Space is gone: free its host.
        if let Some(host) = HOSTS.with(|hosts| hosts.borrow_mut().remove(space)) {
            host.shutdown();
        }
        if operation == "remove-space" {
            remove_controller_data(mtm, text(request, "controllerId"), reply);
        } else {
            reply(json!({}));
        }
        return;
    }
    let mut host = host_for_space(space);
    if host.is_none() && operation == "configure" {
        let created = MistyExtensionHost::new(mtm, space);
        HOSTS.with(|hosts| hosts.borrow_mut().insert(space.to_owned(), created.clone()));
        host = Some(created);
    }
    let Some(host) = host else {
        return reply(json!({"error": "The extension account changed."}));
    };
    host.request(request, reply);
}
