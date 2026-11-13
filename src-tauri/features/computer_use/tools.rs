// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//! The computer tools as an engine sees them through Misty's MCP server (`engines/mcp.rs`), and
//! how one call runs: through the run's gate first (`tool_policy.rs`, under Misty's own names such
//! as `computer.left_click`), then the driver, with Escape watched. The action vocabulary follows
//! the usual computer-use convention: coordinates are pixels of the latest screenshot.

use std::time::Duration;

use agent_runs::local_tools::{LocalToolCall, LocalToolOutcome};
use enigo::Button;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use xcap::Monitor;

use super::driver::{
    action_click, action_drag, action_key, action_move, action_scroll, action_type, capture_frame,
    display_info_of, require_accessibility, require_screen_recording, screen_recording_granted,
    DisplayInfo,
};
use crate::agents::run_control::tool_gate::{self, Admission};

/// What the server tells an engine about these tools.
pub(crate) const INSTRUCTIONS: &str = "The computer_ tools see and control the person's real \
computer with Misty's own cursor, which they watch and can stop with Escape. Loop: screenshot, \
act, read the screenshot that comes back. Coordinates are always pixels of the latest screenshot \
of the same display. On macOS, try computer_get_app_state before a screenshot for app work: the \
tree is far cheaper to read and its refs are exact; use a screenshot for what the tree doesn't \
show. When the next few steps are obvious from the screen (click a field, type, press enter), \
send them as one computer_sequence call; never batch a step whose target depends on what the \
previous step shows. If a tool reports a missing permission, stop and tell the person. The \
cursor you see is Misty's: don't click it or work around it.";

const DISPLAY: &str = "Display id from computer_list_displays; omit for the main display.";

fn schema(properties: Value, required: &[&str]) -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": required,
        "properties": properties,
    })
}

fn point_schema(optional: bool) -> Value {
    let properties = json!({
        "x": { "type": "number", "description": "Horizontal position in screenshot pixels (0 is the left edge)." },
        "y": { "type": "number", "description": "Vertical position in screenshot pixels (0 is the top edge)." },
        "display_id": { "type": "integer", "description": DISPLAY },
    });
    schema(properties, if optional { &[] } else { &["x", "y"] })
}

fn tool(name: &str, description: &str, input: Value, read_only: bool) -> Value {
    json!({
        "name": name,
        "description": description,
        "inputSchema": input,
        "annotations": { "readOnlyHint": read_only, "openWorldHint": false },
    })
}

