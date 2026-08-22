#[cfg(target_os = "macos")]
use tauri::{
    menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu},
    App, AppHandle, Emitter, Manager, Runtime,
};

#[cfg(target_os = "macos")]
use super::commands::ShortcutsSnapshot;

pub const SHORTCUT_MENU_PREFIX: &str = "shortcut.";
pub const SHORTCUT_MENU_EVENT: &str = "misty://shortcut-command";

/// Installs the native macOS menu. AppKit handles these accelerators before a
/// renderer or native Browser child receives key events, so every item forwards
/// the stable command ID back through the same dispatcher used by the shell.
#[cfg(target_os = "macos")]
pub fn setup(app: &App) -> tauri::Result<()> {
    app.set_menu(build_menu(app.handle(), None)?)?;
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn refresh(app: &AppHandle, snapshot: &ShortcutsSnapshot) -> tauri::Result<()> {
    app.set_menu(build_menu(app, Some(snapshot))?)?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn build_menu<R: Runtime, M: Manager<R>>(
    manager: &M,
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
            &command_item(manager, snapshot, "search.toggle", "Open Misty", "Cmd+K")?,
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
                "app.toggle_navigator",
                "Toggle Navigator",
                "Cmd+Shift+B",
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
            &command_item(
                manager,
                snapshot,
                "workspace.new_virtual_window",
                "New Virtual Window",
                "Cmd+N",
            )?,
            &command_item(
                manager,
                snapshot,
                "workspace.close_virtual_window",
                "Close Virtual Window",
                "Cmd+Shift+W",
            )?,
            &command_item(
                manager,
                snapshot,
                "workspace.next_virtual_window",
                "Next Virtual Window",
                "Cmd+Grave",
            )?,
            &command_item(
                manager,
                snapshot,
                "workspace.previous_virtual_window",
                "Previous Virtual Window",
                "Cmd+Shift+Grave",
            )?,
            &command_item(
                manager,
                snapshot,
                "workspace.reopen_virtual_window",
                "Reopen Closed Virtual Window",
                "Cmd+Option+Shift+W",
            )?,
            &PredefinedMenuItem::separator(manager)?,
            &command_item(manager, snapshot, "workspace.new_tab", "New Tab", "Cmd+T")?,
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
    matches!(command_id, "search.toggle" | "app.command_palette")
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
    let Some(command_id) = id.strip_prefix(SHORTCUT_MENU_PREFIX) else {
        return false;
    };
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit(SHORTCUT_MENU_EVENT, command_id);
    }
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
        assert!(!renderer_owned_accelerator("app.open_settings"));
    }
}
