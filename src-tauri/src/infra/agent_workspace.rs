//! One process-wide coordinator for personal agent windows and execution leases.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, VecDeque},
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, State, Webview, WebviewUrl, WebviewWindowBuilder};

// Development diagnostics contain only opaque authority IDs, never page or
// account content. Record native revocation separately from server renewals.
fn lease_diagnostic(reason: &str, task: &str, window: &str) {
    if cfg!(debug_assertions) {
        eprintln!("agent_native_lease reason={reason} task={task} window={window}");
    }
}

#[derive(Default)]
pub struct AgentWorkspaceState(Mutex<WorkspaceState>);
#[derive(Default)]
struct WorkspaceState {
    windows: HashMap<String, String>,
    pending: HashMap<String, VecDeque<Value>>,
    foreground_pending: HashMap<String, VecDeque<Value>>,
    leases: HashMap<String, Lease>,
    receipts: HashMap<String, WorkerReceipt>,
    scopes: HashMap<String, Scope>,
    browser_session_id: Option<String>,
}
struct WorkerReceipt {
    account: String,
    agent: String,
    window: String,
    result: Option<Value>,
}
struct Lease {
    agent: String,
    account: String,
    window: String,
    expires: Instant,
}
struct Scope {
    agent: String,
    account: String,
    window: String,
    task: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowRequest {
    account_id: String,
    agent_id: String,
    #[serde(default)]
    space_id: String,
    name: String,
    task: Value,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaseRequest {
    account_id: String,
    agent_id: String,
    #[serde(default)]
    space_id: String,
    task_id: String,
    #[serde(default)]
    renew: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaseResult {
    pub window_label: String,
    pub task_id: String,
}

#[tauri::command]
pub async fn agent_window_open(
    webview: Webview,
    app: AppHandle,
    state: State<'_, AgentWorkspaceState>,
    request: WindowRequest,
) -> Result<String, String> {
    if webview.label() != "main" {
        return Err("agent_window_requires_main".into());
    }
    let queue_id = request
        .task
        .get("queueId")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty() && id.len() <= 256)
        .ok_or("invalid_agent_task")?
        .to_owned();
    if !request.task.is_object()
        || request.task.get("accountId").and_then(Value::as_str)
            != Some(request.account_id.as_str())
        || request.task.get("agentId").and_then(Value::as_str) != Some(request.agent_id.as_str())
        || request.agent_id.is_empty()
        || request.account_id.is_empty()
        || request.account_id.len() > 256
        || request.agent_id.len() > 256
        || request.space_id.len() > 256
        || request.name.len() > 320
        || request.task.to_string().len() > 1_000_000
    {
        return Err("invalid_agent_task".into());
    }
    let key = format!("{}:{}", request.account_id, request.agent_id);
    let label = {
        let mut inner = state.0.lock().map_err(|_| "agent_workspace_unavailable")?;
        let existing = inner
            .windows
            .get(&key)
            .filter(|label| app.get_window(label).is_some())
            .cloned();
        let label = existing.unwrap_or_else(|| format!("misty-agent-{}", uuid::Uuid::new_v4()));
        if inner
            .pending
            .get(&key)
            .is_some_and(|queue| queue.len() >= 50)
        {
            return Err("agent_queue_full".into());
        }
        if let Some(receipt) = inner.receipts.get(&queue_id) {
            if receipt.account != request.account_id || receipt.agent != request.agent_id {
                return Err("agent_task_mismatch".into());
            }
            // Retrying a handoff can focus/reopen its worker but never enqueue it twice.
            if receipt.result.is_some() {
                return Ok(receipt.window.clone());
            }
        }
        if inner.receipts.len() >= 1000 && !inner.receipts.contains_key(&queue_id) {
            return Err(
                "agent_receipt_limit: restart Misty after reviewing completed tasks".into(),
            );
        }
        inner.receipts.insert(
            queue_id.clone(),
            WorkerReceipt {
                account: request.account_id.clone(),
                agent: request.agent_id.clone(),
                window: label.clone(),
                result: None,
            },
        );
        inner.windows.insert(key.clone(), label.clone());
        let queue = inner.pending.entry(key).or_default();
        if queue.len() >= 50 {
            return Err("agent_queue_full".into());
        }
        if !queue
            .iter()
            .any(|task| task.get("queueId").and_then(Value::as_str) == Some(queue_id.as_str()))
        {
            queue.push_back(request.task);
        }
        label
    };
    if app.get_window(&label).is_none() {
        let mut url = tauri::Url::parse("https://misty.local/").map_err(|e| e.to_string())?;
        url.query_pairs_mut()
            .append_pair("agent_worker", &request.agent_id)
            .append_pair("agent_account", &request.account_id);
        let path = format!("index.html?{}", url.query().unwrap_or_default());
        let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(path.into()))
            .title(format!("{} · Misty Agent", request.name))
            .inner_size(1100.0, 800.0)
            .min_inner_size(760.0, 560.0)
            .focused(false)
            // This renderer renews bounded task leases while the user works in
            // another window. WebKit must not suspend its heartbeat timers.
            .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
            .build()
            .map_err(|e| e.to_string())?;
        let closed_app = app.clone();
        let closed_label = label.clone();
        window.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                if let Ok(mut inner) = closed_app.state::<AgentWorkspaceState>().0.lock() {
                    inner.leases.retain(|task, lease| {
                        if lease.window == closed_label {
                            lease_diagnostic("window_destroyed", task, &lease.window);
                            false
                        } else {
                            true
                        }
                    });
                    // Keep revoked scope bindings: a closed worker must never fall back to legacy authority.
                }
            }
        });
    }
    app.emit_to(&label, "misty://agent-task-queued", ())
        .map_err(|e| e.to_string())?;
    Ok(label)
}

