//! How the menu bar reaches the main window: bringing it forward and telling it what was chosen.

use super::*;

/// Opens a chat the menu listed in the main window.
pub(super) fn open_chat(app: &AppHandle<Wry>, id: &str) {
    let found = app.try_state::<MistyTrayState>().and_then(|tray_state| {
        tray_state
            .menu
            .lock()
            .ok()
            .and_then(|state| state.chats.iter().find(|chat| chat.id == id).cloned())
    });
    let Some(found) = found else {
        return;
    };
    let _ = show_main_window(app);
    if let Some(label) = crate::browser::app_windows::primary_label(app) {
        let _ = app.emit_to(label.as_str(), OPEN_CHAT_EVENT, found);
    }
}

/// Brings the main window forward, opening one when none is, and tells it what was chosen.
pub(super) fn to_main_window(app: &AppHandle<Wry>, event: &str, payload: impl Serialize + Clone) {
    let _ = show_main_window(app);
    if let Some(label) = crate::browser::app_windows::primary_label(app) {
        let _ = app.emit_to(label.as_str(), event, payload);
    }
}

/// Turns Tutor on or off, or opens its setup when it isn't set up.
pub(crate) fn tutor_toggle(app: &AppHandle<Wry>) {
    tutor_to_main_window(app, TUTOR_TOGGLE_EVENT);
}

pub(crate) fn tutor_settings(app: &AppHandle<Wry>) {
    let _ = show_main_window(app);
    tutor_to_main_window(app, TUTOR_SETTINGS_EVENT);
}

/// Tells the main window, which runs Tutor, what the person chose in the menu bar. With no window
/// open, Misty opens one first: Tutor runs only while a main window does.
pub(super) fn tutor_to_main_window(app: &AppHandle<Wry>, event: &str) {
    let label = crate::browser::app_windows::primary_label(app);
    match label {
        Some(label) => {
            let _ = app.emit_to(label.as_str(), event, ());
        }
        None => {
            let _ = show_main_window(app);
        }
    }
}

pub(crate) fn show_main_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    // Startup owns the first reveal, including native traffic-light layout.
    if !crate::app::macos_window_effects::mac_rounded_corners::main_window_ready() {
        return Ok(());
    }
    let Some(window) = crate::browser::app_windows::primary(app) else {
        // Every window was closed: reopen the windows that were open, or the first profile's.
        return crate::browser::app_windows::restore(app);
    };
    window
        .show()
        .map_err(|error| format!("Could not show Misty: {error}"))?;
    window
        .unminimize()
        .map_err(|error| format!("Could not unminimize Misty: {error}"))?;
    window
        .set_focus()
        .map_err(|error| format!("Could not focus Misty: {error}"))?;
    Ok(())
}
