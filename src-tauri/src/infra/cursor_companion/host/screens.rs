//! Which display the person works on, and the windows that count as theirs.

use super::{platform, Display};

fn contains(d: &Display, p: (f64, f64)) -> bool {
    p.0 >= d.x && p.0 < d.x + d.width && p.1 >= d.y && p.1 < d.y + d.height
}
/// Misty windows a person works in: app windows and extension popups. The
/// companion, its overlays and other panels are never "in front".
pub(super) fn person_works_in(label: &str) -> bool {
    crate::infra::space_windows::is_app_window(label)
        || label.starts_with(crate::infra::extensions::popup::POPUP_PREFIX)
}
#[cfg(windows)]
pub(super) fn native_handle(window: &tauri::WebviewWindow) -> Option<isize> {
    window.hwnd().ok().map(|hwnd| hwnd.0 as isize)
}
#[cfg(target_os = "macos")]
pub(super) fn native_handle(window: &tauri::WebviewWindow) -> Option<isize> {
    let native = window.ns_window().ok()? as *const objc2_app_kit::NSWindow;
    // SAFETY: called on the main thread with a live window.
    Some(unsafe { (*native).windowNumber() })
}
/// "App: title", short enough for a capture label.
pub(super) fn window_name(window: &platform::ForegroundWindow) -> String {
    let title: String = window.title.trim().chars().take(120).collect();
    match (window.app.trim(), title.as_str()) {
        ("", "") => "focused window".into(),
        (app, "") => app.into(),
        ("", title) => title.into(),
        (app, title) => format!("{app}: {title}"),
    }
}
/// The display the person is working on: the one holding the window in
/// front, else the one under the cursor, else the first. The flag says
/// whether the foreground window decided it.
pub(super) fn choose_primary(
    frames: &[Display],
    foreground: Option<&platform::ForegroundWindow>,
    cursor: (f64, f64),
) -> Option<(u32, bool)> {
    if let Some(window) = foreground {
        let reported = window.monitor.and_then(|(x, y, width, height)| {
            frames
                .iter()
                .find(|d| d.x == x && d.y == y && d.width == width && d.height == height)
        });
        let overlap = |d: &&Display| {
            let w = (window.x + window.width).min(d.x + d.width) - window.x.max(d.x);
            let h = (window.y + window.height).min(d.y + d.height) - window.y.max(d.y);
            w.max(0.) * h.max(0.)
        };
        let largest = frames
            .iter()
            .filter(|d| overlap(d) > 0.)
            .max_by(|a, b| overlap(a).total_cmp(&overlap(b)));
        if let Some(display) = reported.or(largest) {
            return Some((display.id, true));
        }
    }
    frames
        .iter()
        .find(|d| contains(d, cursor))
        .or(frames.first())
        .map(|d| (d.id, false))
}
#[cfg(test)]
mod primary_display_tests;
