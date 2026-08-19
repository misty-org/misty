#[cfg(target_os = "macos")]
use tauri::{
    menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu},
    App, AppHandle, Emitter, Manager,
};

/// Menu id for Close Tab, and the event it forwards to the workspace.
pub const CLOSE_TAB_MENU_ID: &str = "window.close_tab";
pub const CLOSE_TAB_EVENT: &str = "misty://close-tab";

/// Installs Misty's macOS menu bar.
///
/// AppKit resolves menu key equivalents in `performKeyEquivalent:` before the
/// key reaches any web view, so the default menu's Window > Close swallowed
/// Cmd+W and closed the window. Owning the accelerator here — rather than
/// dropping it — means it also works while a native browser tab holds focus,
/// which a `keydown` listener in the app's own web view can never see.
///
/// Everything else has to be rebuilt, because setting a menu replaces the
/// default one wholesale — including the Edit items that Cmd+C/V rely on.
#[cfg(target_os = "macos")]
pub fn setup(app: &App) -> tauri::Result<()> {
    let handle = app.handle();
    let application = Submenu::with_items(
        handle,
        "Misty",
        true,
        &[
            &PredefinedMenuItem::about(
                handle,
                Some("About Misty"),
                Some(AboutMetadata::default()),
            )?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::services(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::hide(handle, None)?,
            &PredefinedMenuItem::hide_others(handle, None)?,
            &PredefinedMenuItem::show_all(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::quit(handle, None)?,
        ],
    )?;
    let edit = Submenu::with_items(
        handle,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(handle, None)?,
            &PredefinedMenuItem::redo(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::cut(handle, None)?,
            &PredefinedMenuItem::copy(handle, None)?,
            &PredefinedMenuItem::paste(handle, None)?,
            &PredefinedMenuItem::select_all(handle, None)?,
        ],
    )?;
    let window = Submenu::with_items(
        handle,
        "Window",
        true,
        &[
            &MenuItem::with_id(
                handle,
                CLOSE_TAB_MENU_ID,
                "Close Tab",
                true,
                Some("CmdOrCtrl+W"),
            )?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::minimize(handle, None)?,
            &PredefinedMenuItem::maximize(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::fullscreen(handle, None)?,
        ],
    )?;
    app.set_menu(Menu::with_items(handle, &[&application, &edit, &window])?)?;
    Ok(())
}

/// Forwards Close Tab to the workspace. Returns whether the event was ours.
#[cfg(target_os = "macos")]
pub fn handle_menu_event(app: &AppHandle, id: &str) -> bool {
    if id != CLOSE_TAB_MENU_ID {
        return false;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit(CLOSE_TAB_EVENT, ());
    }
    true
}
