//! Claude Code over its stream-json protocol. Each turn is one `claude -p`
//! child: the task goes in on stdin, events come out as JSON lines, and
//! `--permission-prompt-tool stdio` turns every permission check into a
//! control_request the bridge answers. Plan launches use Claude's plan mode;
//! every other launch uses the default mode so each change reaches the bridge.
use serde_json::{json, Value};

use super::{
    bridge::classify_command,
    events::{todo_status, ActionKind, PermissionRequest, RunnerEvent, TodoItem, Usage},
    Capabilities, CommandSpec, EngineId, Launch, LaunchMode, Protocol, Runner, RunnerError, Step,
    Transport,
};

pub struct ClaudeRunner;

impl Runner for ClaudeRunner {
    fn engine(&self) -> EngineId {
        EngineId::Claude
    }

    fn transport(&self) -> Transport {
        Transport::StreamJson
    }

    fn capabilities(&self) -> Capabilities {
        Capabilities {
            interactive_asks: true,
            plan_mode: true,
            todos: true,
            rate_limits: false,
            full_access_only: false,
        }
    }

    fn build_command(&self, launch: &Launch) -> Result<CommandSpec, RunnerError> {
        if launch.task.trim().is_empty() {
            return Err(RunnerError::Invalid("the task is empty"));
        }
        let mode = if launch.mode == LaunchMode::Plan {
            "plan"
        } else {
            "default"
        };
        let mut args: Vec<String> = [
            "-p",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
            "--permission-prompt-tool",
            "stdio",
            "--permission-mode",
            mode,
        ]
        .map(String::from)
        .to_vec();
        if let Some(model) = launch.model.as_deref().filter(|m| !m.is_empty()) {
            args.extend(["--model".into(), model.into()]);
        }
        if let Some(session) = launch.session.as_deref().filter(|s| !s.is_empty()) {
            args.extend(["--resume".into(), session.into()]);
        }
        Ok(CommandSpec {
            program: "claude".into(),
            args,
            env: Vec::new(),
            cwd: launch.project_root.clone(),
        })
    }

    fn protocol(&self, launch: &Launch) -> Box<dyn Protocol> {
        Box::new(ClaudeProtocol {
            task: launch.task.clone(),
            streamed_text: false,
        })
    }
}

struct ClaudeProtocol {
    task: String,
    /// Text arrived as deltas, so the final result text isn't repeated.
    streamed_text: bool,
}

/// What a Claude tool call would do, for the bridge.
fn classify(tool: &str, input: &Value) -> (ActionKind, Option<String>, Option<String>) {
    let path = ["file_path", "notebook_path", "path"]
        .iter()
        .find_map(|key| input[*key].as_str().map(String::from));
    match tool {
        "Read" | "Glob" | "Grep" | "LS" | "TodoWrite" | "WebSearch" => {
            (ActionKind::Read, path, None)
        }
        "WebFetch" => (ActionKind::Network, None, None),
        "Edit" | "MultiEdit" | "Write" | "NotebookEdit" => (ActionKind::Edit, path, None),
        "Bash" => {
            let command = input["command"].as_str().unwrap_or_default().to_owned();
            (classify_command(&command), None, Some(command))
        }
        _ => (ActionKind::Other, path, None),
    }
}

fn todos(input: &Value) -> Option<RunnerEvent> {
    let items = input["todos"].as_array()?;
    let items = items
        .iter()
        .enumerate()
        .filter_map(|(index, todo)| {
            let title = ["content", "subject", "title", "text"]
                .iter()
                .find_map(|key| todo[*key].as_str())?;
            let id = todo["id"]
                .as_str()
                .map(String::from)
                .unwrap_or_else(|| format!("t{}", index + 1));
            Some(TodoItem {
                id,
                title: title.chars().take(160).collect(),
                status: todo_status(todo["status"].as_str().unwrap_or("")).into(),
            })
        })
        .collect();
    Some(RunnerEvent::Todos { items })
}

fn usage(value: &Value, model: &str) -> Usage {
    let count = |key: &str| value[key].as_u64().unwrap_or(0);
    Usage {
        input: count("input_tokens"),
        output: count("output_tokens"),
        cache_write: count("cache_creation_input_tokens"),
        cache_read: count("cache_read_input_tokens"),
        model: model.to_owned(),
    }
}

impl Protocol for ClaudeProtocol {
    fn initial_input(&mut self) -> Vec<String> {
        vec![json!({"type": "user", "message": {"role": "user", "content": [{"type": "text", "text": self.task}]}}).to_string()]
    }

    fn on_line(&mut self, line: &str) -> Step {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            return Step::default();
        };
        let mut events = Vec::new();
        match value["type"].as_str().unwrap_or("") {
            "system" if value["subtype"] == "init" => {
                if let Some(id) = value["session_id"].as_str() {
                    events.push(RunnerEvent::Session { id: id.into() });
                }
            }
            "stream_event" => {
                let delta = &value["event"]["delta"];
                match delta["type"].as_str().unwrap_or("") {
                    "text_delta" => {
                        self.streamed_text = true;
                        events.push(RunnerEvent::Delta {
                            text: delta["text"].as_str().unwrap_or("").into(),
                        });
                    }
                    "thinking_delta" => events.push(RunnerEvent::Thinking {
                        text: delta["thinking"].as_str().unwrap_or("").into(),
                    }),
                    _ => {}
                }
            }
            "assistant" => {
                for block in value["message"]["content"].as_array().into_iter().flatten() {
                    if block["type"] == "tool_use" && block["name"] == "TodoWrite" {
                        events.extend(todos(&block["input"]));
                    }
                }
            }
            "control_request" if value["request"]["subtype"] == "can_use_tool" => {
                let request = &value["request"];
                let tool = request["tool_name"].as_str().unwrap_or("").to_owned();
                let (kind, path, command) = classify(&tool, &request["input"]);
                events.push(RunnerEvent::PermissionRequest(PermissionRequest {
                    id: value["request_id"].as_str().unwrap_or("").into(),
                    tool,
                    kind,
                    path,
                    command,
                    input: request["input"].clone(),
                }));
            }
            "result" => {
                let model = value["modelUsage"]
                    .as_object()
                    .and_then(|models| models.keys().next().cloned())
                    .unwrap_or_default();
                if !self.streamed_text {
                    if let Some(text) = value["result"].as_str().filter(|text| !text.is_empty()) {
                        events.push(RunnerEvent::Message { text: text.into() });
                    }
                }
                events.push(RunnerEvent::Usage(usage(&value["usage"], &model)));
                if value["is_error"] == true {
                    let message = value["result"]
                        .as_str()
                        .unwrap_or("Claude Code stopped with an error.");
                    events.push(RunnerEvent::Error {
                        message: message.into(),
                    });
                }
                events.push(RunnerEvent::Done {
                    stop_reason: value["subtype"].as_str().unwrap_or("success").into(),
                });
            }
            _ => {}
        }
        Step::events(events)
    }

    fn answer(&mut self, request: &PermissionRequest, allow: bool, reason: &str) -> Option<String> {
        let response = if allow {
            json!({"behavior": "allow", "updatedInput": request.input})
        } else {
            json!({"behavior": "deny", "message": reason})
        };
        Some(json!({"type": "control_response", "response": {"subtype": "success", "request_id": request.id, "response": response}}).to_string())
    }
}
