mod audio;
mod loops;
use loops::start;
mod platform;
mod pointing;
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
pub use {platform::show_overlay, pointing::*};

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
    if !host_state(app).enabled.load(Ordering::SeqCst) {
        return Ok(());
    }
    // Enumerating monitors makes GDI calls per display (on Windows each
    // property query opens a device context). Never do that on the UI thread:
    // this runs every two seconds and on every reload or sign-out.
    let frames = tauri::async_runtime::spawn_blocking(displays)
        .await
        .map_err(|e| e.to_string())??;
    // Reloads, sign-out and the topology poll can overlap; build one set at a time.
    static REBUILD: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _serialized = REBUILD.lock().await;
    let state = host_state(app);
    if !state.enabled.load(Ordering::SeqCst) || !OVERLAYS_WANTED.load(Ordering::SeqCst) {
        return Ok(());
    }
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
    // Create the webviews here, off the UI thread. WebView2 creation needs the
    // UI thread's message loop to run; building from inside a task on that
    // thread waits on itself and freezes the app on Windows. The build call
    // hands the work to the UI thread and waits for it from a worker instead.
    for (label, window) in app.webview_windows() {
        if label.starts_with(PREFIX) && label != "misty-cursor-controls" {
            let _ = window.destroy();
        }
    }
    for d in &frames {
        WebviewWindowBuilder::new(
            app,
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
    }
    on_main(app, move |app| {
        let state = host_state(&app);
        for d in &frames {
            let Some(window) = app.get_webview_window(&format!("{PREFIX}{}", d.id)) else {
                continue;
            };
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
                platform::show_overlay(&window);
            }
        }
        state
            .data
            .lock()
            .map_err(|_| "Companion unavailable")?
            .displays = frames;
        let _ = crate::infra::space_windows::emit_to_primary(
            &app,
            "misty://cursor-displays-changed",
            (),
        );
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
    let _ = crate::infra::space_windows::emit_to_primary(
        &app,
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
    let capture_guard = CaptureGuard {
        app: app.clone(),
        state: state.clone(),
    };
    let result=async {
        let ignored = on_main(&app,|app| {
            let mut ignored = Vec::new();
            for (label,w) in app.webview_windows() {
                if label.starts_with(PREFIX) { w.hide().map_err(|e|e.to_string())?; }
                if !person_works_in(&label) { if let Some(handle) = native_handle(&w) { ignored.push(handle); } }
            }
            Ok(ignored)
        }).await?;
        tokio::time::sleep(Duration::from_millis(80)).await;
        let state=state.clone();
        tauri::async_runtime::spawn_blocking(move|| {
            // The blocking acquisition can outlive a canceled async waiter.
            let _capture_guard = capture_guard;
            platform::screen_access()?;
            if !current(&state,turn) { return Err("Capture interrupted".into()); }
            let cursor=platform::cursor().ok_or("Cursor unavailable")?;
            let frames=displays()?;
            // The screen the person works on holds the window in front, not
            // wherever the pointer is parked (on the companion panel, say).
            let foreground=platform::foreground_window(&ignored);
            let (primary_id,focused)=choose_primary(&frames,foreground.as_ref(),cursor).ok_or("No display is available for capture")?;
            let focused=focused.then_some(foreground).flatten();
            let mut monitors=xcap::Monitor::all().map_err(|e|e.to_string())?;
            monitors.sort_by_key(|m| m.id().ok()!=Some(primary_id));
            let captured_at=||Ok::<u64,String>(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_millis() as u64);
            use sha2::{Digest,Sha256};
            let mut result=Vec::new();
            for (index,m) in monitors.iter().enumerate() {
                if !current(&state,turn) { return Err("Capture interrupted".into()); }
                let frame=frames.iter().find(|d|Some(d.id)==m.id().ok()).ok_or("Display disconnected")?;
                let (bytes, width, height) = platform::capture_display(m)?;
                if width == 0 || height == 0 || bytes.is_empty() { return Err("Screen capture returned no pixels".into()); }
                let content_hash=format!("{:x}",Sha256::digest(&bytes));
                let screen=format!("screen{}",index+1);let primary=frame.id==primary_id;
                let focus=match (&focused,primary) { (Some(w),true)=>format!(" — primary ({})",window_name(w)), (None,true)=>" — primary (cursor)".into(), _=>String::new() };
                result.push(json!({"id":uuid::Uuid::new_v4().to_string(),"name":format!("{screen}{focus} ({} × {})",width,height),"mimeType":"image/jpeg","dataUrl":format!("data:image/jpeg;base64,{}",STANDARD.encode(&bytes)),"width":width,"height":height,"contentHash":content_hash,"capturedAt":captured_at()?,"source":"desktop-display","screen":screen,"primary":primary,"display":frame}));
            }
            // The focused window again at full resolution, for detail a
            // whole-display capture shrinks away.
            if let (Some(window),Some(m)) = (&focused,monitors.first()) {
                if !current(&state,turn) { return Err("Capture interrupted".into()); }
                let frame=frames.iter().find(|d|d.id==primary_id).ok_or("Display disconnected")?;
                match platform::capture_window(m,frame,window) {
                    Ok((bytes,width,height,area)) if width>0 && height>0 && !bytes.is_empty() => {
                        let content_hash=format!("{:x}",Sha256::digest(&bytes));
                        result.push(json!({"id":uuid::Uuid::new_v4().to_string(),"name":format!("window1 — {} ({} × {})",window_name(window),width,height),"mimeType":"image/jpeg","dataUrl":format!("data:image/jpeg;base64,{}",STANDARD.encode(&bytes)),"width":width,"height":height,"contentHash":content_hash,"capturedAt":captured_at()?,"source":"desktop-window","screen":"window1","primary":false,"display":area,"app":window.app,"title":window.title}));
                    }
                    // The displays still answer the turn without the closer look.
                    Ok(_) => {}
                    Err(message) => eprintln!("[companion] focused window capture skipped: {message}"),
                }
            }
            if !current(&state,turn) { return Err("Capture interrupted".into()); }
            if result.is_empty() { return Err("No display is available for capture".into()); }
            Ok(result)
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
                        platform::show_overlay(&w);
                    }
                }
            }
        });
    }
}
fn contains(d: &Display, p: (f64, f64)) -> bool {
    p.0 >= d.x && p.0 < d.x + d.width && p.1 >= d.y && p.1 < d.y + d.height
}
/// Misty windows a person works in: app windows and extension popups. The
/// companion, its overlays and other panels are never "in front".
fn person_works_in(label: &str) -> bool {
    crate::infra::space_windows::is_app_window(label)
        || label.starts_with(crate::infra::extensions::popup::POPUP_PREFIX)
}
#[cfg(windows)]
fn native_handle(window: &tauri::WebviewWindow) -> Option<isize> {
    window.hwnd().ok().map(|hwnd| hwnd.0 as isize)
}
#[cfg(target_os = "macos")]
fn native_handle(window: &tauri::WebviewWindow) -> Option<isize> {
    let native = window.ns_window().ok()? as *const objc2_app_kit::NSWindow;
    // SAFETY: called on the main thread with a live window.
    Some(unsafe { (*native).windowNumber() })
}
/// "App: title", short enough for a capture label.
fn window_name(window: &platform::ForegroundWindow) -> String {
    let title: String = window.title.trim().chars().take(120).collect();
    match (window.app.trim(), title.as_str()) {
        ("", "") => "focused window".into(),
        (app, "") => app.into(),
        ("", title) => title.into(),
        (app, title) => format!("{app}: {title}"),
    }
}
/// The display the person is working on: the one holding the window in
/// front, else the one under the cursor, else the first. The flag says
/// whether the foreground window decided it.
fn choose_primary(
    frames: &[Display],
    foreground: Option<&platform::ForegroundWindow>,
    cursor: (f64, f64),
) -> Option<(u32, bool)> {
    if let Some(window) = foreground {
        let reported = window.monitor.and_then(|(x, y, width, height)| {
            frames
                .iter()
                .find(|d| d.x == x && d.y == y && d.width == width && d.height == height)
        });
        let overlap = |d: &&Display| {
            let w = (window.x + window.width).min(d.x + d.width) - window.x.max(d.x);
            let h = (window.y + window.height).min(d.y + d.height) - window.y.max(d.y);
            w.max(0.) * h.max(0.)
        };
        let largest = frames
            .iter()
            .filter(|d| overlap(d) > 0.)
            .max_by(|a, b| overlap(a).total_cmp(&overlap(b)));
        if let Some(display) = reported.or(largest) {
            return Some((display.id, true));
        }
    }
    frames
        .iter()
        .find(|d| contains(d, cursor))
        .or(frames.first())
        .map(|d| (d.id, false))
}
#[cfg(test)]
mod primary_display_tests;