/// Every computer tool, in MCP's shape, by the names an engine calls.
pub(crate) fn offered() -> Vec<Value> {
    let display_only = schema(
        json!({ "display_id": { "type": "integer", "description": DISPLAY } }),
        &[],
    );
    let element = json!({
        "state": { "type": "string", "description": "state_id from computer_get_app_state (such as \"s3\"); a stale one is refused." },
        "ref": { "type": "integer", "description": "The element's ref from the tree: the number in brackets, such as [4]." },
    });
    let mut element_value = element.clone();
    element_value["value"] =
        json!({ "type": "string", "description": "The value to write into the field." });
    vec![
        tool("computer_screenshot", "Capture a screenshot of a display. Returns a JPEG; every coordinate the other tools take is in its pixels.", display_only.clone(), true),
        tool("computer_list_displays", "List the connected displays with their ids, sizes and scale factors.", schema(json!({}), &[]), true),
        tool("computer_mouse_move", "Move the cursor to a point, in screenshot pixels.", point_schema(false), false),
        tool("computer_left_click", "Left-click at a point (screenshot pixels), or where the cursor is when x and y are left out.", point_schema(true), false),
        tool("computer_right_click", "Right-click at a point (screenshot pixels), or where the cursor is when x and y are left out.", point_schema(true), false),
        tool("computer_middle_click", "Middle-click at a point (screenshot pixels), or where the cursor is when x and y are left out.", point_schema(true), false),
        tool("computer_double_click", "Double-click at a point (screenshot pixels), or where the cursor is when x and y are left out.", point_schema(true), false),
        tool("computer_drag", "Drag with the left button from one point to another (screenshot pixels).", schema(json!({
            "from_x": { "type": "number" }, "from_y": { "type": "number" },
            "to_x": { "type": "number" }, "to_y": { "type": "number" },
            "display_id": { "type": "integer", "description": DISPLAY },
        }), &["from_x", "from_y", "to_x", "to_y"]), false),
        tool("computer_scroll", "Scroll the wheel, optionally over a point first (screenshot pixels). A positive delta_y scrolls content down.", schema(json!({
            "x": { "type": "number" }, "y": { "type": "number" },
            "delta_x": { "type": "integer", "description": "Horizontal notches, at most 20 either way." },
            "delta_y": { "type": "integer", "description": "Vertical notches, at most 20 either way." },
            "display_id": { "type": "integer", "description": DISPLAY },
        }), &[]), false),
        tool("computer_type_text", "Type text where the keyboard focus is. Any Unicode works; this clicks nothing first.", schema(json!({
            "text": { "type": "string", "maxLength": 4096 },
            "display_id": { "type": "integer", "description": DISPLAY },
        }), &["text"]), false),
        tool("computer_press_key", "Press a key or chord: \"enter\", \"tab\", \"esc\", \"backspace\", \"delete\", arrows, \"f1\" to \"f12\", or chords such as \"cmd+c\", \"ctrl+shift+t\" or \"alt+tab\".", schema(json!({
            "key": { "type": "string" },
            "display_id": { "type": "integer", "description": DISPLAY },
        }), &["key"]), false),
        tool("computer_get_app_state", "Read the frontmost app's accessibility tree (macOS): a short text snapshot of its controls (role, label, position, actions) with refs for computer_press_element and computer_set_element_value. Much cheaper than a screenshot; try it first for app work.", schema(json!({}), &[]), true),
        tool("computer_press_element", "Press an accessibility element by its ref from computer_get_app_state. Exact, with no pixel coordinates.", schema(element, &["state", "ref"]), false),
        tool("computer_set_element_value", "Set a text field's value by its ref from computer_get_app_state, with no click and no typing.", schema(element_value, &["state", "ref", "value"]), false),
        tool("computer_wait", "Wait for the screen to settle (after opening an app, say), then take a fresh screenshot.", schema(json!({
            "ms": { "type": "integer", "minimum": 0, "maximum": 10000 },
        }), &["ms"]), true),
        tool("computer_sequence", "Run several actions in one call (clicks, typing, keys, scrolls, drags, waits). Much faster than one call each: plan the steps from one screenshot, and only the last screenshot comes back. Stops at the first step that fails.", schema(json!({
            "actions": {
                "type": "array",
                "maxItems": 32,
                "items": {
                    "type": "object",
                    "required": ["type"],
                    "properties": {
                        "type": { "type": "string", "enum": ["left_click", "right_click", "double_click", "mouse_move", "drag", "scroll", "type", "key", "wait"] },
                        "x": { "type": "number" }, "y": { "type": "number" },
                        "from_x": { "type": "number" }, "from_y": { "type": "number" },
                        "to_x": { "type": "number" }, "to_y": { "type": "number" },
                        "delta_x": { "type": "integer" }, "delta_y": { "type": "integer" },
                        "text": { "type": "string" }, "key": { "type": "string" },
                        "ms": { "type": "integer" },
                    },
                },
            },
            "screenshot_after": { "type": "boolean", "description": "Attach a screenshot after the last action (default true)." },
            "display_id": { "type": "integer", "description": DISPLAY },
        }), &["actions"]), false),
    ]
}

/// Misty's own name for a tool an engine called, if it is one of these.
pub(crate) fn misty_name(wire: &str) -> Option<String> {
    let action = wire.strip_prefix("computer_")?;
    offered()
        .iter()
        .any(|tool| tool["name"] == wire)
        .then(|| format!("computer.{action}"))
}

/// One step of a `sequence` call, in screenshot pixels like the single actions.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum SequenceAction {
    LeftClick {
        x: f64,
        y: f64,
    },
    RightClick {
        x: f64,
        y: f64,
    },
    DoubleClick {
        x: f64,
        y: f64,
    },
    MouseMove {
        x: f64,
        y: f64,
    },
    Drag {
        from_x: f64,
        from_y: f64,
        to_x: f64,
        to_y: f64,
    },
    Scroll {
        #[serde(default)]
        delta_x: i32,
        #[serde(default)]
        delta_y: i32,
    },
    Type {
        text: String,
    },
    Key {
        key: String,
    },
    Wait {
        ms: u64,
    },
}

fn run_sequence_step(action: &SequenceAction, display: Option<u32>) -> Result<String, String> {
    match action {
        SequenceAction::LeftClick { x, y } => {
            action_click(Button::Left, "Left", Some(*x), Some(*y), 1, display)
        }
        SequenceAction::RightClick { x, y } => {
            action_click(Button::Right, "Right", Some(*x), Some(*y), 1, display)
        }
        SequenceAction::DoubleClick { x, y } => {
            action_click(Button::Left, "Double", Some(*x), Some(*y), 2, display)
        }
        SequenceAction::MouseMove { x, y } => action_move(*x, *y, display),
        SequenceAction::Drag {
            from_x,
            from_y,
            to_x,
            to_y,
        } => action_drag(*from_x, *from_y, *to_x, *to_y, display),
        SequenceAction::Scroll { delta_x, delta_y } => {
            action_scroll(None, None, *delta_x, *delta_y, display)
        }
        SequenceAction::Type { text } => action_type(text),
        SequenceAction::Key { key } => action_key(key),
        SequenceAction::Wait { ms } => {
            let ms = (*ms).min(10_000);
            std::thread::sleep(Duration::from_millis(ms));
            Ok(format!("Waited {ms} ms."))
        }
    }
}

