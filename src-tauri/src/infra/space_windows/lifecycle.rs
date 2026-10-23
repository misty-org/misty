//! Opening, restoring and closing Space windows and incognito windows.
use super::*;
use std::collections::BTreeSet;
use std::sync::atomic::Ordering;

mod spaces;
pub use spaces::*;

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
    // The traffic lights wait hidden until the layout places them, so they never show in
    // AppKit's spot first, however the window comes to be shown.
    #[cfg(target_os = "macos")]
    if let Some(view) = app.get_webview(label) {
        let _ = view.with_webview(|view| unsafe {
            crate::platform::plugins::mac_traffic_lights::hold_traffic_lights(
                view.ns_window() as cocoa::base::id
            );
        });
    }
    #[cfg(windows)]
    if let Some(view) = app.get_webview(label) {
        crate::infra::browser_process_ended::watch_page_process(&view);
        crate::infra::window_focus_windows::watch(&view);
    }
    Ok(())
}

fn focus<R: Runtime>(window: &Window<R>) {
    // A new window shows itself once its first frame is ready (`reveal_main_window`), which
    // also brings it forward; showing it sooner shows an empty window.
    if !crate::platform::plugins::mac_rounded_corners::window_revealed(window.label()) {
        return;
    }
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
#[cfg(target_os = "macos")]
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
