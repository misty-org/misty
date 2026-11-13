// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//! The pet's own window: transparent, always on top, draggable, and click-through everywhere but
//! the pet itself. A person's window says what their agents are doing (`pet_set_state`); this
//! keeps that, watches where the cursor is so the pet can look at it, and tells the pet window.

use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use super::{change_settings, read_settings, PetPosition};

/// The pet window's label. Its capability is `tauri-permissions/capabilities/pet-overlay.json`.
pub const LABEL: &str = "misty-pet";
const STATE_EVENT: &str = "misty://pet-state";
const SCALE_EVENT: &str = "misty://pet-scale";
/// Tells a person's windows that the pet's settings changed.
pub const SETTINGS_EVENT: &str = "misty://pet-settings-changed";

const WIDTH: f64 = 192.0;
const HEIGHT: f64 = 208.0;
const BUBBLE_WIDTH: f64 = 420.0;
const BUBBLE_HEIGHT: f64 = 64.0;
const BASE_SCALE: f64 = 0.6;
const PROXIMITY_PADDING: f64 = 220.0;
const MIN_SCALE: f64 = 0.5;
const MAX_SCALE: f64 = 1.5;
const HIT_TEST_INTERVAL_MS: u64 = 16;
const LOOK_DIRECTION_INTERVAL_MS: u64 = 180;
/// How often the tracker checks while the pet window is closed: it lives as long as Misty does,
/// and must not spin at the hit-test rate.
const WINDOW_GONE_SLEEP_MS: u64 = 1000;
/// How often it checks while the pet window exists but is hidden.
const HIDDEN_SLEEP_MS: u64 = 500;

const PET_OFFSET_X: f64 = (BUBBLE_WIDTH - WIDTH) / 2.0;

fn render_scale(scale: f64) -> f64 {
    BASE_SCALE * scale.clamp(MIN_SCALE, MAX_SCALE)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PetRuntimeState {
    pub session_key: Option<String>,
    pub session_name: Option<String>,
    pub status: String,
    pub look_direction: u8,
    pub activity: String,
    pub cursor_nearby: bool,
    pub cursor_over: bool,
    pub changed_at: u64,
}

impl Default for PetRuntimeState {
    fn default() -> Self {
        Self {
            session_key: None,
            session_name: None,
            status: "idle".to_string(),
            look_direction: 0,
            activity: "idle".to_string(),
            cursor_nearby: false,
            cursor_over: false,
            changed_at: 0,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetStateUpdate {
    pub session_key: Option<String>,
    pub session_name: Option<String>,
    pub status: String,
    pub activity: String,
    pub changed_at: u64,
}

const STATUSES: [&str; 5] = ["idle", "running", "waiting", "failed", "review"];
const ACTIVITIES: [&str; 7] = [
    "idle",
    "thinking",
    "tool",
    "command",
    "waiting",
    "failed",
    "completed",
];

static STATE: OnceLock<Mutex<PetRuntimeState>> = OnceLock::new();
static TRACKER: OnceLock<()> = OnceLock::new();

fn state() -> &'static Mutex<PetRuntimeState> {
    STATE.get_or_init(|| Mutex::new(PetRuntimeState::default()))
}

fn snapshot() -> PetRuntimeState {
    state()
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default()
}

/// Shows the pet at launch when it was on. Called once from setup.
pub fn init(app: &AppHandle) {
    // A window is built off the UI thread: on Windows, building one from that thread waits on
    // itself.
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let settings = read_settings(&app);
        if settings.enabled && !settings.pet_id.trim().is_empty() {
            if let Err(error) = set_visible(&app, true) {
                eprintln!("[pets] the pet window could not open: {error}");
            }
        }
    });
}

/// Tells a person's windows the pet's settings changed.
pub(crate) fn settings_changed(app: &AppHandle) {
    let _ = app.emit(SETTINGS_EVENT, ());
}

fn on_screen(app: &AppHandle, x: f64, y: f64) -> bool {
    app.available_monitors()
        .map(|monitors| {
            monitors.iter().any(|monitor| {
                let factor = monitor.scale_factor();
                let origin = monitor.position();
                let size = monitor.size();
                let (mx, my) = (origin.x as f64 / factor, origin.y as f64 / factor);
                let (mw, mh) = (size.width as f64 / factor, size.height as f64 / factor);
                x >= mx && x < mx + mw && y >= my && y < my + mh
            })
        })
        .unwrap_or(false)
}

fn create_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        let cursor_over = snapshot().cursor_over;
        window
            .set_ignore_cursor_events(!cursor_over)
            .map_err(|error| error.to_string())?;
        return Ok(window);
    }
    let settings = read_settings(app);
    let scale = render_scale(settings.scale);
    let window =
        tauri::WebviewWindowBuilder::new(app, LABEL, tauri::WebviewUrl::App("pet.html".into()))
            .title("Misty pet")
            .transparent(true)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .shadow(false)
            .focused(false)
            .inner_size(BUBBLE_WIDTH * scale, HEIGHT * scale + BUBBLE_HEIGHT)
            .visible(false)
            .build()
            .map_err(|error| format!("The pet window could not open: {error}"))?;
    // The window is wider than the pet to make room for its bubble. That transparent space stays
    // click-through; the tracker lets clicks in only while the cursor is over the pet itself.
    window
        .set_ignore_cursor_events(true)
        .map_err(|error| error.to_string())?;
    if let Some(position) = settings.position {
        let x = position.x - PET_OFFSET_X * scale;
        let y = position.y - BUBBLE_HEIGHT;
        // Restore only while the spot is still on a connected display. A transparent,
        // click-through window off screen can't be found again (a monitor unplugged, a new
        // resolution), so it goes back to its default place instead.
        if on_screen(app, position.x, position.y) {
            let _ =
                window.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x, y)));
        }
    }
    Ok(window)
}

