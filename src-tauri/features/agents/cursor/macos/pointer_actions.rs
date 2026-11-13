//! The Accessibility actions Misty performs for desktop control, on the main
//! thread after Rust checks the task, grant and snapshot. Coordinates are
//! global display points with a top-left origin.
use std::cell::{Cell, RefCell};

use objc2_core_graphics::{CGEvent, CGEventField, CGEventFlags, CGScrollEventUnit};
use objc2_foundation::NSPoint;
use serde_json::{json, Value};

use super::{accessibility::Element, pointer::pointer_move, ring};

/// Marks input Misty sends, so its own Escape never reads as the person stopping it.
pub(crate) const AGENT_EVENT_TAG: i64 = 0x4d49535459414754;

// Carbon virtual key codes (HIToolbox/Events.h).
const VK_RETURN: u16 = 0x24;
const VK_TAB: u16 = 0x30;
const VK_DELETE: u16 = 0x33;
const VK_ESCAPE: u16 = 0x35;
const VK_LEFT: u16 = 0x7B;
const VK_RIGHT: u16 = 0x7C;
const VK_DOWN: u16 = 0x7D;
const VK_UP: u16 = 0x7E;
const VK_A: u16 = 0x00;
const VK_F: u16 = 0x03;
const VK_Z: u16 = 0x06;
const VK_T: u16 = 0x11;
const VK_L: u16 = 0x25;

thread_local! {
    static FOCUSED: RefCell<Option<Element>> = const { RefCell::new(None) };
    static TARGET_PID: Cell<i32> = const { Cell::new(0) };
}

/// Forgets the field Misty focused and the app it clicked into.
pub(super) fn forget_target() {
    FOCUSED.with(|slot| *slot.borrow_mut() = None);
    TARGET_PID.with(|pid| pid.set(0));
}

fn error(message: &str) -> Value {
    json!({ "error": message })
}

fn editable(role: &str) -> bool {
    ["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"].contains(&role)
}

/// Presses or focuses the control under a point without moving the real pointer.
fn point_at(x: f64, y: f64) -> Value {
    let Some(element) = Element::system_wide().at_position(x, y) else {
        return error("Nothing Misty can use is at that point. Choose a visible control.");
    };
    if element.pid() == std::process::id() as i32 {
        return error("That is Misty's own control. Never operate the control strip or Stop.");
    }
    let mut current = Some(element.clone());
    let mut result: Option<Value> = None;
    for _ in 0..6 {
        let Some(node) = current.take() else { break };
        let role = node.string("AXRole");
        if role == "AXWindow" || role == "AXApplication" {
            break;
        }
        if editable(&role) && node.settable("AXFocused") {
            node.set_bool("AXFocused", true);
            let title = node.string("AXTitle");
            FOCUSED.with(|slot| *slot.borrow_mut() = Some(node));
            result = Some(json!({"role": role, "title": title, "effect": "focused"}));
        } else if node.has_action("AXPress") {
            result = Some(if node.perform("AXPress") {
                json!({"role": role, "title": node.string("AXTitle"), "effect": "pressed"})
            } else {
                error("That control did not accept a press.")
            });
        } else {
            current = node.parent();
            continue;
        }
        break;
    }
    if result
        .as_ref()
        .is_some_and(|value| value.get("error").is_none())
    {
        TARGET_PID.with(|pid| pid.set(element.pid()));
    }
    result.unwrap_or_else(|| {
        error("That spot has no button or field Misty can use without the real pointer. Try a nearby labeled control.")
    })
}

/// Inserts at the field Misty focused, replacing any selection, like typing.
fn insert_text(text: &str) -> Value {
    let Some(target) = FOCUSED.with(|slot| slot.borrow().clone()) else {
        return error("Click a text field before typing.");
    };
    if target.settable("AXSelectedText") && target.set_string("AXSelectedText", text) {
        return json!({"effect": "inserted"});
    }
    if target.settable("AXValue") {
        let value = target.string("AXValue");
        if target.set_string("AXValue", &format!("{value}{text}")) {
            return json!({"effect": "appended"});
        }
    }
    error("That field does not accept text from Misty.")
}

