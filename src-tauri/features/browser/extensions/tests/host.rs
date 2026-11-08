// SPDX-License-Identifier: MIT
//! The production host with MIT-owned fixtures: normal and private content scripts, background
//! messages, the sync bridge, the action popup, options storage, and a navigation swap that
//! keeps the original POST request and the tab's identity.
use super::support::{fail, require, Harness, PROBE_STORE};
use super::support::{string, url};
use misty_native::browser::extensions::macos;
use objc2::rc::Retained;
use objc2_foundation::{NSData, NSMutableURLRequest};
use objc2_web_kit::WKWebView;
use serde_json::json;

pub fn run(root: &str, page: &str) {
    let harness = Harness::new("fixture");
    harness.request(json!({"operation": "configure", "controllerId": objc2_foundation::NSUUID::new().UUIDString().to_string(), "store": PROBE_STORE}));
    harness.request(json!({
        "operation": "load", "id": "1", "guid": "native-fixture@misty.test",
        "origin": Harness::random_origin(), "runtimePath": root, "privateAccess": true,
        "permissions": ["storage", "activeTab", "scripting"], "hosts": ["http://127.0.0.1/*"],
    }));
    let probe_store = nonpersistent(&harness);
    let normal = harness.view_for(page, "normal", false, &probe_store, true);
    let private = harness.view_for(page, "private", true, &probe_store, true);
    macos::tab_event("probe", "normal", "activate");

    // The bridge reports, and both pages hear their content script and background.
    harness.wait_event("the sync bridge", 40.0, |e| e["kind"] == "sync-ready");
    let fixture = |view: &WKWebView, what: &str| {
        harness.wait_until(what, 40.0, || {
            harness
                .eval(
                    view,
                    "return document.documentElement.dataset.mistyFixture ?? ''",
                    &json!({}),
                )
                .ok()
                == Some(json!("content-and-background"))
        });
    };
    fixture(&normal, "the normal tab's content script");
    fixture(&private, "the private tab's content script");

    harness
        .request(json!({"operation": "sync-apply", "id": "1", "changes": {"fixture": {"value": "replicated-value"}}}));
    harness.request(json!({"operation": "sync-restored", "id": "1"}));
    harness.request(json!({"operation": "invoke", "id": "1", "tabId": "normal"}));
    harness.spin(1.0);
    let title = harness
        .request(json!({"operation": "popup-evaluate", "id": "1", "tabId": "normal", "script": "document.title"}));
    require(
        title["result"] == "Misty fixture",
        "Action popup did not load fixture HTML",
    );

    // The options page opens as a Misty tab and reads the replicated storage.
    harness.request(json!({"operation": "options", "id": "1"}));
    let open = harness.wait_event("the options tab request", 20.0, |e| e["kind"] == "open-tab");
    let options = harness.view_for(
        open["url"].as_str().expect("url"),
        "options",
        false,
        &probe_store,
        true,
    );
    harness.spin(1.0);
    let stored = harness
        .eval(
            &options,
            "return (await browser.storage.sync.get('fixture')).fixture",
            &json!({}),
        )
        .unwrap_or_else(|e| fail(e));
    require(
        stored == "replicated-value",
        "Options page could not read replicated storage",
    );

    // A POST to a website swaps the tab's native view and keeps the request and the identity.
    let post = NSMutableURLRequest::requestWithURL(&url(page));
    post.setHTTPMethod(&string("POST"));
    post.setHTTPBody(Some(&NSData::with_bytes(b"fixture=retained")));
    // SAFETY: loads the request the probe built.
    unsafe { options.loadRequest(&post) };
    let swap = harness.wait_event("the view swap", 20.0, |e| e["kind"] == "replace-view");
    require(
        swap["tabId"] == "options",
        "Logical tab identity changed during navigation",
    );
    let website = harness.view_for(
        swap["url"].as_str().expect("url"),
        "options",
        false,
        &probe_store,
        false,
    );
    harness.spin(1.0);
    let title = harness
        .eval(&website, "return document.title", &json!({}))
        .unwrap_or_else(|e| fail(e));
    require(
        title == "POST retained",
        "Navigation swap lost the original POST request",
    );

    harness.request(json!({"operation": "unload", "id": "1"}));
    harness.request(json!({"operation": "remove", "id": "1", "guid": "native-fixture@misty.test"}));
    println!(
        "PASS: production host, normal/private content scripts, background messages, sync bridge apply, action popup, options storage, navigation swap preserving POST and logical identity, disabled-extension cleanup; peak process RSS {:.1} MiB",
        super::peak_rss_mib()
    );
}

fn nonpersistent(harness: &Harness) -> Retained<objc2_web_kit::WKWebsiteDataStore> {
    // SAFETY: a private-browsing store for the probe's pages.
    unsafe { objc2_web_kit::WKWebsiteDataStore::nonPersistentDataStore(harness.mtm) }
}
