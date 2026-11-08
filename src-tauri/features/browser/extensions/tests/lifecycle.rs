// SPDX-License-Identifier: MIT
//! Restored tab adapters and the open-tab bookkeeping WebKit needs, exercised against a host
//! built by hand: tabs known before a controller, extension or native view exists.
use super::support::{fail, require, Harness};
use misty_native::browser::extensions::macos::{self, testing::TestHost};
use objc2_web_kit::{WKWebViewConfiguration, WKWebsiteDataStore};
use serde_json::{json, Value};
use std::{cell::RefCell, rc::Rc};

pub fn run(root: &str, page: &str) {
    let harness = Harness::new("lifecycle");
    let account = harness.account.clone();
    let controller = objc2_foundation::NSUUID::new().UUIDString().to_string();
    let host = TestHost::install(harness.mtm, "probe", &account, &controller);
    let layout = json!({"operation": "layout", "account": account, "tabs": [{
        "id": "restored", "windowId": "window-1", "url": page, "title": "Fixture",
        "private": false, "index": 0, "active": true, "focused": true,
    }]});
    let layout_now = || host.request(&layout, Box::new(|_| {}));
    // Restored logical tabs exist before a controller, extension, or native view.
    layout_now();
    // SAFETY: a private-browsing store for the probe's pages.
    host.start(unsafe { WKWebsiteDataStore::nonPersistentDataStore(harness.mtm) });
    let loaded: Rc<RefCell<Option<Value>>> = Rc::default();
    let sink = loaded.clone();
    host.load(
        &json!({
            "id": "1", "guid": "native-fixture@misty.test", "origin": Harness::random_origin(),
            "runtimePath": root, "privateAccess": true,
            "permissions": ["storage", "activeTab", "scripting"], "hosts": ["http://127.0.0.1/*"],
        }),
        Box::new(move |value| *sink.borrow_mut() = Some(value)),
    );
    harness.wait_until("the extension to load", 5.0, || loaded.borrow().is_some());
    if let Some(message) = loaded.borrow().as_ref().and_then(|v| v["error"].as_str()) {
        fail(message);
    }
    require(
        host.is_open_tab("1", "restored"),
        "Restored tab was not announced to the new context",
    );

    let store = host
        .store()
        .unwrap_or_else(|| fail("the host has no store"));
    // SAFETY: WebKit configuration on the main thread.
    let original = unsafe { WKWebViewConfiguration::new(harness.mtm) };
    unsafe { original.setWebsiteDataStore(&store) };
    // Reproduce the inconsistent state from the live failure: the action and window adapter
    // expose a tab that is absent from context.openTabs.
    host.forget_tab("1", "restored");
    require(
        !host.is_open_tab("1", "restored"),
        "Regression setup did not produce an unannounced tab",
    );
    let view = harness.view_with(&original, page, "restored", false, true);
    require(
        host.is_open_tab("1", "restored"),
        "Binding an existing adapter did not restore its open registration",
    );

    let connected = |harness: &Harness| {
        harness
            .eval(
                &view,
                "return document.documentElement.dataset.mistyFixture",
                &json!({}),
            )
            .ok()
            == Some(json!("content-and-background"))
    };
    harness.wait_until("the content script to reach the background", 6.0, || {
        connected(&harness)
    });
    let bridge = host
        .bridge("1")
        .unwrap_or_else(|| fail("the sync bridge did not start"));
    // No tabs permission is needed to compare IDs in the known fixture.
    let query = "return (await browser.tabs.query({active:true}))[0].id";
    let tab_id = harness
        .eval(&bridge, query, &json!({}))
        .unwrap_or_else(|e| fail(e));
    for _ in 0..5 {
        layout_now();
        macos::register_tab("probe", &view, "restored", false, page);
        macos::tab_event("probe", "restored", "updated");
    }
    let again = harness
        .eval(&bridge, query, &json!({}))
        .unwrap_or_else(|e| fail(e));
    require(
        tab_id == again,
        "Repeated registration changed the extension tab ID",
    );

    host.forget_tab("1", "restored");
    layout_now();
    require(
        host.is_open_tab("1", "restored"),
        "Layout reconciliation did not restore an existing tab",
    );
    host.forget_tab("1", "restored");
    macos::tab_event("probe", "restored", "activate");
    require(
        host.is_open_tab("1", "restored"),
        "Activation did not restore an existing tab",
    );
    host.unload("1");
    println!("PASS: restored adapters, open-tab reconciliation, content/background messaging, stable IDs during repeated layout/registration");
}
