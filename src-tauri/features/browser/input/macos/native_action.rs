//! Trusted WKWebView input: builds real AppKit events and hands them to the granted view.
//!
//! Called only on the main thread following task, grant and snapshot checks. Never use
//! `NSApp.sendEvent` or `CGEventPost`: those could reach browser chrome, a different
//! app, or a window that became active while the model was thinking.

use super::keys::key_spec;
use objc2::rc::{autoreleasepool, Retained};
use objc2::{msg_send, MainThreadMarker};
use objc2_app_kit::{
    NSEvent, NSEventModifierFlags, NSEventType, NSResponder, NSScreen,
    NSStandardKeyBindingResponding, NSView,
};
use objc2_core_graphics::{CGEvent, CGScrollEventUnit};
use objc2_foundation::{NSObjectProtocol, NSPoint, NSRange, NSString, NSTimeInterval};
use objc2_web_kit::WKWebView;
use serde_json::{json, Value};

const NOT_FOUND: usize = usize::MAX;

type Outcome = Result<(), &'static str>;

/// Performs `input` (`{"action", "viewport", "editable"}`) on `view` and says what happened.
pub(crate) fn perform(mtm: MainThreadMarker, view: &WKWebView, input: &Value) -> Value {
    autoreleasepool(|_| match act(mtm, view, input) {
        Ok(()) => json!({"attempted": true, "verified": false, "driver": "native-wkwebview"}),
        Err(error) => json!({"error": error}),
    })
}

fn number(value: &Value) -> f64 {
    value.as_f64().unwrap_or(0.0)
}

/// A point inside the view, from fractions of its width and height measured from the top left.
fn point_in(view: &NSView, x: f64, y: f64) -> NSPoint {
    let bounds = view.bounds();
    let (width, height) = (bounds.size.width, bounds.size.height);
    NSPoint::new(
        bounds.origin.x + (width - 1.0).min(x * width),
        bounds.origin.y
            + if view.isFlipped() {
                (height - 1.0).min(y * height)
            } else {
                ((1.0 - y) * height).max(1.0)
            },
    )
}

fn mouse_event(
    view: &NSView,
    kind: NSEventType,
    point: NSPoint,
    count: isize,
    time: NSTimeInterval,
) -> Option<Retained<NSEvent>> {
    let up = kind == NSEventType::LeftMouseUp || kind == NSEventType::RightMouseUp;
    NSEvent::mouseEventWithType_location_modifierFlags_timestamp_windowNumber_context_eventNumber_clickCount_pressure(
        kind,
        view.convertPoint_toView(point, None),
        NSEventModifierFlags::empty(),
        time,
        view.window().map_or(0, |window| window.windowNumber()),
        None,
        0,
        count,
        if up { 0.0 } else { 1.0 },
    )
}

fn hit(view: &NSView, point: NSPoint) -> Option<Retained<NSView>> {
    // SAFETY: plain AppKit geometry and hit testing on the main thread.
    let target =
        unsafe { view.hitTest(view.convertPoint_toView(point, view.superview().as_deref())) }?;
    (std::ptr::eq(&*target, view) || target.isDescendantOf(view)).then_some(target)
}

