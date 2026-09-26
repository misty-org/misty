#[path = "audio.rs"]
mod audio;
#[path = "platform.rs"]
mod platform;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, Webview, WebviewUrl, WebviewWindowBuilder};

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
}
pub enum Shortcut {
    Held(bool),
    Error(String),
}
fn require_main(webview: &Webview) -> Result<(), String> {
    if webview.label() != "main" {
        return Err("Main Misty window required.".into());
    }
    Ok(())
}
fn host_state(app: &AppHandle) -> Arc<CursorCompanionState> {
    app.state::<Arc<CursorCompanionState>>().inner().clone()
}
fn current(state: &CursorCompanionState, turn: u64) -> bool {
    state.enabled.load(Ordering::SeqCst) && state.turn.load(Ordering::SeqCst) == turn
}
fn error(app: &AppHandle, turn: u64, message: String) {
    let _ = app.emit_to(
        "main",
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
    state.held.store(false, Ordering::SeqCst);
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
    state.held.store(false, Ordering::SeqCst);
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
                    let _ = window.show();
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
fn displays() -> Result<Vec<Display>, String> {
    xcap::Monitor::all()
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|m| {
            Ok(Display {
                id: m.id().map_err(|e| e.to_string())?,
                x: m.x().map_err(|e| e.to_string())? as f64,
                y: m.y().map_err(|e| e.to_string())? as f64,
                width: m.width().map_err(|e| e.to_string())? as f64,
                height: m.height().map_err(|e| e.to_string())? as f64,
                scale: m.scale_factor().map_err(|e| e.to_string())? as f64,
            })
        })
        .collect()
}
async fn rebuild(app: &AppHandle) -> Result<(), String> {
    on_main(app, |app| {
        let state = host_state(&app);
        if !state.enabled.load(Ordering::SeqCst) {
            return Ok(());
        }
        let frames = displays()?;
        let old = state
            .data
            .lock()
            .map_err(|_| "Companion unavailable")?
            .displays
            .clone();
        if old == frames
            && frames.iter().all(|d| {
                app.get_webview_window(&format!("{PREFIX}{}", d.id))
                    .is_some()
            })
        {
            return Ok(());
        }
        for (label, window) in app.webview_windows() {
            if label.starts_with(PREFIX) && label != "misty-cursor-controls" {
                let _ = window.destroy();
            }
        }
        for d in &frames {
            let window = WebviewWindowBuilder::new(
                &app,
                format!("{PREFIX}{}", d.id),
                WebviewUrl::App("companion.html".into()),
            )
            .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
            .title("Misty cursor")
            .transparent(true)
            .decorations(false)
            .shadow(false)
            .resizable(false)
            .visible(false)
            .focused(false)
            .focusable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .build()
            .map_err(|e| e.to_string())?;
            #[cfg(target_os = "macos")]
            platform::position_overlay(&window, d)?;
            #[cfg(windows)]
            {
                window
                    .set_position(tauri::PhysicalPosition::new(d.x as i32, d.y as i32))
                    .map_err(|e| e.to_string())?;
                window
                    .set_size(tauri::PhysicalSize::new(d.width as u32, d.height as u32))
                    .map_err(|e| e.to_string())?;
            }
            platform::configure_overlay(&window)?;
            if state.data.lock().unwrap().presentation["visible"]
                .as_bool()
                .unwrap_or(true)
                && !state.capture.load(Ordering::SeqCst)
            {
                let _ = window.show();
            }
        }
        state
            .data
            .lock()
            .map_err(|_| "Companion unavailable")?
            .displays = frames;
        let _ = app.emit_to("main", "misty://cursor-displays-changed", ());
        Ok(())
    })
    .await
}
#[tauri::command]
pub async fn cursor_companion_capture(
    webview: Webview,
    app: AppHandle,
    turn: u64,
) -> Result<Vec<Value>, String> {
    require_main(&webview)?;
    capture_displays(app, turn).await
}
#[tauri::command]
pub fn cursor_companion_bind_task(
    webview: Webview,
    app: AppHandle,
    turn: u64,
    task_id: String,
) -> Result<(), String> {
    require_main(&webview)?;
    let state = host_state(&app);
    if !current(&state, turn) {
        return Err("Companion interrupted".into());
    }
    state.data.lock().map_err(|_| "Companion unavailable")?.task = task_id;
    Ok(())
}
pub async fn task_visual(app: &AppHandle, task_id: &str) -> Result<Option<Vec<Value>>, String> {
    let state = host_state(app);
    if task_id.is_empty()
        || !state.enabled.load(Ordering::SeqCst)
        || state.data.lock().map_err(|_| "Companion unavailable")?.task != task_id
    {
        return Ok(None);
    }
    let turn = state.turn.load(Ordering::SeqCst);
    let captures = capture_displays(app.clone(), turn).await?;
    if !current(&state, turn) {
        return Err("Companion interrupted".into());
    }
    // Only the main authenticated controller receives refreshed screenshot data.
    let _ = app.emit_to(
        "main",
        "misty://cursor-captures",
        json!({"turn":turn,"captures":captures}),
    );
    Ok(Some(captures))
}
async fn capture_displays(app: AppHandle, turn: u64) -> Result<Vec<Value>, String> {
    let state = host_state(&app);
    if !current(&state, turn) {
        return Err("Capture interrupted".into());
    }
    if state.capture.swap(true, Ordering::SeqCst) {
        return Err("A display capture is already in progress".into());
    }
    let result=async {
        on_main(&app,|app| { for (label,w) in app.webview_windows() { if label.starts_with(PREFIX) { w.hide().map_err(|e|e.to_string())?; } } Ok(()) }).await?;
        tokio::time::sleep(Duration::from_millis(80)).await;
        let state=state.clone();
        tauri::async_runtime::spawn_blocking(move|| {
            platform::screen_access()?;
            if !current(&state,turn) { return Err("Capture interrupted".into()); }
            let cursor=platform::cursor().ok_or("Cursor unavailable")?;
            let frames=displays()?;
            let mut monitors=xcap::Monitor::all().map_err(|e|e.to_string())?;
            monitors.sort_by_key(|m| !frames.iter().any(|d|m.id().ok()==Some(d.id)&&contains(d,cursor)));
            let mut result=Vec::new();
            for (index,m) in monitors.iter().enumerate() {
                if !current(&state,turn) { return Err("Capture interrupted".into()); }
                let frame=frames.iter().find(|d|Some(d.id)==m.id().ok()).ok_or("Display disconnected")?;
                let image=image::DynamicImage::ImageRgba8(m.capture_image().map_err(|e|e.to_string())?);
                let resized=image.resize(1280,1280,image::imageops::FilterType::Lanczos3).to_rgb8();
                let mut bytes=Vec::new(); image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes,80).encode_image(&resized).map_err(|e|e.to_string())?;
                use sha2::{Digest,Sha256}; let content_hash=format!("{:x}",Sha256::digest(&bytes));
                let screen=format!("screen{}",index+1);let primary=contains(frame,cursor);
                result.push(json!({"id":uuid::Uuid::new_v4().to_string(),"name":format!("{screen}{} ({} × {})",if primary {" — primary (cursor)"}else{""},resized.width(),resized.height()),"mimeType":"image/jpeg","dataUrl":format!("data:image/jpeg;base64,{}",STANDARD.encode(&bytes)),"width":resized.width(),"height":resized.height(),"contentHash":content_hash,"screen":screen,"primary":primary,"display":frame}));
            }
            if !current(&state,turn) { return Err("Capture interrupted".into()); } Ok(result)
        }).await.map_err(|e|e.to_string())?
    }.await;

    result
}
// Browser operations can be dropped by their execution deadline. Always restore overlays,
// including when the capture future never reaches its normal return path.
struct CaptureGuard {
    app: AppHandle,
    state: Arc<CursorCompanionState>,
}
impl Drop for CaptureGuard {
    fn drop(&mut self) {
        self.state.capture.store(false, Ordering::SeqCst);
        let state = self.state.clone();
        let app = self.app.clone();
        let handle = app.clone();
        let _ = handle.run_on_main_thread(move || {
            let visible = state.enabled.load(Ordering::SeqCst)
                && state
                    .data
                    .lock()
                    .map(|d| d.presentation["visible"].as_bool().unwrap_or(false))
                    .unwrap_or(false);
            if visible && !state.capture.load(Ordering::SeqCst) {
                for (label, w) in app.webview_windows() {
                    if label.starts_with(PREFIX) && label != "misty-cursor-controls" {
                        let _ = w.show();
                    }
                }
            }
        });
    }
}
fn contains(d: &Display, p: (f64, f64)) -> bool {
    p.0 >= d.x && p.0 < d.x + d.width && p.1 >= d.y && p.1 < d.y + d.height
}
fn start(app: AppHandle, state: Arc<CursorCompanionState>) {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || platform::shortcut(tx));
    let (audio_tx, audio_rx) = mpsc::channel();
    let events_app = app.clone();
    let events_state = state.clone();
    std::thread::spawn(move || {
        while let Ok(event) = rx.recv() {
            if !events_state.enabled.load(Ordering::SeqCst) {
                continue;
            }
            match event {
                Shortcut::Held(held) => {
                    if events_state.held.swap(held, Ordering::SeqCst) == held {
                        continue;
                    }
                    let turn = if held {
                        events_state.turn.fetch_add(1, Ordering::SeqCst) + 1
                    } else {
                        events_state.turn.load(Ordering::SeqCst)
                    };
                    if held {
                        if let Some(window) = events_app.get_webview_window("misty-cursor-controls")
                        {
                            let _ = window.hide();
                        }
                    }
                    let _ = events_app.emit_to(
                        "main",
                        "misty://cursor-shortcut",
                        json!({"turn":turn,"held":held}),
                    );
                    let _ = audio_tx.send((turn, held));
                }
                Shortcut::Error(message) => error(
                    &events_app,
                    events_state.turn.load(Ordering::SeqCst),
                    message,
                ),
            }
        }
    });
    let audio_app = app.clone();
    let audio_state = state.clone();
    std::thread::spawn(move || {
        let mut recording: Option<(u64, Instant, audio::Recording)> = None;
        loop {
            if recording
                .as_ref()
                .is_some_and(|(turn, _, _)| !current(&audio_state, *turn))
            {
                recording = None;
            }
            let event = audio_rx.recv_timeout(Duration::from_millis(25));
            let timed_out = recording
                .as_ref()
                .is_some_and(|(_, start, _)| start.elapsed() >= Duration::from_secs(60));
            match event {
                Ok((turn, true)) => {
                    recording = None;
                    if !current(&audio_state, turn) {
                        continue;
                    }
                    if !audio_state.held.load(Ordering::SeqCst) {
                        let _ = audio_app.emit_to(
                            "main",
                            "misty://cursor-recorded",
                            json!({"turn":turn,"audio":"","durationMs":0}),
                        );
                        continue;
                    }
                    match audio::Recording::start(audio_app.clone(), turn) {
                        Ok(value)
                            if current(&audio_state, turn)
                                && audio_state.held.load(Ordering::SeqCst) =>
                        {
                            recording = Some((turn, Instant::now(), value))
                        }
                        Ok(_) => {
                            if current(&audio_state, turn) {
                                let _ = audio_app.emit_to(
                                    "main",
                                    "misty://cursor-recorded",
                                    json!({"turn":turn,"audio":"","durationMs":0}),
                                );
                            }
                        }
                        Err(message) => {
                            if current(&audio_state, turn) {
                                error(&audio_app, turn, message)
                            }
                        }
                    }
                }
                Ok((_, false)) | Err(mpsc::RecvTimeoutError::Timeout)
                    if timed_out || !audio_state.held.load(Ordering::SeqCst) =>
                {
                    if let Some((turn, _, record)) = recording.take() {
                        let (wav, duration) = record.finish();
                        if current(&audio_state, turn) {
                            let _=audio_app.emit_to("main","misty://cursor-recorded",json!({"turn":turn,"audio":STANDARD.encode(wav),"durationMs":duration}));
                        }
                    } else if let Ok((turn, false)) = event {
                        if current(&audio_state, turn) {
                            let _ = audio_app.emit_to(
                                "main",
                                "misty://cursor-recorded",
                                json!({"turn":turn,"audio":"","durationMs":0}),
                            );
                        }
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
                _ => {}
            }
        }
    });
    std::thread::spawn(move || {
        let mut topology = Instant::now();
        loop {
            if state.enabled.load(Ordering::SeqCst) {
                if let Some((x, y)) = platform::cursor() {
                    let displays = state.data.lock().unwrap().displays.clone();
                    let payload = json!({"x":x,"y":y,"displays":displays});
                    for (label, w) in app.webview_windows() {
                        if label.starts_with(PREFIX) && label != "misty-cursor-controls" {
                            let _ = w.emit("misty://cursor-sample", &payload);
                        }
                    }
                }
                if topology.elapsed() > Duration::from_secs(2) {
                    topology = Instant::now();
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = rebuild(&app).await;
                    });
                }
            }
            std::thread::sleep(Duration::from_millis(16));
        }
    });
}
