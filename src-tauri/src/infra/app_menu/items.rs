//! Menu items for shortcut commands and their native accelerators.
use super::*;

#[cfg(target_os = "macos")]
pub(super) fn command_item<R: Runtime, M: Manager<R>>(
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

#[cfg(all(test, target_os = "macos"))]
mod tests;

#[cfg(test)]
mod renderer_accelerator_tests;