/// Explicit owner interaction only; task admission never steals focus.
#[tauri::command]
pub fn agent_window_show(
    webview: Webview,
    app: AppHandle,
    state: State<'_, AgentWorkspaceState>,
    account_id: String,
    agent_id: String,
) -> Result<(), String> {
    if webview.label() != "main" {
        return Err("agent_window_requires_main".into());
    }
    let label = {
        let inner = state.0.lock().map_err(|_| "agent_workspace_unavailable")?;
        owned_worker_window(&inner, &account_id, &agent_id)?
    };
    let window = app
        .get_window(&label)
        .ok_or("No agent window is open. Start a separate-window task first.")?;
    window.show().map_err(|e| e.to_string())?;
    window.unminimize().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}
fn owned_worker_window(
    inner: &WorkspaceState,
    account: &str,
    agent: &str,
) -> Result<String, String> {
    if account.is_empty() || agent.is_empty() || account.len() > 256 || agent.len() > 256 {
        return Err("invalid_agent_task".into());
    }
    inner
        .windows
        .get(&format!("{}:{}", account, agent))
        .cloned()
        .ok_or_else(|| "No agent window is open. Start a separate-window task first.".into())
}

#[tauri::command]
pub fn agent_window_take_task(
    webview: Webview,
    conversation_id: Option<String>,
    state: State<'_, AgentWorkspaceState>,
) -> Result<Option<Value>, String> {
    let inner = state.0.lock().map_err(|_| "agent_workspace_unavailable")?;
    let key = inner
        .windows
        .iter()
        .find(|(_, label)| label.as_str() == webview.label())
        .map(|(key, _)| key.clone());
    Ok(key.and_then(|key| {
        inner
            .pending
            .get(&key)
            .and_then(|q| match conversation_id.as_deref() {
                Some(id) => q
                    .iter()
                    .find(|v| v.get("conversationId").and_then(Value::as_str) == Some(id))
                    .cloned(),
                None => q.front().cloned(),
            })
    }))
}
#[tauri::command]
pub fn agent_window_ack_task(
    webview: Webview,
    state: State<'_, AgentWorkspaceState>,
    queue_id: String,
    result: Value,
) -> Result<(), String> {
    let mut inner = state.0.lock().map_err(|_| "agent_workspace_unavailable")?;
    acknowledge_worker(&mut inner, webview.label(), &queue_id, result)
}
fn acknowledge_worker(
    inner: &mut WorkspaceState,
    window: &str,
    queue_id: &str,
    result: Value,
) -> Result<(), String> {
    let receipt = inner
        .receipts
        .get_mut(queue_id)
        .ok_or("agent_task_missing")?;
    if receipt.window != window || !result.is_object() || result.to_string().len() > 4096 {
        return Err("agent_task_mismatch".into());
    }
    // Admission is immutable; a delayed acknowledgement cannot replace it.
    if receipt.result.is_none() {
        receipt.result = Some(result);
    }
    let key = format!("{}:{}", receipt.account, receipt.agent);
    if let Some(queue) = inner.pending.get_mut(&key) {
        acknowledge(queue, queue_id);
    }
    Ok(())
}
/// Main can observe an owned handoff and revoke its exact device lease immediately.
#[tauri::command]
pub fn agent_window_task_receipt(
    webview: Webview,
    app: AppHandle,
    state: State<'_, AgentWorkspaceState>,
    account_id: String,
    agent_id: String,
    queue_id: String,
    revoke: Option<bool>,
) -> Result<Option<Value>, String> {
    if webview.label() != "main" {
        return Err("agent_window_requires_main".into());
    }
    let mut inner = state.0.lock().map_err(|_| "agent_workspace_unavailable")?;
    let receipt = inner.receipts.get(&queue_id).ok_or("agent_task_missing")?;
    if receipt.account != account_id || receipt.agent != agent_id {
        return Err("agent_task_mismatch".into());
    }
    let result = receipt.result.clone();
    let label = receipt.window.clone();
    if revoke == Some(true) {
        // Also cancel a handoff that has not reached server admission yet.
        let key = format!("{}:{}", account_id, agent_id);
        if let Some(queue) = inner.pending.get_mut(&key) {
            acknowledge(queue, &queue_id);
        }
        if let Some(task) = result
            .as_ref()
            .and_then(|value| value.get("taskId"))
            .and_then(Value::as_str)
        {
            if inner
                .leases
                .get(task)
                .is_some_and(|lease| lease.window == label && lease.account == account_id)
            {
                lease_diagnostic("main_handoff_revoked", task, &label);
                inner.leases.remove(task);
                super::workspace_autopilot::stop(task);
            }
        }
        if result.is_none() {
            inner.receipts.get_mut(&queue_id).unwrap().result =
                Some(serde_json::json!({"error":"The queued task was stopped."}));
        }
        app.emit_to(&label, "misty://agent-task-stop", &queue_id)
            .map_err(|e| e.to_string())?;
    }
    Ok(result)
}