fn post_to_target(code: u16, command: bool) {
    let pid = TARGET_PID.with(Cell::get);
    for down in [true, false] {
        let Some(event) = CGEvent::new_keyboard_event(None, code, down) else {
            continue;
        };
        CGEvent::set_flags(
            Some(&event),
            if command {
                CGEventFlags::MaskCommand
            } else {
                CGEventFlags::empty()
            },
        );
        CGEvent::set_integer_value_field(
            Some(&event),
            CGEventField::EventSourceUserData,
            AGENT_EVENT_TAG,
        );
        CGEvent::post_to_pid(pid, Some(&event));
    }
}

fn press_key(key: &str) -> Value {
    if TARGET_PID.with(Cell::get) == 0 {
        return error("Click into an app before pressing keys.");
    }
    let focused = FOCUSED.with(|slot| slot.borrow().clone());
    if let Some(target) = &focused {
        if key == "SelectAll" && target.settable("AXSelectedTextRange") {
            let length = target.string("AXValue").encode_utf16().count() as isize;
            if target.set_selected_range(0, length) {
                return json!({"effect": "selected"});
            }
        }
        if key == "Enter" && target.has_action("AXConfirm") && target.perform("AXConfirm") {
            return json!({"effect": "confirmed"});
        }
    }
    let (code, command) = match key {
        "Enter" => (VK_RETURN, false),
        "Escape" => (VK_ESCAPE, false),
        "Tab" => (VK_TAB, false),
        "Backspace" => (VK_DELETE, false),
        "ArrowLeft" => (VK_LEFT, false),
        "ArrowRight" => (VK_RIGHT, false),
        "ArrowUp" => (VK_UP, false),
        "ArrowDown" => (VK_DOWN, false),
        "SelectAll" => (VK_A, true),
        "Undo" => (VK_Z, true),
        "AddressBar" => (VK_L, true),
        "NewTab" => (VK_T, true),
        "Find" => (VK_F, true),
        _ => return error("Unsupported desktop key."),
    };
    post_to_target(code, command);
    json!({"effect": "key"})
}

fn scroll_at(x: f64, y: f64, delta_x: i32, delta_y: i32) -> Value {
    let Some(element) = Element::system_wide().at_position(x, y) else {
        return error("Nothing to scroll at that point.");
    };
    let pid = element.pid();
    let Some(event) =
        CGEvent::new_scroll_wheel_event2(None, CGScrollEventUnit::Pixel, 2, -delta_y, -delta_x, 0)
    else {
        return json!({"effect": "scrolled"});
    };
    CGEvent::set_location(Some(&event), NSPoint::new(x, y));
    CGEvent::set_integer_value_field(
        Some(&event),
        CGEventField::EventSourceUserData,
        AGENT_EVENT_TAG,
    );
    CGEvent::post_to_pid(pid, Some(&event));
    json!({"effect": "scrolled"})
}

fn integer(action: &Value, key: &str) -> i32 {
    action[key]
        .as_i64()
        .map(|value| value as i32)
        .or_else(|| action[key].as_f64().map(|value| value as i32))
        .unwrap_or(0)
}

/// Called on the main queue after Rust checks the task, grant and snapshot.
/// `(x, y)` is in global display coordinates.
pub(crate) fn desktop_action(action: &Value, x: f64, y: f64) -> Value {
    if matches!(action["kind"].as_str(), Some("point" | "scroll")) {
        pointer_move(x, y);
        ring::pulse(x, y);
    }
    perform(action, x, y)
}

/// The Accessibility and key-event half of an action, with nothing drawn.
pub(crate) fn perform(action: &Value, x: f64, y: f64) -> Value {
    match action["kind"].as_str().unwrap_or("") {
        "point" => point_at(x, y),
        "scroll" => scroll_at(x, y, integer(action, "deltaX"), integer(action, "deltaY")),
        "type" => match action["text"].as_str() {
            Some(text) if text.encode_utf16().count() <= 16000 => insert_text(text),
            _ => error("Invalid text."),
        },
        "key" => press_key(action["key"].as_str().unwrap_or("")),
        _ => error("Unsupported desktop action."),
    }
}
