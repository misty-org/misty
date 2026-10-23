//! Placing a page's native view: its bounds, kept unchanged when nothing moved,
//! and on Windows the hidden tabs that shared its place.
use super::*;

pub(super) fn logical_bounds(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> (LogicalPosition<f64>, LogicalSize<f64>) {
    (
        LogicalPosition::new(x.max(0.0), y.max(0.0)),
        LogicalSize::new(width.max(1.0), height.max(1.0)),
    )
}

pub(super) fn set_webview_bounds_if_changed(
    app: &AppHandle,
    webview: &Webview,
    position: LogicalPosition<f64>,
    size: LogicalSize<f64>,
) -> Result<(), String> {
    let scale = webview
        .window()
        .scale_factor()
        .map_err(|error| error.to_string())?;
    #[cfg(not(windows))]
    let _ = app;
    // A view still waiting for its first paint takes its size but stays parked,
    // so no caller can pull the blank surface on screen early.
    let position = if is_held_view(webview) {
        PARKED_POSITION
    } else {
        position
    };
    let desired_position = position.to_physical::<i32>(scale);
    let desired_size = size.to_physical::<u32>(scale);
    let current_position = webview.position().map_err(|error| error.to_string())?;
    let current_size = webview.size().map_err(|error| error.to_string())?;
    if current_position == desired_position && current_size == desired_size {
        return Ok(());
    }
    webview
        .set_bounds(tauri::Rect {
            position: position.into(),
            size: size.into(),
        })
        .map_err(|error| error.to_string())?;
    #[cfg(windows)]
    if current_position.x > -10_000 && desired_position.x > -10_000 && !is_stacked(webview) {
        follow_siblings(
            app,
            webview,
            (current_position, current_size),
            (position, size),
        );
    }
    refresh_browser_cursor_ownership(webview)
}

/// Equal sizes after logical-to-physical rounding at fractional display scales.
#[cfg(windows)]
fn about_same_size(a: tauri::PhysicalSize<u32>, b: tauri::PhysicalSize<u32>) -> bool {
    a.width.abs_diff(b.width) <= 2 && a.height.abs_diff(b.height) <= 2
}

/// When a page on screen moves or changes size (the window, the sidebar or a
/// split moved), the hidden tabs that shared its old place follow it: stacked
/// ones to its new place and size, parked ones to its new size. Switching to
/// one then only raises it, already laid out where it shows.
#[cfg(windows)]
fn follow_siblings(
    app: &AppHandle,
    moved: &Webview,
    (old_position, old_size): (tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>),
    (position, size): (LogicalPosition<f64>, LogicalSize<f64>),
) {
    let window = moved.window().label().to_owned();
    for (label, webview) in app.webviews() {
        if label == moved.label()
            || !label.starts_with("misty-browser-")
            || webview.window().label() != window
        {
            continue;
        }
        let (Ok(current_position), Ok(current_size)) = (webview.position(), webview.size()) else {
            continue;
        };
        if !about_same_size(current_size, old_size) {
            continue;
        }
        let parked = current_position.x <= -10_000 && current_position.y <= -10_000;
        let same_place = current_position.x.abs_diff(old_position.x) <= 2
            && current_position.y.abs_diff(old_position.y) <= 2;
        let target = if parked {
            PARKED_POSITION
        } else if is_stacked(&webview) && same_place {
            position
        } else {
            continue;
        };
        let _ = webview.set_bounds(tauri::Rect {
            position: target.into(),
            size: size.into(),
        });
    }
}
