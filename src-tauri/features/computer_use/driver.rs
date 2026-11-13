// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//! The screenshot and input driver behind the computer tools (tools.rs): display enumeration and
//! capture (xcap), mouse and keyboard input (enigo; the RemoteDesktop portal on a Wayland
//! session, portal.rs), and where each action lands for the virtual cursor (overlay.rs).
//!
//! Fail-closed: every screenshot needs Screen Recording, every input action needs Accessibility,
//! and a missing grant returns an error that tells the engine to send the person to System
//! Settings. Every call reaches here only after the run's gate (`tool_policy.rs`) let it through.

use std::io::Cursor;
use std::time::Duration;

use enigo::{Axis, Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings};
use serde::Serialize;
use xcap::Monitor;

#[path = "driver_keys.rs"]
mod keys;

pub(crate) use keys::parse_key_chord;

// ==================== OS permission preflight ====================

pub(crate) fn accessibility_granted() -> bool {
    #[cfg(target_os = "macos")]
    {
        crate::agents::cursor::macos::accessibility::trusted()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

pub(crate) fn screen_recording_granted() -> bool {
    #[cfg(target_os = "macos")]
    {
        objc2_core_graphics::CGPreflightScreenCaptureAccess()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

pub(crate) fn require_accessibility() -> Result<(), String> {
    if accessibility_granted() {
        Ok(())
    } else {
        Err("Misty doesn't have Accessibility. Tell the person to allow Misty in System Settings → Privacy & Security → Accessibility.".into())
    }
}

pub(crate) fn require_screen_recording() -> Result<(), String> {
    if screen_recording_granted() {
        Ok(())
    } else {
        Err("Misty doesn't have Screen Recording. Tell the person to allow Misty in System Settings → Privacy & Security → Screen Recording.".into())
    }
}

/// Stops before an action once the person pressed Escape (mod.rs).
fn require_running() -> Result<(), String> {
    if super::stopped() {
        Err("The person stopped screen control with Escape. Stop and ask them how to go on.".into())
    } else {
        Ok(())
    }
}

// ==================== Driver: displays & screenshots ====================

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayInfo {
    pub id: u32,
    pub name: String,
    /// Origin in the global logical (point) coordinate space.
    pub x: i32,
    pub y: i32,
    /// Physical pixel size.
    pub width: u32,
    pub height: u32,
    pub scale: f64,
    pub primary: bool,
}

pub(crate) fn display_info_of(monitor: &Monitor) -> DisplayInfo {
    DisplayInfo {
        id: monitor.id().unwrap_or(0),
        name: monitor.friendly_name().unwrap_or_default(),
        x: monitor.x().unwrap_or(0),
        y: monitor.y().unwrap_or(0),
        width: monitor.width().unwrap_or(0),
        height: monitor.height().unwrap_or(0),
        scale: monitor.scale_factor().unwrap_or(1.0) as f64,
        primary: monitor.is_primary().unwrap_or(false),
    }
}

fn pick_display(display_id: Option<u32>) -> Result<(Monitor, DisplayInfo), String> {
    let monitors = Monitor::all().map_err(|e| format!("list monitors: {e}"))?;
    let picked = match display_id {
        Some(id) => monitors
            .into_iter()
            .find(|m| m.id().unwrap_or(0) == id)
            .ok_or_else(|| format!("no display with id {id}"))?,
        None => monitors
            .into_iter()
            .find(|m| m.is_primary().unwrap_or(false))
            .or_else(|| Monitor::all().ok()?.into_iter().next())
            .ok_or_else(|| "no display found".to_string())?,
    };
    let info = display_info_of(&picked);
    Ok((picked, info))
}

/// Long-edge cap for frames sent to the model: large enough to read UI text,
/// small enough to stay inside vision-token budgets.
const MAX_FRAME_EDGE: u32 = 1568;

/// Encoded-frame pixel dimensions for a display. Deterministic, so action
/// coordinates map back with the same math without re-capturing.
pub(crate) fn frame_dims(display: &DisplayInfo) -> (u32, u32) {
    let (w, h) = (display.width.max(1), display.height.max(1));
    let shrink = MAX_FRAME_EDGE as f64 / w.max(h) as f64;
    if shrink < 1.0 {
        (
            ((w as f64 * shrink).round() as u32).max(1),
            ((h as f64 * shrink).round() as u32).max(1),
        )
    } else {
        (w, h)
    }
}

/// Map a point in screenshot-image pixels to global logical points (the
/// coordinate space enigo injects in): image px → display physical px →
/// logical points via the scale factor, offset by the display origin.
#[cfg_attr(target_os = "linux", allow(dead_code))]
pub(crate) fn frame_to_logical(
    x: f64,
    y: f64,
    frame_w: u32,
    frame_h: u32,
    display: &DisplayInfo,
) -> (i32, i32) {
    let phys_x = x * display.width as f64 / frame_w.max(1) as f64;
    let phys_y = y * display.height as f64 / frame_h.max(1) as f64;
    let scale = if display.scale > 0.0 {
        display.scale
    } else {
        1.0
    };
    (
        display.x + (phys_x / scale).round() as i32,
        display.y + (phys_y / scale).round() as i32,
    )
}

pub struct CapturedFrame {
    pub jpeg_b64: String,
    pub width: u32,
    pub height: u32,
    pub display: DisplayInfo,
}

pub(crate) fn capture_frame(display_id: Option<u32>) -> Result<CapturedFrame, String> {
    let (monitor, info) = pick_display(display_id)?;
    let raw = monitor
        .capture_image()
        .map_err(|e| format!("capture display: {e}"))?;
    let (fw, fh) = frame_dims(&info);
    let resized = if (raw.width(), raw.height()) != (fw, fh) {
        image::imageops::resize(&raw, fw, fh, image::imageops::FilterType::Triangle)
    } else {
        raw
    };
    // JPEG (no alpha) keeps vision payloads small; quality 78 is plenty for
    // UI text the model has to read.
    let rgb = image::DynamicImage::ImageRgba8(resized).to_rgb8();
    let mut buf = Cursor::new(Vec::new());
    rgb.write_with_encoder(image::codecs::jpeg::JpegEncoder::new_with_quality(
        &mut buf, 78,
    ))
    .map_err(|e| format!("encode screenshot: {e}"))?;
    Ok(CapturedFrame {
        jpeg_b64: base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            buf.into_inner(),
        ),
        width: fw,
        height: fh,
        display: info,
    })
}

// ==================== Driver: input ====================

fn new_enigo() -> Result<Enigo, String> {
    Enigo::new(&Settings::default()).map_err(|e| format!("init input driver: {e}"))
}

/// Where input goes: enigo (CoreGraphics, SendInput, or XTest on X11), or the RemoteDesktop
/// portal on a Wayland session, where no app may post global input itself (portal.rs).
enum Input {
    Enigo(Enigo),
    #[cfg(target_os = "linux")]
    Portal,
}

fn new_input() -> Result<Input, String> {
    #[cfg(target_os = "linux")]
    if crate::agents::desktop_control::linux::wayland_session() {
        return Ok(Input::Portal);
    }
    Ok(Input::Enigo(new_enigo()?))
}

impl Input {
    fn move_mouse(&mut self, x: i32, y: i32) -> Result<(), String> {
        match self {
            Input::Enigo(enigo) => enigo
                .move_mouse(x, y, Coordinate::Abs)
                .map_err(|e| e.to_string()),
            #[cfg(target_os = "linux")]
            Input::Portal => super::portal::move_to(f64::from(x), f64::from(y)),
        }
    }

    fn button(&mut self, button: Button, direction: Direction) -> Result<(), String> {
        match self {
            Input::Enigo(enigo) => enigo.button(button, direction).map_err(|e| e.to_string()),
            #[cfg(target_os = "linux")]
            Input::Portal => match direction {
                Direction::Press => super::portal::button(button, true),
                Direction::Release => super::portal::button(button, false),
                Direction::Click => {
                    super::portal::button(button, true)?;
                    super::portal::button(button, false)
                }
            },
        }
    }

    fn scroll(&mut self, amount: i32, axis: Axis) -> Result<(), String> {
        match self {
            Input::Enigo(enigo) => enigo.scroll(amount, axis).map_err(|e| e.to_string()),
            // enigo's sign (positive scrolls up or right) back to the wheel's.
            #[cfg(target_os = "linux")]
            Input::Portal => match axis {
                Axis::Vertical => super::portal::scroll(0, -amount),
                Axis::Horizontal => super::portal::scroll(amount, 0),
            },
        }
    }

    fn text(&mut self, text: &str) -> Result<(), String> {
        match self {
            Input::Enigo(enigo) => enigo.text(text).map_err(|e| e.to_string()),
            #[cfg(target_os = "linux")]
            Input::Portal => super::portal::text(text),
        }
    }

    fn key(&mut self, key: Key, direction: Direction) -> Result<(), String> {
        match self {
            Input::Enigo(enigo) => enigo.key(key, direction).map_err(|e| e.to_string()),
            #[cfg(target_os = "linux")]
            Input::Portal => match direction {
                Direction::Press => super::portal::key(key, true),
                Direction::Release => super::portal::key(key, false),
                Direction::Click => {
                    super::portal::key(key, true)?;
                    super::portal::key(key, false)
                }
            },
        }
    }

    /// Where the pointer is; Wayland doesn't say.
    fn location(&self) -> Option<(i32, i32)> {
        match self {
            Input::Enigo(enigo) => enigo.location().ok(),
            #[cfg(target_os = "linux")]
            Input::Portal => None,
        }
    }
}

// ---- The virtual cursor ----

/// Shows the virtual cursor where the next action lands. A missing window never fails an action.
pub(crate) fn notify_cursor(x: i32, y: i32) {
    super::overlay::show_at(f64::from(x), f64::from(y));
}

fn logical_point(x: f64, y: f64, display_id: Option<u32>) -> Result<(i32, i32), String> {
    let (_, info) = pick_display(display_id)?;
    let (fw, fh) = frame_dims(&info);
    #[cfg(not(target_os = "linux"))]
    let point = frame_to_logical(x, y, fw, fh, &info);
    #[cfg(target_os = "linux")]
    let point = linux_point(x, y, fw, fh, &info);
    notify_cursor(point.0, point.1);
    Ok(point)
}

/// Linux: xcap reports displays in logical units. XTest places the pointer in X pixels, the
/// logical units times the desktop's scale; the portal takes the compositor's logical units.
#[cfg(target_os = "linux")]
fn linux_point(x: f64, y: f64, frame_w: u32, frame_h: u32, display: &DisplayInfo) -> (i32, i32) {
    let logical_x = f64::from(display.x) + x * f64::from(display.width) / f64::from(frame_w.max(1));
    let logical_y =
        f64::from(display.y) + y * f64::from(display.height) / f64::from(frame_h.max(1));
    let scale = if crate::agents::desktop_control::linux::wayland_session() || display.scale <= 0.0
    {
        1.0
    } else {
        display.scale
    };
    (
        (logical_x * scale).round() as i32,
        (logical_y * scale).round() as i32,
    )
}

pub(crate) fn action_move(x: f64, y: f64, display_id: Option<u32>) -> Result<String, String> {
    require_running()?;
    require_accessibility()?;
    let (lx, ly) = logical_point(x, y, display_id)?;
    new_input()?
        .move_mouse(lx, ly)
        .map_err(|e| format!("move mouse: {e}"))?;
    Ok(format!("Mouse moved to ({lx}, {ly})."))
}

pub(crate) fn action_click(
    button: Button,
    label: &str,
    x: Option<f64>,
    y: Option<f64>,
    times: u32,
    display_id: Option<u32>,
) -> Result<String, String> {
    require_running()?;
    require_accessibility()?;
    let mut input = new_input()?;
    if let (Some(x), Some(y)) = (x, y) {
        let (lx, ly) = logical_point(x, y, display_id)?;
        input
            .move_mouse(lx, ly)
            .map_err(|e| format!("move mouse: {e}"))?;
    }
    for _ in 0..times.max(1) {
        input
            .button(button, Direction::Click)
            .map_err(|e| format!("click: {e}"))?;
    }
    Ok(format!("{label} click ×{} done.", times.max(1)))
}

pub(crate) fn action_drag(
    from_x: f64,
    from_y: f64,
    to_x: f64,
    to_y: f64,
    display_id: Option<u32>,
) -> Result<String, String> {
    require_running()?;
    require_accessibility()?;
    let (sx, sy) = logical_point(from_x, from_y, display_id)?;
    let (ex, ey) = logical_point(to_x, to_y, display_id)?;
    let mut input = new_input()?;
    input
        .move_mouse(sx, sy)
        .map_err(|e| format!("move mouse: {e}"))?;
    input
        .button(Button::Left, Direction::Press)
        .map_err(|e| format!("press button: {e}"))?;
    // Interpolate so drop targets that highlight under a moving cursor
    // (lists, canvases) see a natural drag instead of a teleport.
    const STEPS: i32 = 16;
    for step in 1..=STEPS {
        let nx = sx + (ex - sx) * step / STEPS;
        let ny = sy + (ey - sy) * step / STEPS;
        if input.move_mouse(nx, ny).is_err() {
            break;
        }
        std::thread::sleep(Duration::from_millis(8));
    }
    input
        .button(Button::Left, Direction::Release)
        .map_err(|e| format!("release button: {e}"))?;
    Ok(format!("Dragged from ({sx}, {sy}) to ({ex}, {ey})."))
}

pub(crate) fn action_scroll(
    x: Option<f64>,
    y: Option<f64>,
    delta_x: i32,
    delta_y: i32,
    display_id: Option<u32>,
) -> Result<String, String> {
    require_running()?;
    require_accessibility()?;
    let mut input = new_input()?;
    if let (Some(x), Some(y)) = (x, y) {
        let (lx, ly) = logical_point(x, y, display_id)?;
        input
            .move_mouse(lx, ly)
            .map_err(|e| format!("move mouse: {e}"))?;
    }
    // enigo scrolls up/right for positive values; the tool's deltas follow
    // the wheel convention (positive y = scroll content down).
    let dy = -delta_y.clamp(-20, 20);
    let dx = delta_x.clamp(-20, 20);
    if dy != 0 {
        input
            .scroll(dy, Axis::Vertical)
            .map_err(|e| format!("scroll: {e}"))?;
    }
    if dx != 0 {
        input
            .scroll(dx, Axis::Horizontal)
            .map_err(|e| format!("scroll: {e}"))?;
    }
    Ok(format!("Scrolled by ({delta_x}, {delta_y})."))
}

/// Cap so a runaway tool call cannot dump a novel into a focused field.
const MAX_TYPE_CHARS: usize = 4096;

pub(crate) fn action_type(text: &str) -> Result<String, String> {
    require_running()?;
    require_accessibility()?;
    if let Some((x, y)) = new_input().ok().and_then(|input| input.location()) {
        notify_cursor(x, y);
    }
    if text.chars().count() > MAX_TYPE_CHARS {
        return Err(format!(
            "The text is too long (at most {MAX_TYPE_CHARS} characters). Split it into several calls."
        ));
    }
    new_input()?
        .text(text)
        .map_err(|e| format!("type text: {e}"))?;
    Ok(format!("Typed {} chars.", text.chars().count()))
}

pub(crate) fn action_key(chord: &str) -> Result<String, String> {
    require_running()?;
    require_accessibility()?;
    if let Some((x, y)) = new_input().ok().and_then(|input| input.location()) {
        notify_cursor(x, y);
    }
    let (modifiers, key) = parse_key_chord(chord)?;
    let mut input = new_input()?;
    for modifier in &modifiers {
        input
            .key(*modifier, Direction::Press)
            .map_err(|e| format!("press modifier: {e}"))?;
    }
    let result = input.key(key, Direction::Click);
    for modifier in modifiers.iter().rev() {
        let _ = input.key(*modifier, Direction::Release);
    }
    result.map_err(|e| format!("press key: {e}"))?;
    Ok(format!("Pressed {chord}."))
}

// ==================== Tests ====================

#[cfg(test)]
#[path = "driver_tests.rs"]
mod tests;