fn text_block(text: impl Into<String>) -> Value {
    json!({ "type": "text", "text": text.into() })
}

fn image_block(jpeg: String) -> Value {
    json!({ "type": "image", "data": jpeg, "mimeType": "image/jpeg" })
}

fn error_result(message: impl Into<String>) -> Value {
    json!({ "isError": true, "content": [text_block(message)] })
}

/// A confirmation and a fresh screenshot, so the engine sees what its action did.
fn action_result(message: String, display: Option<u32>) -> Value {
    std::thread::sleep(Duration::from_millis(250));
    let mut blocks = vec![text_block(message)];
    if screen_recording_granted() {
        match capture_frame(display) {
            Ok(frame) => {
                blocks.push(image_block(frame.jpeg_b64));
                blocks.push(text_block(format!(
                    "The screen after the action ({}×{} px).",
                    frame.width, frame.height
                )));
            }
            Err(error) => blocks.push(text_block(format!(
                "(The screenshot after failed: {error})"
            ))),
        }
    }
    json!({ "content": blocks })
}

fn number(input: &Value, name: &str) -> Option<f64> {
    input.get(name).and_then(Value::as_f64)
}

fn required(input: &Value, name: &str) -> Result<f64, String> {
    number(input, name).ok_or_else(|| format!("{name} is missing."))
}

fn display_of(input: &Value) -> Option<u32> {
    input
        .get("display_id")
        .and_then(Value::as_u64)
        .and_then(|id| u32::try_from(id).ok())
}

fn click(input: &Value, button: Button, label: &str, times: u32) -> Result<Value, String> {
    let display = display_of(input);
    let message = action_click(
        button,
        label,
        number(input, "x"),
        number(input, "y"),
        times,
        display,
    )?;
    Ok(action_result(message, display))
}

/// Runs a tool the gate already let through. Blocking: it captures the screen and moves input.
fn run(name: &str, input: &Value) -> Result<Value, String> {
    let display = display_of(input);
    match name {
        "computer.screenshot" => {
            require_screen_recording()?;
            let frame = capture_frame(display)?;
            Ok(json!({ "content": [
                image_block(frame.jpeg_b64),
                text_block(format!(
                    "Screenshot of {} ({}×{} px image; {}×{} physical px, scale {}).",
                    frame.display.name, frame.width, frame.height,
                    frame.display.width, frame.display.height, frame.display.scale
                )),
            ]}))
        }
        "computer.list_displays" => {
            let monitors =
                Monitor::all().map_err(|error| format!("Couldn't list displays: {error}"))?;
            let infos: Vec<DisplayInfo> = monitors.iter().map(display_info_of).collect();
            let text = serde_json::to_string_pretty(&infos).map_err(|error| error.to_string())?;
            Ok(json!({ "content": [text_block(text)] }))
        }
        "computer.mouse_move" => {
            let message = action_move(required(input, "x")?, required(input, "y")?, display)?;
            Ok(json!({ "content": [text_block(message)] }))
        }
        "computer.left_click" => click(input, Button::Left, "Left", 1),
        "computer.right_click" => click(input, Button::Right, "Right", 1),
        "computer.middle_click" => click(input, Button::Middle, "Middle", 1),
        "computer.double_click" => click(input, Button::Left, "Double", 2),
        "computer.drag" => {
            let message = action_drag(
                required(input, "from_x")?,
                required(input, "from_y")?,
                required(input, "to_x")?,
                required(input, "to_y")?,
                display,
            )?;
            Ok(action_result(message, display))
        }
        "computer.scroll" => {
            let delta = |name: &str| {
                input
                    .get(name)
                    .and_then(Value::as_i64)
                    .map_or(0, |value| value.clamp(-20, 20) as i32)
            };
            let message = action_scroll(
                number(input, "x"),
                number(input, "y"),
                delta("delta_x"),
                delta("delta_y"),
                display,
            )?;
            Ok(action_result(message, display))
        }
        "computer.type_text" => {
            let text = input["text"].as_str().ok_or("text is missing.")?;
            Ok(action_result(action_type(text)?, display))
        }
        "computer.press_key" => {
            let key = input["key"].as_str().ok_or("key is missing.")?;
            Ok(action_result(action_key(key)?, display))
        }
        "computer.get_app_state" => {
            require_accessibility()?;
            Ok(json!({ "content": [text_block(super::ax::app_state()?)] }))
        }
        "computer.press_element" | "computer.set_element_value" => {
            require_accessibility()?;
            let state = input["state"].as_str().ok_or("state is missing.")?;
            let element = input["ref"]
                .as_u64()
                .and_then(|id| usize::try_from(id).ok())
                .ok_or("ref is missing.")?;
            let message = if name == "computer.press_element" {
                super::ax::press(state, element)?
            } else {
                let value = input["value"].as_str().ok_or("value is missing.")?;
                super::ax::set_value(state, element, value)?
            };
            Ok(action_result(message, None))
        }
        "computer.wait" => {
            let ms = input["ms"].as_u64().unwrap_or(0).min(10_000);
            std::thread::sleep(Duration::from_millis(ms));
            Ok(action_result(format!("Waited {ms} ms."), None))
        }
        "computer.sequence" => {
            require_accessibility()?;
            let actions: Vec<SequenceAction> = serde_json::from_value(input["actions"].clone())
                .map_err(|error| format!("The actions aren't valid: {error}"))?;
            if actions.is_empty() {
                return Err("Give at least one action.".into());
            }
            if actions.len() > 32 {
                return Err("That's too many actions (at most 32). Split the batch.".into());
            }
            let mut done = Vec::new();
            for (index, action) in actions.iter().enumerate() {
                match run_sequence_step(action, display) {
                    Ok(message) => done.push(format!("{}. {message}", index + 1)),
                    Err(error) => {
                        return Err(format!(
                            "Step {} failed: {error}\nSteps done:\n{}",
                            index + 1,
                            done.join("\n")
                        ));
                    }
                }
                // A short settle between steps so fast interfaces keep up.
                std::thread::sleep(Duration::from_millis(50));
            }
            let summary = format!("Ran {} actions:\n{}", done.len(), done.join("\n"));
            if input["screenshot_after"] == false {
                return Ok(json!({ "content": [text_block(summary)] }));
            }
            Ok(action_result(summary, display))
        }
        other => Err(format!("There is no tool named {other}.")),
    }
}

