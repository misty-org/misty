// SPDX-License-Identifier: MIT
//! Runs an extension that asks for everything through the production host, grants it only part
//! of that, and checks what it can reach: WebKit's own APIs, Misty's native answers, other
//! hosts, the page's world, extension pages it wasn't given, and access taken back while it runs.
use super::support::{fail, require, Harness};
use objc2::{
    define_class, msg_send,
    rc::Retained,
    runtime::{NSObject, ProtocolObject},
    MainThreadOnly,
};
use objc2_foundation::NSObjectProtocol;
use objc2_web_kit::{
    WKScriptMessage, WKScriptMessageHandler, WKUserContentController, WKUserScript,
    WKUserScriptInjectionTime, WKWebView, WKWebViewConfiguration,
};
use serde_json::{json, Value};
use std::{cell::RefCell, rc::Rc};

const PROBE_STORE: &str = "6D697374-7900-4000-8000-70726F626574";
const PAGE_STORE: &str = "7d4a6c2e-3f1b-4f7e-9a51-0c0de5c0a7b2";

define_class!(
    /// A handler in the page's world, standing in for Misty's own.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    struct HostHandler;

    unsafe impl NSObjectProtocol for HostHandler {}

    unsafe impl WKScriptMessageHandler for HostHandler {
        #[unsafe(method(userContentController:didReceiveScriptMessage:))]
        fn did_receive(&self, _controller: &WKUserContentController, _message: &WKScriptMessage) {}
    }
);

fn refused(results: &Value, name: &str) {
    let value = &results[name];
    require(
        value
            .as_str()
            .is_some_and(|text| text.starts_with("error:")),
        format!("{name} should be refused, got {value} ({results})"),
    );
}

fn equal(results: &Value, name: &str, expected: Value) {
    require(
        results[name] == expected,
        format!("{name}: expected {expected}, got {}", results[name]),
    );
}

struct Probe<'a> {
    harness: &'a Harness,
    origin: String,
    root: String,
    store: Retained<objc2_web_kit::WKWebsiteDataStore>,
    handler: Retained<HostHandler>,
}

impl Probe<'_> {
    fn descriptor(
        &self,
        id: &str,
        guid: &str,
        origin: &str,
        permissions: Value,
        hosts: Value,
    ) -> Value {
        json!({"operation": "load", "id": id, "guid": guid, "origin": origin, "runtimePath": self.root,
            "privateAccess": false, "permissions": permissions, "hosts": hosts})
    }

    fn view(&self, page: &str, identifier: &str) -> Retained<WKWebView> {
        // SAFETY: WebKit configuration on the main thread.
        let original = unsafe { WKWebViewConfiguration::new(self.harness.mtm) };
        unsafe {
            original.setWebsiteDataStore(&self.store);
            // A handler and a global in the page's world, standing in for Misty's own.
            original
                .userContentController()
                .addScriptMessageHandler_name(
                    ProtocolObject::from_ref(&*self.handler),
                    &super::support::string("probeHost"),
                );
            let script = WKUserScript::initWithSource_injectionTime_forMainFrameOnly(
                WKUserScript::alloc(self.harness.mtm),
                &super::support::string("window.__PROBE_PAGE_SECRET__ = 'token'; document.documentElement.dataset.pageSawHandler = typeof window.webkit?.messageHandlers?.probeHost;"),
                WKUserScriptInjectionTime::AtDocumentStart,
                true,
            );
            original.userContentController().addUserScript(&script);
        }
        self.harness
            .view_with(&original, page, identifier, false, true)
    }

    fn run_checks(&self) -> Value {
        let id = format!("checks-{}", objc2_foundation::NSUUID::new().UUIDString());
        let checks = self.view(
            &format!("webkit-extension://{}/check.html", self.origin),
            &id,
        );
        self.harness.spin(2.0);
        let results = self
            .harness
            .eval(&checks, "return await window.runChecks()", &json!({}))
            .unwrap_or_else(|e| fail(format!("Checks did not run: {e}")));
        eprintln!("results: {results}");
        checks.removeFromSuperview();
        results
    }
}

