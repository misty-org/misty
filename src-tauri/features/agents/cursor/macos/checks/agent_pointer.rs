//! Live check of Misty's desktop actions: opens a text file in TextEdit, then
//! clicks into it, types and selects through Accessibility while the person's
//! pointer stays where it is. Run with `npm run check:desktop-agent` (macOS,
//! Accessibility allowed for the terminal). It edits only a scratch file. The
//! pointer and mist drawings need the app's main thread, so they are not part
//! of this check.
use std::{
    io::Write,
    sync::atomic::{AtomicI32, Ordering},
    sync::Arc,
};

use block2::RcBlock;
use objc2_app_kit::{NSRunningApplication, NSWorkspace, NSWorkspaceOpenConfiguration};
use objc2_core_graphics::CGEvent;
use objc2_foundation::{NSArray, NSError, NSString, NSURL};
use serde_json::json;

use crate::agents::cursor::macos::{
    accessibility::{trusted, Element},
    pointer_actions::perform,
};

fn text_area(pid: i32) -> Option<Element> {
    let mut queue = std::collections::VecDeque::from(vec![Element::application(pid)
        .windows()
        .into_iter()
        .next()?]);
    while let Some(element) = queue.pop_front() {
        if element.string("AXRole") == "AXTextArea" {
            return Some(element);
        }
        queue.extend(element.children());
    }
    None
}

fn spin(seconds: f64) {
    std::thread::sleep(std::time::Duration::from_secs_f64(seconds));
}

#[test]
#[ignore = "drives TextEdit; run with --ignored and Accessibility allowed"]
fn agent_pointer_clicks_types_and_selects_in_textedit() {
    assert!(
        trusted(),
        "Allow this terminal in System Settings \u{2192} Privacy & Security \u{2192} Accessibility, then run again."
    );
    let mut file = tempfile::Builder::new()
        .prefix("Misty desktop check")
        .suffix(".txt")
        .tempfile()
        .expect("scratch file");
    file.write_all(b"Scratch file for Misty's desktop pointer check.")
        .unwrap();
    let url = NSURL::fileURLWithPath(&NSString::from_str(file.path().to_str().unwrap()));

    let config = NSWorkspaceOpenConfiguration::configuration();
    config.setActivates(false);
    let editor = Arc::new(AtomicI32::new(0));
    let opened = editor.clone();
    let done = RcBlock::new(
        move |app: *mut NSRunningApplication, _error: *mut NSError| {
            // SAFETY: null or a live application for the call's duration.
            if let Some(app) = unsafe { app.as_ref() } {
                opened.store(app.processIdentifier(), Ordering::SeqCst);
            }
        },
    );
    let workspace = NSWorkspace::sharedWorkspace();
    let app_url = workspace
        .URLForApplicationWithBundleIdentifier(&NSString::from_str("com.apple.TextEdit"))
        .expect("TextEdit is installed");
    workspace.openURLs_withApplicationAtURL_configuration_completionHandler(
        &NSArray::from_retained_slice(&[url]),
        &app_url,
        &config,
        Some(&done),
    );

    let mut area = None;
    for _ in 0..40 {
        if area.is_some() {
            break;
        }
        spin(0.25);
        let pid = editor.load(Ordering::SeqCst);
        if pid != 0 {
            area = text_area(pid);
        }
    }
    let area = area.expect("TextEdit's text area did not appear.");
    let human = CGEvent::location(CGEvent::new(None).as_deref());

    let frame = area.frame().expect("the text area has a frame");
    let (x, y) = (
        frame.origin.x + frame.size.width / 2.0,
        frame.origin.y + frame.size.height / 2.0,
    );
    let point = perform(&json!({"kind": "point", "x": 0, "y": 0}), x, y);
    assert!(point["error"].is_null(), "{}", point["error"]);
    spin(0.4);
    let typed = perform(&json!({"kind": "type", "text": " Misty was here."}), x, y);
    assert!(typed["error"].is_null(), "{}", typed["error"]);
    spin(0.4);
    let text = area.string("AXValue");
    assert!(
        text.contains("Misty was here."),
        "Typed text missing: {text}"
    );
    let selected = perform(&json!({"kind": "key", "key": "SelectAll"}), x, y);
    assert!(selected["error"].is_null(), "{}", selected["error"]);

    let now = CGEvent::location(CGEvent::new(None).as_deref());
    assert!(
        (now.x - human.x).abs() <= 0.5 && (now.y - human.y).abs() <= 0.5,
        "The person's pointer moved."
    );
    println!(
        "PASS clicked {}, typed and selected in TextEdit; your pointer stayed at ({:.0}, {:.0}).",
        point["effect"].as_str().unwrap_or(""),
        human.x,
        human.y
    );
}