/// One call from an engine's run: the run's gate decides first, natively, from the mode the run
/// started with; then the driver acts.
pub(crate) async fn call(app: &AppHandle, run_id: &str, wire: &str, arguments: Value) -> Value {
    let Some(name) = misty_name(wire) else {
        return error_result(format!("There is no tool named {wire}."));
    };
    let store = app
        .state::<crate::app::runtime::MistyRuntime>()
        .environment
        .store();
    let facts = tool_gate::facts_of_run(app, run_id).await;
    let call = LocalToolCall {
        run_id: run_id.to_string(),
        call_id: format!("mcp_{}", uuid::Uuid::new_v4().simple()),
        turn: 0,
        name: name.clone(),
        input: arguments,
    };
    let input = match tool_gate::admit(app, &store, &facts, &call).await {
        Admission::Run(input) => input,
        Admission::Done(LocalToolOutcome::Rejected { code, message }) => {
            return error_result(format!("{message} ({code})"));
        }
        Admission::Done(LocalToolOutcome::Result(value)) => {
            return json!({ "content": [text_block(value.to_string())] });
        }
    };
    let worker = app.clone();
    let owner = run_id.to_string();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        super::acting(&worker, &owner, || run(&name, &input))
    })
    .await;
    match outcome {
        Ok(Ok(result)) => result,
        Ok(Err(message)) => error_result(message),
        Err(error) => error_result(format!("The action didn't finish: {error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_offered_tool_maps_to_a_gated_name() {
        use crate::agents::run_control::tool_policy::{COMPUTER_ACTS, COMPUTER_READS};
        for tool in offered() {
            let wire = tool["name"].as_str().unwrap();
            let name = misty_name(wire).unwrap();
            assert!(
                COMPUTER_ACTS.contains(&name.as_str()) || COMPUTER_READS.contains(&name.as_str()),
                "{name} isn't in tool_policy.rs"
            );
        }
        assert_eq!(misty_name("computer_explode"), None);
    }

    #[test]
    fn a_sequence_is_read_as_tagged_steps() {
        let actions: Vec<SequenceAction> = serde_json::from_value(json!([
            {"type": "left_click", "x": 100.0, "y": 200.0},
            {"type": "type", "text": "hello"},
            {"type": "key", "key": "cmd+enter"},
            {"type": "wait", "ms": 300},
        ]))
        .unwrap();
        assert_eq!(actions.len(), 4);
        assert!(serde_json::from_value::<SequenceAction>(json!({"type": "explode"})).is_err());
        assert!(run_sequence_step(&SequenceAction::Wait { ms: 1 }, None).is_ok());
    }
}
