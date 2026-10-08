//! Opening, restoring and closing Space windows and incognito windows.
use super::*;
use std::collections::BTreeSet;
use std::sync::atomic::Ordering;

fn window_config<R: Runtime>(app: &AppHandle<R>, label: &str) -> Result<tauri::utils::config::WindowConfig, String> {
    let mut config = app
        .config()
        .app
        .windows
        .first()
        .cloned()
        .ok_or("Misty has no window configuration.")?;
    config.label = label.into();
    config.create = true;
    Ok(config)
}

fn build_window<R: Runtime>(app: &AppHandle<R>, label: &str, title: &str) -> Result<(), String> {
    let config = window_config(app, label)?;
    tauri::WebviewWindowBuilder::from_config(app, &config)
        .map_err(|error| error.to_string())?
        .title(title)
        .build()
        .map_err(|error| error.to_string())?;
    #[cfg(windows)]
    if let Some(view) = app.get_webview(label) {
        crate::infra::browser_process_ended::watch_page_process(&view);
    }
    Ok(())
}

fn focus<R: Runtime>(window: &Window<R>) {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

/// Opens the Space's window, or brings it forward when it is already open.
pub fn open_space<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<(), String> {
    if !valid_key(key) {
        return Err("Unknown Space.".into());
    }
    let label = space_label(key);
    if let Some(window) = app.get_window(&label) {
        focus(&window);
        return Ok(());
    }
    let entry = {
        let mut state = lock_registry().map_err(|_| "Spaces are unavailable.")?;
        let entry = ensure_entry(&mut state, key);
        if !state.open.iter().any(|open| open == key) {
            state.open.push(key.into());
        }
        save(&state);
        entry
    };
    build_window(app, &label, &entry.name)?;
    refresh_menus(app);
    Ok(())
}

/// Opens a new incognito window for a Space. It joins the Space's temporary session,
/// starting a fresh one when the Space has no incognito window open.
pub fn open_incognito<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<(), String> {
    if !valid_key(key) {
        return Err("Unknown Space.".into());
    }
    let (label, name) = {
        let mut state = lock_registry().map_err(|_| "Spaces are unavailable.")?;
        let entry = ensure_entry(&mut state, key);
        let session = state
            .incognito
            .entry(key.into())
            .or_insert_with(|| IncognitoSession {
                windows: BTreeSet::new(),
                session: format!(
                    "{key}#{}",
                    INCOGNITO_GENERATION.fetch_add(1, Ordering::Relaxed) + 1
                ),
            });
        let number = (1..).find(|n| !session.windows.contains(n)).unwrap_or(1);
        session.windows.insert(number);
        save(&state);
        (incognito_label(key, number), format!("{} (Incognito)", entry.name))
    };
    if let Err(error) = build_window(app, &label, &name) {
        forget_incognito(&label);
        return Err(error);
    }
    Ok(())
}

/// Opens the Spaces that were open at quit, or the personal Space.
pub fn restore<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let open = lock_registry()
        .map(|state| state.open.clone())
        .unwrap_or_default();
    let mut opened = false;
    for key in open {
        // A Space that no longer opens (it was deleted elsewhere) is skipped.
        opened |= open_space(app, &key).is_ok();
    }
    if !opened {
        open_space(app, PERSONAL)?;
    }
    // The last focused Space comes forward last.
    if let Some(window) = primary(app) {
        focus(&window);
    }
    Ok(())
}

/// Window lifecycle: remembers focus, forgets closed Spaces (unless quitting) and
/// erases an incognito session with its last window.
pub fn window_event(window: &Window, event: &tauri::WindowEvent) {
    let label = window.label();
    let Some(parsed) = parse(label) else { return };
    if matches!(event, tauri::WindowEvent::Focused(true)) {
        if let Ok(mut last) = LAST_FOCUSED.lock() {
            *last = Some(label.to_owned());
        }
    }
    match event {
        tauri::WindowEvent::Focused(true) if parsed.incognito.is_none() => {
            if let Ok(mut state) = lock_registry() {
                if state.last_focused.as_deref() != Some(label) {
                    state.last_focused = Some(label.into());
                    save(&state);
                }
            }
        }
        tauri::WindowEvent::Destroyed => {
            crate::platform::plugins::mac_rounded_corners::forget_window(label);
            crate::infra::browser::forget_closed_pages(window.app_handle());
            if parsed.incognito.is_some() {
                if let Some(session) = forget_incognito(label) {
                    crate::infra::browser::end_incognito_session(window.app_handle(), &session);
                }
                return;
            }
            if QUITTING.load(Ordering::SeqCst) {
                return;
            }
            if let Ok(mut state) = lock_registry() {
                state.open.retain(|key| *key != parsed.space);
                if state.last_focused.as_deref() == Some(label) {
                    state.last_focused = None;
                }
                save(&state);
            }
            refresh_menus(window.app_handle());
        }
        _ => {}
    }
}

/// Quitting keeps the list of open Spaces for the next launch.
pub fn quitting() {
    QUITTING.store(true, Ordering::SeqCst);
}

/// Whether this window should take links other apps hand to Misty: the last focused
/// Space window. A Space that claims the site comes with Phase 6.
pub fn is_link_target<R: Runtime>(app: &AppHandle<R>, label: &str) -> bool {
    is_space_window(label) && primary_label(app).as_deref() == Some(label)
}

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
        let Ok(mut state) = lock_registry() else { return };
        let mut changed = Vec::new();
        let mut known = BTreeSet::new();
        for (space_id, personal, name) in spaces {
            let Ok(key) = space_key(&space_id, personal) else { continue };
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
            let title = match parse(window.label()).and_then(|w| w.incognito) {
                Some(_) => format!("{} (Incognito)", entry.name),
                None => entry.name.clone(),
            };
            let _ = window.set_title(&title);
        }
    }
    refresh_menus(app);
}

pub fn set_color<R: Runtime>(app: &AppHandle<R>, key: &str, color: &str) -> Result<SpaceEntry, String> {
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
pub fn remove_space<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<(), String> {
    if key == PERSONAL {
        return Err("The personal Space can't be removed.".into());
    }
    for window in windows_for_space(app, key) {
        let _ = window.destroy();
    }
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
        if let Err(error) = crate::infra::browser::profile_cleanup::remove_space_data(app, key).await {
            eprintln!("Could not remove a Space's website data: {error}");
        }
    });
    Ok(())
}
