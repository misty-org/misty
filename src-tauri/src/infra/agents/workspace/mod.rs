//! One process-wide coordinator for agent execution leases.
use serde_json::Value;
use std::{
    collections::{HashMap, VecDeque},
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{AppHandle, State, Webview};

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
    foreground_pending: HashMap<String, VecDeque<Value>>,
    leases: HashMap<String, Lease>,
    scopes: HashMap<String, Scope>,
    browser_session_id: Option<String>,
}
struct Lease {
    agent: String,
    account: String,
    window: String,
    expires: Instant,
    /// A hidden session of the agent's own (never on screen, no native input), which
    /// neither waits for nor blocks other tasks in the window.
    background: bool,
}
struct Scope {
    agent: String,
    account: String,
    window: String,
    task: String,
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
    let queue_key = format!("foreground:{}", webview.window().label());
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
    super::super::workspace_autopilot::renew(&task);
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
    if !request.background
        && inner.leases.iter().any(|(id, lease)| {
            id != &request.task_id
                && !lease.background
                && (lease.window == window
                    || lease.agent == request.agent_id && lease.account == request.account_id)
        })
    {
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
            // A hidden session's renewals come from a timer in the app window, which WebKit
            // throttles while the window is in the background; a longer lease keeps the
            // agent's tabs alive. Stop and the session's end still release it at once.
            expires: Instant::now()
                + Duration::from_secs(if request.background { 600 } else { 30 }),
            background: request.background,
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
    super::super::workspace_autopilot::stop(&task_id);
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
        super::super::browser::resume_task_downloads(
            &app,
            &scope_id,
            &scope.agent,
            &previous,
            &task_id,
        )?;
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

mod requests;
pub use requests::*;
mod authority;
pub(in crate::infra) use authority::stop_account_tasks;
pub use authority::{authorize_scope, authorize_window_task, task_window};

#[cfg(test)]
mod tests;
