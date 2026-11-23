use super::*;

pub(crate) fn profiles_changed<R: Runtime>(app: &AppHandle<R>) {
    let _ = app.emit_filter(PROFILES_CHANGED_EVENT, (), |target| {
        targets(target, is_app_window)
    });
}

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
