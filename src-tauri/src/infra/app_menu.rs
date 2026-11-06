#[cfg(target_os = "macos")]
use super::profile_windows;
#[cfg(target_os = "macos")]
use tauri::{
    menu::{AboutMetadata, CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    App, AppHandle, Manager, Runtime,
};

#[cfg(target_os = "macos")]
use super::shortcuts::ShortcutsSnapshot;

mod items;
use items::command_item;

pub const SHORTCUT_MENU_PREFIX: &str = "shortcut.";
pub const SHORTCUT_MENU_EVENT: &str = "misty://shortcut-command";
/// Menu items that open a profile's window: `profile.open.<id>`.
const PROFILE_MENU_PREFIX: &str = "profile.open.";

/// The shortcuts the menu was last built with, so a change to the profiles can rebuild it.
#[cfg(target_os = "macos")]
static LAST_SNAPSHOT: std::sync::Mutex<Option<ShortcutsSnapshot>> = std::sync::Mutex::new(None);
#[cfg(target_os = "macos")]
static DOCK_APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

#[cfg(target_os = "macos")]
extern "C" {
    fn misty_space_dock_install(callback: extern "C" fn(*const std::ffi::c_char));
    fn misty_space_dock_set(json: *const std::ffi::c_char);
}

#[cfg(target_os = "macos")]
extern "C" fn dock_choice(key: *const std::ffi::c_char) {
    if key.is_null() {
        return;
    }
    let key = unsafe { std::ffi::CStr::from_ptr(key) }
        .to_string_lossy()
        .into_owned();
    if let Some(app) = DOCK_APP.get() {
        let _ = profile_windows::open_profile(app, &key);
    }
}

/// The profiles, with a checkmark beside the one the window used last belongs to. Choosing one
/// brings its window forward, opening one if it has none.
#[cfg(target_os = "macos")]
fn profiles_menu<R: Runtime>(app: &AppHandle<R>, title: &str) -> tauri::Result<Submenu<R>> {
    let menu = Submenu::new(app, title, true)?;
    let shown = profile_windows::focused(app)
        .and_then(|window| profile_windows::profile_for_window(window.label()));
    for profile in profile_windows::listed_profiles() {
        let open = shown.as_deref() == Some(profile.id.as_str());
        menu.append(&CheckMenuItem::with_id(
            app,
            format!("{PROFILE_MENU_PREFIX}{}", profile.id),
            &profile.name,
            true,
            open,
            None::<&str>,
        )?)?;
    }
    Ok(menu)
}

#[cfg(target_os = "macos")]
fn refresh_dock() {
    let profiles: Vec<_> = profile_windows::listed_profiles()
        .into_iter()
        .map(|profile| {
            serde_json::json!({
                "key": profile.id,
                "name": profile.name,
                "open": profile_windows::profile_is_open(&profile.id),
            })
        })
        .collect();
    if let Ok(json) = std::ffi::CString::new(serde_json::Value::from(profiles).to_string()) {
        unsafe { misty_space_dock_set(json.as_ptr()) };
    }
}

/// Rebuilds the Window menu's profiles and the Dock menu after profiles open, close or
/// change name.
#[cfg(target_os = "macos")]
pub fn refresh_profiles<R: Runtime>(app: &AppHandle<R>) {
    let snapshot = LAST_SNAPSHOT.lock().ok().and_then(|last| last.clone());
    if let Ok(menu) = build_menu(app, snapshot.as_ref()) {
        let _ = app.set_menu(menu);
    }
    refresh_dock();
}

/// Installs the native macOS menu. AppKit handles these accelerators before a
/// renderer or native Browser child receives key events, so every item forwards
/// the stable command ID back through the same dispatcher used by the shell.
#[cfg(target_os = "macos")]
pub fn setup(app: &App) -> tauri::Result<()> {
    app.set_menu(build_menu(app.handle(), None)?)?;
    let _ = DOCK_APP.set(app.handle().clone());
    unsafe { misty_space_dock_install(dock_choice) };
    refresh_dock();
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn refresh(app: &AppHandle, snapshot: &ShortcutsSnapshot) -> tauri::Result<()> {
    if let Ok(mut last) = LAST_SNAPSHOT.lock() {
        *last = Some(snapshot.clone());
    }
    app.set_menu(build_menu(app, Some(snapshot))?)?;
    Ok(())
}

/// A menu item for a renderer command that has no keyboard shortcut.
#[cfg(target_os = "macos")]
fn plain_command_item<R: Runtime>(
    manager: &AppHandle<R>,
    command_id: &str,
    label: &str,
) -> tauri::Result<MenuItem<R>> {
    MenuItem::with_id(
        manager,
        format!("{SHORTCUT_MENU_PREFIX}{command_id}"),
        label,
        true,
        None::<&str>,
    )
}

#[cfg(target_os = "macos")]
fn build_menu<R: Runtime>(
    manager: &AppHandle<R>,
    snapshot: Option<&ShortcutsSnapshot>,
) -> tauri::Result<Menu<R>> {
    let application = Submenu::with_items(
        manager,
        "Misty",
        true,
        &[
            &PredefinedMenuItem::about(
                manager,
                Some("About Misty"),
                Some(AboutMetadata::default()),
            )?,
            &PredefinedMenuItem::separator(manager)?,
            &command_item(
                manager,
                snapshot,
                "app.command_palette",
                "Command Palette…",
                "Cmd+Shift+P",
            )?,
            &command_item(
                manager,
                snapshot,
                "app.open_settings",
                "Settings…",
                "Cmd+Comma",
            )?,
            &PredefinedMenuItem::separator(manager)?,
            // Misty works without an account; these are the only way in or out from the menu.
            &plain_command_item(manager, "account.sign_in", "Sign In…")?,
            &plain_command_item(manager, "account.sign_out", "Sign Out…")?,
            &PredefinedMenuItem::separator(manager)?,
            &PredefinedMenuItem::services(manager, None)?,
            &PredefinedMenuItem::separator(manager)?,
            &PredefinedMenuItem::hide(manager, None)?,
            &PredefinedMenuItem::hide_others(manager, None)?,
            &PredefinedMenuItem::show_all(manager, None)?,
            &PredefinedMenuItem::separator(manager)?,
            &PredefinedMenuItem::quit(manager, None)?,
        ],
    )?;
    let edit = Submenu::with_items(
        manager,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(manager, None)?,
            &PredefinedMenuItem::redo(manager, None)?,
            &PredefinedMenuItem::separator(manager)?,
            &PredefinedMenuItem::cut(manager, None)?,
            &PredefinedMenuItem::copy(manager, None)?,
            &PredefinedMenuItem::paste(manager, None)?,
            &PredefinedMenuItem::select_all(manager, None)?,
        ],
    )?;
    let view = Submenu::with_items(
        manager,
        "View",
        true,
        &[
            &command_item(
                manager,
                snapshot,
                "app.toggle_focus_mode",
                "Toggle Focus Mode",
                "Cmd+Shift+S",
            )?,
            &command_item(
                manager,
                snapshot,
                "navigation.refresh",
                "Refresh Focused Tool",
                "Cmd+R",
            )?,
            &PredefinedMenuItem::separator(manager)?,
            // Zooming acts on the page; the app's own scale is the same keys with Shift.
            &command_item(manager, snapshot, "browser.zoom_in", "Zoom In", "Cmd+Plus")?,
            &command_item(
                manager,
                snapshot,
                "browser.zoom_out",
                "Zoom Out",
                "Cmd+Minus",
            )?,
            &command_item(
                manager,
                snapshot,
                "browser.zoom_reset",
                "Actual Size",
                "Cmd+0",
            )?,
            &PredefinedMenuItem::separator(manager)?,
            &command_item(
                manager,
                snapshot,
                "app.zoom_in",
                "Scale App Up",
                "Cmd+Shift+Plus",
            )?,
            &command_item(
                manager,
                snapshot,
                "app.zoom_out",
                "Scale App Down",
                "Cmd+Shift+Minus",
            )?,
            &command_item(
                manager,
                snapshot,
                "app.zoom_reset",
                "Reset App Scale",
                "Cmd+Shift+0",
            )?,
        ],
    )?;
    let window = Submenu::with_items(
        manager,
        "Window",
        true,
        &[
            &profiles_menu(manager, "Profiles")?,
            &command_item(
                manager,
                snapshot,
                "workspace.new_window",
                "New Window",
                "Cmd+N",
            )?,
            &plain_command_item(manager, "workspace.new_profile", "Add Profile…")?,
            &command_item(
                manager,
                snapshot,
                "workspace.new_incognito_window",
                "New Incognito Window",
                "Cmd+Option+N",
            )?,
            &command_item(
                manager,
                snapshot,
                "workspace.close_window",
                "Close Window",
                "Cmd+Shift+W",
            )?,
            &PredefinedMenuItem::separator(manager)?,
            &command_item(manager, snapshot, "search.toggle", "New Tab", "Cmd+T")?,
            &command_item(
                manager,
                snapshot,
                "workspace.close_tab",
                "Close Tab",
                "Cmd+W",
            )?,
            &command_item(
                manager,
                snapshot,
                "workspace.reopen_tab",
                "Reopen Closed Tab",
                "Cmd+Shift+T",
            )?,
            &command_item(
                manager,
                snapshot,
                "workspace.next_tab",
                "Next Tab",
                "Cmd+Shift+RightBracket",
            )?,
            &command_item(
                manager,
                snapshot,
                "workspace.previous_tab",
                "Previous Tab",
                "Cmd+Shift+LeftBracket",
            )?,
            &PredefinedMenuItem::separator(manager)?,
            &PredefinedMenuItem::minimize(manager, None)?,
            &PredefinedMenuItem::maximize(manager, None)?,
            &PredefinedMenuItem::separator(manager)?,
            &PredefinedMenuItem::fullscreen(manager, None)?,
        ],
    )?;
    Menu::with_items(manager, &[&application, &edit, &view, &window])
}

/// Forwards native menu choices to the central renderer dispatcher.
#[cfg(target_os = "macos")]
pub fn handle_menu_event(app: &AppHandle, id: &str) -> bool {
    if let Some(key) = id.strip_prefix(PROFILE_MENU_PREFIX) {
        let _ = profile_windows::open_profile(app, key);
        // A check item toggles itself when chosen; the rebuilt menu shows what is open.
        refresh_profiles(app);
        return true;
    }
    let Some(command_id) = id.strip_prefix(SHORTCUT_MENU_PREFIX) else {
        return false;
    };
    // With every window closed there's nothing to act in, so the choice brings them back, as the
    // Dock icon does.
    if profile_windows::primary(app).is_none() {
        let _ = profile_windows::restore(app);
        return true;
    }
    // A menu choice acts in the window the person used last, incognito included.
    profile_windows::emit_to_focused(app, SHORTCUT_MENU_EVENT, command_id);
    true
}
