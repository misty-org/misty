#[cfg(target_os = "macos")]
use super::space_windows;
#[cfg(target_os = "macos")]
use tauri::{
    menu::{AboutMetadata, CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    App, AppHandle, Emitter, Manager, Runtime,
};

#[cfg(target_os = "macos")]
use super::commands::ShortcutsSnapshot;

pub const SHORTCUT_MENU_PREFIX: &str = "shortcut.";
pub const SHORTCUT_MENU_EVENT: &str = "misty://shortcut-command";
/// Menu items that open a Space's window: `space.open.<key>`.
const SPACE_MENU_PREFIX: &str = "space.open.";

/// The shortcuts the menu was last built with, so a change to the Spaces can rebuild it.
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
        let _ = space_windows::open_space(app, &key);
    }
}

/// The Spaces, with a checkmark beside the one the window used last shows. Choosing one
/// switches that window to it.
#[cfg(target_os = "macos")]
fn spaces_menu<R: Runtime>(app: &AppHandle<R>, title: &str) -> tauri::Result<Submenu<R>> {
    let menu = Submenu::new(app, title, true)?;
    let shown = space_windows::focused(app)
        .and_then(|window| space_windows::space_for_window(window.label()));
    for space in space_windows::listed_spaces() {
        let open = shown.as_deref() == Some(space.key.as_str());
        menu.append(&CheckMenuItem::with_id(
            app,
            format!("{SPACE_MENU_PREFIX}{}", space.key),
            &space.name,
            true,
            open,
            None::<&str>,
        )?)?;
    }
    Ok(menu)
}

#[cfg(target_os = "macos")]
fn refresh_dock<R: Runtime>(app: &AppHandle<R>) {
    let spaces: Vec<_> = space_windows::listed_spaces()
        .into_iter()
        .map(|space| {
            serde_json::json!({
                "key": space.key,
                "name": space.name,
                "open": space_windows::space_is_open(&space.key),
            })
        })
        .collect();
    if let Ok(json) = std::ffi::CString::new(serde_json::Value::from(spaces).to_string()) {
        unsafe { misty_space_dock_set(json.as_ptr()) };
    }
}

/// Rebuilds the Window menu's Spaces and the Dock menu after Spaces open, close or
/// change name.
#[cfg(target_os = "macos")]
pub fn refresh_spaces<R: Runtime>(app: &AppHandle<R>) {
    let snapshot = LAST_SNAPSHOT.lock().ok().and_then(|last| last.clone());
    if let Ok(menu) = build_menu(app, snapshot.as_ref()) {
        let _ = app.set_menu(menu);
    }
    refresh_dock(app);
}

/// Shows the Spaces menu at the pointer in `window` (⌘⇧N).
#[cfg(target_os = "macos")]
pub fn popup_spaces<R: Runtime>(
    app: &AppHandle<R>,
    window: &tauri::Window<R>,
) -> Result<(), String> {
    let menu = spaces_menu(app, "Spaces").map_err(|error| error.to_string())?;
    window.popup_menu(&menu).map_err(|error| error.to_string())
}

