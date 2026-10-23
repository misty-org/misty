//! Screen memory: a capture session the person starts reads the words on the window in front
//! and hands them to the window that started it, which redacts and keeps them as Memory.
//!
//! Nothing runs until `screen_memory_start`; one session at a time. Pixels never leave the
//! native reader and no text is stored here. A session ends when the person stops it, after
//! they have been idle for the length they chose, or when the window that started it closes.
#![cfg_attr(not(target_os = "macos"), allow(unused_imports, dead_code))]

use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

const FRAME_EVENT: &str = "screen-memory-frame";
const ENDED_EVENT: &str = "screen-memory-ended";
/// Idle for this long and nothing new is on screen, so nothing is read.
const QUIET_AFTER_SECS: f64 = 60.0;
/// Consecutive failed reads before the session gives up.
const MAX_FAILURES: u32 = 3;

#[cfg(target_os = "macos")]
extern "C" {
    fn misty_screen_memory_state() -> *mut std::ffi::c_char;
    fn misty_screen_memory_reset();
    fn misty_screen_memory_read(excluded: *const std::ffi::c_char) -> *mut std::ffi::c_char;
    fn misty_context_status(request: bool) -> *mut std::ffi::c_char;
}

struct Session {
    id: String,
    started_ms: u64,
    cancel: Arc<AtomicBool>,
    frames: Arc<AtomicU64>,
}

static SESSION: Mutex<Option<Session>> = Mutex::new(None);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartOptions {
    /// Seconds between reads.
    interval_secs: u64,
    /// Seconds without keyboard or pointer input after which the session ends.
    idle_secs: u64,
    /// App names or bundle ids that are never read.
    excluded_apps: Vec<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Frame {
    session_id: String,
    app: String,
    title: String,
    text: String,
    captured_at_ms: u64,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn trusted(window: &tauri::Webview) -> Result<(), String> {
    if crate::infra::space_windows::is_person_window(window.label()) {
        Ok(())
    } else {
        Err("Only the person's own windows can capture the screen.".into())
    }
}

#[cfg(target_os = "macos")]
unsafe fn take_json(pointer: *mut std::ffi::c_char) -> Value {
    if pointer.is_null() {
        return json!({"error": "Screen memory is unavailable."});
    }
    let value = serde_json::from_slice(std::ffi::CStr::from_ptr(pointer).to_bytes())
        .unwrap_or_else(|_| json!({"error": "Screen memory is unavailable."}));
    libc::free(pointer.cast());
    value
}

fn session_snapshot() -> Value {
    match SESSION.lock().ok().and_then(|s| {
        s.as_ref()
            .map(|s| (s.id.clone(), s.started_ms, s.frames.load(Ordering::Relaxed)))
    }) {
        Some((id, started, frames)) => {
            json!({"running": true, "sessionId": id, "startedAtMs": started, "frames": frames})
        }
        None => json!({"running": false}),
    }
}

/// Whether capture is supported and allowed here, and the running session if there is one.
/// With `request`, macOS asks for screen access when it has not been granted.
#[tauri::command]
pub async fn screen_memory_status(window: tauri::Webview, request: bool) -> Result<Value, String> {
    trusted(&window)?;
    #[cfg(target_os = "macos")]
    let mut status = tauri::async_runtime::spawn_blocking(move || unsafe {
        take_json(misty_context_status(request))
    })
    .await
    .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    let mut status = {
        let _ = request;
        json!({"supported": false, "allowed": false})
    };
    if let (Some(out), Some(running)) = (status.as_object_mut(), session_snapshot().as_object()) {
        out.extend(running.clone());
    }
    Ok(status)
}

#[tauri::command]
pub fn screen_memory_start(
    app: AppHandle,
    window: tauri::Webview,
    options: StartOptions,
) -> Result<Value, String> {
    trusted(&window)?;
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (&app, &options);
        Err("Screen capture isn't available on this system yet.".into())
    }
    #[cfg(target_os = "macos")]
    {
        let mut slot = SESSION
            .lock()
            .map_err(|_| "Screen capture is busy.".to_string())?;
        if slot.is_some() {
            return Err("A capture session is already running.".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let session = Session {
            id: id.clone(),
            started_ms: now_ms(),
            cancel: Arc::new(AtomicBool::new(false)),
            frames: Arc::new(AtomicU64::new(0)),
        };
        let (cancel, frames) = (session.cancel.clone(), session.frames.clone());
        let started = session.started_ms;
        *slot = Some(session);
        drop(slot);
        let label = window.label().to_string();
        thread::Builder::new()
            .name("misty-screen-memory".into())
            .spawn(move || run(app, label, id.clone(), options, cancel, frames))
            .map_err(|e| e.to_string())?;
        Ok(json!({"running": true, "startedAtMs": started}))
    }
}

#[tauri::command]
pub fn screen_memory_stop(window: tauri::Webview) -> Result<(), String> {
    trusted(&window)?;
    if let Ok(slot) = SESSION.lock() {
        if let Some(session) = slot.as_ref() {
            session.cancel.store(true, Ordering::Release);
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn run(
    app: AppHandle,
    label: String,
    id: String,
    options: StartOptions,
    cancel: Arc<AtomicBool>,
    frames: Arc<AtomicU64>,
) {
    let excluded = std::ffi::CString::new(options.excluded_apps.join(","))
        .unwrap_or_else(|_| std::ffi::CString::default());
    let interval = Duration::from_secs(options.interval_secs.clamp(5, 120));
    let mut failures = 0u32;
    let mut reason = "stopped";
    unsafe { misty_screen_memory_reset() };
    'session: loop {
        let mut waited = Duration::ZERO;
        while waited < interval {
            if cancel.load(Ordering::Acquire) {
                break 'session;
            }
            thread::sleep(Duration::from_millis(500));
            waited += Duration::from_millis(500);
        }
        let state = unsafe { take_json(misty_screen_memory_state()) };
        let idle = state["idle"].as_f64().unwrap_or(0.0);
        if options.idle_secs > 0 && idle >= options.idle_secs as f64 {
            reason = "idle";
            break;
        }
        if state["locked"].as_bool().unwrap_or(false) || idle >= QUIET_AFTER_SECS {
            continue;
        }
        let read = unsafe { take_json(misty_screen_memory_read(excluded.as_ptr())) };
        if read.get("error").is_some() {
            failures += 1;
            if failures >= MAX_FAILURES {
                reason = "failed";
                break;
            }
            continue;
        }
        failures = 0;
        let Some(text) = read["text"].as_str() else {
            continue;
        };
        let frame = Frame {
            session_id: id.clone(),
            app: read["app"].as_str().unwrap_or_default().to_string(),
            title: read["title"].as_str().unwrap_or_default().to_string(),
            text: text.to_string(),
            captured_at_ms: now_ms(),
        };
        // The window that started the session keeps its text; if it is gone, so is the session.
        if app.emit_to(label.as_str(), FRAME_EVENT, frame).is_err() {
            reason = "window-closed";
            break;
        }
        frames.fetch_add(1, Ordering::Relaxed);
    }
    if let Ok(mut slot) = SESSION.lock() {
        if slot.as_ref().is_some_and(|s| s.id == id) {
            *slot = None;
        }
    }
    let _ = app.emit_to(
        label.as_str(),
        ENDED_EVENT,
        json!({"sessionId": id, "reason": reason, "frames": frames.load(Ordering::Relaxed)}),
    );
}
