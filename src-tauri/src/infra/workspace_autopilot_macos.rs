//! The macOS side of window and desktop control: the Objective-C entry points
//! (`MistyAutopilot.m`, `MistyDesktopControl.m`) and their callbacks.
use serde_json::Value;

use super::workspace_autopilot::DESKTOP_APP;

extern "C" {
    pub(super) fn misty_autopilot_supported() -> bool;
    pub(super) fn misty_autopilot_capture() -> *mut std::ffi::c_char;
    pub(super) fn misty_autopilot_action(input: *const std::ffi::c_char) -> *mut std::ffi::c_char;
    pub(super) fn misty_autopilot_hide_cursor();
    pub(super) fn misty_autopilot_focus_reason() -> *mut std::ffi::c_char;
    pub(super) fn misty_desktop_prepare(
        task: *const std::ffi::c_char,
        ask: bool,
        callback: extern "C" fn(*const std::ffi::c_char),
        island: extern "C" fn(*const std::ffi::c_char),
    );
    pub(super) fn misty_desktop_island(
        task: *const std::ffi::c_char,
        json: *const std::ffi::c_char,
    );
    pub(super) fn misty_agent_mist_waiting(waiting: bool);
    pub(super) fn misty_desktop_renew(task: *const std::ffi::c_char);
    pub(super) fn misty_desktop_stop(task: *const std::ffi::c_char);
    pub(super) fn misty_desktop_capture(task: *const std::ffi::c_char) -> *mut std::ffi::c_char;
    pub(super) fn misty_desktop_action(input: *const std::ffi::c_char) -> *mut std::ffi::c_char;
    pub(super) fn misty_agent_window_ring(view: *mut std::ffi::c_void, active: bool);
    pub(super) fn misty_desktop_yield(task: *const std::ffi::c_char);
}
pub(super) extern "C" fn desktop_stopped(value: *const std::ffi::c_char) {
    if value.is_null() {
        return;
    }
    let payload =
        unsafe { serde_json::from_slice::<Value>(std::ffi::CStr::from_ptr(value).to_bytes()) };
    if let (Some(app), Ok(payload)) = (DESKTOP_APP.get(), payload) {
        let _ = crate::infra::space_windows::emit(&app, "misty://desktop-control-stopped", payload);
    }
}
/// A press on the desktop control island: the in-app island performs it.
pub(super) extern "C" fn desktop_island(value: *const std::ffi::c_char) {
    if value.is_null() {
        return;
    }
    let payload =
        unsafe { serde_json::from_slice::<Value>(std::ffi::CStr::from_ptr(value).to_bytes()) };
    if let (Some(app), Ok(payload)) = (DESKTOP_APP.get(), payload) {
        let _ = crate::infra::space_windows::emit(&app, "misty://agent-island", payload);
    }
}
pub(super) unsafe fn decode(pointer: *mut std::ffi::c_char) -> Result<Value, String> {
    if pointer.is_null() {
        return Err("Misty window control is unavailable".into());
    }
    let result = serde_json::from_slice(std::ffi::CStr::from_ptr(pointer).to_bytes())
        .map_err(|e| e.to_string());
    libc::free(pointer.cast());
    let value: Value = result?;
    if let Some(error) = value["error"].as_str() {
        return Err(error.into());
    }
    Ok(value)
}
