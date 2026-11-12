#[cfg(target_os = "macos")]
use crate::browser::app_windows;
#[cfg(target_os = "macos")]
use crate::browser::app_windows::macos::space_dock;
#[cfg(target_os = "macos")]
use tauri::{
    menu::{AboutMetadata, CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    App, AppHandle, Manager, Runtime,
};

#[cfg(target_os = "macos")]
use settings::shortcuts::ShortcutsSnapshot;

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
fn dock_choice(key: &str) {
    if let Some(app) = DOCK_APP.get() {
        let _ = app_windows::open_profile(app, key);
    }
}

/// The profiles, with a checkmark beside the one the window used last belongs to. Choosing one
/// brings its window forward, opening one if it has none.
#[cfg(target_os = "macos")]
fn profiles_menu<R: Runtime>(app: &AppHandle<R>, title: &str) -> tauri::Result<Submenu<R>> {
    let menu = Submenu::new(app, title, true)?;
    let shown = app_windows::focused(app)
        .and_then(|window| app_windows::profile_for_window(window.label()));
    for profile in app_windows::listed_profiles() {
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
    let spaces = app_windows::listed_profiles()
        .into_iter()
        .map(|profile| space_dock::DockSpace {
            open: app_windows::profile_is_open(&profile.id),
            key: profile.id,
            name: profile.name,
        })
        .collect();
    space_dock::set(spaces);
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
    space_dock::install(dock_choice);
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
            &command_item(
                manager,
                snapshot,
                "workspace.close_window",
                "Close Window",
                "Cmd+Shift+W",
            )?,
            &PredefinedMenuItem::separator(manager)?,
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
        let _ = app_windows::open_profile(app, key);
        // A check item toggles itself when chosen; the rebuilt menu shows what is open.
        refresh_profiles(app);
        return true;
    }
    let Some(command_id) = id.strip_prefix(SHORTCUT_MENU_PREFIX) else {
        return false;
    };
    // With every window closed there's nothing to act in, so the choice brings them back, as the
    // Dock icon does.
    if app_windows::primary(app).is_none() {
        let _ = app_windows::restore(app);
        return true;
    }
    // A menu choice acts in the window the person used last.
    app_windows::emit_to_focused(app, SHORTCUT_MENU_EVENT, command_id);
    true
}