fn act(mtm: MainThreadMarker, view: &WKWebView, input: &Value) -> Outcome {
    let Some(window) = view.window() else {
        return Err("The granted browser must be visible before native input.");
    };
    if !window.isVisible() || window.isMiniaturized() || view.isHiddenOrHasHiddenAncestor() {
        return Err("The granted browser must be visible before native input.");
    }
    let bounds = view.bounds();
    // SAFETY: a plain property read on the main thread.
    let zoom = unsafe { view.pageZoom() };
    let viewport = &input["viewport"];
    if (bounds.size.width / zoom - number(&viewport["width"])).abs() > 2.0
        || (bounds.size.height / zoom - number(&viewport["height"])).abs() > 2.0
    {
        return Err("browser_snapshot_stale: browser viewport resized before native input");
    }
    let action = &input["action"];
    let kind = action["kind"].as_str().unwrap_or("");
    let time = objc2_foundation::NSProcessInfo::processInfo().systemUptime();
    let view: &NSView = view;
    if matches!(kind, "click" | "drag" | "scroll" | "move") {
        let drag = kind == "drag";
        let (x, y) = if drag { ("fromX", "fromY") } else { ("x", "y") };
        let point = point_in(view, number(&action[x]), number(&action[y]));
        let Some(target) = hit(view, point) else {
            return Err("The inspected browser target is unavailable");
        };
        match kind {
            "move" => {
                // The pointer comes to rest over the control, so the page's own :hover menus open.
                if let Some(event) = mouse_event(view, NSEventType::MouseMoved, point, 0, time) {
                    target.mouseMoved(&event);
                }
            }
            "scroll" => scroll(mtm, view, &target, point, action),
            _ => click_or_drag(view, &target, point, action, drag, time),
        }
        return Ok(());
    }
    let responder: Retained<NSResponder> = match window.firstResponder() {
        Some(responder)
            if responder
                .downcast_ref::<NSView>()
                .is_some_and(|inside| inside.isDescendantOf(view)) =>
        {
            responder
        }
        _ => {
            if kind == "type" {
                return Err("Focus an editable field in the granted browser before typing");
            }
            let bounds = view.bounds();
            let center = NSPoint::new(
                bounds.origin.x + bounds.size.width / 2.0,
                bounds.origin.y + bounds.size.height / 2.0,
            );
            // SAFETY: plain AppKit geometry and hit testing on the main thread.
            let focus = unsafe {
                view.hitTest(view.convertPoint_toView(center, view.superview().as_deref()))
            }
            .filter(|focus| focus.isDescendantOf(view));
            match focus {
                Some(focus) => Retained::into_super(focus),
                None => return Err("Focus a field in the granted browser first"),
            }
        }
    };
    match kind {
        "type" => {
            let accepts = responder.respondsToSelector(objc2::sel!(insertText:replacementRange:));
            if !accepts {
                return Err("The focused browser control cannot accept text");
            }
            let text = NSString::from_str(action["text"].as_str().unwrap_or(""));
            let none = NSRange::new(NOT_FOUND, 0);
            // SAFETY: the responder implements `NSTextInputClient`, as checked above.
            let _: () =
                unsafe { msg_send![&*responder, insertText: &*text, replacementRange: none] };
            Ok(())
        }
        "key" => key(&window, &responder, input, time),
        _ => Err("Unsupported native browser action"),
    }
}

fn scroll(mtm: MainThreadMarker, view: &NSView, target: &NSView, point: NSPoint, action: &Value) {
    let (Some(window), Some(cg)) = (
        view.window(),
        CGEvent::new_scroll_wheel_event2(
            None,
            CGScrollEventUnit::Pixel,
            2,
            -(number(&action["deltaY"]) as i32),
            -(number(&action["deltaX"]) as i32),
            0,
        ),
    ) else {
        return;
    };
    let screen = window.convertPointToScreen(view.convertPoint_toView(point, None));
    let height = NSScreen::screens(mtm)
        .firstObject()
        .map_or(0.0, |screen| screen.frame().size.height);
    CGEvent::set_location(
        Some(&cg),
        objc2_core_foundation::CGPoint::new(screen.x, height - screen.y),
    );
    if let Some(event) = NSEvent::eventWithCGEvent(&cg) {
        target.scrollWheel(&event);
    }
}

