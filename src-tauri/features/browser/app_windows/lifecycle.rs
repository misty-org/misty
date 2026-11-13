//! Opening, restoring and closing profile windows.
use super::*;
use std::sync::atomic::Ordering;

mod profiles;
pub use profiles::*;

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

fn build_window<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    title: &str,
    entry: &ProfileEntry,
) -> Result<(), String> {
    let config = window_config(app, label)?;
    // The app reads who this window is before it first renders.
    let state = window_state(label).ok_or("This window has no profile.")?;
    let opening = serde_json::json!({
        "windowId": state.window_id,
        "profile": entry,
        "space": state.space,
    });
    tauri::WebviewWindowBuilder::from_config(app, &config)
        .map_err(|error| error.to_string())?
        .initialization_script(format!("window.__MISTY_WINDOW__ = {opening};"))
        .title(title)
        .build()
        .map_err(|error| error.to_string())?;
    // The traffic lights wait hidden until the layout places them, so they never show in
    // AppKit's spot first, however the window comes to be shown.
    #[cfg(target_os = "macos")]
    if let Some(view) = app.get_webview(label) {
        let _ = view.with_webview(|view| unsafe {
            crate::app::macos_window_effects::mac_traffic_lights::hold_traffic_lights_of(
                view.ns_window(),
            );
        });
    }
    #[cfg(windows)]
    if let Some(view) = app.get_webview(label) {
        crate::browser::pages::process_ended::watch_page_process(&view);
        crate::browser::app_windows::windows::focus::watch(&view);
    }
    Ok(())
}

fn focus<R: Runtime>(window: &Window<R>) {
    // A new window shows itself once its first frame is ready (`reveal_main_window`), which
    // also brings it forward; showing it sooner shows an empty window.
    if !crate::app::macos_window_effects::mac_rounded_corners::window_revealed(window.label()) {
        return;
    }
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

pub(super) fn window_title(entry: &ProfileEntry) -> String {
    entry.name.clone()
}

fn new_window_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn open_window<R: Runtime>(app: &AppHandle<R>, window: OpenWindow) -> Result<(), String> {
    let key = window.profile.clone();
    let entry = {
        let mut state = lock_registry().map_err(|_| "Profiles are unavailable.")?;
        state.current().get(&key).cloned()
    }
    .ok_or("Unknown profile.")?;
    let label = new_label();
    window_geometry::remember(&window.window_id, window.geometry.as_ref());
    let window_id = window.window_id.clone();
    set_current(
        &label,
        WindowState {
            profile: key,
            window_id: window.window_id,
            space: window.space,
        },
    );
    if let Err(error) = build_window(app, &label, &window_title(&entry), &entry) {
        forget_current(&label);
        return Err(error);
    }
    // Before it is first shown, so it never appears at its default size and then jumps.
    if let Some(built) = app.get_window(&label) {
        window_geometry::apply_and_track(&built, &window_id);
    }
    if let Ok(state) = lock_registry() {
        save(&state);
    }
    Ok(())
}

/// Opens a new window of a profile. If a closed window of the profile left tabs waiting, this
/// window takes up where that one was.
pub fn open_profile_window<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<(), String> {
    if !valid_key(key) {
        return Err("Unknown profile.".into());
    }
    let window_id = lock_registry()
        .ok()
        .and_then(|mut state| {
            let orphans = state.orphans.get_mut(key)?;
            (!orphans.is_empty()).then(|| orphans.remove(0))
        })
        .unwrap_or_else(new_window_id);
    open_window(
        app,
        OpenWindow {
            profile: key.to_owned(),
            window_id,
            space: None,
            geometry: None,
        },
    )
}

/// Opens the windows the last launch left open, or the first profile's.
pub fn restore<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let open = lock_registry()
        .map(|state| state.open.clone())
        .unwrap_or_default();
    let mut opened = false;
    for window in open {
        // A profile that no longer opens (deleted elsewhere) is skipped.
        opened |= open_window(app, window).is_ok();
    }
    if !opened {
        open_profile_window(app, PERSONAL)?;
    }
    if let Some(window) = primary(app) {
        focus(&window);
    }
    Ok(())
}

/// Window lifecycle: remembers focus and leaves a closed window's tabs in its profile.
pub fn window_event(window: &Window, event: &tauri::WindowEvent) {
    let label = window.label();
    let Some(parsed) = parse(label) else { return };
    if matches!(event, tauri::WindowEvent::Focused(true)) {
        if let Ok(mut last) = LAST_FOCUSED.lock() {
            *last = Some(label.to_owned());
        }
        // Alt+Tab focuses the window but none of its webviews; give focus back.
        #[cfg(windows)]
        crate::browser::app_windows::windows::focus::window_activated(window);
    }
    #[cfg(windows)]
    if matches!(event, tauri::WindowEvent::Destroyed) {
        crate::browser::app_windows::windows::focus::forget(label);
    }
    match event {
        tauri::WindowEvent::Resized(_)
        | tauri::WindowEvent::Moved(_)
        | tauri::WindowEvent::ScaleFactorChanged { .. } => window_geometry::mark_dirty(label),
        tauri::WindowEvent::CloseRequested { .. } => window_geometry::flush(label),
        _ => {}
    }
    match event {
        tauri::WindowEvent::Focused(true) => {
            // A saved maximize or full screen lands when the window is revealed
            // (`reveal_main_window`), never here: a window that opened without focus would
            // otherwise resize the first time it is clicked.
            if let Ok(mut state) = lock_registry() {
                state.last_focused = Some(label.into());
            }
        }
        tauri::WindowEvent::Destroyed => {
            window_geometry::forget(label);
            crate::app::macos_window_effects::mac_rounded_corners::forget_window(label);
            crate::browser::forget_closed_pages(window.app_handle());
            crate::project::terminal::close_window(label);
            if QUITTING.load(Ordering::SeqCst) {
                return;
            }
            let was_host = host_window().as_deref() == Some(label);
            let closed = forget_current(label);
            if was_host {
                if let Some(next) = host_window() {
                    let _ = window.app_handle().emit_to(next.as_str(), HOST_EVENT, ());
                }
            }
            if let Ok(mut state) = lock_registry() {
                if state.last_focused.as_deref() == Some(label) {
                    state.last_focused = None;
                }
                if let Some(closed) = closed {
                    state
                        .orphans
                        .entry(parsed.profile.clone())
                        .or_default()
                        .push(closed.window_id);
                }
                save(&state);
            }
            emit_to_profile(window.app_handle(), &parsed.profile, ORPHANS_EVENT, ());
        }
        _ => {}
    }
}

/// Quitting keeps the windows open for the next launch.
pub fn quitting() {
    QUITTING.store(true, Ordering::SeqCst);
    window_geometry::flush_all();
    if let Ok(state) = lock_registry() {
        save(&state);
    }
}
