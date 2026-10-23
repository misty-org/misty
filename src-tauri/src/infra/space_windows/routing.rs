//! Which windows stand for the app, a Space or the person, and the events sent to them.
use super::*;

/// Emitted to the window that becomes the host after the host closes.
pub const HOST_EVENT: &str = "misty://space-window-host";

/// The window that runs this device's own background work (agent jobs): the oldest
/// open app window. Incognito windows never host it.
pub fn host_window() -> Option<String> {
    current_windows()
        .into_iter()
        .map(|(label, _)| label)
        .find(|label| is_person_window(label))
}

/// Whether any open window shows the Space now.
pub fn space_is_open(key: &str) -> bool {
    current_windows().iter().any(|(_, shown)| shown == key)
}

/// Every open app window, incognito included.
pub fn app_windows<R: Runtime>(app: &AppHandle<R>) -> Vec<Window<R>> {
    // `get_webview_window` cannot see a window that holds page views beside its own.
    app.windows()
        .into_iter()
        .filter(|(label, _)| is_app_window(label))
        .map(|(_, window)| window)
        .collect()
}

/// Every open Space window (no incognito windows).
pub fn space_windows<R: Runtime>(app: &AppHandle<R>) -> Vec<Window<R>> {
    app_windows(app)
        .into_iter()
        .filter(|window| is_space_window(window.label()))
        .collect()
}

/// A Space's open windows, its incognito windows included.
pub fn windows_for_space<R: Runtime>(app: &AppHandle<R>, key: &str) -> Vec<Window<R>> {
    app_windows(app)
        .into_iter()
        .filter(|window| space_for_window(window.label()).as_deref() == Some(key))
        .collect()
}

/// The app window that answers for the app as a whole: the last focused Space window,
/// else the personal Space's, else any. Incognito windows never stand in for the app.
pub fn primary<R: Runtime>(app: &AppHandle<R>) -> Option<Window<R>> {
    let last = registry::last_focused_space();
    last.and_then(|label| app.get_window(&label))
        .filter(|window| is_person_window(window.label()))
        .or_else(|| {
            windows_for_space(app, PERSONAL)
                .into_iter()
                .find(|window| is_person_window(window.label()))
        })
        .or_else(|| {
            space_windows(app)
                .into_iter()
                .find(|window| is_person_window(window.label()))
        })
}

/// The app window the person used last, incognito included: menu choices act there.
#[cfg(target_os = "macos")]
pub fn focused<R: Runtime>(app: &AppHandle<R>) -> Option<Window<R>> {
    let last = registry::last_focused_any();
    last.and_then(|label| app.get_window(&label))
        .or_else(|| primary(app))
}

/// Sends a menu choice to the window the person used last, incognito included.
#[cfg(target_os = "macos")]
pub fn emit_to_focused<R: Runtime, S: Serialize + Clone>(
    app: &AppHandle<R>,
    event: &str,
    payload: S,
) {
    if let Some(window) = focused(app) {
        let _ = app.emit_to(window.label(), event, payload);
    }
}

pub fn primary_label<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    primary(app).map(|window| window.label().to_owned())
}

/// The primary window's app webview.
pub fn primary_webview<R: Runtime>(app: &AppHandle<R>) -> Option<tauri::Webview<R>> {
    primary_label(app).and_then(|label| app.get_webview(&label))
}

pub(in crate::infra) fn targets(target: &EventTarget, accept: impl Fn(&str) -> bool) -> bool {
    match target {
        EventTarget::Window { label }
        | EventTarget::Webview { label }
        | EventTarget::WebviewWindow { label }
        | EventTarget::AnyLabel { label } => accept(label),
        _ => false,
    }
}

/// Sends an account-wide event (sync, extensions, devices) to every Space window.
/// Incognito windows never hear about account data.
pub fn emit<R: Runtime, S: Serialize + Clone>(app: &AppHandle<R>, event: &str, payload: S) {
    let _ = app.emit_filter(event, payload, |target| targets(target, is_space_window));
}

/// Sends an event to one Space's windows, incognito windows included.
pub fn emit_to_space<R: Runtime, S: Serialize + Clone>(
    app: &AppHandle<R>,
    key: &str,
    event: &str,
    payload: S,
) {
    let _ = app.emit_filter(event, payload, |target| {
        targets(target, |label| {
            space_for_window(label).as_deref() == Some(key)
        })
    });
}

/// Sends an event the person acts on (a menu choice, dictation, the cursor agent) to
/// the window they use: the last focused Space window.
pub fn emit_to_primary<R: Runtime, S: Serialize + Clone>(
    app: &AppHandle<R>,
    event: &str,
    payload: S,
) {
    if let Some(label) = primary_label(app) {
        let _ = app.emit_to(label.as_str(), event, payload);
    }
}