/// Opens or closes the pet window. Closing destroys it, so opening it again loads the chosen
/// pet afresh.
pub(crate) fn set_visible(app: &AppHandle, visible: bool) -> Result<(), String> {
    if !visible {
        if let Some(window) = app.get_webview_window(LABEL) {
            window.destroy().map_err(|error| error.to_string())?;
        }
        return Ok(());
    }
    if read_settings(app).pet_id.trim().is_empty() {
        return Err("Import a pet first.".to_string());
    }
    let window = create_window(app)?;
    start_look_tracking(app);
    let _ = app.emit_to(LABEL, STATE_EVENT, snapshot());
    window.show().map_err(|error| error.to_string())?;
    Ok(())
}

/// Shows the chosen pet again, after the choice changed.
pub(crate) fn reload(app: &AppHandle) -> Result<(), String> {
    set_visible(app, false)?;
    set_visible(app, true)
}

/// The cursor in logical desktop points, the space the hit test turns the window into.
///
/// Windows: GetCursorPos is in physical pixels; dividing by the window's scale is exact whenever
/// the cursor and the window share a monitor, the only case the hit test can match.
///
/// macOS: NSEvent's mouse location, in points, flipped with the main display's height, the same
/// convention tao uses for logical window positions.
///
/// Linux: the window's cursor position, in physical pixels. Wayland has no global cursor and
/// answers the origin instead of an error, so the origin counts as unknown.
///
/// None of these needs an input grant.
#[cfg(windows)]
fn cursor_position(_window: &tauri::WebviewWindow, dpi: f64) -> Option<(f64, f64)> {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut point = POINT { x: 0, y: 0 };
    // SAFETY: GetCursorPos writes one POINT through a valid pointer.
    if unsafe { GetCursorPos(&mut point) } == 0 {
        return None;
    }
    Some((point.x as f64 / dpi, point.y as f64 / dpi))
}

#[cfg(target_os = "macos")]
mod mac_cursor {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        pub fn CGMainDisplayID() -> u32;
        pub fn CGDisplayPixelsHigh(display: u32) -> usize;
    }
}

