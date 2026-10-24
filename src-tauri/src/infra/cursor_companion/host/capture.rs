//! Display and focused-window captures for a companion turn.

use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{
    sync::{atomic::Ordering, Arc},
    time::Duration,
};
use tauri::{AppHandle, Manager, Webview};

use super::screens::{choose_primary, native_handle, person_works_in, window_name};
use super::{
    current, displays, host_state, on_main, platform, require_main, CursorCompanionState, PREFIX,
};

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
