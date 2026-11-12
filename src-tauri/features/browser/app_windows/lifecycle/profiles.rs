//! Changes to the profiles themselves: creating, renaming, coloring and deleting them, and
//! moving every window to the account that just signed in.
use super::*;

/// Rebuilds every menu that lists profiles.
pub fn refresh_menus<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(target_os = "macos")]
    crate::app::app_menu::refresh_profiles(app);
    let _ = app;
}

fn clean_name(name: &str) -> Result<String, String> {
    let name: String = name.trim().chars().take(60).collect();
    if name.is_empty() || name.chars().any(char::is_control) {
        return Err("Use a name of 1 to 60 characters.".into());
    }
    Ok(name)
}

/// Everything that shows the list of profiles needs it again.
pub(crate) fn profiles_changed<R: Runtime>(app: &AppHandle<R>) {
    let _ = app.emit_filter(PROFILES_CHANGED_EVENT, (), |target| {
        targets(target, is_app_window)
    });
    refresh_menus(app);
}

/// Adds a profile and opens its first window.
pub fn create_profile<R: Runtime>(
    app: &AppHandle<R>,
    name: &str,
    color: Option<&str>,
) -> Result<ProfileEntry, String> {
    let name = clean_name(name)?;
    if color.is_some_and(|color| !valid_color(color)) {
        return Err("Choose one of the profile colors.".into());
    }
    let entry = {
        let mut state = lock_registry().map_err(|_| "Profiles are unavailable.")?;
        let profiles = state.current();
        let entry = ProfileEntry {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            color: Some(color.map_or_else(|| next_color(profiles), str::to_owned)),
            order: profiles.values().map(|p| p.order).fold(0.0, f64::max) + 1.0,
            sites: Vec::new(),
        };
        profiles.insert(entry.id.clone(), entry.clone());
        save(&state);
        entry
    };
    profiles_changed(app);
    open_profile_window(app, &entry.id)?;
    Ok(entry)
}

/// Changes a profile's name, color or claimed sites. Its windows follow.
pub fn update_profile<R: Runtime>(
    app: &AppHandle<R>,
    key: &str,
    change: impl FnOnce(&mut ProfileEntry) -> Result<(), String>,
) -> Result<ProfileEntry, String> {
    let entry = {
        let mut state = lock_registry().map_err(|_| "Profiles are unavailable.")?;
        let entry = state.current().get_mut(key).ok_or("Unknown profile.")?;
        change(entry)?;
        let entry = entry.clone();
        save(&state);
        entry
    };
    emit_to_profile(app, key, PROFILE_CHANGED_EVENT, &entry);
    for window in windows_for_profile(app, key) {
        let _ = window.set_title(&window_title(&entry));
    }
    profiles_changed(app);
    Ok(entry)
}

pub fn rename_profile<R: Runtime>(
    app: &AppHandle<R>,
    key: &str,
    name: &str,
) -> Result<ProfileEntry, String> {
    let name = clean_name(name)?;
    update_profile(app, key, |entry| {
        entry.name = name;
        Ok(())
    })
}

pub fn set_color<R: Runtime>(
    app: &AppHandle<R>,
    key: &str,
    color: &str,
) -> Result<ProfileEntry, String> {
    if !valid_color(color) {
        return Err("Choose one of the profile colors.".into());
    }
    update_profile(app, key, |entry| {
        entry.color = Some(color.into());
        Ok(())
    })
}

/// Deletes a profile from this computer: its windows close now, and its website data is
/// erased once the engine has let go of the store. The first profile always stays.
pub fn delete_profile(app: &AppHandle, key: &str) -> Result<(), String> {
    if key == PERSONAL {
        return Err("The first profile can't be deleted.".into());
    }
    let store = {
        let mut state = lock_registry().map_err(|_| "Profiles are unavailable.")?;
        if !state.current().contains_key(key) {
            return Err("Unknown profile.".into());
        }
        state.store(key)
    };
    for window in windows_for_profile(app, key) {
        let _ = window.close();
    }
    if let Ok(mut state) = lock_registry() {
        state.current().remove(key);
        state.open.retain(|open| open.profile != key);
        state.orphans.remove(key);
        save(&state);
    }
    profiles_changed(app);
    let (app, key) = (app.clone(), key.to_owned());
    tauri::async_runtime::spawn(async move {
        crate::browser::profiles::remove_profile(&key).await;
        let library_key =
            crate::browser::history_downloads::library::history::store_key(store.clone());
        if let Ok(library) = crate::browser::history_downloads::library::library(&app) {
            let _ = crate::browser::history_downloads::library::history::forget_profile(
                &library,
                &library_key,
            );
        }
        if let Some(store) = store {
            if let Err(error) =
                crate::browser::site_data::store_cleanup::remove_store_data(app, key, store).await
            {
                eprintln!("Could not remove a profile's website data: {error}");
            }
        }
    });
    Ok(())
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

