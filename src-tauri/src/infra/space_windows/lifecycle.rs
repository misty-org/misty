//! Opening, restoring and closing Space windows and incognito windows.
use super::*;
use std::collections::BTreeSet;
use std::sync::atomic::Ordering;

fn window_config<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
) -> Result<tauri::utils::config::WindowConfig, String> {
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
    // The app reads the Space the window opens in before it first renders; after that
    // it follows `SPACE_CHANGED_EVENT` and asks `space_window_info` after a reload.
    let space = space_for_window(label).unwrap_or_else(|| PERSONAL.into());
    let opening = serde_json::json!({ "key": space, "spaceId": space_id_for_key(&space) });
    tauri::WebviewWindowBuilder::from_config(app, &config)
        .map_err(|error| error.to_string())?
        .initialization_script(format!("window.__MISTY_WINDOW_SPACE__ = {opening};"))
        .title(title)
        .build()
        .map_err(|error| error.to_string())?;
    #[cfg(windows)]
    if let Some(view) = app.get_webview(label) {
        crate::infra::browser_process_ended::watch_page_process(&view);
        crate::infra::window_focus_windows::watch(&view);
    }
    Ok(())
}

fn focus<R: Runtime>(window: &Window<R>) {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

fn window_title(entry: &SpaceEntry, incognito: bool) -> String {
    if incognito {
        format!("{} (Incognito)", entry.name)
    } else {
        entry.name.clone()
    }
}

/// Opens a new window showing a Space ("Open in new window").
pub fn open_space_window<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<(), String> {
    if !valid_key(key) {
        return Err("Unknown Space.".into());
    }
    let entry = {
        let mut state = lock_registry().map_err(|_| "Spaces are unavailable.")?;
        ensure_entry(&mut state, key)
    };
    let label = new_label(false);
    set_current(&label, key);
    if let Err(error) = build_window(app, &label, &window_title(&entry, false)) {
        forget_current(&label);
        return Err(error);
    }
    if let Ok(state) = lock_registry() {
        save(&state);
    }
    refresh_menus(app);
    Ok(())
}

/// Brings forward a window showing the Space, the one used last first, or opens one.
pub fn open_space<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<(), String> {
    if !valid_key(key) {
        return Err("Unknown Space.".into());
    }
    let showing = windows_for_space(app, key)
        .into_iter()
        .filter(|window| is_space_window(window.label()))
        .collect::<Vec<_>>();
    let last = last_focused_any();
    if let Some(window) = showing
        .iter()
        .find(|window| Some(window.label()) == last.as_deref())
        .or_else(|| showing.first())
    {
        focus(window);
        return Ok(());
    }
    open_space_window(app, key)
}

/// Switches a window to another Space in place. The window's app swaps its tabs to that
/// Space's; pages it opens from now on use that Space's store, extensions and sync.
pub fn switch_space(app: &AppHandle, label: &str, key: &str) -> Result<SpaceEntry, String> {
    let window = parse(label).ok_or("This window can't show a Space.")?;
    if !valid_key(key) {
        return Err("Unknown Space.".into());
    }
    let (entry, ended) = {
        let mut state = lock_registry().map_err(|_| "Spaces are unavailable.")?;
        // Only Spaces the account has (as its windows listed them) or the personal one.
        if key != PERSONAL && !state.spaces.contains_key(key) {
            return Err("Unknown Space.".into());
        }
        let entry = ensure_entry(&mut state, key);
        let mut ended = None;
        if window.incognito && window.space != key {
            ended = leave_incognito(&mut state, &window.space, label);
            join_incognito(&mut state, key, label);
        }
        (entry, ended)
    };
    set_current(label, key);
    if let Ok(state) = lock_registry() {
        save(&state);
    }
    if let Some(session) = ended {
        crate::infra::browser::end_incognito_session(app, &session);
    }
    if let Some(native) = app.get_window(label) {
        let _ = native.set_title(&window_title(&entry, window.incognito));
    }
    let _ = app.emit_to(label, SPACE_CHANGED_EVENT, &entry);
    refresh_menus(app);
    Ok(entry)
}

/// Switches the window used last to a Space (the Window menu and ⌘⇧N), or opens a
/// window for it when none is open.
pub fn switch_focused(app: &AppHandle, key: &str) -> Result<(), String> {
    let Some(window) = focused(app) else {
        return open_space(app, key);
    };
    switch_space(app, window.label(), key)?;
    focus(&window);
    Ok(())
}

/// Opens a new incognito window showing a Space. It joins the Space's temporary
/// session, starting a fresh one when the Space has no incognito window open.
pub fn open_incognito<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<(), String> {
    if !valid_key(key) {
        return Err("Unknown Space.".into());
    }
    let label = new_label(true);
    let entry = {
        let mut state = lock_registry().map_err(|_| "Spaces are unavailable.")?;
        let entry = ensure_entry(&mut state, key);
        join_incognito(&mut state, key, &label);
        entry
    };
    set_current(&label, key);
    if let Err(error) = build_window(app, &label, &window_title(&entry, true)) {
        forget_current(&label);
        forget_incognito(&label, key);
        return Err(error);
    }
    Ok(())
}

/// Opens a window for each Space the last launch left open, or the personal Space.
pub fn restore<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let open = lock_registry()
        .map(|state| state.open.clone())
        .unwrap_or_default();
    let mut opened = false;
    for key in open {
        // A Space that no longer opens (it was deleted elsewhere) is skipped.
        opened |= open_space_window(app, &key).is_ok();
    }
    if !opened {
        open_space_window(app, PERSONAL)?;
    }
    if let Some(window) = primary(app) {
        focus(&window);
    }
    Ok(())
}

