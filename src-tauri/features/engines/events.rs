// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/events.rs.
//! Engine event types and tool-call/todo payload parsing shared by every
//! engine adapter (claude, kimi, codex, omp, ...).

use super::plan_review::PlanReview;
use serde::Serialize;
use serde_json::Value;

#[derive(Debug)]
pub enum EngineEvent {
    Delta(String),
    Thinking(String),
    Message {
        role: String,
        text: String,
        path: Option<String>,
        todos: Option<TodosPayload>,
        args: Option<Value>,
        result: Option<Value>,
        patch: bool,
        tool_call_id: Option<String>,
    },
    SessionId(String),
    Usage(Value),
    Generation {
        active: bool,
    },
    Error(String),
    Warn(String),
    AttemptEnd {
        error: Option<String>,
    },
    Retry {
        attempt: u64,
        max: u64,
        message: String,
    },
    PermissionDenied {
        tool: Option<String>,
        path: Option<String>,
        message: String,
        tool_use_id: Option<String>,
    },
    Question {
        request_id: String,
        tool_use_id: Option<String>,
        input: Value,
    },
    QuestionSettled {
        request_id: String,
    },
    PlanDraft {
        plan_id: String,
        text: String,
        replace: bool,
    },
    PlanReviewReady {
        record: Box<PlanReview>,
        context: Value,
    },
    PlanReviewSettled {
        plan_id: String,
        revision: i64,
        status: String,
    },
    Compaction {
        active: bool,
        reason: Option<String>,
    },
    AgentSettled,
    ControlPermission {
        request_id: String,
        tool_name: String,
        input: Value,
    },
    ElicitationDecline {
        request_id: String,
    },
    ControlRequestError {
        request_id: String,
        subtype: String,
    },
    Done {
        session_id: Option<String>,
        usage: Option<Value>,
    },
    Model(String),
    Effort(String),
    Launch {
        comparison_model: Option<Option<String>>,
        model: Option<String>,
        effort: Option<String>,
        reports_served: bool,
    },
    Served {
        model: Option<String>,
        effort: Option<String>,
    },
    SessionTitle(String),
    SessionMode(String),
    SessionChoice {
        model: Option<String>,
        effort: Option<String>,
    },
    McpServers {
        servers: Vec<(String, Option<String>)>,
        tools: Vec<String>,
    },
    Scope {
        parent: Option<String>,
    },
    BackgroundTasks {
        pending: usize,
    },
}
#[derive(Debug, Clone, Serialize)]
pub struct TodoItem {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub content: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl TodoItem {
    pub fn new(content: impl Into<String>, status: impl Into<String>) -> Self {
        Self {
            id: None,
            content: content.into(),
            status: status.into(),
            phase: None,
            reason: None,
            detail: None,
        }
    }
}
#[derive(Debug, Clone, Serialize)]
pub struct TodosPayload {
    pub items: Vec<TodoItem>,
    pub replace: bool,
}
fn todo_status(raw: Option<&str>) -> &'static str {
    match raw.unwrap_or("") {
        "in_progress" | "running" | "active" => "active",
        "completed" | "complete" | "done" => "complete",
        "blocked" => "blocked",
        "dropped" | "cancelled" | "abandoned" | "deleted" => "dropped",
        _ => "pending",
    }
}
pub(crate) fn parse_tool_args_value(value: &Value) -> Option<Value> {
    match value {
        Value::Null => None,
        Value::Object(map) if map.is_empty() => None,
        Value::Array(items) if items.is_empty() => None,
        Value::String(s) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                return None;
            }
            match serde_json::from_str::<Value>(trimmed) {
                Ok(parsed) => parse_tool_args_value(&parsed)
                    .or_else(|| Some(Value::String(trimmed.to_string()))),
                Err(_) => Some(Value::String(trimmed.to_string())),
            }
        }
        other => Some(other.clone()),
    }
}
fn tool_call_identity(id: Option<&str>) -> Option<String> {
    id.map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
}
pub(crate) fn tool_call_message(name: impl Into<String>, args: Option<&Value>) -> EngineEvent {
    tool_call_message_with_id(name, args, None)
}
pub(crate) fn tool_call_message_with_id(
    name: impl Into<String>,
    args: Option<&Value>,
    tool_call_id: Option<&str>,
) -> EngineEvent {
    let name = name.into();
    let args = args.and_then(parse_tool_args_value);
    let todos = args.as_ref().and_then(parse_todo_args);
    EngineEvent::Message {
        role: "tool".to_string(),
        text: name,
        path: args.as_ref().and_then(tool_path_arg),
        todos,
        args,
        result: None,
        patch: false,
        tool_call_id: tool_call_identity(tool_call_id),
    }
}
pub(crate) fn tool_call_patch_with_id(
    name: impl Into<String>,
    args: Option<&Value>,
    tool_call_id: Option<&str>,
) -> EngineEvent {
    match tool_call_message_with_id(name, args, tool_call_id) {
        EngineEvent::Message {
            role,
            text,
            path,
            todos,
            args,
            tool_call_id,
            ..
        } => EngineEvent::Message {
            role,
            text,
            path,
            todos,
            args,
            result: None,
            patch: true,
            tool_call_id,
        },
        other => other,
    }
}
fn created_task(result: &Value) -> Option<(String, String)> {
    if let Some(text) = result.as_str() {
        if text.contains('\n') {
            return None;
        }
        let rest = text.trim().strip_prefix("Task #")?;
        let (id, tail) = rest.split_once(" created successfully")?;
        let id = id.trim();
        let content = tail.trim_start_matches(&[':', '：'][..]).trim();
        if id.is_empty() || content.is_empty() {
            return None;
        }
        return Some((id.to_string(), content.to_string()));
    }
    let task = result.get("task")?;
    let id = task
        .get("id")
        .and_then(|value| match value {
            Value::String(s) => Some(s.trim().to_string()),
            Value::Number(n) => Some(n.to_string()),
            _ => None,
        })
        .filter(|id| !id.is_empty())?;
    let content = task
        .get("subject")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|subject| !subject.is_empty())?;
    Some((id, content.to_string()))
}

