use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct BackgroundTask {
    pub id: String,
    pub kind: String,
    pub agent: Option<String>,
    pub description: String,
    pub status: String,
}

#[derive(Clone, Debug)]
pub(crate) struct ListedTasks {
    pub pid: Option<u32>,
    pub tasks: Vec<BackgroundTask>,
}

static BACKGROUND_TASKS: std::sync::LazyLock<Mutex<HashMap<String, ListedTasks>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

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

pub(crate) fn background_tasks(session: &str) -> Option<ListedTasks> {
    BACKGROUND_TASKS.lock().ok()?.get(session).cloned()
}

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

        engine.parse_line(
            &changed(serde_json::json!([
                { "task_id": "a77", "task_type": "local_agent", "description": "Review the diff" },
            ])),
            &mut out,
        );
        let listed = background_tasks(session).expect("one task is left");
        assert_eq!(listed.tasks.len(), 1);
        assert_eq!(listed.tasks[0].status, "paused");

        engine.parse_line(&changed(serde_json::json!([])), &mut out);
        assert!(background_tasks(session).is_none());
    }
}
