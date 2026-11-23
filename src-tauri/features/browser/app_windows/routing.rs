use super::*;

pub const HOST_EVENT: &str = "misty://profile-window-host";

pub fn host_window() -> Option<String> {
    current_windows()
        .into_iter()
        .map(|(label, _)| label)
        .find(|label| is_person_window(label))
}

pub(crate) fn open_window_ids(profile: &str) -> std::collections::BTreeSet<String> {
    current_windows()
        .into_iter()
        .filter(|(label, window)| is_person_window(label) && window.profile == profile)
        .map(|(_, window)| window.window_id)
        .collect()
}

pub(crate) fn first_window_of(profile: &str) -> Option<String> {
    current_windows()
        .into_iter()
        .find(|(label, window)| is_person_window(label) && window.profile == profile)
        .map(|(label, _)| label)
}

pub(crate) fn last_person_window() -> Option<String> {
    registry::last_focused_person()
}

pub fn app_windows<R: Runtime>(app: &AppHandle<R>) -> Vec<Window<R>> {
    app.windows()
        .into_iter()
        .filter(|(label, _)| is_app_window(label))
        .map(|(_, window)| window)
        .collect()
}

pub fn person_windows<R: Runtime>(app: &AppHandle<R>) -> Vec<Window<R>> {
    app_windows(app)
        .into_iter()
        .filter(|window| is_person_window(window.label()))
        .collect()
}

pub fn windows_for_profile<R: Runtime>(app: &AppHandle<R>, key: &str) -> Vec<Window<R>> {
    app_windows(app)
        .into_iter()
        .filter(|window| profile_for_window(window.label()).as_deref() == Some(key))
        .collect()
}

pub fn primary<R: Runtime>(app: &AppHandle<R>) -> Option<Window<R>> {
    let last = registry::last_focused_person();
    last.and_then(|label| app.get_window(&label))
        .filter(|window| is_person_window(window.label()))
        .or_else(|| {
            windows_for_profile(app, PERSONAL)
                .into_iter()
                .find(|window| is_person_window(window.label()))
        })
        .or_else(|| {
            person_windows(app)
                .into_iter()
                .find(|window| is_person_window(window.label()))
        })
}

#[cfg(target_os = "macos")]
pub fn focused<R: Runtime>(app: &AppHandle<R>) -> Option<Window<R>> {
    let last = registry::last_focused_any();
    last.and_then(|label| app.get_window(&label))
        .or_else(|| primary(app))
}

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

pub fn primary_webview<R: Runtime>(app: &AppHandle<R>) -> Option<tauri::Webview<R>> {
    primary_label(app).and_then(|label| app.get_webview(&label))
}

pub(crate) fn targets(target: &EventTarget, accept: impl Fn(&str) -> bool) -> bool {
    match target {
        EventTarget::Window { label }
        | EventTarget::Webview { label }
        | EventTarget::WebviewWindow { label }
        | EventTarget::AnyLabel { label } => accept(label),
        _ => false,
    }
}

pub fn emit<R: Runtime, S: Serialize + Clone>(app: &AppHandle<R>, event: &str, payload: S) {
    let _ = app.emit_filter(event, payload, |target| targets(target, is_person_window));
}

pub fn emit_to_profile<R: Runtime, S: Serialize + Clone>(
    app: &AppHandle<R>,
    key: &str,
    event: &str,
    payload: S,
) {
    let _ = app.emit_filter(event, payload, |target| {
        targets(target, |label| {
            profile_for_window(label).as_deref() == Some(key)
        })
    });
}

pub fn emit_to_primary<R: Runtime, S: Serialize + Clone>(
    app: &AppHandle<R>,
    event: &str,
    payload: S,
) {
    if let Some(label) = primary_label(app) {
        let _ = app.emit_to(label.as_str(), event, payload);
    }
}
