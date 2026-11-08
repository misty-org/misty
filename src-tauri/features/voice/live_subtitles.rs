//! The live subtitles panel: a view inside the Misty window, above its tabs, the way a tab itself is
//! attached. It never leaves that window and goes away with it, and it only draws what the window
//! that opened it sends.
use file_access::fs;
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Webview, WebviewBuilder, WebviewUrl, Window,
};

const PANEL_PREFIX: &str = "misty-live-subtitles-";
const WIDTH: f64 = 800.0;
const HEIGHT: f64 = 360.0;
const MIN_WIDTH: f64 = 480.0;
const MIN_HEIGHT: f64 = 240.0;
/// Clear of the window's edges and a player's controls.
const EDGE_GAP: f64 = 16.0;
const BOTTOM_GAP: f64 = 72.0;

fn require_person_window(webview: &Webview) -> Result<(), String> {
    crate::browser::app_windows::is_person_window(webview.label())
        .then_some(())
        .ok_or_else(|| "Live subtitles aren't available in this window.".into())
}

pub fn subtitles_panel_label(window: &str) -> String {
    format!("{PANEL_PREFIX}{window}")
}

/// A panel of a person's window, and nothing that merely starts the same way.
pub fn is_subtitles_panel(label: &str) -> bool {
    label
        .strip_prefix(PANEL_PREFIX)
        .is_some_and(crate::browser::app_windows::is_person_window)
}

/// Where the panel goes in a window this size: `wanted`, or as near as fits.
fn placed(wanted: (f64, f64), panel: (f64, f64), window: (f64, f64)) -> (f64, f64) {
    let inside = |at: f64, size: f64, room: f64| at.min(room - size - EDGE_GAP).max(EDGE_GAP);
    (
        inside(wanted.0, panel.0, window.0),
        inside(wanted.1, panel.1, window.1),
    )
}

/// The size asked for, in a window this size: the gap around it stays, down to the panel's minimum.
fn sized(wanted: (f64, f64), window: (f64, f64)) -> (f64, f64) {
    (
        wanted.0.min(window.0 - EDGE_GAP * 2.0).max(MIN_WIDTH),
        wanted.1.min(window.1 - EDGE_GAP * 2.0).max(MIN_HEIGHT),
    )
}

fn logical_inner_size(window: &Window) -> Result<(f64, f64), String> {
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let size = window
        .inner_size()
        .map_err(|error| error.to_string())?
        .to_logical::<f64>(scale);
    Ok((size.width, size.height))
}

fn logical_frame(panel: &Webview) -> Result<((f64, f64), (f64, f64)), String> {
    let scale = panel
        .window()
        .scale_factor()
        .map_err(|error| error.to_string())?;
    let at = panel
        .position()
        .map_err(|error| error.to_string())?
        .to_logical::<f64>(scale);
    let size = panel
        .size()
        .map_err(|error| error.to_string())?
        .to_logical::<f64>(scale);
    Ok(((at.x, at.y), (size.width, size.height)))
}

fn set_frame(panel: &Webview, at: (f64, f64), size: (f64, f64)) -> Result<(), String> {
    let room = logical_inner_size(&panel.window())?;
    let size = sized(size, room);
    let at = placed(at, size, room);
    panel
        .set_size(LogicalSize::new(size.0, size.1))
        .map_err(|error| error.to_string())?;
    panel
        .set_position(LogicalPosition::new(at.0, at.1))
        .map_err(|error| error.to_string())
}

fn attach(window: &Window) -> Result<(), String> {
    let room = logical_inner_size(window)?;
    let size = sized((WIDTH, HEIGHT), room);
    let at = placed(
        ((room.0 - size.0) / 2.0, room.1 - size.1 - BOTTOM_GAP),
        size,
        room,
    );
    let builder = WebviewBuilder::new(
        subtitles_panel_label(window.label()),
        WebviewUrl::App("desktop.html".into()),
    )
    .transparent(true)
    // The first click on the panel should count, not just bring it forward.
    .accept_first_mouse(true);
    window
        .add_child(
            builder,
            LogicalPosition::new(at.0, at.1),
            LogicalSize::new(size.0, size.1),
        )
        .map_err(|error| error.to_string())?;
    crate::browser::stack_subtitles_panel(window.app_handle(), window.label());
    Ok(())
}