fn acknowledge(queue: &mut VecDeque<Value>, queue_id: &str) {
    if let Some(index) = queue
        .iter()
        .position(|v| v.get("queueId").and_then(Value::as_str) == Some(queue_id))
    {
        queue.remove(index);
    }
}
#[tauri::command]
pub fn agent_foreground_queue(
    webview: Webview,
    state: State<'_, AgentWorkspaceState>,
    task: Option<Value>,
    acknowledge_id: Option<String>,
) -> Result<Option<Value>, String> {
    let mut inner = state.0.lock().map_err(|_| "agent_workspace_unavailable")?;
    // Team queues follow the personal agent when a closed worker is reopened.
    let queue_key = inner
        .windows
        .iter()
        .find(|(_, label)| label.as_str() == webview.label())
        .map(|(key, _)| key.clone())
        .unwrap_or_else(|| format!("foreground:{}", webview.window().label()));
    let queue = inner.foreground_pending.entry(queue_key).or_default();
    if let Some(mut task) = task {
        if queue.len() >= 50 || !task.is_object() || task.to_string().len() > 1_000_000 {
            return Err("agent_queue_full_or_invalid".into());
        }
        task["queueId"] = Value::String(uuid::Uuid::new_v4().to_string());
        queue.push_back(task);
    }
    if let Some(id) = acknowledge_id {
        acknowledge(queue, &id);
    }
    Ok(queue.front().cloned())
}

#[tauri::command]
pub fn agent_workspace_acquire(
    webview: Webview,
    state: State<'_, AgentWorkspaceState>,
    request: LeaseRequest,
) -> Result<LeaseResult, String> {
    let mut inner = state.0.lock().map_err(|_| "agent_workspace_unavailable")?;
    let task = request.task_id.clone();
    let renewing = request.renew;
    let window = webview.window();
    let result = acquire_lease(&mut inner, window.label(), request).map_err(|error| {
        lease_diagnostic(&format!("acquire_failed:{error}"), &task, window.label());
        error
    })?;
    lease_diagnostic(
        if renewing { "renewed" } else { "acquired" },
        &task,
        window.label(),
    );
    drop(inner);
    super::workspace_autopilot::renew(&task);
    Ok(result)
}

