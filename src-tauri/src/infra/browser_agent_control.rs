//! Per-device-job execution controls. Dropping a dispatched webview operation
//! cannot undo a website effect; interruption therefore reports uncertainty.
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::Value;
use std::{collections::HashMap, sync::{Arc, Mutex}, time::{Duration, Instant}};
use tauri::{AppHandle, Manager, State};
use tokio::sync::Notify;
use super::browser::{browser_agent_execute, revoke_execution_grant, BrowserAgentExecuteRequest, BrowserSessionState};

#[derive(Default)]
pub struct BrowserExecutionState(Mutex<HashMap<String, Arc<Control>>>);
struct Control {
    deadline: Instant,
    scope: String,
    grant: String,
    inner: Mutex<ControlInner>,
    changed: Notify,
}
struct ControlInner { lease: Instant, stopped: bool, started: bool }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionControlRequest {
    execution_id: String,
    deadline_at: String,
    lease_expires_at: String,
    scope_id: String,
    grant_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoundedBrowserRequest {
    control: ExecutionControlRequest,
    operation: BrowserAgentExecuteRequest,
}
fn instant(value: &str) -> Result<Instant, String> {
    let date = DateTime::parse_from_rfc3339(value).map_err(|_| "invalid_device_deadline")?.with_timezone(&Utc);
    let left = (date - Utc::now()).to_std().map_err(|_| "device_execution_expired")?;
    if left > Duration::from_secs(301) { return Err("invalid_device_deadline".into()); }
    Ok(Instant::now() + left)
}
fn control(state: &BrowserExecutionState, request: &ExecutionControlRequest, create: bool) -> Result<Arc<Control>, String> {
    if request.execution_id.is_empty() || request.execution_id.len()>200 || request.scope_id.is_empty() || request.grant_id.is_empty() {
        return Err("invalid_device_execution".into());
    }
    let deadline = instant(&request.deadline_at)?;
    let lease = instant(&request.lease_expires_at)?.min(deadline);
    let mut entries = state.0.lock().map_err(|_| "device_control_unavailable")?;
    entries.retain(|_, entry| entry.deadline > Instant::now());
    if let Some(entry) = entries.get(&request.execution_id) {
        if entry.scope != request.scope_id || entry.grant != request.grant_id { return Err("device_execution_mismatch".into()); }
        return Ok(entry.clone());
    }
    if !create { return Err("device_execution_missing".into()); }
    if entries.len() >= 4096 { return Err("device_execution_capacity".into()); }
    let entry = Arc::new(Control { deadline, scope: request.scope_id.clone(), grant: request.grant_id.clone(), inner: Mutex::new(ControlInner {lease, stopped:false, started:false}), changed: Notify::new() });
    entries.insert(request.execution_id.clone(),entry.clone());
    Ok(entry)
}
#[tauri::command]
pub fn browser_agent_execution_cancel(state: State<'_,BrowserExecutionState>, browser: State<'_,BrowserSessionState>, request: ExecutionControlRequest) -> Result<(),String> {
    // Record a tombstone even if cancellation overtakes the execute invocation.
    // A past lease must not prevent stopping work within its immutable deadline.
    let mut request = request;
    request.lease_expires_at = request.deadline_at.clone();
    let entry = control(&state,&request,true)?;
    entry.inner.lock().map_err(|_| "device_control_unavailable")?.stopped = true;
    entry.changed.notify_one();
    revoke_execution_grant(&browser,&entry.scope,&entry.grant)
}
#[tauri::command]
pub fn browser_agent_execution_renew(state: State<'_,BrowserExecutionState>, request: ExecutionControlRequest) -> Result<(),String> {
    let entry = control(&state,&request,false)?;
    let next = instant(&request.lease_expires_at)?.min(entry.deadline);
    let mut inner = entry.inner.lock().map_err(|_| "device_control_unavailable")?;
    if inner.stopped || inner.lease <= Instant::now() { return Err("device_execution_stopped".into()); }
    inner.lease = inner.lease.max(next);
    entry.changed.notify_one();
    Ok(())
}
#[tauri::command]
pub async fn browser_agent_execute_bounded(app: AppHandle, state: State<'_,BrowserExecutionState>, request: BoundedBrowserRequest) -> Result<Value,String> {
    if request.operation.scope_id != request.control.scope_id || request.operation.grant_id != request.control.grant_id { return Err("device_execution_mismatch".into()); }
    let entry = control(&state,&request.control,true)?;
    {
        let mut inner = entry.inner.lock().map_err(|_| "device_control_unavailable")?;
        if inner.started || inner.stopped || inner.lease <= Instant::now() { return Err("device_execution_stopped".into()); }
        inner.started = true;
    }
    let browser = app.state::<BrowserSessionState>();
    let operation = browser_agent_execute(app.clone(),browser.clone(),request.operation);
    tokio::pin!(operation);
    let result = loop {
        let expiry = {
            let inner = entry.inner.lock().map_err(|_| "device_control_unavailable")?;
            if inner.stopped { break Err("device_execution_uncertain".into()); }
            inner.lease.min(entry.deadline)
        };
        if expiry <= Instant::now() { break Err("device_execution_uncertain".into()); }
        tokio::select! {
            biased;
            _ = entry.changed.notified() => continue,
            _ = tokio::time::sleep_until(expiry.into()) => continue,
            value = &mut operation => break value,
        }
    };
    if let Ok(mut inner) = entry.inner.lock() { inner.stopped = true; }
    let _ = revoke_execution_grant(&browser,&entry.scope,&entry.grant);
    result
}
