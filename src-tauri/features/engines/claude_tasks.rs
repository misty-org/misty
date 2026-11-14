//! Claude Code's background tasks (shells, agents, monitors, …) per session, as its
//! `background_tasks_changed` and `task_updated` events report them, for `/tasks`.

use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;

/// One background task Claude Code started (a shell, an agent, a monitor, …), as its
/// `background_tasks_changed` event lists it, for `/tasks` (`slash/claude/tasks.rs`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct BackgroundTask {
    pub id: String,
    /// Claude Code's `task_type`: `local_bash`, `local_agent`, `monitor_mcp`, …
    pub kind: String,
    /// A `local_agent` task's agent type, such as `general-purpose`.
    pub agent: Option<String>,
    pub description: String,
    /// The last status a `task_updated` gave it; `running` until one does, since the list holds
    /// only live tasks.
    pub status: String,
}

/// A session's task list and the process that listed it. Claude Code's tasks live in the
/// process of the turn that started them and end with it, and a new process lists nothing until
/// its own first change, so a list is only current while that same process runs.
#[derive(Clone, Debug)]
pub(crate) struct ListedTasks {
    /// The registry's pid for the session when the list came; None when none was registered.
    pub pid: Option<u32>,
    pub tasks: Vec<BackgroundTask>,
}

static BACKGROUND_TASKS: std::sync::LazyLock<Mutex<HashMap<String, ListedTasks>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

/// The tasks of a `background_tasks_changed` event, which lists every live one each time.
fn background_tasks_in(value: &Value) -> Vec<BackgroundTask> {
    let text = |item: &Value, key: &str| {
        item.get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(str::to_string)
    };
    value
        .get("tasks")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    Some(BackgroundTask {
                        id: text(item, "task_id")?,
                        kind: text(item, "task_type").unwrap_or_default(),
                        agent: text(item, "subagent_type"),
                        description: text(item, "description").unwrap_or_default(),
                        status: "running".into(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Keeps a session's new task list, with the status each task already had.
pub(super) fn record_background_tasks(value: &Value) {
    let Some(session) = value.get("session_id").and_then(Value::as_str) else {
        return;
    };
    let pid = crate::engines::support::state()
        .and_then(|state| state.processes.get(session))
        .map(|entry| entry.pid);
    let mut tasks = background_tasks_in(value);
    let Ok(mut map) = BACKGROUND_TASKS.lock() else {
        return;
    };
    if let Some(before) = map.get(session).filter(|listed| listed.pid == pid) {
        for task in &mut tasks {
            if let Some(known) = before.tasks.iter().find(|known| known.id == task.id) {
                task.status = known.status.clone();
            }
        }
    }
    if tasks.is_empty() {
        map.remove(session);
    } else {
        map.insert(session.to_string(), ListedTasks { pid, tasks });
    }
}

/// A `task_updated` patch's status, on the task it names.
pub(super) fn record_task_update(value: &Value) {
    let (Some(session), Some(id), Some(status)) = (
        value.get("session_id").and_then(Value::as_str),
        value.get("task_id").and_then(Value::as_str),
        value.pointer("/patch/status").and_then(Value::as_str),
    ) else {
        return;
    };
    if let Ok(mut map) = BACKGROUND_TASKS.lock() {
        if let Some(task) = map
            .get_mut(session)
            .and_then(|listed| listed.tasks.iter_mut().find(|task| task.id == id))
        {
            task.status = status.to_string();
        }
    }
}

/// The task list last seen for `session`, if it had any.
pub(crate) fn background_tasks(session: &str) -> Option<ListedTasks> {
    BACKGROUND_TASKS.lock().ok()?.get(session).cloned()
}

/// Forgets a session's list once its process is gone.
pub(crate) fn forget_background_tasks(session: &str) {
    if let Ok(mut map) = BACKGROUND_TASKS.lock() {
        map.remove(session);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engines::claude::ClaudeEngine;
    use crate::engines::{Engine, EngineEvent};

    #[test]
    fn background_task_list_is_kept_per_session_with_its_status() {
        let engine = ClaudeEngine::new();
        let session = "tasks-test-session";
        let changed = |tasks: Value| {
            serde_json::json!({
                "type": "system", "subtype": "background_tasks_changed",
                "tasks": tasks, "uuid": "u-1", "session_id": session,
            })
            .to_string()
        };
        let mut out = Vec::new();
        engine.parse_line(
            &changed(serde_json::json!([
                { "task_id": "b1a2c3d4e", "task_type": "local_bash", "description": "npm run dev" },
                { "task_id": "a77", "run_id": "r-1", "task_type": "local_agent",
                  "subagent_type": "general-purpose", "description": "Review the diff" },
                { "task_type": "local_bash", "description": "no id, skipped" },
            ])),
            &mut out,
        );
        assert!(matches!(
            out.as_slice(),
            [
                EngineEvent::SessionId(_),
                EngineEvent::BackgroundTasks { pending: 3 }
            ] | [EngineEvent::BackgroundTasks { pending: 3 }]
        ));
        engine.parse_line(
            &serde_json::json!({
                "type": "system", "subtype": "task_updated", "task_id": "a77",
                "patch": { "status": "paused" }, "uuid": "u-2", "session_id": session,
            })
            .to_string(),
            &mut out,
        );
        let listed = background_tasks(session).expect("the list is kept");
        assert_eq!(
            listed.tasks,
            vec![
                BackgroundTask {
                    id: "b1a2c3d4e".into(),
                    kind: "local_bash".into(),
                    agent: None,
                    description: "npm run dev".into(),
                    status: "running".into(),
                },
                BackgroundTask {
                    id: "a77".into(),
                    kind: "local_agent".into(),
                    agent: Some("general-purpose".into()),
                    description: "Review the diff".into(),
                    status: "paused".into(),
                },
            ]
        );

        // A new list replaces the old one and keeps what a task's status already was.
        engine.parse_line(
            &changed(serde_json::json!([
                { "task_id": "a77", "task_type": "local_agent", "description": "Review the diff" },
            ])),
            &mut out,
        );
        let listed = background_tasks(session).expect("one task is left");
        assert_eq!(listed.tasks.len(), 1);
        assert_eq!(listed.tasks[0].status, "paused");

        // An empty list forgets the session.
        engine.parse_line(&changed(serde_json::json!([])), &mut out);
        assert!(background_tasks(session).is_none());
    }
}
