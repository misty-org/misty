//! Telling every window the profiles changed, and moving every window to the account that just
//! signed in.
use super::*;

/// Everything that shows the list of profiles needs it again.
pub(crate) fn profiles_changed<R: Runtime>(app: &AppHandle<R>) {
    let _ = app.emit_filter(PROFILES_CHANGED_EVENT, (), |target| {
        targets(target, is_app_window)
    });
}

/// The windows now belong to another account. A window of a profile that account doesn't have
/// moves to its first profile; every window's app reloads its tabs for the new account.
pub fn set_scope(scope: &str) {
    let Ok(mut state) = lock_registry() else {
        return;
    };
    if state.scope == scope {
        return;
    }
    state.scope = scope.to_owned();
    let known: std::collections::BTreeSet<String> = state.current().keys().cloned().collect();
    if let Ok(mut current) = CURRENT.lock() {
        for window in current.values_mut() {
            if !known.contains(&window.profile) {
                window.profile = PERSONAL.into();
            }
        }
    }
    save(&state);
}

/// Windows that closed and left tabs behind, for a window of the same profile to take.
pub fn take_orphans(label: &str) -> Vec<String> {
    let Some(window) = parse(label) else {
        return Vec::new();
    };
    let Ok(mut state) = lock_registry() else {
        return Vec::new();
    };
    let taken = state.orphans.remove(&window.profile).unwrap_or_default();
    save(&state);
    taken
}

/// Remembers which Space a window shows, for the next launch.
pub fn set_window_space(label: &str, space: Option<String>) {
    if let Ok(mut current) = CURRENT.lock() {
        if let Some(window) = current.get_mut(label) {
            window.space = space;
        }
    }
    if let Ok(state) = lock_registry() {
        save(&state);
    }
}
