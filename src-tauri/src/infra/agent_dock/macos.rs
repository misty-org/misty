//! The native dock on macOS (`MistyAgentDock.m`): it keeps each docked
//! window on screen at its laid-out size, inside Misty's window.
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use super::{on_main, route, APP};

extern "C" {
    pub(super) fn misty_agent_dock_init(callback: extern "C" fn(*const std::ffi::c_char));
    pub(super) fn misty_agent_dock_add(
        window: *mut std::ffi::c_void,
        id: *const std::ffi::c_char,
        name: *const std::ffi::c_char,
        parent: *mut std::ffi::c_void,
    ) -> bool;
    pub(super) fn misty_agent_dock_open(id: *const std::ffi::c_char);
    pub(super) fn misty_agent_dock_is_docked(id: *const std::ffi::c_char) -> bool;
    pub(super) fn misty_agent_dock_forget(id: *const std::ffi::c_char);
    pub(super) fn misty_agent_dock_status(
        id: *const std::ffi::c_char,
        status: *const std::ffi::c_char,
        waiting: bool,
    );
    pub(super) fn misty_agent_dock_fill(view: *mut std::ffi::c_void, top: f64);
    pub(super) fn misty_agent_dock_visibility() -> *mut std::ffi::c_char;
    pub(super) fn misty_agent_dock_carousel(show: bool);
    pub(super) fn misty_agent_dock_test_app(action: *const std::ffi::c_char);
    pub(super) fn misty_agent_dock_page_returned(view: *mut std::ffi::c_void);
}

pub(super) fn init() {
    unsafe { misty_agent_dock_init(dock_event) };
}

/// A press in the native dock.
extern "C" fn dock_event(value: *const std::ffi::c_char) {
    if value.is_null() {
        return;
    }
    let payload =
        unsafe { serde_json::from_slice::<Value>(std::ffi::CStr::from_ptr(value).to_bytes()) };
    if let (Some(app), Ok(payload)) = (APP.get(), payload) {
        route(app, payload);
    }
}

fn c_string(value: &str) -> std::ffi::CString {
    std::ffi::CString::new(value.replace('\0', "")).unwrap_or_default()
}

pub(super) fn test_app(app: &AppHandle, action: &str) -> Result<(), String> {
    let action = action.to_owned();
    on_main(app, move |_| unsafe {
        misty_agent_dock_test_app(c_string(&action).as_ptr())
    })
}

pub(super) fn carousel(app: &AppHandle, show: bool) -> Result<(), String> {
    on_main(app, move |_| unsafe { misty_agent_dock_carousel(show) })
}

pub(super) fn add(app: &AppHandle, label: &str, name: &str) -> Result<(), String> {
    let (label, name) = (label.to_owned(), name.to_owned());
    on_main(app, move |app| {
        let Some(window) = app.get_window(&label) else {
            return;
        };
        let Ok(pointer) = window.ns_window() else {
            return;
        };
        // Docked windows live in the Space window they came from and move with it.
        let owner = super::hosts()
            .lock()
            .ok()
            .and_then(|hosts| hosts.get(&label).map(|host| host.owner.clone()));
        let parent = owner
            .and_then(|owner| app.get_window(&owner))
            .or_else(|| crate::infra::space_windows::primary(app))
            .and_then(|main| main.ns_window().ok())
            .unwrap_or(std::ptr::null_mut());
        let (id, name) = (c_string(&label), c_string(&name));
        unsafe { misty_agent_dock_add(pointer, id.as_ptr(), name.as_ptr(), parent) };
    })
}

pub(super) fn open(app: &AppHandle, label: &str) -> Result<(), String> {
    let label = label.to_owned();
    on_main(app, move |_| unsafe {
        misty_agent_dock_open(c_string(&label).as_ptr())
    })
}

pub(super) fn is_docked(label: &str) -> bool {
    unsafe { misty_agent_dock_is_docked(c_string(label).as_ptr()) }
}

pub(super) fn forget(app: &AppHandle, label: &str) {
    let label = label.to_owned();
    let _ = on_main(app, move |_| unsafe {
        misty_agent_dock_forget(c_string(&label).as_ptr())
    });
}

pub(super) fn status(
    app: &AppHandle,
    label: String,
    status: String,
    waiting: bool,
) -> Result<(), String> {
    on_main(app, move |_| unsafe {
        misty_agent_dock_status(
            c_string(&label).as_ptr(),
            c_string(&status).as_ptr(),
            waiting,
        )
    })
}

pub(super) fn visibility() -> Result<Value, String> {
    unsafe {
        let pointer = misty_agent_dock_visibility();
        if pointer.is_null() {
            return Ok(json!([]));
        }
        let value = serde_json::from_slice(std::ffi::CStr::from_ptr(pointer).to_bytes())
            .map_err(|error| error.to_string());
        libc::free(pointer.cast());
        value
    }
}
