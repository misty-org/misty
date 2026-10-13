//! The windows Misty shows while it controls the desktop or its own window
//! on Windows: the control island, and the mist that rings what Misty
//! controls and carries Misty's own pointer
//! (docs/design/agents-at-cursor/BRIEF.md). Both render `desktop.html`, are
//! kept out of screen captures, and never take focus by being shown. The
//! mist ignores the mouse; the island takes it only when the person clicks.
use std::sync::Mutex;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const ISLAND: &str = "misty-desktop-island";
pub const MIST: &str = "misty-desktop-mist";
const ISLAND_WIDTH: f64 = 560.0;
const ISLAND_HEIGHT: f64 = 124.0;

/// A rectangle in physical screen pixels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Frame {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// What the island shows and which presses it offers.
#[derive(Clone, Debug, Default)]
pub struct Island {
    pub status: String,
    pub meta: String,
    pub waiting: String,
}

static ISLAND_STATE: Mutex<Option<(Island, bool)>> = Mutex::new(None);

fn window(app: &AppHandle, label: &str, focusable: bool) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(label) {
        return Ok(window);
    }
    let window = WebviewWindowBuilder::new(app, label, WebviewUrl::App("desktop.html".into()))
        .title(if label == ISLAND {
            "Misty desktop control"
        } else {
            "Misty control ring"
        })
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focusable(focusable)
        .focused(false)
        .visible(false)
        .build()
        .map_err(|error| error.to_string())?;
    if let Ok(hwnd) = window.hwnd() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetWindowLongPtrW, SetWindowDisplayAffinity, SetWindowLongPtrW, GWL_EXSTYLE,
            WDA_EXCLUDEFROMCAPTURE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
        };
        let hwnd = hwnd.0 as _;
        // SAFETY: a live window this process created; only its styles change.
        unsafe {
            let mut style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE)
                | WS_EX_NOACTIVATE as isize
                | WS_EX_TOOLWINDOW as isize;
            if !focusable {
                style |= WS_EX_TRANSPARENT as isize;
            }
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style);
            // Misty's own controls never show in a capture, the agent's
            // included, so the agent can't act on them.
            SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
        }
    }
    if !focusable {
        let _ = window.set_ignore_cursor_events(true);
    }
    Ok(window)
}

fn place(window: &WebviewWindow, frame: Frame) {
    let _ = window.set_position(tauri::PhysicalPosition::new(frame.x, frame.y));
    let _ = window.set_size(tauri::PhysicalSize::new(
        frame.width.max(1) as u32,
        frame.height.max(1) as u32,
    ));
    super::cursor_companion::show_overlay(window);
}

/// The work area (the display minus the taskbar) of the display holding `frame`.
fn work_area(frame: Frame) -> Frame {
    use windows_sys::Win32::{
        Foundation::POINT,
        Graphics::Gdi::{GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST},
    };
    let center = POINT {
        x: frame.x + frame.width / 2,
        y: frame.y + frame.height / 2,
    };
    // SAFETY: plain queries with a zeroed, sized output structure.
    unsafe {
        let monitor = MonitorFromPoint(center, MONITOR_DEFAULTTONEAREST);
        let mut info: MONITORINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoW(monitor, &mut info) == 0 {
            return frame;
        }
        let area = info.rcWork;
        Frame {
            x: area.left,
            y: area.top,
            width: area.right - area.left,
            height: area.bottom - area.top,
        }
    }
}

/// Rings `frame` (a display, or Misty's window). `waiting` thins the mist
/// while the task waits for the person.
pub fn show_mist(app: &AppHandle, frame: Frame, waiting: bool) -> Result<(), String> {
    let mist = window(app, MIST, false)?;
    place(&mist, frame);
    set_mist_waiting(app, waiting);
    Ok(())
}

pub fn set_mist_waiting(app: &AppHandle, waiting: bool) {
    MIST_WAITING.store(waiting, std::sync::atomic::Ordering::Release);
    let _ = app.emit_to(MIST, "misty://desktop-mist", mist_payload());
}

static MIST_WAITING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn mist_payload() -> Value {
    json!({ "waiting": MIST_WAITING.load(std::sync::atomic::Ordering::Acquire) })
}

