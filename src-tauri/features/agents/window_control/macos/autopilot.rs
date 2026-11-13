//! Window control: the agent drives Misty's own window with in-process events.
//! No global input is posted; the checks run in Rust before an action gets here.
use std::{cell::RefCell, sync::mpsc};

use base64::Engine;
use block2::RcBlock;
use objc2::{
    define_class, msg_send, rc::Retained, sel, AllocAnyThread, MainThreadMarker, MainThreadOnly,
};
use objc2_app_kit::{
    NSApplication, NSEvent, NSEventModifierFlags, NSEventType, NSScreen, NSView, NSWindow,
    NSWindowOrderingMode, NSWorkspace,
};
use objc2_core_graphics::CGImage;
use objc2_core_graphics::{CGEvent, CGScrollEventUnit};
use objc2_foundation::{
    NSError, NSNotFound, NSObjectProtocol, NSPoint, NSProcessInfo, NSRange, NSRect, NSSize,
    NSString,
};
use objc2_screen_capture_kit::{
    SCContentFilter, SCScreenshotManager, SCShareableContent, SCStreamConfiguration,
};
use serde_json::{json, Value};

use crate::agents::cursor::macos::{
    pointer::{arrow_view_frame, draw_arrow},
    screen_capture::{error_text, WAIT},
    support::{error_json, jpeg, macos_at_least, on_main_queued},
};

/// Window control needs the window-only ScreenCaptureKit stream of macOS 14.4.
pub(crate) fn supported() -> bool {
    macos_at_least(14, 4)
}

/// The error shown when Misty lost focus, naming what has it.
pub(crate) fn focus_reason() -> Value {
    let name = NSWorkspace::sharedWorkspace()
        .frontmostApplication()
        .and_then(|app| app.localizedName())
        .map(|name| name.to_string())
        .unwrap_or_else(|| "another window".to_owned());
    error_json(format!(
        "Misty lost focus to {name}. Bring Misty to the front, then resume."
    ))
}

define_class!(
    #[unsafe(super(NSView))]
    #[thread_kind = MainThreadOnly]
    #[name = "MistyAutopilotCursor"]
    struct AutopilotCursor;

    unsafe impl NSObjectProtocol for AutopilotCursor {}

    impl AutopilotCursor {
        #[unsafe(method(hitTest:))]
        fn hit_test(&self, _point: NSPoint) -> *mut NSView {
            std::ptr::null_mut()
        }

        #[unsafe(method(isFlipped))]
        fn is_flipped(&self) -> bool {
            true
        }

        #[unsafe(method(drawRect:))]
        fn draw_rect(&self, _rect: NSRect) {
            // The same arrow as the in-page and desktop agent cursors.
            draw_arrow(2.0);
        }
    }
);

thread_local! {
    static CURSOR: RefCell<Option<Retained<AutopilotCursor>>> = const { RefCell::new(None) };
}

pub(crate) fn hide_cursor() {
    on_main_queued(|_| {
        if let Some(cursor) = CURSOR.with(|slot| slot.borrow_mut().take()) {
            cursor.removeFromSuperview();
        }
    });
}

fn active_window(mtm: MainThreadMarker) -> Option<Retained<NSWindow>> {
    let app = NSApplication::sharedApplication(mtm);
    app.keyWindow()
        .filter(|window| app.isActive() && window.isVisible() && !window.isMiniaturized())
}

/// Spec for a workspace key: the key code and the character it types.
fn key_spec(key: &str) -> Option<(u16, &'static str, bool)> {
    Some(match key {
        "Enter" => (0x24, "\r", false),
        "Escape" => (0x35, "\u{1b}", false),
        "Tab" => (0x30, "\t", false),
        "Backspace" => (0x33, "\u{7f}", false),
        "ArrowLeft" => (0x7B, "\u{F702}", false),
        "ArrowRight" => (0x7C, "\u{F703}", false),
        "ArrowUp" => (0x7E, "\u{F700}", false),
        "ArrowDown" => (0x7D, "\u{F701}", false),
        "SelectAll" => (0x00, "a", true),
        "Undo" => (0x06, "z", true),
        "AddressBar" => (0x25, "l", true),
        "NewTab" => (0x11, "t", true),
        "Find" => (0x03, "f", true),
        _ => return None,
    })
}

fn integer(action: &Value, key: &str) -> i64 {
    action[key]
        .as_i64()
        .or_else(|| action[key].as_f64().map(|v| v as i64))
        .unwrap_or(0)
}