/// Opens the panel inside the window that asked, low in the middle.
#[tauri::command]
pub fn voice_subtitles_show(webview: Webview, app: AppHandle) -> Result<(), String> {
    require_person_window(&webview)?;
    let window = webview.window();
    if app
        .get_webview(&subtitles_panel_label(window.label()))
        .is_some()
    {
        return Ok(());
    }
    // Built off the UI thread like the tabs are (WebView2 deadlocks otherwise).
    std::thread::spawn(move || {
        if let Err(error) = attach(&window) {
            eprintln!("Could not open live subtitles: {error}");
        }
    });
    Ok(())
}

#[tauri::command]
pub fn voice_subtitles_hide(webview: Webview, app: AppHandle) {
    if let Some(panel) = app.get_webview(&subtitles_panel_label(webview.window().label())) {
        let _ = panel.close();
    }
}

/// The panel dragged or resized by this much, kept inside its window.
#[tauri::command]
pub fn voice_subtitles_frame(
    webview: Webview,
    dx: f64,
    dy: f64,
    dw: f64,
    dh: f64,
) -> Result<(), String> {
    if !is_subtitles_panel(webview.label())
        || ![dx, dy, dw, dh].iter().all(|delta| delta.is_finite())
    {
        return Err("Only the subtitles panel moves itself.".into());
    }
    let (at, size) = logical_frame(&webview)?;
    set_frame(&webview, (at.0 + dx, at.1 + dy), (size.0 + dw, size.1 + dh))
}

/// The window changed size: the panel stays inside it.
#[tauri::command]
pub fn voice_subtitles_fit(webview: Webview, app: AppHandle) -> Result<(), String> {
    require_person_window(&webview)?;
    let Some(panel) = app.get_webview(&subtitles_panel_label(webview.window().label())) else {
        return Ok(());
    };
    let (at, size) = logical_frame(&panel)?;
    set_frame(&panel, at, size)
}

/// Writes a kept session to the file the person just picked in the save dialog.
#[tauri::command]
pub fn voice_subtitles_export(webview: Webview, path: String, text: String) -> Result<(), String> {
    require_person_window(&webview)?;
    fs::write(path, text).map_err(|_| "That session couldn't be exported.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_panel_stays_inside_the_window() {
        let panel = (800.0, 360.0);
        let window = (1200.0, 800.0);
        assert_eq!(placed((200.0, 368.0), panel, window), (200.0, 368.0));
        assert_eq!(
            placed((-500.0, -500.0), panel, window),
            (EDGE_GAP, EDGE_GAP)
        );
        assert_eq!(placed((5000.0, 5000.0), panel, window), (384.0, 424.0));
    }

    #[test]
    fn a_small_window_gets_a_smaller_panel_down_to_its_minimum() {
        assert_eq!(sized((WIDTH, HEIGHT), (1200.0, 800.0)), (WIDTH, HEIGHT));
        assert_eq!(sized((WIDTH, HEIGHT), (700.0, 300.0)), (668.0, 268.0));
        assert_eq!(
            sized((WIDTH, HEIGHT), (300.0, 100.0)),
            (MIN_WIDTH, MIN_HEIGHT)
        );
        assert_eq!(
            sized((100.0, 100.0), (1200.0, 800.0)),
            (MIN_WIDTH, MIN_HEIGHT)
        );
    }

    #[test]
    fn only_the_panels_own_labels_count() {
        assert!(is_subtitles_panel("misty-live-subtitles-window-1"));
        assert!(!is_subtitles_panel("misty-live-subtitles"));
        assert!(!is_subtitles_panel("misty-live-subtitles-window-1-spoof"));
        assert!(!is_subtitles_panel("misty-browser-a"));
    }
}