fn click_or_drag(
    view: &NSView,
    target: &NSView,
    point: NSPoint,
    action: &Value,
    drag: bool,
    mut time: NSTimeInterval,
) {
    if let Some(window) = view.window() {
        window.makeFirstResponder(Some(target));
    }
    let right = action["button"].as_str() == Some("right");
    let count = if drag {
        1
    } else {
        action["clickCount"].as_i64().unwrap_or(1) as isize
    };
    let (down_kind, up_kind) = if right {
        (NSEventType::RightMouseDown, NSEventType::RightMouseUp)
    } else {
        (NSEventType::LeftMouseDown, NSEventType::LeftMouseUp)
    };
    for click in 1..=count {
        if let Some(down) = mouse_event(view, down_kind, point, click, time) {
            if right {
                target.rightMouseDown(&down)
            } else {
                target.mouseDown(&down)
            }
        }
        let mut end = point;
        if drag {
            end = point_in(view, number(&action["toX"]), number(&action["toY"]));
            for step in 1..=24 {
                let fraction = f64::from(step) / 24.0;
                let next = NSPoint::new(
                    point.x + (end.x - point.x) * fraction,
                    point.y + (end.y - point.y) * fraction,
                );
                if let Some(event) = mouse_event(
                    view,
                    NSEventType::LeftMouseDragged,
                    next,
                    1,
                    time + fraction * 0.3,
                ) {
                    target.mouseDragged(&event);
                }
            }
        }
        let at = time + if drag { 0.31 } else { 0.01 };
        if let Some(up) = mouse_event(view, up_kind, end, click, at) {
            if right {
                target.rightMouseUp(&up)
            } else {
                target.mouseUp(&up)
            }
        }
        time += 0.08;
    }
}

fn key(
    window: &objc2_app_kit::NSWindow,
    responder: &NSResponder,
    input: &Value,
    time: NSTimeInterval,
) -> Outcome {
    let action = &input["action"];
    let modifiers: Vec<&str> = action["modifiers"]
        .as_array()
        .map(|list| list.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    let name = action["key"].as_str().unwrap_or("");
    let has = |modifier: &str| modifiers.contains(&modifier);
    if has("Meta")
        && (!matches!(name.to_lowercase().as_str(), "a" | "z") || has("Control") || has("Alt"))
    {
        return Err("Only select-all and undo/redo Command shortcuts are supported");
    }
    let Some(spec) = key_spec(name) else {
        return Err("Unsupported native browser key");
    };
    let mut flags = if spec.shift {
        NSEventModifierFlags::Shift
    } else {
        NSEventModifierFlags::empty()
    };
    for (modifier, flag) in [
        ("Meta", NSEventModifierFlags::Command),
        ("Shift", NSEventModifierFlags::Shift),
        ("Alt", NSEventModifierFlags::Option),
        ("Control", NSEventModifierFlags::Control),
    ] {
        if has(modifier) {
            flags |= flag;
        }
    }
    let editable = input["editable"].as_bool().unwrap_or(false);
    for kind in [NSEventType::KeyDown, NSEventType::KeyUp] {
        let event = NSEvent::keyEventWithType_location_modifierFlags_timestamp_windowNumber_context_characters_charactersIgnoringModifiers_isARepeat_keyCode(
            kind,
            NSPoint::ZERO,
            flags,
            time,
            window.windowNumber(),
            None,
            &NSString::from_str(&spec.characters),
            &NSString::from_str(&spec.unmodified),
            false,
            spec.code,
        );
        let Some(event) = event else { continue };
        if kind == NSEventType::KeyUp {
            responder.keyUp(&event);
        } else if flags.contains(NSEventModifierFlags::Command) && editable {
            // WebKit editor defaults require an explicit editing command when this
            // agent-owned window is not key. Canvas applications instead receive their
            // ordinary shortcut events. Never send through NSApp.
            let command = match name.to_lowercase().as_str() {
                "a" => objc2::sel!(selectAll:),
                _ if flags.contains(NSEventModifierFlags::Shift) => objc2::sel!(redo:),
                _ => objc2::sel!(undo:),
            };
            // SAFETY: the responder is a view inside the granted web view, which handles these.
            unsafe { responder.doCommandBySelector(command) };
        } else {
            responder.keyDown(&event);
        }
    }
    Ok(())
}
