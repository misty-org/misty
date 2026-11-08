// SPDX-License-Identifier: MIT
//! Misty's WebExtension compatibility layer through the production host: shims, native answers,
//! requests forwarded to the app, tab moves, the OAuth redirect rewrite, and learned blocking rules.
use super::support::{fail, require, Harness};
use serde_json::{json, Value};
use std::{cell::Cell, rc::Rc};

// Probes run as one Space with its own named store.
const PROBE_STORE: &str = "6D697374-7900-4000-8000-70726F626573";
const PAGE_STORE: &str = "6d4a6c2e-3f1b-4f7e-9a51-0c0de5c0a7b1";

fn expect(results: &Value, name: &str, expected: Value) {
    if results[name] != expected {
        fail(format!(
            "{name}: expected {expected}, got {}",
            results[name]
        ));
    }
}

pub fn run(root: &str, page_url: &str) {
    let harness = Harness::new("compat");
    Harness::use_kiri_transport();
    let origin = Harness::random_origin();
    let (moved, forwarded_history, forwarded_notification) = (
        Rc::new(Cell::new(false)),
        Rc::new(Cell::new(false)),
        Rc::new(Cell::new(false)),
    );
    {
        let (moved, history, notification) = (
            moved.clone(),
            forwarded_history.clone(),
            forwarded_notification.clone(),
        );
        // The app's side of forwarded requests, as useExtensionsRuntime answers them.
        harness.on_event(move |harness, event| match event["kind"].as_str() {
            Some("compat-request") => {
                let method = event["method"].as_str().unwrap_or_default();
                let result = match method {
                    "history.search" => {
                        history.set(true);
                        json!([{"id": "1", "url": "https://example.org/", "title": "Example", "lastVisitTime": 0, "visitCount": 1, "typedCount": 0}])
                    }
                    "notifications.create" => {
                        notification.set(true);
                        Value::Null
                    }
                    other => {
                        harness.fire(json!({"operation": "compat-reply", "requestId": event["requestId"], "error": format!("Unexpected forwarded method {other}")}));
                        return;
                    }
                };
                harness.fire(json!({"operation": "compat-reply", "requestId": event["requestId"], "result": result}));
            }
            Some("move-tab") => moved.set(event["tabId"] == "normal" && event["index"] == 0),
            _ => {}
        });
    }
    let permissions = [
        "storage",
        "webRequest",
        "webRequestBlocking",
        "declarativeNetRequest",
        "history",
        "idle",
        "notifications",
        "browsingData",
        "tabs",
    ];
    harness.request(json!({"operation": "configure", "controllerId": objc2_foundation::NSUUID::new().UUIDString().to_string(), "store": PROBE_STORE}));
    harness.request(json!({
        "operation": "load", "id": "1", "guid": "compat-fixture@misty.test", "origin": origin, "runtimePath": root,
        "privateAccess": false, "permissions": permissions, "hosts": ["http://127.0.0.1/*"],
    }));
    // WebKit treats a nonpersistent store as private browsing, where an extension without
    // private access has no rules. Normal tabs persist.
    let store = harness.named_store(PAGE_STORE);
    let page = harness.view_for(page_url, "normal", false, &store, true);
    misty_native::browser::extensions::macos::tab_event("probe", "normal", "activate");
    harness.spin(2.0);

    let checks = harness.view_for(
        &format!("webkit-extension://{origin}/check.html"),
        "checks",
        false,
        &store,
        true,
    );
    harness.spin(2.0);
    let results = harness
        .eval(&checks, "return await window.runChecks()", &json!({}))
        .unwrap_or_else(|e| fail(format!("Checks did not run: {e}")));
    eprintln!("results: {results}");
    expect(&results, "browserInfo", json!("Misty"));
    expect(&results, "self", json!("Misty compat fixture"));
    expect(&results, "managed", json!("{}"));
    expect(&results, "language", json!("fr"));
    require(
        ["active", "idle", "locked"].contains(&results["idle"].as_str().unwrap_or_default()),
        "idle.queryState returned no state",
    );
    expect(&results, "history", json!("https://example.org/"));
    expect(&results, "notification", json!("probe"));
    expect(&results, "browsingData", json!("removed"));
    expect(&results, "move", json!("moved"));
    let redirect = results["redirect"].as_str().unwrap_or_default().to_owned();
    require(
        redirect.starts_with(&format!("https://{origin}.extensions.misty.invalid/")),
        "identity.getRedirectURL used the wrong address",
    );
    require(
        forwarded_history.get() && forwarded_notification.get(),
        "Forwarded requests did not reach the app",
    );
    require(
        moved.get(),
        "tabs.move did not ask the workspace to move the tab",
    );

    // Learned blocking rules: the first request passes, the repeat is blocked, an unrelated one passes.
    let script =
        "const fetchStatus = (url) => fetch(url, { cache: 'no-store' }).then((r) => r.status, () => 'blocked');\
        const first = await fetchStatus(base + 'content.js?misty-block=1');\
        await new Promise((resolve) => setTimeout(resolve, 2000));\
        const second = await fetchStatus(base + 'content.js?misty-block=2');\
        const control = await fetchStatus(base + 'background.js?allowed=1');\
        return [first, second, control];";
    let statuses = harness
        .eval(&page, script, &json!({"base": page_url}))
        .unwrap_or_else(|e| fail(format!("Blocking check failed: {e}")));
    require(
        statuses[0] == 200,
        format!("First request should pass before learning: {statuses}"),
    );
    require(
        statuses[1] == "blocked",
        format!("Learned rule did not block the repeat request: {statuses}"),
    );
    require(
        statuses[2] == 200,
        format!("Learned rule blocked an unrelated request: {statuses}"),
    );

    // The provider's redirect must land on the extension's identity page.
    // SAFETY: loads the redirect the extension was given.
    unsafe {
        page.loadRequest(&objc2_foundation::NSURLRequest::requestWithURL(
            &super::support::url(&format!("{redirect}?code=probe")),
        ))
    };
    let swap = harness.wait_event("the OAuth redirect rewrite", 5.0, |e| {
        e["kind"] == "replace-view" && e["tabId"] == "normal"
    });
    let address = swap["url"].as_str().unwrap_or_default();
    let expected = format!("webkit-extension://{origin}/__misty_compat__/identity.html#");
    if !address.starts_with(&expected) || !address.contains("code%3Dprobe") {
        fail(format!("Unexpected identity page: {address}"));
    }
    harness.spin(0.2);
    println!("PASS: compatibility layer shims, native language/idle/site data, forwarded history and notifications, tabs.move, OAuth redirect rewrite, learned blocking");
}