/// Window lifecycle: remembers focus, forgets closed windows (unless quitting), erases
/// an incognito session with its last window and frees the extension host of a Space
/// no window shows any more.
pub fn window_event(window: &Window, event: &tauri::WindowEvent) {
    let label = window.label();
    let Some(parsed) = parse(label) else { return };
    if matches!(event, tauri::WindowEvent::Focused(true)) {
        if let Ok(mut last) = LAST_FOCUSED.lock() {
            *last = Some(label.to_owned());
        }
        // Alt+Tab focuses the window but none of its webviews; give focus back.
        #[cfg(windows)]
        crate::infra::window_focus_windows::window_activated(window);
    }
    #[cfg(windows)]
    if matches!(event, tauri::WindowEvent::Destroyed) {
        crate::infra::window_focus_windows::forget(label);
    }
    match event {
        tauri::WindowEvent::Focused(true) if !parsed.incognito => {
            if let Ok(mut state) = lock_registry() {
                state.last_focused = Some(label.into());
            }
        }
        tauri::WindowEvent::Destroyed => {
            crate::platform::plugins::mac_rounded_corners::forget_window(label);
            crate::infra::browser::forget_closed_pages(window.app_handle());
            if parsed.incognito {
                forget_current(label);
                if let Some(session) = forget_incognito(label, &parsed.space) {
                    crate::infra::browser::end_incognito_session(window.app_handle(), &session);
                }
                return;
            }
            if QUITTING.load(Ordering::SeqCst) {
                return;
            }
            let was_host = host_window().as_deref() == Some(label);
            forget_current(label);
            if was_host {
                if let Some(next) = host_window() {
                    let _ = window.app_handle().emit_to(next.as_str(), HOST_EVENT, ());
                }
            }
            // A Space no window shows any more lets its extension host go.
            if !space_is_open(&parsed.space) {
                crate::infra::extensions::release_space(&parsed.space);
            }
            if let Ok(mut state) = lock_registry() {
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

/// Quitting keeps the Spaces the windows show for the next launch.
pub fn quitting() {
    QUITTING.store(true, Ordering::SeqCst);
    if let Ok(state) = lock_registry() {
        save(&state);
    }
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
