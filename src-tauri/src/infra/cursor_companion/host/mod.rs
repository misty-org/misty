mod audio;
mod capture;
mod loops;
use loops::start;
mod overlays;
mod platform;
mod pointing;
mod screens;
use overlays::{displays, rebuild};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, Webview};
pub use {capture::*, platform::show_overlay, pointing::*};

const PREFIX: &str = "misty-cursor-";
#[derive(Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Display {
    id: u32,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    scale: f64,
}
#[derive(Default)]
struct Data {
    account: String,
    task: String,
    presentation: Value,
    displays: Vec<Display>,
}
#[derive(Default)]
pub struct CursorCompanionState {
    data: Mutex<Data>,
    enabled: AtomicBool,
    held: AtomicBool,
    turn: AtomicU64,
    started: AtomicBool,
    capture: AtomicBool,
    keyboard_activity: AtomicU64,
    /// Click positions leave the native hook only while a walkthrough step waits.
    watch_clicks: AtomicBool,
    click_turn: AtomicU64,
}
pub enum Shortcut {
    KeyboardActivity,
    Held(bool),
    Click(f64, f64),
    Error(String),
}
fn require_main(webview: &Webview) -> Result<(), String> {
    if !crate::infra::space_windows::is_person_window(webview.label()) {
        return Err("Main Misty window required.".into());
    }
    Ok(())
}
/// The overlay windows (one full web view per display, about 46 MB each) are built the first time
/// the companion has something to show, not at sign-in: most sessions never show it.
static OVERLAYS_WANTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn host_state(app: &AppHandle) -> Arc<CursorCompanionState> {
    app.state::<Arc<CursorCompanionState>>().inner().clone()
}
fn current(state: &CursorCompanionState, turn: u64) -> bool {
    state.enabled.load(Ordering::SeqCst) && state.turn.load(Ordering::SeqCst) == turn
}
fn error(app: &AppHandle, turn: u64, message: String) {
    let _ = crate::infra::space_windows::emit_to_primary(
        &app,
        "misty://cursor-error",
        json!({"turn":turn,"error":message}),
    );
}

#[tauri::command]
pub async fn cursor_companion_configure(
    webview: Webview,
    app: AppHandle,
    account_id: String,
) -> Result<u64, String> {
    require_main(&webview)?;
    let state = host_state(&app);
    eprintln!(
        "[companion] configure account_empty={}",
        account_id.is_empty()
    );
    stop(&app);
    if account_id.is_empty() {
        return Ok(state.turn.load(Ordering::SeqCst));
    }
    state
        .data
        .lock()
        .map_err(|_| "Companion unavailable")?
        .account = account_id;
    state.enabled.store(true, Ordering::SeqCst);
    if !state.started.swap(true, Ordering::SeqCst) {
        start(app.clone(), state.clone());
    }
    rebuild(&app).await?;
    Ok(state.turn.load(Ordering::SeqCst))
}
/// Also called at the native account boundary, before renderer teardown completes.
pub fn stop(app: &AppHandle) {
    let Some(managed) = app.try_state::<Arc<CursorCompanionState>>() else {
        return;
    };
    let state = managed.inner().clone();
    state.enabled.store(false, Ordering::SeqCst);
    eprintln!("[companion] stop (account boundary or reconfigure)");
    state.held.store(false, Ordering::SeqCst);
    state.watch_clicks.store(false, Ordering::SeqCst);
    let turn = state.turn.fetch_add(1, Ordering::SeqCst) + 1;
    let cleared = serde_json::json!({
        "generation": turn, "enabled": false, "visible": false,
        "phase": "idle", "mode": "team", "model": ""
    });
    if let Ok(mut data) = state.data.lock() {
        data.account.clear();
        data.task.clear();
        data.presentation = cleared.clone();
    }
    let app = app.clone();
    let handle = app.clone();
    let _ = handle.run_on_main_thread(move || {
        for (label, window) in app.webview_windows() {
            if label.starts_with(PREFIX) {
                let _ = window.emit("misty://cursor-presentation", &cleared);
                let _ = window.hide();
            }
        }
    });
}
#[tauri::command]
pub fn cursor_companion_interrupt(
    webview: Webview,
    app: AppHandle,
    expected_turn: Option<u64>,
) -> Result<u64, String> {
    require_main(&webview)?;
    let state = host_state(&app);
    let expected = expected_turn.unwrap_or_else(|| state.turn.load(Ordering::SeqCst));
    state
        .turn
        .compare_exchange(expected, expected + 1, Ordering::SeqCst, Ordering::SeqCst)
        .map_err(|_| "Companion already interrupted")?;
    eprintln!("[companion] interrupt expected={expected}");
    state.held.store(false, Ordering::SeqCst);
    state.watch_clicks.store(false, Ordering::SeqCst);
    if let Ok(mut data) = state.data.lock() {
        data.task.clear();
    }
    Ok(expected + 1)
}
#[tauri::command]
pub async fn cursor_companion_present(
    webview: Webview,
    app: AppHandle,
    turn: u64,
    presentation: Value,
) -> Result<(), String> {
    require_main(&webview)?;
    if presentation.to_string().len() > 32_000 {
        return Err("Presentation too large".into());
    }
    let state = host_state(&app);
    if !current(&state, turn) {
        return Ok(());
    }
    state
        .data
        .lock()
        .map_err(|_| "Companion unavailable")?
        .presentation = presentation.clone();
    let visible = presentation["visible"].as_bool().unwrap_or(false);
    if visible && !OVERLAYS_WANTED.swap(true, Ordering::SeqCst) {
        rebuild(&app).await?;
    }
    on_main(&app, move |app| {
        if !current(&state, turn) {
            return Ok(());
        }
        for (label, window) in app.webview_windows() {
            if !label.starts_with(PREFIX) {
                continue;
            }
            let _ = window.emit("misty://cursor-presentation", &presentation);
            if label != "misty-cursor-controls" && !state.capture.load(Ordering::SeqCst) {
                if visible {
                    platform::show_overlay(&window);
                } else {
                    let app = app.clone();
                    let label = label.clone();
                    let state = state.clone();
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(Duration::from_millis(400)).await;
                        if current(&state, turn)
                            && !state.data.lock().unwrap().presentation["visible"]
                                .as_bool()
                                .unwrap_or(false)
                        {
                            if let Some(w) = app.get_webview_window(&label) {
                                let _ = w.hide();
                            }
                        }
                    });
                }
            }
        }
        Ok(())
    })
    .await
}
#[tauri::command]
pub fn cursor_companion_snapshot(webview: Webview, app: AppHandle) -> Result<Value, String> {
    if !webview.label().starts_with(PREFIX) {
        require_main(&webview)?;
    }
    let state = host_state(&app);
    let data = state.data.lock().map_err(|_| "Companion unavailable")?;
    Ok(data.presentation.clone())
}
async fn on_main<T: Send + 'static>(
    app: &AppHandle,
    work: impl FnOnce(AppHandle) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = tx.send(work(handle));
    })
    .map_err(|e| e.to_string())?;
    rx.await
        .map_err(|_| "Misty's UI thread stopped".to_string())?
}
