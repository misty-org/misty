//! Checks at native boundaries that an agent task still holds its authority.
use super::{AgentWorkspaceState, WorkspaceState};
use std::time::Instant;
use tauri::{AppHandle, Manager};

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
pub(super) fn authorize_scope_state(
    inner: &WorkspaceState,
    scope_id: &str,
    agent_id: &str,
    task_id: &str,
) -> Result<(), String> {
    if let Some(scope) = inner.scopes.get(scope_id) {
        if scope.task != task_id {
            return Err("agent_task_paused:scope_task_mismatch".into());
        }
        if scope.agent != agent_id {
            return Err("agent_task_paused:scope_agent_mismatch".into());
        }
        let lease = inner
            .leases
            .get(&scope.task)
            .ok_or("agent_task_paused:native_lease_missing")?;
        if lease.window != scope.window
            || lease.agent != scope.agent
            || lease.account != scope.account
        {
            return Err("agent_task_paused:native_lease_owner_mismatch".into());
        }
        if lease.expires <= Instant::now() {
            return Err("agent_task_paused:native_lease_expired".into());
        }
    }
    Ok(())
}

// Keep scope tombstones when changing accounts: removing them would enable the
// legacy unbound-scope fallback for an action already in flight.
pub(super) fn invalidate_account_leases(inner: &mut WorkspaceState) -> Vec<String> {
    inner.pending.clear();
    inner.foreground_pending.clear();
    inner.receipts.clear();
    inner.leases.drain().map(|(task, _)| task).collect()
}

pub(in crate::infra) fn stop_account_tasks(app: &AppHandle) -> Result<(), String> {
    #[cfg(any(target_os = "macos", windows))]
    crate::infra::cursor_companion::stop(app);
    let Some(state) = app.try_state::<AgentWorkspaceState>() else {
        return Ok(());
    };
    let tasks = {
        let mut inner = state.0.lock().map_err(|_| "agent_workspace_unavailable")?;
        invalidate_account_leases(&mut inner)
    };
    for task in tasks {
        crate::infra::workspace_autopilot::stop(&task);
    }
    Ok(())
}

/// Full-window control always requires a live foreground lease; no legacy fallback.
pub fn authorize_window_task(
    app: &AppHandle,
    task: &str,
    account: &str,
    _legacy_space: &str,
) -> Result<(), String> {
    let state = app.state::<AgentWorkspaceState>();
    let inner = state.0.lock().map_err(|_| "agent_workspace_unavailable")?;
    if inner.leases.get(task).is_some_and(|lease| {
        lease.window == "main" && lease.account == account && lease.expires > Instant::now()
    }) {
        Ok(())
    } else {
        Err("agent_task_paused".into())
    }
}