/// Called on the main queue, after the Rust task/grant checks. No global input is posted.
pub(crate) fn action(mtm: MainThreadMarker, input: &Value) -> Value {
    let app = NSApplication::sharedApplication(mtm);
    let frame: Vec<f64> = input["frame"]
        .as_array()
        .map(|list| list.iter().map(|v| v.as_f64().unwrap_or(0.0)).collect())
        .unwrap_or_default();
    let window = active_window(mtm).filter(|window| {
        window.windowNumber() as i64 == integer(input, "windowNumber") && frame.len() == 4
    });
    let Some(window) = window else {
        return error_json("Misty must be the active window. Resume when you are ready.");
    };
    let expected = NSRect::new(
        NSPoint::new(frame[0], frame[1]),
        NSSize::new(frame[2], frame[3]),
    );
    if expected != window.frame() {
        return error_json("browser_snapshot_stale: the window moved or resized; inspect again");
    }
    let action = &input["action"];
    let kind = action["kind"].as_str().unwrap_or("");
    let time = NSProcessInfo::processInfo().systemUptime();
    match kind {
        "point" | "scroll" => {
            let (x, y) = (
                action["x"].as_f64().unwrap_or(0.0),
                action["y"].as_f64().unwrap_or(0.0),
            );
            if !(x.is_finite()
                && y.is_finite()
                && (0.0..=1.0).contains(&x)
                && (0.0..=1.0).contains(&y))
            {
                return error_json("Invalid screenshot coordinates");
            }
            let size = window.frame().size;
            let point = NSPoint::new(x * size.width, (1.0 - y) * size.height);
            let Some(content_view) = window.contentView() else {
                return error_json("Only the Misty workspace can be controlled");
            };
            let content = content_view.convertRect_toView(content_view.bounds(), None);
            let inside = point.x >= content.origin.x
                && point.x < content.origin.x + content.size.width
                && point.y >= content.origin.y
                && point.y < content.origin.y + content.size.height;
            if !inside {
                return error_json("Only the Misty workspace can be controlled");
            }
            let cursor = CURSOR.with(|slot| {
                slot.borrow_mut()
                    .get_or_insert_with(|| {
                        let cursor: Retained<AutopilotCursor> = unsafe {
                            msg_send![AutopilotCursor::alloc(mtm), initWithFrame: arrow_view_frame()]
                        };
                        cursor.setWantsLayer(true);
                        cursor
                    })
                    .clone()
            });
            content_view.addSubview_positioned_relativeTo(
                &cursor,
                NSWindowOrderingMode::Above,
                None,
            );
            let local = content_view.convertPoint_fromView(point, None);
            // The tip (2,2) of the flipped view sits on the target.
            cursor.setFrame(NSRect::new(
                NSPoint::new(local.x - 2.0, local.y - 28.0),
                NSSize::new(26.0, 30.0),
            ));
            if kind == "point" {
                for kind in [NSEventType::LeftMouseDown, NSEventType::LeftMouseUp] {
                    if let Some(event) = NSEvent::mouseEventWithType_location_modifierFlags_timestamp_windowNumber_context_eventNumber_clickCount_pressure(
                        kind, point, NSEventModifierFlags::empty(), time, window.windowNumber(), None, 0, 1, 1.0,
                    ) {
                        app.sendEvent(&event);
                    }
                }
            } else {
                let (dy, dx) = (
                    integer(action, "deltaY") as i32,
                    integer(action, "deltaX") as i32,
                );
                if let Some(cg) =
                    CGEvent::new_scroll_wheel_event2(None, CGScrollEventUnit::Pixel, 2, -dy, -dx, 0)
                {
                    let screen = window.convertPointToScreen(point);
                    let top = NSScreen::screens(mtm)
                        .firstObject()
                        .map(|s| s.frame().size.height)
                        .unwrap_or(0.0);
                    CGEvent::set_location(Some(&cg), NSPoint::new(screen.x, top - screen.y));
                    let event = NSEvent::eventWithCGEvent(&cg);
                    let hit = content_view.hitTest(local);
                    if let (Some(hit), Some(event)) = (hit, event) {
                        hit.scrollWheel(&event);
                    }
                }
            }
        }
        "type" => {
            let responder = window.firstResponder();
            let text = action["text"]
                .as_str()
                .filter(|text| text.encode_utf16().count() <= 16000);
            let accepts = responder
                .as_ref()
                .is_some_and(|r| r.respondsToSelector(sel!(insertText:replacementRange:)));
            let (Some(text), Some(responder), true) = (text, responder, accepts) else {
                return error_json("Click an editable field before typing");
            };
            let range = NSRange::new(NSNotFound as usize, 0);
            // SAFETY: the responder was checked to implement NSTextInputClient's insertText.
            let _: () = unsafe {
                msg_send![&*responder, insertText: &*NSString::from_str(text), replacementRange: range]
            };
        }
        "key" => {
            let Some((code, characters, command)) = key_spec(action["key"].as_str().unwrap_or(""))
            else {
                return error_json("Unsupported workspace key");
            };
            let flags = if command {
                NSEventModifierFlags::Command
            } else {
                NSEventModifierFlags::empty()
            };
            let characters = NSString::from_str(characters);
            for kind in [NSEventType::KeyDown, NSEventType::KeyUp] {
                if let Some(event) = NSEvent::keyEventWithType_location_modifierFlags_timestamp_windowNumber_context_characters_charactersIgnoringModifiers_isARepeat_keyCode(
                    kind, NSPoint::new(0.0, 0.0), flags, time, window.windowNumber(), None, &characters, &characters, false, code,
                ) {
                    app.sendEvent(&event);
                }
            }
        }
        _ => return error_json("Unsupported workspace action"),
    }
    json!({"attempted": true, "verified": false})
}