/// Moves Misty's own pointer to a point in physical screen pixels inside the
/// mist, and pulses there when it acts.
pub fn point(app: &AppHandle, x: f64, y: f64) {
    let Some(mist) = app.get_webview_window(MIST) else {
        return;
    };
    let (Ok(origin), Ok(scale)) = (mist.outer_position(), mist.scale_factor()) else {
        return;
    };
    let _ = mist.emit_to(
        MIST,
        "misty://desktop-pointer",
        json!({
            "x": (x - f64::from(origin.x)) / scale,
            "y": (y - f64::from(origin.y)) / scale,
        }),
    );
}

pub fn hide_pointer(app: &AppHandle) {
    let _ = app.emit_to(MIST, "misty://desktop-pointer", Value::Null);
}

/// Shows the island at the bottom of the display holding `frame`, above the
/// taskbar.
pub fn show_island(app: &AppHandle, frame: Frame) -> Result<(), String> {
    let island = window(app, ISLAND, true)?;
    let scale = island.scale_factor().unwrap_or(1.0);
    let (width, height) = (
        (ISLAND_WIDTH * scale).round() as i32,
        (ISLAND_HEIGHT * scale).round() as i32,
    );
    let area = work_area(frame);
    place(
        &island,
        Frame {
            x: area.x + (area.width - width) / 2,
            y: area.y + area.height - height - (24.0 * scale).round() as i32,
            width,
            height,
        },
    );
    publish_island(app);
    Ok(())
}

/// What the island says. `waiting` switches it to Done.
pub fn set_island(app: &AppHandle, island: Island, waiting: bool) {
    if let Ok(mut state) = ISLAND_STATE.lock() {
        *state = Some((island, waiting));
    }
    publish_island(app);
}

fn publish_island(app: &AppHandle) {
    let _ = app.emit_to(ISLAND, "misty://desktop-island", island_payload());
}

fn island_payload() -> Value {
    let (island, waiting) = ISLAND_STATE
        .lock()
        .ok()
        .and_then(|state| state.clone())
        .unwrap_or_default();
    let status = if waiting {
        non_empty(
            &island.waiting,
            "Misty is waiting for you. Press Done when you're finished.",
        )
    } else {
        non_empty(&island.status, "Misty is working with its own cursor")
    };
    json!({ "status": status, "meta": if waiting { "" } else { island.meta.as_str() }, "waiting": waiting })
}

/// What a desktop overlay shows now, for a page that just loaded and missed
/// the updates sent before it listened.
#[tauri::command]
pub fn agent_desktop_overlay_state(webview: tauri::Webview) -> Result<Value, String> {
    match webview.label() {
        ISLAND => Ok(island_payload()),
        MIST => Ok(mist_payload()),
        _ => Err("Only Misty's desktop overlays read this.".into()),
    }
}

fn non_empty<'a>(text: &'a str, fallback: &'a str) -> &'a str {
    if text.trim().is_empty() {
        fallback
    } else {
        text
    }
}

/// Hides the island and the mist.
pub fn hide_all(app: &AppHandle) {
    for label in [ISLAND, MIST] {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.hide();
        }
    }
    if let Ok(mut state) = ISLAND_STATE.lock() {
        *state = None;
    }
}

pub fn hide_mist(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MIST) {
        let _ = window.hide();
    }
}

/// A press on the island: Stop ends control here; the rest go to Misty's
/// island, which performs them for the task that holds control.
#[tauri::command]
pub fn agent_desktop_island_press(
    webview: tauri::Webview,
    action: String,
    text: Option<String>,
) -> Result<(), String> {
    if webview.label() != ISLAND {
        return Err("Only the desktop control island can press here.".into());
    }
    let text = text.unwrap_or_default();
    if text.chars().count() > 4000 {
        return Err("That message is too long.".into());
    }
    match action.as_str() {
        "stop" => {
            super::desktop_control_windows::stop_by_person(
                "Desktop control stopped. You have control.",
            );
            Ok(())
        }
        "send" | "queue" | "takeover" | "done" => {
            super::desktop_control_windows::island_press(&action, text.trim());
            Ok(())
        }
        _ => Err("Unknown island action.".into()),
    }
}
