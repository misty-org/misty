mod region;
mod snap;
pub use region::capture_region;

use permissions::{self, Permission};
pub use snap::snap_point;

use super::{current, displays, host_state, require_main};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Webview};

pub(super) fn forward_click(app: &AppHandle, state: &super::CursorCompanionState, x: f64, y: f64) {
    let turn = state.click_turn.load(Ordering::SeqCst);
    if state.watch_clicks.load(Ordering::SeqCst) && current(state, turn) {
        crate::browser::app_windows::emit_to_primary(
            app,
            "misty://cursor-click",
            json!({"turn":turn,"x":x,"y":y}),
        );
    }
}
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
#[tauri::command]
pub fn cursor_companion_trail(
    webview: Webview,
    app: AppHandle,
    turn: u64,
) -> Result<Vec<[f64; 2]>, String> {
    require_main(&webview)?;
    let state = host_state(&app);
    if !current(&state, turn) {
        return Ok(Vec::new());
    }
    let trail = state.trail.lock().unwrap();
    Ok(trail.iter().map(|&(x, y)| [x, y]).collect())
}
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
    if !permissions::ensure_async(&app, Permission::ScreenCapture).await {
        return Err(super::capture::SCREEN_CAPTURE_OFF.into());
    }
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

pub struct RegionCapture {
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub x: f64,
    pub y: f64,
    pub region_width: f64,
    pub region_height: f64,
}