#[cfg(target_os = "macos")]
fn cursor_position(_window: &tauri::WebviewWindow, _dpi: f64) -> Option<(f64, f64)> {
    let point = objc2_app_kit::NSEvent::mouseLocation();
    // SAFETY: plain CoreGraphics queries with no arguments beyond a display id.
    let main_height = unsafe { mac_cursor::CGDisplayPixelsHigh(mac_cursor::CGMainDisplayID()) };
    Some((
        point.x.trunc(),
        (main_height as i32 - point.y as i32) as f64,
    ))
}

#[cfg(all(not(windows), not(target_os = "macos")))]
fn cursor_position(window: &tauri::WebviewWindow, dpi: f64) -> Option<(f64, f64)> {
    let point = window.cursor_position().ok()?;
    if point.x == 0.0 && point.y == 0.0 {
        return None;
    }
    Some((point.x / dpi, point.y / dpi))
}

fn start_look_tracking(app: &AppHandle) {
    if TRACKER.set(()).is_err() {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut interval =
            tokio::time::interval(std::time::Duration::from_millis(HIT_TEST_INTERVAL_MS));
        let mut next_look_update = tokio::time::Instant::now();
        loop {
            interval.tick().await;
            let Some(window) = app.get_webview_window(LABEL) else {
                tokio::time::sleep(std::time::Duration::from_millis(WINDOW_GONE_SLEEP_MS)).await;
                continue;
            };
            if !window.is_visible().unwrap_or(true) {
                tokio::time::sleep(std::time::Duration::from_millis(HIDDEN_SLEEP_MS)).await;
                continue;
            }
            let Ok(position) = window.outer_position() else {
                continue;
            };
            let Ok(size) = window.outer_size() else {
                continue;
            };
            let dpi = window.scale_factor().unwrap_or(1.0);
            // Without a cursor (Wayland) the window stays click-through rather than putting an
            // invisible interactive area on the desktop.
            let Some((mouse_x, mouse_y)) = cursor_position(&window, dpi) else {
                continue;
            };
            // The window holds transparent space above the pet for the bubble. Nearness and hover
            // use the pet's own rectangle, all in logical points.
            let position: tauri::LogicalPosition<f64> = position.to_logical(dpi);
            let size: tauri::LogicalSize<f64> = size.to_logical(dpi);
            let pet_height = size.height - BUBBLE_HEIGHT;
            let pet_top = position.y + BUBBLE_HEIGHT;
            let pet_left = position.x + size.width * PET_OFFSET_X / BUBBLE_WIDTH;
            let pet_width = size.width * WIDTH / BUBBLE_WIDTH;
            let center_x = pet_left + pet_width / 2.0;
            let center_y = pet_top + pet_height / 2.0;
            let dx = mouse_x - center_x;
            let dy = mouse_y - center_y;
            let direction = (((dx.atan2(-dy) / std::f64::consts::TAU) * 16.0).round() as i32 + 16)
                .rem_euclid(16) as u8;
            let radius = PROXIMITY_PADDING + (pet_width.max(pet_height) / 2.0);
            let cursor_nearby = dx.hypot(dy) <= radius;
            let cursor_over = mouse_x >= pet_left
                && mouse_x < pet_left + pet_width
                && mouse_y >= pet_top
                && mouse_y < pet_top + pet_height;
            let now = tokio::time::Instant::now();
            let update_look_direction = now >= next_look_update;
            if update_look_direction {
                next_look_update =
                    now + std::time::Duration::from_millis(LOOK_DIRECTION_INTERVAL_MS);
            }
            let capture_changed = state()
                .lock()
                .map(|current| current.cursor_over != cursor_over)
                .unwrap_or(false);
            let capture_applied =
                !capture_changed || window.set_ignore_cursor_events(!cursor_over).is_ok();
            let changed = if let Ok(mut current) = state().lock() {
                let mut changed = false;
                if current.cursor_nearby != cursor_nearby {
                    current.cursor_nearby = cursor_nearby;
                    changed = true;
                }
                if capture_applied && current.cursor_over != cursor_over {
                    current.cursor_over = cursor_over;
                    changed = true;
                }
                if update_look_direction && cursor_nearby && current.look_direction != direction {
                    current.look_direction = direction;
                    changed = true;
                }
                changed
            } else {
                false
            };
            if changed {
                let _ = app.emit_to(LABEL, STATE_EVENT, snapshot());
            }
        }
    });
}

