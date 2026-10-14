//! Precise pointing for the cursor companion: the real control near a model's
//! point (macOS Accessibility), a full-resolution crop around it for the model
//! to place again, and the clicks a walkthrough step waits for.
use super::{current, displays, host_state, require_main};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Webview};

/// Sends a click to the main window while a walkthrough step waits for one.
pub(super) fn forward_click(app: &AppHandle, state: &super::CursorCompanionState, x: f64, y: f64) {
    let turn = state.click_turn.load(Ordering::SeqCst);
    if state.watch_clicks.load(Ordering::SeqCst) && current(state, turn) {
        let _ = app.emit_to(
            "main",
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

/// The actionable control at or near a global point, preferring one whose text
/// matches the label. None when Accessibility is not allowed or nothing fits.
#[cfg(target_os = "macos")]
pub fn snap_point(x: f64, y: f64, label: &str) -> Result<Option<serde_json::Value>, String> {
    unsafe extern "C" {
        fn misty_companion_snap_point(
            x: f64,
            y: f64,
            label: *const std::ffi::c_char,
        ) -> *mut std::ffi::c_char;
    }
    let label = std::ffi::CString::new(label.replace('\0', "")).map_err(|e| e.to_string())?;
    let value = native_json(unsafe { misty_companion_snap_point(x, y, label.as_ptr()) })?;
    if value["error"].is_string() {
        // Without Accessibility the raw point stands; it is never an error.
        return Ok(None);
    }
    Ok(value.get("element").cloned())
}

/// The actionable control at or near a global point (physical pixels),
/// preferring one whose text matches the label, through UI Automation. Only
/// reads; nothing is pressed or focused. None when nothing fits.
#[cfg(windows)]
pub fn snap_point(x: f64, y: f64, label: &str) -> Result<Option<serde_json::Value>, String> {
    use crate::platform::windows::automation::{is_target_role, Automation, Element};
    let Ok(automation) = Automation::new() else {
        // Without UI Automation the raw point stands; it is never an error.
        return Ok(None);
    };
    let words = label_words(label);
    let mut offsets = vec![(0.0, 0.0)];
    for radius in [14.0, 32.0] {
        for step in 0..8 {
            let angle = f64::from(step) * std::f64::consts::FRAC_PI_4;
            offsets.push((angle.cos() * radius, angle.sin() * radius));
        }
    }
    let mut seen: Vec<Element> = Vec::new();
    let mut best: Option<(f64, f64, serde_json::Value)> = None;
    for (dx, dy) in offsets {
        let Some(mut current) =
            automation.element_at((x + dx).round() as i32, (y + dy).round() as i32)
        else {
            continue;
        };
        for _ in 0..5 {
            let role = current.role();
            if role == "Window" {
                break;
            }
            let bounds = current.bounds().filter(|frame| {
                frame.width >= 4.0
                    && frame.height >= 4.0
                    && frame.width <= 480.0
                    && frame.height <= 240.0
            });
            if let Some(frame) = bounds.filter(|_| is_target_role(role) || current.pressable()) {
                // Neighboring samples often land on the same control; score it once.
                if seen.iter().any(|other| other.same_as(&current)) {
                    break;
                }
                let description = current.description().to_lowercase();
                let matched = words
                    .iter()
                    .filter(|word| description.contains(word.as_str()))
                    .count();
                let score = if words.is_empty() {
                    0.0
                } else {
                    matched as f64 / words.len() as f64
                };
                let (center_x, center_y) = frame.center();
                let distance = (center_x - x).hypot(center_y - y);
                // A named match anywhere nearby wins; otherwise only the
                // control under the point itself is trusted.
                let acceptable = score >= 0.5 || frame.contains(x, y);
                let better = best.as_ref().is_none_or(|(best_score, best_distance, _)| {
                    score > *best_score || (score == *best_score && distance < *best_distance)
                });
                if acceptable && better {
                    best = Some((
                        score,
                        distance,
                        serde_json::json!({
                            "x": center_x, "y": center_y,
                            "frame": {"x": frame.x, "y": frame.y, "width": frame.width, "height": frame.height},
                            "role": role, "title": current.name(), "matched": score >= 0.5,
                        }),
                    ));
                }
                seen.push(current);
                break;
            }
            match automation.parent(&current) {
                Some(parent) => current = parent,
                None => break,
            }
        }
    }
    Ok(best.map(|(_, _, element)| element))
}

/// Words of the model's label that name the control, without the instruction.
#[cfg(windows)]
fn label_words(label: &str) -> Vec<String> {
    const SKIP: &[&str] = &[
        "click", "open", "press", "choose", "select", "tap", "the", "a", "an", "on", "to", "in",
        "go", "use", "pick", "this", "that", "here", "type", "into", "enter", "button", "menu",
        "field", "icon", "tab", "your", "of",
    ];
    label
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| word.chars().count() > 1 && !SKIP.contains(word))
        .map(str::to_owned)
        .collect()
}

#[cfg(target_os = "macos")]
pub fn capture_region(
    monitor: &xcap::Monitor,
    region: (f64, f64, f64, f64),
    max_side: f64,
) -> Result<RegionCapture, String> {
    use base64::Engine;
    unsafe extern "C" {
        fn misty_companion_capture_region(
            display_id: u32,
            x: f64,
            y: f64,
            width: f64,
            height: f64,
            max_side: f64,
        ) -> *mut std::ffi::c_char;
    }
    let id = monitor.id().map_err(|e| e.to_string())?;
    let value = native_json(unsafe {
        misty_companion_capture_region(id, region.0, region.1, region.2, region.3, max_side)
    })?;
    if value["legacy_capture"].as_bool() == Some(true) {
        return capture_legacy_region(monitor, region, max_side);
    }
    if let Some(error) = value["error"].as_str() {
        return Err(error.into());
    }
    let number = |key: &str| value[key].as_f64().ok_or(format!("Invalid region {key}"));
    Ok(RegionCapture {
        bytes: base64::engine::general_purpose::STANDARD
            .decode(
                value["jpeg"]
                    .as_str()
                    .ok_or("Region capture returned no image")?,
            )
            .map_err(|e| e.to_string())?,
        width: number("width")? as u32,
        height: number("height")? as u32,
        x: number("x")?,
        y: number("y")?,
        region_width: number("regionWidth")?,
        region_height: number("regionHeight")?,
    })
}

#[cfg(windows)]
pub fn capture_region(
    monitor: &xcap::Monitor,
    region: (f64, f64, f64, f64),
    max_side: f64,
) -> Result<RegionCapture, String> {
    capture_legacy_region(monitor, region, max_side)
}

/// Crops a full display capture. The display's units map to its pixels by the
/// capture's own width, which also covers Retina displays on macOS 12–13.
fn capture_legacy_region(
    monitor: &xcap::Monitor,
    region: (f64, f64, f64, f64),
    max_side: f64,
) -> Result<RegionCapture, String> {
    let display_width = monitor.width().map_err(|e| e.to_string())? as f64;
    let display_height = monitor.height().map_err(|e| e.to_string())? as f64;
    let image =
        image::DynamicImage::ImageRgba8(monitor.capture_image().map_err(|e| e.to_string())?);
    let (left, top) = (region.0.max(0.), region.1.max(0.));
    let (right, bottom) = (
        (region.0 + region.2).min(display_width),
        (region.1 + region.3).min(display_height),
    );
    if right <= left || bottom <= top {
        return Err("The region is outside the display.".into());
    }
    let factor = image.width() as f64 / display_width.max(1.);
    let crop = image.crop_imm(
        (left * factor) as u32,
        (top * factor) as u32,
        (((right - left) * factor) as u32).max(1),
        (((bottom - top) * factor) as u32).max(1),
    );
    let longest = crop.width().max(crop.height()) as f64;
    let crop = if longest > max_side {
        let scale = max_side / longest;
        crop.resize_exact(
            ((crop.width() as f64 * scale) as u32).max(1),
            ((crop.height() as f64 * scale) as u32).max(1),
            image::imageops::FilterType::Lanczos3,
        )
    } else {
        crop
    }
    .to_rgb8();
    let mut bytes = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 85)
        .encode_image(&crop)
        .map_err(|e| e.to_string())?;
    Ok(RegionCapture {
        bytes,
        width: crop.width(),
        height: crop.height(),
        x: left,
        y: top,
        region_width: right - left,
        region_height: bottom - top,
    })
}

#[cfg(all(test, windows))]
mod snap_tests {
    #[test]
    fn labels_keep_only_the_words_that_name_a_control() {
        assert_eq!(
            super::label_words("Click the Save As button"),
            vec!["save", "as"]
        );
        assert!(super::label_words("tap here").is_empty());
    }
}