/// Worker entry point. Captures the active Misty window including every child webview.
pub(crate) fn capture() -> Value {
    if !macos_at_least(14, 4) {
        return error_json("Misty window control requires macOS 14.4 or later");
    }
    let (send, receive) = mpsc::channel::<Value>();
    on_main_queued(move |mtm| {
        let Some(window) = active_window(mtm) else {
            let _ = send.send(error_json(
                "Bring Misty to the front before starting control.",
            ));
            return;
        };
        let number = window.windowNumber();
        let frame = window.frame();
        let handler = RcBlock::new(
            move |content: *mut SCShareableContent, error: *mut NSError| {
                // SAFETY: null or live content for the call's duration.
                let target = unsafe { content.as_ref() }.and_then(|content| unsafe {
                    content
                        .windows()
                        .iter()
                        .find(|candidate| candidate.windowID() as isize == number)
                });
                let Some(target) = target else {
                    let _ = send.send(error_json(
                        error_text(error).unwrap_or_else(|| "Misty window is unavailable".into()),
                    ));
                    return;
                };
                // SAFETY: a window from the same content; the configuration is set before capture.
                let (filter, config) = unsafe {
                    let filter = SCContentFilter::initWithDesktopIndependentWindow(
                        SCContentFilter::alloc(),
                        &target,
                    );
                    let config = SCStreamConfiguration::new();
                    let size = target.frame().size;
                    let scale = 2.0_f64.min(2000.0 / size.width.max(size.height));
                    config.setWidth(((size.width * scale) as usize).max(1));
                    config.setHeight(((size.height * scale) as usize).max(1));
                    config.setShowsCursor(false);
                    config.setIgnoreShadowsSingleWindow(true);
                    (filter, config)
                };
                let send = send.clone();
                let done = RcBlock::new(move |image: *mut CGImage, error: *mut NSError| {
                    // SAFETY: null or a live image for the call's duration.
                    let Some(image) = (unsafe { image.as_ref() }) else {
                        let _ = send.send(error_json(
                            error_text(error).unwrap_or_else(|| "Window capture failed".into()),
                        ));
                        return;
                    };
                    let Some(bytes) = jpeg(image, 0.85) else {
                        let _ = send.send(error_json("Window capture failed"));
                        return;
                    };
                    let data = base64::engine::general_purpose::STANDARD.encode(bytes);
                    let _ = send.send(json!({
                    "image": {
                        "dataUrl": format!("data:image/jpeg;base64,{data}"),
                        "width": CGImage::width(Some(image)),
                        "height": CGImage::height(Some(image)),
                    },
                    "windowNumber": number,
                    "frame": [frame.origin.x, frame.origin.y, frame.size.width, frame.size.height],
                }));
                });
                // SAFETY: the filter and configuration are fully set.
                unsafe {
                    SCScreenshotManager::captureImageWithFilter_configuration_completionHandler(
                        &filter,
                        &config,
                        Some(&done),
                    );
                }
            },
        );
        // SAFETY: the handler is a valid block for the call.
        unsafe {
            SCShareableContent::getCurrentProcessShareableContentWithCompletionHandler(&handler)
        };
    });
    receive
        .recv_timeout(WAIT)
        .unwrap_or_else(|_| error_json("Window capture timed out"))
}