fn acquire_lease(
    inner: &mut WorkspaceState,
    window: &str,
    request: LeaseRequest,
) -> Result<LeaseResult, String> {
    // A task belongs to an account, agent and window, independent of content.
    if [&request.account_id, &request.agent_id, &request.task_id]
        .iter()
        .any(|s| s.is_empty() || s.len() > 256)
        || request.space_id.len() > 256
    {
        return Err("invalid_agent_task".into());
    }
    let now = Instant::now();
    inner.leases.retain(|task, lease| {
        if lease.expires <= now {
            lease_diagnostic("expired_pruned", task, &lease.window);
            false
        } else {
            true
        }
    });
    let window = window.to_owned();
    if request.renew && !inner.leases.contains_key(&request.task_id) {
        return Err("agent_task_paused".into());
    }
    if inner.leases.iter().any(|(id, lease)| {
        id != &request.task_id
            && (lease.window == window
                || lease.agent == request.agent_id && lease.account == request.account_id)
    }) {
        return Err("agent_busy: this agent or window already has an active task".into());
    }
    if let Some(lease) = inner.leases.get(&request.task_id) {
        if lease.window != window
            || lease.agent != request.agent_id
            || lease.account != request.account_id
        {
            return Err("agent_task_mismatch".into());
        }
    }
    inner.leases.insert(
        request.task_id.clone(),
        Lease {
            agent: request.agent_id,
            account: request.account_id,
            window: window.clone(),
            expires: Instant::now() + Duration::from_secs(30),
        },
    );
    Ok(LeaseResult {
        window_label: window,
        task_id: request.task_id,
    })
}
#[tauri::command]
pub fn agent_workspace_release(
    webview: Webview,
    state: State<'_, AgentWorkspaceState>,
    task_id: String,
) -> Result<(), String> {
    let mut inner = state.0.lock().map_err(|_| "agent_workspace_unavailable")?;
    if inner
        .leases
        .get(&task_id)
        .is_some_and(|lease| lease.window != webview.window().label())
    {
        return Err("agent_task_mismatch".into());
    }
    lease_diagnostic("owner_released", &task_id, webview.window().label());
    inner.leases.remove(&task_id);
    drop(inner);
    super::workspace_autopilot::stop(&task_id);
    Ok(())
}
#[tauri::command]
pub fn agent_workspace_bind_scope(
    webview: Webview,
    app: AppHandle,
    state: State<'_, AgentWorkspaceState>,
    task_id: String,
    scope_id: String,
    previous_task_id: Option<String>,
) -> Result<(), String> {
    let mut inner = state.0.lock().map_err(|_| "agent_workspace_unavailable")?;
    let lease = inner
        .leases
        .get(&task_id)
        .filter(|lease| lease.window == webview.window().label() && lease.expires > Instant::now())
        .ok_or("agent_task_paused")?;
    let scope = Scope {
        agent: lease.agent.clone(),
        account: lease.account.clone(),
        window: lease.window.clone(),
        task: task_id.clone(),
    };
    if let Some(previous) = previous_task_id {
        let old = inner.scopes.get(&scope_id).ok_or("agent_task_mismatch")?;
        if old.task != previous
            || old.agent != scope.agent
            || old.account != scope.account
            || old.window != scope.window
        {
            return Err("agent_task_mismatch".into());
        }
        // Resume rotates execution authority, but verified files from the
        // paused task remain usable in its explicitly rebound browser scopes.
        super::browser::resume_task_downloads(&app, &scope_id, &scope.agent, &previous, &task_id)?;
    }
    inner.scopes.insert(scope_id, scope);
    Ok(())
}
#[tauri::command]
pub fn agent_browser_session_id(state: State<'_, AgentWorkspaceState>) -> Result<String, String> {
    let mut inner = state.0.lock().map_err(|_| "agent_workspace_unavailable")?;
    Ok(inner
        .browser_session_id
        .get_or_insert_with(|| uuid::Uuid::new_v4().to_string())
        .clone())
}

#[path = "agent_workspace_authority.rs"]
mod authority;
pub(super) use authority::stop_account_tasks;
pub use authority::{authorize_scope, authorize_window_task};

#[cfg(test)]
#[path = "agent_workspace_tests.rs"]
mod tests;