/// Installs the native macOS menu. AppKit handles these accelerators before a
/// renderer or native Browser child receives key events, so every item forwards
/// the stable command ID back through the same dispatcher used by the shell.
#[cfg(target_os = "macos")]
pub fn setup(app: &App) -> tauri::Result<()> {
    app.set_menu(build_menu(app.handle(), None)?)?;
    let _ = DOCK_APP.set(app.handle().clone());
    unsafe { misty_space_dock_install(dock_choice) };
    refresh_dock(app.handle());
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
            &command_item(manager, snapshot, "app.zoom_in", "Zoom In", "Cmd+Plus")?,
            &command_item(manager, snapshot, "app.zoom_out", "Zoom Out", "Cmd+Minus")?,
            &command_item(manager, snapshot, "app.zoom_reset", "Actual Size", "Cmd+0")?,
        ],
    )?;
    let window = Submenu::with_items(
        manager,
        "Window",
        true,
        &[
            &spaces_menu(manager, "Spaces")?,
            &command_item(
                manager,
                snapshot,
                "workspace.open_space",
                "Open Space…",
                "Cmd+Shift+N",
            )?,
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

#[cfg(target_os = "macos")]
fn command_item<R: Runtime, M: Manager<R>>(
    manager: &M,
    snapshot: Option<&ShortcutsSnapshot>,
    command_id: &str,
    label: &str,
    default: &str,
) -> tauri::Result<MenuItem<R>> {
    // These global shortcuts intentionally overlap focused-tool commands
    // (Code uses Cmd+K for Inline AI and Cmd+Shift+P for its command palette).
    // Giving AppKit ownership of the accelerators would bypass the renderer's
    // scope-aware dispatcher and always run the global command. Keep the menu
    // items clickable, but let the renderer/browser forwarding layer own the
    // keystrokes so the focused tool can shadow them correctly.
    let accelerator = (!renderer_owned_accelerator(command_id))
        .then(|| effective_primary(snapshot, command_id, default))
        .flatten()
        .map(|binding| native_accelerator(&binding));
    let item = MenuItem::with_id(
        manager,
        format!("{SHORTCUT_MENU_PREFIX}{command_id}"),
        label,
        true,
        accelerator.as_deref(),
    );
    if item.is_err() && accelerator.is_some() {
        return MenuItem::with_id(
            manager,
            format!("{SHORTCUT_MENU_PREFIX}{command_id}"),
            label,
            true,
            None::<&str>,
        );
    }
    item
}

fn renderer_owned_accelerator(command_id: &str) -> bool {
    matches!(
        command_id,
        "search.toggle" | "app.command_palette" | "app.zoom_in" | "app.zoom_out" | "app.zoom_reset"
    )
}

#[cfg(target_os = "macos")]
fn native_accelerator(binding: &str) -> String {
    let mut tokens = binding
        .split('+')
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    match tokens.last().map(String::as_str) {
        Some("LeftBracket") => {
            *tokens.last_mut().expect("accelerator always has a key") = "BracketLeft".to_owned()
        }
        Some("RightBracket") => {
            *tokens.last_mut().expect("accelerator always has a key") = "BracketRight".to_owned()
        }
        Some("Plus") => {
            *tokens.last_mut().expect("accelerator always has a key") = "Equal".to_owned();
            if !tokens
                .iter()
                .any(|token| token.eq_ignore_ascii_case("shift"))
            {
                let key = tokens.pop().expect("accelerator always has a key");
                tokens.push("Shift".to_owned());
                tokens.push(key);
            }
        }
        Some("Grave") => {
            *tokens.last_mut().expect("accelerator always has a key") = "Backquote".to_owned()
        }
        _ => {}
    }
    tokens.join("+")
}

#[cfg(target_os = "macos")]
fn effective_primary(
    snapshot: Option<&ShortcutsSnapshot>,
    command_id: &str,
    default: &str,
) -> Option<String> {
    let Some(entry) = snapshot.and_then(|snapshot| {
        snapshot
            .overrides
            .iter()
            .find(|entry| entry.command_id == command_id)
    }) else {
        return Some(default.to_owned());
    };
    match &entry.primary {
        None => Some(default.to_owned()),
        Some(None) => None,
        Some(Some(value)) => Some(value.clone()),
    }
}

/// Forwards native menu choices to the central renderer dispatcher.
#[cfg(target_os = "macos")]
pub fn handle_menu_event(app: &AppHandle, id: &str) -> bool {
    if let Some(key) = id.strip_prefix(SPACE_MENU_PREFIX) {
        let _ = space_windows::switch_focused(app, key);
        // A check item toggles itself when chosen; the rebuilt menu shows what is open.
        refresh_spaces(app);
        return true;
    }
    let Some(command_id) = id.strip_prefix(SHORTCUT_MENU_PREFIX) else {
        return false;
    };
    // A menu choice acts in the window the person used last, incognito included.
    space_windows::emit_to_focused(app, SHORTCUT_MENU_EVENT, command_id);
    true
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::native_accelerator;

    #[test]
    fn canonical_shortcut_keys_are_translated_for_muda() {
        assert_eq!(native_accelerator("Cmd+Plus"), "Cmd+Shift+Equal");
        assert_eq!(native_accelerator("Cmd+Grave"), "Cmd+Backquote");
        assert_eq!(
            native_accelerator("Cmd+Shift+RightBracket"),
            "Cmd+Shift+BracketRight"
        );
    }
}

#[cfg(test)]
mod renderer_accelerator_tests {
    use super::renderer_owned_accelerator;

    #[test]
    fn contextual_shortcuts_stay_owned_by_the_renderer() {
        assert!(renderer_owned_accelerator("search.toggle"));
        assert!(renderer_owned_accelerator("app.command_palette"));
        assert!(renderer_owned_accelerator("app.zoom_in"));
        assert!(renderer_owned_accelerator("app.zoom_out"));
        assert!(renderer_owned_accelerator("app.zoom_reset"));
        assert!(!renderer_owned_accelerator("app.open_settings"));
    }
}
