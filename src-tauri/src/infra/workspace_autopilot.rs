//! Foreground, task-bound whole-window control. No authority survives Stop or Space changes.
use serde_json::{json, Value};
use std::{sync::{Mutex, OnceLock}, time::{Duration, Instant}};
use tauri::{AppHandle, Manager, Webview};
use super::browser::BrowserAgentExecuteRequest;

#[derive(Default)]
struct Session { task: String, context: Value, snapshot: Option<Snapshot> }
struct Snapshot { id: String, captured: Instant, geometry: Value }
static SESSION: OnceLock<Mutex<Session>> = OnceLock::new();
fn session() -> &'static Mutex<Session> { SESSION.get_or_init(Mutex::default) }
#[cfg(target_os="macos")]
extern "C" {
    fn misty_autopilot_supported() -> bool;
    fn misty_autopilot_capture() -> *mut std::ffi::c_char;
    fn misty_autopilot_action(input: *const std::ffi::c_char) -> *mut std::ffi::c_char;
    fn misty_autopilot_hide_cursor();
    fn misty_autopilot_focus_reason() -> *mut std::ffi::c_char;
}
#[cfg(target_os="macos")]
unsafe fn decode(pointer: *mut std::ffi::c_char) -> Result<Value,String> {
    if pointer.is_null() { return Err("Misty window control is unavailable".into()); }
    let result=serde_json::from_slice(std::ffi::CStr::from_ptr(pointer).to_bytes()).map_err(|e|e.to_string());
    libc::free(pointer.cast());
    let value:Value=result?;
    if let Some(error)=value["error"].as_str() { return Err(error.into()); }
    Ok(value)
}
#[tauri::command]
pub fn agent_workspace_context(app:AppHandle, webview:Webview, task_id:String, context:Value, start:bool) -> Result<(),String> {
    #[cfg(target_os="macos")]
    if !unsafe { misty_autopilot_supported() } { return Err("Misty window control requires macOS 14.4 or later".into()); }
    #[cfg(not(target_os="macos"))]
    return Err("Misty window control requires macOS 14.4 or later".into());
    if webview.label()!="main" || context.to_string().len()>32000 { return Err("Invalid workspace context".into()); }
    super::agent_workspace::authorize_window_task(&app,&task_id,context["accountId"].as_str().unwrap_or(""),context["spaceId"].as_str().unwrap_or(""))?;
    let mut state=session().lock().map_err(|_|"workspace_unavailable")?;
    if start { *state=Session{task:task_id,context,snapshot:None}; }
    else {
        if state.task!=task_id { return Err("agent_task_paused".into()); }
        if state.context!=context { state.snapshot=None; }
        state.context=context;
    }
    Ok(())
}
pub fn stop(task:&str) {
    if let Ok(mut state)=session().lock() { if state.task==task { *state=Session::default(); } else { return; } }
    #[cfg(target_os="macos")]
    unsafe { misty_autopilot_hide_cursor(); }
}
fn authorize(app:&AppHandle,request:&BrowserAgentExecuteRequest) -> Result<Value,String> {
    let task=request.input["__mistyTaskId"].as_str().unwrap_or("");
    let state=session().lock().map_err(|_|"workspace_unavailable")?;
    if task.is_empty() || state.task!=task { return Err("Start Agent mode to allow Misty window control".into()); }
    super::agent_workspace::authorize_window_task(app,task,state.context["accountId"].as_str().unwrap_or(""),state.context["spaceId"].as_str().unwrap_or(""))?;
    super::agent_workspace::authorize_scope(app,&request.scope_id,&request.agent_id,task)?;
    let window=app.get_window("main").ok_or("Misty window closed")?;
    if !window.is_focused().unwrap_or(false) {
        #[cfg(target_os="macos")]
        return unsafe { decode(misty_autopilot_focus_reason()) };
        #[cfg(not(target_os="macos"))]
        return Err("Bring Misty to the front, then resume the agent".into());
    }
    Ok(state.context.clone())
}
pub async fn execute(app:&AppHandle,request:&BrowserAgentExecuteRequest) -> Result<Value,String> {
    let context=authorize(app,request)?;
    #[cfg(not(target_os="macos"))]
    { let _=context; return Err("Misty window control requires macOS 14 or later".into()); }
    #[cfg(target_os="macos")]
    match request.operation.as_str() {
        "browser.workspace.visual" => {
            let mut capture=tauri::async_runtime::spawn_blocking(|| unsafe { decode(misty_autopilot_capture()) }).await.map_err(|e|e.to_string())??;
            let latest=authorize(app,request)?;
            if context!=latest { return Err("browser_snapshot_stale: workspace changed while capturing".into()); }
            let id=uuid::Uuid::new_v4().to_string();
            let image=capture.as_object_mut().ok_or("Invalid capture")?.remove("image").ok_or("Missing image")?;
            session().lock().map_err(|_|"workspace_unavailable")?.snapshot=Some(Snapshot{id:id.clone(),captured:Instant::now(),geometry:capture});
            Ok(json!({"documentId":id,"url":"misty://workspace","title":"Misty workspace","context":context,"image":image,"interactive":[],"contentTrust":"untrusted-screen-content","text":"Full Misty window. Choose normalized coordinates from this image. The workspace controls and embedded apps are visible. Observe after every action. Do not interact with agent mode, permissions, Stop, or account/Space switching controls."}))
        }
        "browser.workspace.interact" => {
            let action=request.input.get("action").ok_or("Missing action")?.clone();
            validate_action(&action)?;
            let document=request.input["documentId"].as_str().ok_or("Inspect the window first")?.to_owned();
            let app=app.clone();
            let scope=request.scope_id.clone(); let agent=request.agent_id.clone(); let grant=request.grant_id.clone();
            let task=request.input["__mistyTaskId"].as_str().unwrap_or("").to_owned();
            let (send,receive)=tokio::sync::oneshot::channel();
            let main=app.clone();
            app.run_on_main_thread(move || {
                let result=(|| {
                    // Recheck inside the dispatch closure: a queued action must not outlive Stop.
                    super::browser::authorize_workspace_dispatch(&main,&scope,&agent,&grant,&task)?;
                    let mut state=session().lock().map_err(|_|"workspace_unavailable")?;
                    if state.task!=task { return Err("agent_task_paused".into()); }
                    let snapshot=state.snapshot.take().ok_or("browser_snapshot_stale: inspect before acting")?;
                    if snapshot.id!=document || snapshot.captured.elapsed()>Duration::from_secs(90) { return Err("browser_snapshot_stale: inspect before acting".into()); }
                    let mut input=snapshot.geometry; input["action"]=action;
                    // Release state before native events invoke the app's event handlers.
                    drop(state);
                    let encoded=std::ffi::CString::new(input.to_string()).map_err(|e|e.to_string())?;
                    unsafe { decode(misty_autopilot_action(encoded.as_ptr())) }
                })();
                let _=send.send(result);
            }).map_err(|e|e.to_string())?;
            receive.await.map_err(|e|e.to_string())?
        }
        _=>Err("Unsupported workspace operation".into())
    }
}
fn validate_action(action:&Value)->Result<(),String> {
    let coordinate=|key:&str|action[key].as_f64().is_some_and(|v|v.is_finite() && (0.0..=1.0).contains(&v));
    let valid=match action["kind"].as_str().unwrap_or("") {
        "point"=>coordinate("x")&&coordinate("y"),
        "scroll"=>coordinate("x")&&coordinate("y")&&["deltaX","deltaY"].iter().all(|key| action[*key].as_i64().is_some_and(|v|(-2000..=2000).contains(&v))),
        "type"=>action["text"].as_str().is_some_and(|v|v.len()<=16000),
        "key"=>action["key"].as_str().is_some_and(|v|matches!(v,"Enter"|"Escape"|"Tab"|"Backspace"|"ArrowLeft"|"ArrowRight"|"ArrowUp"|"ArrowDown"|"SelectAll"|"Undo")),
        _=>false
    };
    if valid { Ok(()) } else { Err("Invalid workspace action".into()) }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn bounds_and_supported_input_are_enforced() {
        for action in [json!({"kind":"point","x":0.2,"y":0.6}),json!({"kind":"key","key":"SelectAll"}),json!({"kind":"type","text":"pilot"})] { assert!(validate_action(&action).is_ok()); }
        for action in [json!({"kind":"point","x":2,"y":0.6}),json!({"kind":"key","key":"RunShell"}),json!({"kind":"scroll","x":0.5,"y":0.5,"deltaX":0,"deltaY":2001})] { assert!(validate_action(&action).is_err()); }
    }
}
