//! Changes to the Spaces themselves: names, ids and colors from the account,
//! and removing a Space from this device.
use super::*;

/// Rebuilds every menu that lists Spaces.
pub fn refresh_menus<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(target_os = "macos")]
    crate::infra::app_menu::refresh_spaces(app);
    let _ = app;
}

/// Updates names and ids from the account's Spaces. Spaces this device has never
/// opened get a color now, so their first window is already tinted.
pub fn set_spaces<R: Runtime>(app: &AppHandle<R>, spaces: Vec<(String, bool, String)>) {
    let changed = {
        let Ok(mut state) = lock_registry() else {
            return;
        };
        let mut changed = Vec::new();
        let mut known = BTreeSet::new();
        for (space_id, personal, name) in spaces {
            let Ok(key) = space_key(&space_id, personal) else {
                continue;
            };
            let name: String = name.trim().chars().take(80).collect();
            known.insert(key.clone());
            let before = state.spaces.get(&key).cloned();
            ensure_entry(&mut state, &key);
            let entry = state.spaces.get_mut(&key).expect("entry exists");
            entry.space_id = Some(space_id);
            if !name.is_empty() {
                entry.name = name;
            }
            if before.as_ref() != Some(entry) {
                changed.push(entry.clone());
            }
        }
        // Spaces the account left drop out of the menus; the personal one never does.
        state
            .spaces
            .retain(|key, _| key == PERSONAL || known.contains(key));
        save(&state);
        changed
    };
    for entry in changed {
        emit_to_space(app, &entry.key, SPACE_CHANGED_EVENT, &entry);
        for window in windows_for_space(app, &entry.key) {
            let incognito = is_incognito_window(window.label());
            let _ = window.set_title(&window_title(&entry, incognito));
        }
    }
    refresh_menus(app);
}

pub fn set_color<R: Runtime>(
    app: &AppHandle<R>,
    key: &str,
    color: &str,
) -> Result<SpaceEntry, String> {
    if !valid_color(color) {
        return Err("Choose one of the Space colors.".into());
    }
    let entry = {
        let mut state = lock_registry().map_err(|_| "Spaces are unavailable.")?;
        ensure_entry(&mut state, key);
        let entry = state.spaces.get_mut(key).expect("entry exists");
        entry.color = Some(color.into());
        let entry = entry.clone();
        save(&state);
        entry
    };
    emit_to_space(app, key, SPACE_CHANGED_EVENT, &entry);
    Ok(entry)
}

/// A deleted or left Space: its windows close now, and its website data goes once
/// WebKit has let go of the store (see `browser_profile_cleanup`).
pub fn remove_space(app: &AppHandle, key: &str) -> Result<(), String> {
    if key == PERSONAL {
        return Err("The personal Space can't be removed.".into());
    }
    // Windows showing the Space switch to the personal Space; its pages close with it.
    for window in windows_for_space(app, key) {
        let _ = switch_space(app, window.label(), PERSONAL);
    }
    crate::infra::extensions::release_space(key);
    if let Ok(mut state) = lock_registry() {
        state.spaces.remove(key);
        state.open.retain(|open| open != key);
        save(&state);
    }
    refresh_menus(app);
    Ok(())
}

/// Removes a Space from this device: its windows close now and its website data is
/// erased in a later step, once WebKit has let go of the store.
pub fn delete_space(app: &AppHandle, key: &str) -> Result<(), String> {
    remove_space(app, key)?;
    let (app, key) = (app.clone(), key.to_owned());
    tauri::async_runtime::spawn(async move {
        // Its extensions' storage lives in the Space's own controller.
        if let Err(error) = crate::infra::extensions::remove_space(&app, &key).await {
            eprintln!("Could not remove a Space's extension data: {error}");
        }
        if let Err(error) =
            crate::infra::browser::profile_cleanup::remove_space_data(app, key).await
        {
            eprintln!("Could not remove a Space's website data: {error}");
        }
    });
    Ok(())
}