pub(crate) fn parse_todo_result(tool: &str, result: &Value) -> Option<TodosPayload> {
    if let Some(phases) = result
        .get("details")
        .and_then(|d| d.get("phases"))
        .and_then(Value::as_array)
    {
        return phases_payload(phases);
    }
    if !is_task_create(tool) {
        return None;
    }
    created_task(result).map(|(id, content)| TodosPayload {
        items: vec![TodoItem {
            id: Some(id),
            content,
            status: "pending".to_string(),
            phase: None,
            reason: None,
            detail: None,
        }],
        replace: false,
    })
}

fn is_task_create(tool: &str) -> bool {
    let tool = tool.to_ascii_lowercase();
    tool.contains("taskcreate") || tool.contains("task_create")
}

fn phases_payload(phases: &[Value]) -> Option<TodosPayload> {
    let mut items = Vec::new();
    for phase in phases {
        let phase_name = phase
            .get("name")
            .or_else(|| phase.get("phase"))
            .and_then(Value::as_str);
        let Some(tasks) = phase.get("tasks").and_then(Value::as_array) else {
            continue;
        };
        for task in tasks {
            let Some(content) = task
                .get("content")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
            else {
                continue;
            };
            let status = todo_status(task.get("status").and_then(Value::as_str));
            let phase = phase_name
                .or_else(|| task.get("phase").and_then(Value::as_str))
                .map(str::to_string);
            let reason = task
                .get("blocker")
                .or_else(|| task.get("reason"))
                .and_then(Value::as_str)
                .map(str::to_string);
            let detail = task
                .get("detail")
                .or_else(|| task.get("description"))
                .and_then(Value::as_str)
                .map(str::to_string);
            items.push(TodoItem {
                id: None,
                content: content.to_string(),
                status: status.to_string(),
                phase,
                reason,
                detail,
            });
        }
    }
    if items.is_empty() {
        return None;
    }
    Some(TodosPayload {
        items,
        replace: true,
    })
}
pub(crate) fn tool_result_patch(name: impl Into<String>, result: Option<&Value>) -> EngineEvent {
    tool_result_patch_with_id(name, result, None)
}
pub(crate) fn tool_result_patch_with_id(
    name: impl Into<String>,
    result: Option<&Value>,
    tool_call_id: Option<&str>,
) -> EngineEvent {
    let name = name.into();
    let todos = result.and_then(|result| parse_todo_result(&name, result));
    EngineEvent::Message {
        role: "tool".to_string(),
        text: name,
        path: None,
        todos,
        args: None,
        result: result.cloned(),
        patch: true,
        tool_call_id: tool_call_identity(tool_call_id),
    }
}
pub(crate) fn assistant_message(text: String) -> EngineEvent {
    EngineEvent::Message {
        role: "assistant".to_string(),
        text,
        path: None,
        todos: None,
        args: None,
        result: None,
        patch: false,
        tool_call_id: None,
    }
}
pub(crate) fn tool_path_arg(args: &Value) -> Option<String> {
    ["path", "file_path", "filePath"]
        .iter()
        .filter_map(|key| args.get(key).and_then(Value::as_str))
        .map(|s| s.trim())
        .find(|s| !s.is_empty())
        .map(|s| s.to_string())
}
pub(crate) fn parse_todo_args(args: &Value) -> Option<TodosPayload> {
    if args.get("command").is_some()
        || args.get("file_path").is_some()
        || args.get("filePath").is_some()
        || args.get("pattern").is_some()
    {
        return None;
    }

    let pending_item = |content: &str| TodoItem::new(content, "pending");
    let phase_items = |args: &Value| -> Vec<TodoItem> {
        args.get("list")
            .and_then(Value::as_array)
            .map(|phases| {
                phases
                    .iter()
                    .flat_map(|phase| {
                        let phase_name = phase
                            .get("phase")
                            .or_else(|| phase.get("name"))
                            .and_then(Value::as_str)
                            .map(str::to_string);
                        phase
                            .get("items")
                            .and_then(Value::as_array)
                            .into_iter()
                            .flatten()
                            .filter_map(Value::as_str)
                            .map(move |content| TodoItem {
                                id: None,
                                content: content.to_string(),
                                status: "pending".to_string(),
                                phase: phase_name.clone(),
                                reason: None,
                                detail: None,
                            })
                    })
                    .collect()
            })
            .unwrap_or_default()
    };
    if let Some(todos) = args.get("todos").and_then(Value::as_array) {
        let items = todos
            .iter()
            .filter_map(|entry| {
                let content = ["content", "text", "title", "task", "subject"]
                    .iter()
                    .filter_map(|key| entry.get(key).and_then(Value::as_str))
                    .map(|s| s.trim())
                    .find(|s| !s.is_empty())?;
                let status = todo_status(entry.get("status").and_then(Value::as_str));
                let id = entry
                    .get("id")
                    .or_else(|| entry.get("taskId"))
                    .and_then(Value::as_str)
                    .map(|s| s.to_string());
                Some(TodoItem {
                    id,
                    content: content.to_string(),
                    status: status.to_string(),
                    phase: entry
                        .get("phase")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    reason: entry
                        .get("reason")
                        .or_else(|| entry.get("blocker"))
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    detail: entry
                        .get("detail")
                        .or_else(|| entry.get("description"))
                        .and_then(Value::as_str)
                        .map(str::to_string),
                })
            })
            .collect();
        return Some(TodosPayload {
            items,
            replace: true,
        });
    }

    if let Some(subject) = args
        .get("subject")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        if args.get("taskId").is_none() && args.get("op").is_none() {
            let status = todo_status(args.get("status").and_then(Value::as_str));
            let detail = args
                .get("description")
                .or_else(|| args.get("detail"))
                .and_then(Value::as_str)
                .map(str::to_string);
            return Some(TodosPayload {
                items: vec![TodoItem {
                    id: None,
                    content: subject.to_string(),
                    status: status.to_string(),
                    phase: None,
                    reason: None,
                    detail,
                }],
                replace: false,
            });
        }
    }

    if args.get("op").is_none() {
        if let Some(task_id) = args
            .get("taskId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            let content = args
                .get("subject")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("");
            let status = args
                .get("status")
                .and_then(Value::as_str)
                .map(|raw| todo_status(Some(raw)))
                .unwrap_or("");
            let detail = args
                .get("description")
                .or_else(|| args.get("detail"))
                .and_then(Value::as_str)
                .map(str::to_string);
            if content.is_empty() && status.is_empty() && detail.is_none() {
                return None;
            }
            return Some(TodosPayload {
                items: vec![TodoItem {
                    id: Some(task_id.to_string()),
                    content: content.to_string(),
                    status: status.to_string(),
                    phase: None,
                    reason: None,
                    detail,
                }],
                replace: false,
            });
        }
    }

    let op = args.get("op").and_then(Value::as_str)?;
    match op {
        "init" => Some(TodosPayload {
            items: phase_items(args),
            replace: true,
        }),
        "append" => {
            let items = match args.get("items").and_then(Value::as_array) {
                Some(items) => items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(pending_item)
                    .collect(),
                None => phase_items(args),
            };
            Some(TodosPayload {
                items,
                replace: false,
            })
        }
        "start" | "done" | "block" | "unblock" | "drop" => {
            let task = args.get("task").and_then(Value::as_str)?;
            let status = match op {
                "start" => "active",
                "done" => "complete",
                "block" => "blocked",
                "unblock" => "pending",
                _ => "dropped",
            };
            let phase = args
                .get("phase")
                .and_then(Value::as_str)
                .map(str::to_string);
            let reason = args
                .get("reason")
                .or_else(|| args.get("blocker"))
                .and_then(Value::as_str)
                .map(str::to_string);
            let detail = args
                .get("detail")
                .or_else(|| args.get("i"))
                .and_then(Value::as_str)
                .map(str::to_string);
            Some(TodosPayload {
                items: vec![TodoItem {
                    id: None,
                    content: task.to_string(),
                    status: status.to_string(),
                    phase,
                    reason,
                    detail,
                }],
                replace: false,
            })
        }
        "rm" | "clear" => Some(TodosPayload {
            items: Vec::new(),
            replace: true,
        }),
        _ => None,
    }
}
pub(crate) fn push_session_id(value: &Value, key: &str, out: &mut Vec<EngineEvent>) {
    if let Some(id) = value.get(key).and_then(Value::as_str) {
        if !id.trim().is_empty() {
            out.push(EngineEvent::SessionId(id.trim().to_string()));
        }
    }
}
#[cfg(test)]
#[path = "events_tests.rs"]
mod tool_args_tests;
