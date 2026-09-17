//! One process-wide coordinator for personal agent windows and execution leases.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, VecDeque},
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, State, Webview, WebviewUrl, WebviewWindowBuilder};

#[derive(Default)]
pub struct AgentWorkspaceState(Mutex<WorkspaceState>);
#[derive(Default)]
struct WorkspaceState {
    windows: HashMap<String, String>,
    pending: HashMap<String, VecDeque<Value>>,
    foreground_pending: HashMap<String, VecDeque<Value>>,
    leases: HashMap<String, Lease>,
    scopes: HashMap<String, Scope>,
    browser_session_id: Option<String>,
}
struct Lease {
    agent: String,
    account: String,
    space: String,
    window: String,
    expires: Instant,
}
struct Scope {
    agent: String,
    window: String,
    task: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowRequest {
    account_id: String,
    agent_id: String,
    space_id: String,
    name: String,
    task: Value,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaseRequest {
    account_id: String,
    agent_id: String,
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
    app: AppHandle,
    state: State<'_, AgentWorkspaceState>,
    mut request: WindowRequest,
) -> Result<String, String> {
    if request.agent_id.is_empty()
        || request.account_id.is_empty()
        || request.space_id.is_empty()
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
            .filter(|label| app.get_webview_window(label).is_some())
            .cloned();
        let label = existing.unwrap_or_else(|| format!("misty-agent-{}", uuid::Uuid::new_v4()));
        inner.windows.insert(key.clone(), label.clone());
        let queue = inner.pending.entry(key).or_default();
        if queue.len() >= 50 {
            return Err("agent_queue_full".into());
        }
        request.task["queueId"] = Value::String(uuid::Uuid::new_v4().to_string());
        queue.push_back(request.task);
        label
    };
    if app.get_webview_window(&label).is_none() {
        let mut url = tauri::Url::parse("https://misty.local/").map_err(|e| e.to_string())?;
        url.query_pairs_mut()
            .append_pair("agent_worker", &request.agent_id)
            .append_pair("agent_space", &request.space_id)
            .append_pair("agent_account", &request.account_id);
        let path = format!("index.html?{}", url.query().unwrap_or_default());
        let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(path.into()))
            .title(format!("{} · Misty Agent", request.name))
            .inner_size(1100.0, 800.0)
            .min_inner_size(760.0, 560.0)
            .focused(false)
            .build()
            .map_err(|e| e.to_string())?;
        let closed_app = app.clone();
        let closed_label = label.clone();
        window.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                if let Ok(mut inner) = closed_app.state::<AgentWorkspaceState>().0.lock() {
                    inner.leases.retain(|_, lease| lease.window != closed_label);
                    // Keep revoked scope bindings: a closed worker must never fall back to legacy authority.
                }
            }
        });
    }
    app.emit_to(&label, "misty://agent-task-queued", ())
        .map_err(|e| e.to_string())?;
    Ok(label)
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
        .find(|(_, label)| label.as_str() == webview.window().label())
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
) -> Result<(), String> {
    let mut inner = state.0.lock().map_err(|_| "agent_workspace_unavailable")?;
    let key = inner
        .windows
        .iter()
        .find(|(_, label)| label.as_str() == webview.window().label())
        .map(|(key, _)| key.clone());
    if let Some(key) = key {
        if let Some(queue) = inner.pending.get_mut(&key) {
            acknowledge(queue, &queue_id);
        }
    }
    Ok(())
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
        .find(|(_, label)| label.as_str() == webview.window().label())
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
    if [
        &request.account_id,
        &request.agent_id,
        &request.space_id,
        &request.task_id,
    ]
    .iter()
    .any(|s| s.is_empty() || s.len() > 256)
    {
        return Err("invalid_agent_task".into());
    }
    let mut inner = state.0.lock().map_err(|_| "agent_workspace_unavailable")?;
    inner
        .leases
        .retain(|_, lease| lease.expires > Instant::now());
    let window = webview.window().label().to_owned();
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
            || lease.space != request.space_id
        {
            return Err("agent_task_mismatch".into());
        }
    }
    inner.leases.insert(
        request.task_id.clone(),
        Lease {
            agent: request.agent_id,
            account: request.account_id,
            space: request.space_id,
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
    inner.leases.remove(&task_id);
    Ok(())
}
#[tauri::command]
pub fn agent_workspace_bind_scope(
    webview: Webview,
    state: State<'_, AgentWorkspaceState>,
    task_id: String,
    scope_id: String,
) -> Result<(), String> {
    let mut inner = state.0.lock().map_err(|_| "agent_workspace_unavailable")?;
    let lease = inner
        .leases
        .get(&task_id)
        .filter(|lease| lease.window == webview.window().label() && lease.expires > Instant::now())
        .ok_or("agent_task_paused")?;
    let scope = Scope {
        agent: lease.agent.clone(),
        window: lease.window.clone(),
        task: task_id.clone(),
    };
    inner.scopes.insert(scope_id, scope);
    Ok(())
}
/// Check at the last native boundary, including after renderer loss or device sleep.
pub fn authorize_scope(
    app: &AppHandle,
    scope_id: &str,
    agent_id: &str,
    task_id: &str,
) -> Result<(), String> {
    let state = app.state::<AgentWorkspaceState>();
    let inner = state.0.lock().map_err(|_| "agent_workspace_unavailable")?;
    authorize_scope_state(&inner, scope_id, agent_id, task_id)
}
fn authorize_scope_state(
    inner: &WorkspaceState,
    scope_id: &str,
    agent_id: &str,
    task_id: &str,
) -> Result<(), String> {
    if let Some(scope) = inner.scopes.get(scope_id) {
        if scope.task != task_id
            || scope.agent != agent_id
            || !inner.leases.get(&scope.task).is_some_and(|lease| {
                lease.window == scope.window
                    && lease.agent == scope.agent
                    && lease.expires > Instant::now()
            })
        {
            return Err("agent_task_paused".into());
        }
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> WorkspaceState {
        let mut state = WorkspaceState::default();
        state.leases.insert(
            "task-one".into(),
            Lease {
                account: "owner".into(),
                agent: "one".into(),
                space: "launch".into(),
                window: "worker-one".into(),
                expires: Instant::now() + Duration::from_secs(20),
            },
        );
        state.leases.insert(
            "task-two".into(),
            Lease {
                account: "owner".into(),
                agent: "two".into(),
                space: "launch".into(),
                window: "worker-two".into(),
                expires: Instant::now() + Duration::from_secs(20),
            },
        );
        state.scopes.insert(
            "notion".into(),
            Scope {
                agent: "one".into(),
                window: "worker-one".into(),
                task: "task-one".into(),
            },
        );
        state.scopes.insert(
            "instagram".into(),
            Scope {
                agent: "two".into(),
                window: "worker-two".into(),
                task: "task-two".into(),
            },
        );
        state
    }
    #[test]
    fn acknowledging_a_correction_preserves_independent_queued_tasks() {
        let mut queue = VecDeque::from([
            serde_json::json!({"queueId":"independent"}),
            serde_json::json!({"queueId":"correction"}),
        ]);
        acknowledge(&mut queue, "unknown");
        assert_eq!(queue.len(), 2);
        acknowledge(&mut queue, "correction");
        assert_eq!(queue.len(), 1);
        assert_eq!(queue.front().unwrap()["queueId"], "independent");
    }
    #[test]
    fn parallel_windows_cannot_exchange_authority() {
        let state = fixture();
        assert!(authorize_scope_state(&state, "notion", "one", "task-one").is_ok());
        assert!(authorize_scope_state(&state, "instagram", "two", "task-two").is_ok());
        assert!(authorize_scope_state(&state, "notion", "two", "task-two").is_err());
        assert!(authorize_scope_state(&state, "notion", "one", "task-two").is_err());
    }
    #[test]
    fn cancellation_and_expiry_do_not_fall_back_to_legacy_scope_authority() {
        let mut state = fixture();
        state.leases.remove("task-one");
        assert!(authorize_scope_state(&state, "notion", "one", "task-one").is_err());
        state.leases.get_mut("task-two").unwrap().expires = Instant::now() - Duration::from_secs(1);
        assert!(authorize_scope_state(&state, "instagram", "two", "task-two").is_err());
    }
    #[test]
    fn a_rebound_scope_rejects_pending_actions_from_the_prior_request() {
        let mut state = fixture();
        state.scopes.get_mut("notion").unwrap().task = "replacement".into();
        assert!(authorize_scope_state(&state, "notion", "one", "task-one").is_err());
    }
}