/// Turns the pet on or off for this device.
#[tauri::command]
pub async fn pet_set_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    if visible && read_settings(&app).pet_id.trim().is_empty() {
        return Err("Import a pet first.".to_string());
    }
    change_settings(&app, |settings| settings.enabled = visible)?;
    let shown = set_visible(&app, visible);
    settings_changed(&app);
    shown
}

/// Resizes the pet, keeping its feet where they were.
#[tauri::command]
pub fn pet_set_scale(app: AppHandle, scale: f64) -> Result<f64, String> {
    if !scale.is_finite() || !(MIN_SCALE..=MAX_SCALE).contains(&scale) {
        return Err(format!(
            "The pet's size must be between {}% and {}%.",
            MIN_SCALE * 100.0,
            MAX_SCALE * 100.0
        ));
    }
    // Resize the live window first, and save only once that worked, so a failed resize can't
    // leave a size saved that the page has already rolled back.
    if let Some(window) = app.get_webview_window(LABEL) {
        let previous = render_scale(read_settings(&app).scale);
        let dpi = window.scale_factor().unwrap_or(1.0);
        let pet_position = window.outer_position().ok().map(|position| {
            (
                position.x as f64 / dpi + PET_OFFSET_X * previous,
                position.y as f64 / dpi + BUBBLE_HEIGHT,
            )
        });
        let next = render_scale(scale);
        window
            .set_size(tauri::Size::Logical(tauri::LogicalSize::new(
                BUBBLE_WIDTH * next,
                HEIGHT * next + BUBBLE_HEIGHT,
            )))
            .map_err(|error| error.to_string())?;
        if let Some((pet_x, pet_y)) = pet_position {
            window
                .set_position(tauri::Position::Logical(tauri::LogicalPosition::new(
                    pet_x - PET_OFFSET_X * next,
                    pet_y - BUBBLE_HEIGHT,
                )))
                .map_err(|error| error.to_string())?;
        }
        let _ = app.emit_to(LABEL, SCALE_EVENT, scale);
    }
    change_settings(&app, |settings| settings.scale = scale)?;
    settings_changed(&app);
    Ok(scale)
}

/// What the person's agents are doing, from one of their windows.
#[tauri::command]
pub fn pet_set_state(app: AppHandle, next: PetStateUpdate) -> Result<(), String> {
    if !STATUSES.contains(&next.status.as_str()) || !ACTIVITIES.contains(&next.activity.as_str()) {
        return Err("Unknown pet state.".to_string());
    }
    {
        let mut current = state().lock().map_err(|_| "The pet is unavailable.")?;
        // The look direction belongs to the cursor tracker, so it takes no part in this.
        if current.session_key == next.session_key
            && current.session_name == next.session_name
            && current.status == next.status
            && current.activity == next.activity
        {
            return Ok(());
        }
        current.session_key = next.session_key;
        current.session_name = next
            .session_name
            .map(|name| name.chars().take(60).collect());
        current.status = next.status;
        current.activity = next.activity;
        current.changed_at = next.changed_at;
    }
    if app.get_webview_window(LABEL).is_some() {
        app.emit_to(LABEL, STATE_EVENT, snapshot())
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// The pet's current state, for the pet window as it loads.
#[tauri::command]
pub fn pet_overlay_state() -> PetRuntimeState {
    snapshot()
}

/// Where the person dropped the pet.
#[tauri::command]
pub fn pet_save_position(app: AppHandle, position: PetPosition) -> Result<(), String> {
    if !position.x.is_finite() || !position.y.is_finite() {
        return Err("The pet's position must be a point on screen.".to_string());
    }
    change_settings(&app, |settings| settings.position = Some(position))?;
    Ok(())
}