pub fn run(root: &str, granted: &str) {
    let harness = Harness::new("permissions");
    Harness::use_kiri_transport();
    // Misty's rule stands in here: only `public.html`, as the manifest lists it.
    misty_native::browser::extensions::macos::set_navigation_policy(|_tab, url, _source| {
        url.ends_with("/public.html")
    });
    let swaps: Rc<RefCell<Vec<String>>> = Rc::default();
    {
        let swaps = swaps.clone();
        // The app's side of a request the native host let through.
        harness.on_event(move |harness, event| match event["kind"].as_str() {
            Some("replace-view") => swaps
                .borrow_mut()
                .push(event["url"].as_str().unwrap_or_default().to_owned()),
            Some("compat-request") => harness.fire(
                json!({"operation": "compat-reply", "requestId": event["requestId"], "result": []}),
            ),
            _ => {}
        });
    }
    let handler: Retained<HostHandler> = {
        let this = harness.mtm.alloc::<HostHandler>().set_ivars(());
        // SAFETY: NSObject's designated initializer.
        unsafe { msg_send![super(this), init] }
    };
    let probe = Probe {
        harness: &harness,
        origin: Harness::random_origin(),
        root: root.to_owned(),
        store: harness.named_store(PAGE_STORE),
        handler,
    };
    // The manifest asks for all of it; only this much is granted.
    harness.request(json!({"operation": "configure", "controllerId": objc2_foundation::NSUUID::new().UUIDString().to_string(), "store": PROBE_STORE}));
    harness.request(probe.descriptor(
        "1",
        "permissions-fixture@misty.test",
        &probe.origin,
        json!(["storage"]),
        json!(["http://127.0.0.1/*"]),
    ));
    let page = probe.view(granted, "normal");
    misty_native::browser::extensions::macos::tab_event("probe", "normal", "activate");
    harness.spin(2.0);

    // Isolation: the content script runs on a granted host only, and is cut off from the page's world.
    let own = harness
        .eval(
            &page,
            "return document.documentElement.dataset.pageSawHandler",
            &json!({}),
        )
        .unwrap_or_else(|e| fail(e));
    require(
        own == "object",
        format!("The page's world should see its handler: {own}"),
    );
    let main_world = harness
        .eval(
            &page,
            "return document.documentElement.dataset.mainWorldSawSecret ?? 'did not run'",
            &json!({}),
        )
        .unwrap_or_else(|e| fail(e));
    eprintln!(
        "A main-world content script at document_start saw the embedder's script: {main_world}"
    );
    require(
        main_world == "string",
        format!("A main-world content script ran before the embedder's script: {main_world}"),
    );
    let script = "return document.documentElement.dataset.mistyPermissions ?? 'none'";
    let seen = harness
        .eval(&page, script, &json!({}))
        .unwrap_or_else(|e| fail(e));
    let text = seen.as_str().unwrap_or("none");
    require(
        text != "none",
        format!("The content script did not run on a granted host: {seen}"),
    );
    let seen: Value = serde_json::from_str(text).unwrap_or(Value::Null);
    for key in ["handler", "pageSecret", "tauri"] {
        require(
            seen[key] == "undefined",
            format!("A content script reached the page's {key}: {seen}"),
        );
    }
    let hidden = probe.view(&granted.replace("127.0.0.1", "localhost"), "ungranted-host");
    harness.spin(2.0);
    let blocked = harness
        .eval(&hidden, script, &json!({}))
        .unwrap_or_else(|e| fail(e));
    require(
        blocked == "none",
        format!("A content script ran on a host it wasn't granted: {blocked}"),
    );
    let results = probe.run_checks();
    equal(&results, "storage", json!("kept"));
    for name in [
        "cookies",
        "rules",
        "history",
        "bookmarks",
        "downloads",
        "downloadsOpen",
        "cookieHeader",
        "browsingData",
    ] {
        refused(&results, name);
    }
    equal(&results, "webNavigation", json!("undefined"));
    require(
        !results["ungrantedTab"]
            .as_str()
            .unwrap_or_default()
            .contains("localhost"),
        format!(
            "A tab on an ungranted host was visible: {}",
            results["ungrantedTab"]
        ),
    );
    require(
        results["grantedTab"]
            .as_str()
            .unwrap_or_default()
            .contains("127.0.0.1"),
        format!(
            "A tab on a granted host was hidden: {}",
            results["grantedTab"]
        ),
    );

    // With the downloads permission granted, the two things it still can't do.
    harness.request(probe.descriptor(
        "1",
        "permissions-fixture@misty.test",
        &probe.origin,
        json!(["storage", "downloads"]),
        json!(["http://127.0.0.1/*"]),
    ));
    let results = probe.run_checks();
    refused(&results, "downloadsOpen");
    require(
        results["downloadsOpen"]
            .as_str()
            .unwrap_or_default()
            .contains("not available"),
        results["downloadsOpen"].to_string(),
    );
    require(
        results["cookieHeader"]
            .as_str()
            .unwrap_or_default()
            .contains("Unsafe download header"),
        format!("Cookie header: {}", results["cookieHeader"]),
    );

    // A website can't move a tab into an extension page the manifest doesn't list.
    let go = |path: &str| {
        harness
            .eval(
                &page,
                "location.href = target; return null",
                &json!({"target": format!("webkit-extension://{}/{path}", probe.origin)}),
            )
            .ok();
    };
    go("options.html?do=harm");
    harness.spin(1.5);
    require(
        swaps.borrow().is_empty(),
        format!(
            "A website opened an unlisted extension page: {:?}",
            swaps.borrow().first()
        ),
    );
    go("public.html");
    harness.spin(1.5);
    require(
        swaps
            .borrow()
            .first()
            .is_some_and(|url| url.ends_with("/public.html")),
        "A listed extension page did not open",
    );

    // Access taken away from a running extension stops without a restart.
    harness.request(probe.descriptor(
        "1",
        "permissions-fixture@misty.test",
        &probe.origin,
        json!(["storage", "history"]),
        json!(["http://127.0.0.1/*"]),
    ));
    let wide = probe.run_checks();
    if wide["history"]
        .as_str()
        .is_some_and(|text| text.contains("permission is required"))
    {
        fail("Granted history was refused");
    }
    harness.request(probe.descriptor(
        "1",
        "permissions-fixture@misty.test",
        &probe.origin,
        json!(["storage"]),
        json!(["http://127.0.0.1/*"]),
    ));
    refused(&probe.run_checks(), "history");

    // A second extension with the same package reads its own storage, never the first one's.
    let other = Harness::random_origin();
    harness.request(probe.descriptor(
        "2",
        "other-fixture@misty.test",
        &other,
        json!(["storage"]),
        json!([]),
    ));
    let check = probe.view(&format!("webkit-extension://{other}/check.html"), "other");
    harness.spin(2.0);
    let stored = harness
        .eval(
            &check,
            "return JSON.stringify(await browser.storage.local.get('mine'))",
            &json!({}),
        )
        .unwrap_or_else(|e| fail(e));
    require(
        stored == "{}",
        format!("Another extension's storage leaked: {stored}"),
    );
    let open =
        "try { await browser.tabs.create({ url }); return 'opened'; } catch (failure) { return failure.message; }";
    let answer = harness
        .eval(
            &check,
            open,
            &json!({"url": format!("webkit-extension://{}/options.html", probe.origin)}),
        )
        .unwrap_or_else(|e| fail(e));
    require(
        answer != "opened",
        format!("An extension opened another's page: {answer}"),
    );
    println!("PASS: ungranted WebKit and native APIs refused, hidden hosts stay hidden, content scripts only on granted hosts and cut off from the page's world, downloads.open and unsafe download headers refused, unlisted extension pages closed to websites, removed access stops at once, another extension's storage and pages out of reach");
}
