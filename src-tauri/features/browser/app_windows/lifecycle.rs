//! Opening, restoring and closing profile windows and incognito windows.
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
            crate::app::macos_window_effects::mac_traffic_lights::hold_traffic_lights(
                view.ns_window() as cocoa::base::id,
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

pub(super) fn window_title(entry: &ProfileEntry, incognito: bool) -> String {
    if incognito {
        format!("{} (Incognito)", entry.name)
    } else {
        entry.name.clone()
    }
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
    let label = new_label(false);
    set_current(
        &label,
        WindowState {
            profile: key,
            window_id: window.window_id,
            space: window.space,
        },
    );
    if let Err(error) = build_window(app, &label, &window_title(&entry, false), &entry) {
        forget_current(&label);
        return Err(error);
    }
    if let Ok(state) = lock_registry() {
        save(&state);
    }
    refresh_menus(app);
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
        },
    )
}

/// Brings forward a window of the profile, the one used last first, or opens one. This is
/// what switching profile does: tabs never swap under a window.
pub fn open_profile<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<(), String> {
    if !valid_key(key) {
        return Err("Unknown profile.".into());
    }
    let showing = windows_for_profile(app, key)
        .into_iter()
        .filter(|window| is_person_window(window.label()))
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
    open_profile_window(app, key)
}

/// Opens a new incognito window of a profile. It joins the profile's temporary session,
/// starting a fresh one when the profile has no incognito window open.
pub fn open_incognito<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<(), String> {
    if !valid_key(key) {
        return Err("Unknown profile.".into());
    }
    let label = new_label(true);
    let entry = {
        let mut state = lock_registry().map_err(|_| "Profiles are unavailable.")?;
        let entry = state
            .current()
            .get(key)
            .cloned()
            .ok_or("Unknown profile.")?;
        join_incognito(&mut state, key, &label);
        entry
    };
    set_current(
        &label,
        WindowState {
            profile: key.to_owned(),
            window_id: new_window_id(),
            space: None,
        },
    );
    if let Err(error) = build_window(app, &label, &window_title(&entry, true), &entry) {
        forget_current(&label);
        forget_incognito(&label, key);
        return Err(error);
    }
    Ok(())
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

/// Window lifecycle: remembers focus, leaves a closed window's tabs in its profile, erases an
/// incognito session with its last window and frees the extension host of a profile with no
/// window any more. Closing a window never tells the vault anything: only closing a tab does.
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
        tauri::WindowEvent::Focused(true) if !parsed.incognito => {
            if let Ok(mut state) = lock_registry() {
                state.last_focused = Some(label.into());
            }
        }
        tauri::WindowEvent::Destroyed => {
            crate::app::macos_window_effects::mac_rounded_corners::forget_window(label);
            crate::browser::forget_closed_pages(window.app_handle());
            if parsed.incognito {
                forget_current(label);
                if let Some(session) = forget_incognito(label, &parsed.profile) {
                    crate::browser::end_incognito_session(window.app_handle(), &session);
                }
                return;
            }
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
            // A profile with no window any more lets its extension host go.
            if !profile_is_open(&parsed.profile) {
                crate::browser::extensions::release_profile(&parsed.profile);
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
            refresh_menus(window.app_handle());
        }
        _ => {}
    }
}

/// Quitting keeps the windows open for the next launch.
pub fn quitting() {
    QUITTING.store(true, Ordering::SeqCst);
    if let Ok(state) = lock_registry() {
        save(&state);
    }
}
