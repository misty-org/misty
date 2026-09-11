//! Misty-window control on Windows, the counterpart of `MistyAutopilot.m`:
//! the whole Misty window is captured with every webview in it, and each
//! action goes to the webview under the point as trusted DevTools input, so
//! no global input is posted and the person's pointer and keyboard stay
//! theirs. Typing and keys go to the webview Misty last pointed at.
use std::sync::Mutex;

use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Webview};

use super::{
    desktop_overlays_windows::{self as overlays, Frame},
    webview2::{self, MouseButton},
};

/// The longest edge of a window frame the agent sees, as on macOS.
const MAX_EDGE: u32 = 2000;

/// The label of the webview Misty last pointed at.
static TARGET: Mutex<Option<String>> = Mutex::new(None);

fn main_window(app: &AppHandle) -> Result<tauri::Window, String> {
    app.get_window("main")
        .ok_or_else(|| "Misty window closed".into())
}

/// The window's rectangle in physical screen pixels.
fn frame_of(window: &tauri::Window) -> Result<Frame, String> {
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    Ok(Frame {
        x: position.x,
        y: position.y,
        width: size.width as i32,
        height: size.height as i32,
    })
}

/// Why control can't continue while another window is in front.
pub fn focus_reason() -> String {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW};
    let mut title = [0u16; 256];
    // SAFETY: plain queries into a local buffer.
    let length = unsafe {
        GetWindowTextW(
            GetForegroundWindow(),
            title.as_mut_ptr(),
            title.len() as i32,
        )
    };
    let name = String::from_utf16_lossy(&title[..length.max(0) as usize]);
    let name = if name.trim().is_empty() {
        "another window".to_owned()
    } else {
        name
    };
    format!("Misty lost focus to {name}. Bring Misty to the front, then resume.")
}

/// One capture of the display under control, or of the Misty window, off
/// the UI thread.
pub async fn native_capture(app: &AppHandle, desktop: bool, task: String) -> Result<Value, String> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if desktop {
            super::desktop_control_windows::capture(&task)
        } else {
            capture(&app)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Performs an action on the desktop under control, or in the Misty window.
pub async fn perform(app: &AppHandle, desktop: bool, input: Value) -> Result<Value, String> {
    if !desktop {
        return action(app, &input).await;
    }
    tauri::async_runtime::spawn_blocking(move || super::desktop_control_windows::action(&input))
        .await
        .map_err(|e| e.to_string())?
}

/// Captures the whole Misty window. Called on a worker thread.
pub fn capture(app: &AppHandle) -> Result<Value, String> {
    let window = main_window(app)?;
    if !window.is_focused().unwrap_or(false)
        || !window.is_visible().unwrap_or(false)
        || window.is_minimized().unwrap_or(true)
    {
        return Err("Bring Misty to the front before starting control.".into());
    }
    let frame = frame_of(&window)?;
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    let target = xcap::Window::all()
        .map_err(|_| "Misty window is unavailable".to_owned())?
        .into_iter()
        .find(|candidate| candidate.id().is_ok_and(|id| id as isize == hwnd))
        .ok_or("Misty window is unavailable")?;
    let image = target
        .capture_image()
        .map_err(|_| "Window capture failed".to_owned())?;
    let image = image::DynamicImage::ImageRgba8(image);
    let scale = (2.0f64).min(f64::from(MAX_EDGE) / f64::from(image.width().max(image.height())));
    let image = if (scale - 1.0).abs() > f64::EPSILON {
        let (width, height) = (
            ((f64::from(image.width()) * scale) as u32).max(1),
            ((f64::from(image.height()) * scale) as u32).max(1),
        );
        image.resize_exact(width, height, image::imageops::FilterType::Triangle)
    } else {
        image
    };
    let mut jpeg = std::io::Cursor::new(Vec::new());
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 85)
        .encode_image(&image.to_rgb8())
        .map_err(|_| "Window capture failed".to_owned())?;
    // The window is ringed while Misty controls it, as on macOS.
    let _ = overlays::show_mist(app, frame, false);
    Ok(json!({
        "image": {
            "dataUrl": format!("data:image/jpeg;base64,{}", STANDARD.encode(jpeg.into_inner())),
            "width": image.width(),
            "height": image.height(),
        },
        "windowNumber": hwnd,
        "frame": [frame.x, frame.y, frame.width, frame.height],
    }))
}

/// The Misty webview under a point in physical screen pixels, and the point
/// in its CSS pixels.
fn webview_at(app: &AppHandle, x: f64, y: f64) -> Option<(Webview, f64, f64)> {
    let window = main_window(app).ok()?;
    let origin = window.inner_position().ok()?;
    let scale = window.scale_factor().ok()?;
    let (local_x, local_y) = (x - f64::from(origin.x), y - f64::from(origin.y));
    // Page webviews sit above the main one; the topmost containing the point wins.
    let mut candidates: Vec<Webview> = window.webviews();
    candidates.sort_by_key(|view| view.label() == "main");
    candidates.into_iter().find_map(|view| {
        let position = view.position().ok()?;
        let size = view.size().ok()?;
        let (left, top) = (f64::from(position.x), f64::from(position.y));
        let inside = local_x >= left
            && local_y >= top
            && local_x < left + f64::from(size.width)
            && local_y < top + f64::from(size.height);
        inside.then(|| (view, (local_x - left) / scale, (local_y - top) / scale))
    })
}

