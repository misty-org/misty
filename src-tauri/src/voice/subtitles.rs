//! The live subtitles panel: a floating window above every app, fullscreen ones included. It
//! doesn't take focus when it appears, but can be clicked and typed in, and it only draws what the
//! window that opened it sends. Docs: docs/voice-memory/README.md.
use tauri::{
    AppHandle, Manager, PhysicalPosition, Webview, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

const LABEL: &str = "misty-live-subtitles";
const WIDTH: f64 = 800.0;
const HEIGHT: f64 = 360.0;
const MIN_WIDTH: f64 = 560.0;
const MIN_HEIGHT: f64 = 300.0;
/// Above the bottom of the screen, clear of the Dock, the taskbar and a player's controls.
const BOTTOM_GAP: f64 = 96.0;

fn require_person_window(webview: &Webview) -> Result<(), String> {
    crate::infra::profile_windows::is_person_window(webview.label())
        .then_some(())
        .ok_or_else(|| "Live subtitles aren't available in this window.".into())
}

fn build(app: &AppHandle) -> Option<WebviewWindow> {
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("desktop.html".into()))
        .title("Misty subtitles")
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .resizable(true)
        .visible(false)
        .focused(false)
        .always_on_top(true)
        .skip_taskbar(true)
        // The first click on the panel should count, not just bring it forward.
        .accept_first_mouse(true)
        .inner_size(WIDTH, HEIGHT)
        .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
        .build()
        .ok()
}

/// Low in the middle of the screen holding the window that asked.
fn bottom_center(app: &AppHandle, label: &str) -> Option<PhysicalPosition<i32>> {
    let monitor = app.get_window(label)?.current_monitor().ok()??;
    let scale = monitor.scale_factor();
    let (origin, size) = (monitor.position(), monitor.size());
    Some(PhysicalPosition::new(
        origin.x + ((f64::from(size.width) - WIDTH * scale) / 2.0) as i32,
        origin.y + (f64::from(size.height) - (HEIGHT + BOTTOM_GAP) * scale) as i32,
    ))
}

/// Windows is handled by `show_overlay`; macOS has to be told about Spaces and fullscreen apps.
#[cfg(target_os = "macos")]
fn above_fullscreen(window: &WebviewWindow) {
    use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};
    const STATUS_WINDOW_LEVEL: isize = 25;
    let Ok(native) = window.ns_window() else {
        return;
    };
    // SAFETY: a live window on the main thread, as `run_on_main_thread` guarantees.
    unsafe {
        let native = &*(native as *mut NSWindow);
        native.setLevel(STATUS_WINDOW_LEVEL);
        native.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::FullScreenAuxiliary,
        );
        native.setHidesOnDeactivate(false);
    }
}

#[cfg(not(target_os = "macos"))]
fn above_fullscreen(_window: &WebviewWindow) {}

/// Shows the panel where it was left, or low in the middle of the screen the first time.
#[tauri::command]
pub fn voice_subtitles_show(webview: Webview, app: AppHandle) -> Result<(), String> {
    require_person_window(&webview)?;
    let position = bottom_center(&app, webview.label());
    // Built off the UI thread like the other overlays (WebView2 deadlocks otherwise); shown on it.
    std::thread::spawn(move || {
        let fresh = app.get_webview_window(LABEL).is_none();
        let Some(window) = app.get_webview_window(LABEL).or_else(|| build(&app)) else {
            return;
        };
        if let (true, Some(position)) = (fresh, position) {
            let _ = window.set_position(position);
        }
        let _ = app.run_on_main_thread(move || {
            above_fullscreen(&window);
            crate::infra::cursor_companion::show_overlay(&window);
        });
    });
    Ok(())
}

#[tauri::command]
pub fn voice_subtitles_hide(app: AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.hide();
    }
}

/// The microphone's name and the apps playing sound, for the panel's Source control.
#[tauri::command]
pub fn voice_capture_sources(webview: Webview) -> Result<serde_json::Value, String> {
    require_person_window(&webview)?;
    let sources = misty_audio_capture::capture_sources().map_err(|error| error.to_string())?;
    serde_json::to_value(sources).map_err(|error| error.to_string())
}

/// Writes a kept session to the file the person just picked in the save dialog.
#[tauri::command]
pub fn voice_subtitles_export(webview: Webview, path: String, text: String) -> Result<(), String> {
    require_person_window(&webview)?;
    std::fs::write(path, text).map_err(|_| "That session couldn't be exported.".into())
}
