//! macOS integration regression: exercises real trusted WKWebView events.
//!
//! AppKit needs the process's main thread and a window server, so this is a test with
//! its own `main` (see `Cargo.toml`) and only runs when asked:
//! `MISTY_NATIVE_INPUT_TEST=1 cargo test --test browser_native_input`.
#![cfg(target_os = "macos")]
#![allow(dead_code, unused_imports)]

#[path = "../macos/keys.rs"]
mod keys;
#[path = "../macos/lock.rs"]
mod lock;
#[path = "../macos/native_action.rs"]
mod native_action;

use lock::set_locked;
use native_action::perform;
use objc2::rc::Retained;
use objc2::{MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSApplication, NSApplicationActivationPolicy, NSBackingStoreType, NSWindow, NSWindowStyleMask,
};
use objc2_foundation::{NSDate, NSPoint, NSRect, NSRunLoop, NSSize, NSString};
use objc2_web_kit::{WKWebView, WKWebViewConfiguration};
use serde_json::{json, Value};
use std::{cell::RefCell, rc::Rc};

const PAGE: &str = "<html><body style='margin:0'><input id='text' style='position:absolute;left:20px;top:20px;width:200px;height:40px'><canvas style='position:absolute;top:100px;left:0' width='800' height='450'></canvas><script>window.events=[];for(const name of ['mousedown','mousemove','mouseup','keydown','keyup','input'])document.addEventListener(name,e=>events.push({type:e.type,x:e.clientX,y:e.clientY,key:e.key,code:e.code,trusted:e.isTrusted}));</script></body></html>";

fn spin(seconds: f64) {
    NSRunLoop::currentRunLoop().runUntilDate(&NSDate::dateWithTimeIntervalSinceNow(seconds));
}

/// Runs `script` in the page and returns its JSON-encoded result.
fn evaluate(view: &WKWebView, script: &str) -> Value {
    let slot: Rc<RefCell<Option<String>>> = Rc::default();
    let sink = slot.clone();
    let done = block2::RcBlock::new(
        move |value: *mut objc2::runtime::AnyObject, error: *mut objc2_foundation::NSError| {
            assert!(error.is_null(), "evaluate failed");
            // SAFETY: the script returns a JSON string.
            let text = unsafe { value.cast::<NSString>().as_ref() }.map(|text| text.to_string());
            *sink.borrow_mut() = Some(text.unwrap_or_default());
        },
    );
    // SAFETY: called on the main thread with a valid completion handler.
    unsafe {
        view.evaluateJavaScript_completionHandler(
            &NSString::from_str(&format!("JSON.stringify({script})")),
            Some(&done),
        )
    };
    let limit = std::time::Instant::now() + std::time::Duration::from_secs(4);
    while slot.borrow().is_none() && std::time::Instant::now() < limit {
        spin(0.01);
    }
    let text = slot.borrow().clone().expect("evaluate timed out");
    serde_json::from_str(&text).unwrap_or(Value::Null)
}

fn action(mtm: MainThreadMarker, view: &WKWebView, action: Value) {
    let editable = evaluate(
        view,
        "document.activeElement.matches('input,textarea') || document.activeElement.isContentEditable",
    );
    let input =
        json!({"viewport": {"width": 800, "height": 600}, "editable": editable, "action": action});
    let result = perform(mtm, view, &input);
    assert!(result["error"].is_null(), "action failed: {result}");
    spin(0.1);
}

fn main() {
    if std::env::var_os("MISTY_NATIVE_INPUT_TEST").is_none() {
        println!("skipped: set MISTY_NATIVE_INPUT_TEST=1 to run with a window server");
        return;
    }
    let mtm = MainThreadMarker::new().expect("native test must run on the main thread");
    let app = NSApplication::sharedApplication(mtm);
    app.setActivationPolicy(NSApplicationActivationPolicy::Accessory);
    let frame = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(800.0, 600.0));
    // SAFETY: the standard AppKit initialisers, called on the main thread.
    let window: Retained<NSWindow> = unsafe {
        NSWindow::initWithContentRect_styleMask_backing_defer(
            NSWindow::alloc(mtm),
            frame,
            NSWindowStyleMask::Titled,
            NSBackingStoreType::Buffered,
            false,
        )
    };
    let view = unsafe {
        WKWebView::initWithFrame_configuration(
            WKWebView::alloc(mtm),
            frame,
            &WKWebViewConfiguration::new(mtm),
        )
    };
    window.setContentView(Some(&view));
    window.orderBack(None);
    unsafe { view.loadHTMLString_baseURL(&NSString::from_str(PAGE), None) };
    spin(1.0);
    set_locked(&view, true);
    action(mtm, &view, json!({"kind": "click", "x": 0.1, "y": 0.065}));
    action(mtm, &view, json!({"kind": "type", "text": "house"}));
    action(mtm, &view, json!({"kind": "key", "key": "r"}));
    action(
        mtm,
        &view,
        json!({"kind": "key", "key": "a", "modifiers": ["Meta"]}),
    );
    action(mtm, &view, json!({"kind": "type", "text": "roof"}));
    action(
        mtm,
        &view,
        json!({"kind": "drag", "fromX": 0.2, "fromY": 0.3, "toX": 0.7, "toY": 0.8}),
    );
    let result = evaluate(
        &view,
        "({value:document.querySelector('input').value,events:window.events})",
    );
    println!("{result}");
    let events = result["events"].as_array().cloned().unwrap_or_default();
    let dragged = events
        .iter()
        .any(|event| event["type"] == "mouseup" && event["x"] == 560 && event["y"] == 480);
    let keyed = events.iter().any(|event| event["code"] == "KeyR");
    assert_eq!(result["value"], "roof");
    assert!(dragged, "drag did not end at 560,480");
    assert!(keyed, "KeyR was not delivered");
    window.orderOut(None);
    println!("PASS scoped WKWebView click/type/key/drag");
}