fn target_view(app: &AppHandle) -> Option<Webview> {
    let label = TARGET.lock().ok()?.clone().unwrap_or_else(|| "main".into());
    app.get_webview(&label).or_else(|| app.get_webview("main"))
}

/// Performs one validated action in the Misty window.
pub async fn action(app: &AppHandle, input: &Value) -> Result<Value, String> {
    let window = main_window(app)?;
    if !window.is_focused().unwrap_or(false) || window.is_minimized().unwrap_or(true) {
        return Err("Misty must be the active window. Resume when you are ready.".into());
    }
    let frame = frame_of(&window)?;
    let expected: Vec<i64> = input["frame"]
        .as_array()
        .map(|values| values.iter().filter_map(Value::as_i64).collect())
        .unwrap_or_default();
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as i64;
    if input["windowNumber"].as_i64() != Some(hwnd)
        || expected
            != [
                i64::from(frame.x),
                i64::from(frame.y),
                i64::from(frame.width),
                i64::from(frame.height),
            ]
    {
        return Err("browser_snapshot_stale: the window moved or resized; inspect again".into());
    }
    let action = &input["action"];
    let failed = |_| "Misty's window didn't take the action.".to_owned();
    match action["kind"].as_str().unwrap_or("") {
        kind @ ("point" | "scroll") => {
            let fraction = |key: &str| action[key].as_f64().unwrap_or(0.0).clamp(0.0, 1.0);
            let (x, y) = (
                f64::from(frame.x) + fraction("x") * f64::from(frame.width),
                f64::from(frame.y) + fraction("y") * f64::from(frame.height),
            );
            let (view, local_x, local_y) =
                webview_at(app, x, y).ok_or("Only the Misty workspace can be controlled")?;
            overlays::point(app, x, y);
            if let Ok(mut target) = TARGET.lock() {
                *target = Some(view.label().to_owned());
            }
            if kind == "point" {
                webview2::click(&view, local_x, local_y, MouseButton::Left, 1)
                    .await
                    .map_err(failed)?;
            } else {
                webview2::cdp(
                    &view,
                    "Input.dispatchMouseEvent",
                    &json!({
                        "type": "mouseWheel", "x": local_x, "y": local_y,
                        "deltaX": action["deltaX"].as_i64().unwrap_or(0),
                        "deltaY": action["deltaY"].as_i64().unwrap_or(0),
                    }),
                )
                .await
                .map_err(failed)?;
            }
        }
        "type" => {
            let text = action["text"].as_str().unwrap_or("");
            let view = target_view(app).ok_or("Click an editable field before typing")?;
            webview2::cdp(&view, "Input.insertText", &json!({ "text": text }))
                .await
                .map_err(failed)?;
        }
        "key" => {
            let view = target_view(app).ok_or("Click into Misty before pressing keys")?;
            press_key(&view, action["key"].as_str().unwrap_or("")).await?;
        }
        _ => return Err("Unsupported workspace action".into()),
    }
    Ok(json!({ "attempted": true, "verified": false }))
}

async fn press_key(view: &Webview, key: &str) -> Result<(), String> {
    // (DOM key, Windows virtual key code, with Ctrl).
    let (name, code, control) = match key {
        "Enter" => ("Enter", 13, false),
        "Escape" => ("Escape", 27, false),
        "Tab" => ("Tab", 9, false),
        "Backspace" => ("Backspace", 8, false),
        "ArrowLeft" => ("ArrowLeft", 37, false),
        "ArrowRight" => ("ArrowRight", 39, false),
        "ArrowUp" => ("ArrowUp", 38, false),
        "ArrowDown" => ("ArrowDown", 40, false),
        "SelectAll" => ("a", 65, true),
        "Undo" => ("z", 90, true),
        "AddressBar" => ("l", 76, true),
        "NewTab" => ("t", 84, true),
        "Find" => ("f", 70, true),
        _ => return Err("Unsupported workspace key".into()),
    };
    let text = match name {
        "Enter" => "\r",
        "Tab" => "\t",
        _ => "",
    };
    for kind in ["keyDown", "keyUp"] {
        let mut event = json!({
            "type": if kind == "keyDown" && !text.is_empty() && !control { "keyDown" } else if kind == "keyDown" { "rawKeyDown" } else { "keyUp" },
            "key": name,
            "windowsVirtualKeyCode": code,
            "modifiers": if control { 2 } else { 0 },
        });
        if kind == "keyDown" && !text.is_empty() && !control {
            event["text"] = json!(text);
        }
        webview2::cdp(view, "Input.dispatchKeyEvent", &event)
            .await
            .map_err(|_| "Misty's window didn't take the key.".to_owned())?;
    }
    Ok(())
}

/// Control of the Misty window ended or paused: its ring and pointer go.
pub fn release(app: &AppHandle) {
    overlays::hide_pointer(app);
    overlays::hide_mist(app);
    if let Ok(mut target) = TARGET.lock() {
        *target = None;
    }
}
