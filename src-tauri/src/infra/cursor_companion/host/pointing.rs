//! Precise pointing for the cursor companion: the real control near a model's
//! point (macOS Accessibility), a full-resolution crop around it for the model
//! to place again, and the clicks a walkthrough step waits for.
mod region;
mod snap;
pub use region::capture_region;
pub use snap::snap_point;

use super::{current, displays, host_state, require_main};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Webview};

/// Sends a click to the main window while a walkthrough step waits for one.
pub(super) fn forward_click(app: &AppHandle, state: &super::CursorCompanionState, x: f64, y: f64) {
    let turn = state.click_turn.load(Ordering::SeqCst);
    if state.watch_clicks.load(Ordering::SeqCst) && current(state, turn) {
        let _ = crate::infra::space_windows::emit_to_primary(
            &app,
            "misty://cursor-click",
            json!({"turn":turn,"x":x,"y":y}),
        );
    }
}
/// Starts or stops forwarding the person's clicks for a walkthrough step.
#[tauri::command]
pub fn cursor_companion_watch_clicks(
    webview: Webview,
    app: AppHandle,
    turn: u64,
    watching: bool,
) -> Result<(), String> {
    require_main(&webview)?;
    let state = host_state(&app);
    if watching && !current(&state, turn) {
        return Err("Companion interrupted".into());
    }
    state.click_turn.store(turn, Ordering::SeqCst);
    state.watch_clicks.store(watching, Ordering::SeqCst);
    Ok(())
}
/// The real control at or near a pointed-at spot, or null.
#[tauri::command]
pub async fn cursor_companion_snap(
    webview: Webview,
    x: f64,
    y: f64,
    label: String,
) -> Result<Value, String> {
    require_main(&webview)?;
    if !x.is_finite() || !y.is_finite() || label.chars().count() > 200 {
        return Err("Invalid point".into());
    }
    let element = tauri::async_runtime::spawn_blocking(move || snap_point(x, y, &label))
        .await
        .map_err(|e| e.to_string())??;
    Ok(element.unwrap_or(Value::Null))
}
/// A full-resolution crop of one display centered on a global point, so the
/// model can place a pointer it could only estimate from the downscaled view.
#[tauri::command]
pub async fn cursor_companion_capture_region(
    webview: Webview,
    app: AppHandle,
    turn: u64,
    display_id: u32,
    x: f64,
    y: f64,
    size: f64,
) -> Result<Value, String> {
    require_main(&webview)?;
    let state = host_state(&app);
    if !current(&state, turn) {
        return Err("Companion interrupted".into());
    }
    if !x.is_finite() || !y.is_finite() || !size.is_finite() || !(64.0..=1200.0).contains(&size) {
        return Err("Invalid region".into());
    }
    let frame = displays()?
        .into_iter()
        .find(|d| d.id == display_id)
        .ok_or("Display disconnected")?;
    tauri::async_runtime::spawn_blocking(move || {
        super::platform::screen_access()?;
        let monitor = xcap::Monitor::all()
            .map_err(|e| e.to_string())?
            .into_iter()
            .find(|m| m.id().ok() == Some(display_id))
            .ok_or("Display disconnected")?;
        let region = (x - frame.x - size / 2., y - frame.y - size / 2., size, size);
        let crop = capture_region(&monitor, region, 768.)?;
        if !current(&state, turn) {
            return Err("Companion interrupted".into());
        }
        Ok(json!({
            "mimeType": "image/jpeg",
            "dataUrl": format!("data:image/jpeg;base64,{}", STANDARD.encode(&crop.bytes)),
            "width": crop.width,
            "height": crop.height,
            "region": {"x": crop.x + frame.x, "y": crop.y + frame.y, "width": crop.region_width, "height": crop.region_height},
            "displayId": display_id,
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// A crop of one display around a companion point. `x`, `y`, `region_width`
/// and `region_height` place it in display-local units (points on macOS,
/// physical pixels on Windows); `width` and `height` are its pixels.
pub struct RegionCapture {
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub x: f64,
    pub y: f64,
    pub region_width: f64,
    pub region_height: f64,
}

#[cfg(target_os = "macos")]
fn native_json(raw: *mut std::ffi::c_char) -> Result<serde_json::Value, String> {
    if raw.is_null() {
        return Err("The native companion returned nothing".into());
    }
    let decoded = unsafe {
        serde_json::from_slice::<serde_json::Value>(std::ffi::CStr::from_ptr(raw).to_bytes())
    };
    unsafe {
        libc::free(raw.cast());
    }
    decoded.map_err(|e| e.to_string())
}
