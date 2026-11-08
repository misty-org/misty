//! The macOS side of window and desktop control: window control in Misty's own
//! window (`autopilot`), desktop control in other apps (`desktop_control::macos`),
//! and their callbacks.
use serde_json::Value;

use crate::agents::window_control::DESKTOP_APP;

mod autopilot;
pub(crate) use autopilot::{capture as autopilot_capture, focus_reason, hide_cursor, supported};

/// Performs a window action on the main thread.
pub(crate) fn autopilot_action(input: &Value) -> Value {
    match objc2::MainThreadMarker::new() {
        Some(mtm) => autopilot::action(mtm, input),
        None => crate::agents::cursor::macos::support::error_json(
            "Misty window control must run on the main thread",
        ),
    }
}

pub(crate) fn desktop_stopped(payload: Value) {
    if let Some(app) = DESKTOP_APP.get() {
        let _ = crate::browser::app_windows::emit(app, "misty://desktop-control-stopped", payload);
    }
}
/// A press on the desktop control island: the in-app island performs it.
pub(crate) fn desktop_island(payload: Value) {
    if let Some(app) = DESKTOP_APP.get() {
        let _ = crate::browser::app_windows::emit(app, "misty://agent-island", payload);
    }
}
pub(crate) fn decode(value: Value) -> Result<Value, String> {
    if let Some(error) = value["error"].as_str() {
        return Err(error.into());
    }
    Ok(value)
}
