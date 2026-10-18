//! The dictation pill: a small monochrome window under the cursor that shows
//! live words. It never takes focus, so typing continues in the app below.
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const LABEL: &str = "misty-dictation-pill";
const WIDTH: f64 = 420.0;
const HEIGHT: f64 = 56.0;
/// Below and right of the pointer, clear of the I-beam.
const OFFSET: (f64, f64) = (14.0, 22.0);

fn window(app: &AppHandle) -> Option<WebviewWindow> {
    if let Some(window) = app.get_webview_window(LABEL) {
        return Some(window);
    }
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("desktop.html".into()))
        .title("Misty dictation")
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .visible(false)
        .focused(false)
        .focusable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .inner_size(WIDTH, HEIGHT)
        .build()
        .ok()
}

#[cfg(target_os = "macos")]
fn place(window: &WebviewWindow) {
    use core_graphics::{event::CGEvent, event_source::{CGEventSource, CGEventSourceStateID}};
    let Some(point) = CGEventSource::new(CGEventSourceStateID::CombinedSessionState)
        .ok()
        .and_then(|source| CGEvent::new(source).ok())
        .map(|event| event.location())
    else {
        return;
    };
    let _ = window.set_position(tauri::LogicalPosition::new(point.x + OFFSET.0, point.y + OFFSET.1));
}

#[cfg(windows)]
fn place(window: &WebviewWindow) {
    use windows_sys::Win32::{Foundation::POINT, UI::WindowsAndMessaging::GetCursorPos};
    let mut point = POINT { x: 0, y: 0 };
    if unsafe { GetCursorPos(&mut point) } == 0 {
        return;
    }
    let scale = window.scale_factor().unwrap_or(1.0);
    let _ = window.set_position(tauri::PhysicalPosition::new(
        point.x + (OFFSET.0 * scale) as i32,
        point.y + (OFFSET.1 * scale) as i32,
    ));
}

/// Shows the pill at the pointer without activating Misty.
pub fn show(app: &AppHandle) {
    let handle = app.clone();
    // Built off the UI thread like the companion overlays (WebView2 deadlocks
    // otherwise); shown on it.
    std::thread::spawn(move || {
        let Some(pill) = window(&handle) else { return };
        place(&pill);
        let _ = handle.run_on_main_thread(move || crate::infra::cursor_companion::show_overlay(&pill));
    });
}

pub fn hide(app: &AppHandle) {
    if let Some(pill) = app.get_webview_window(LABEL) {
        let _ = pill.hide();
    }
}
