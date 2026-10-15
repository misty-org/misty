//! The Agent Client Protocol (JSON-RPC over stdio), shared by every ACP tool.
//! The session initializes without offering file access (the tool uses its
//! own, inside the project), opens a session in the project, applies the
//! engine's mode, and sends the prompt. `session/request_permission` reaches
//! the bridge; anything else the tool asks of the client gets a safe no.
use std::collections::HashMap;

use serde_json::{json, Value};

use super::{
    bridge::classify_command,
    events::{todo_status, ActionKind, PermissionRequest, RunnerEvent, TodoItem, Usage},
    Launch, Protocol, Step,
};

/// A setup request sent after the session opens, before the prompt.
pub type Setup = (&'static str, Value);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Pending {
    Initialize,
    NewSession,
    Setup,
    Prompt,
}

pub struct AcpProtocol {
    launch: Launch,
    /// Mode and config requests for this engine; `{session}` is filled in.
    setup: Vec<Setup>,
    next_id: u64,
    pending: HashMap<u64, Pending>,
    session: String,
    setups_left: usize,
}

impl AcpProtocol {
    pub fn new(launch: &Launch, setup: Vec<Setup>) -> Self {
        Self {
            launch: launch.clone(),
            setups_left: setup.len(),
            setup,
            next_id: 1,
            pending: HashMap::new(),
            session: String::new(),
        }
    }

    fn request(&mut self, method: &str, params: Value, kind: Pending) -> String {
        let id = self.next_id;
        self.next_id += 1;
        self.pending.insert(id, kind);
        json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}).to_string()
    }

    fn prompt(&mut self) -> String {
        let params = json!({"sessionId": self.session, "prompt": [{"type": "text", "text": self.launch.task}]});
        self.request("session/prompt", params, Pending::Prompt)
    }

    fn after_session(&mut self) -> Vec<String> {
        if self.setup.is_empty() {
            return vec![self.prompt()];
        }
        let setup = std::mem::take(&mut self.setup);
        setup
            .into_iter()
            .map(|(method, mut params)| {
                params["sessionId"] = json!(self.session);
                self.request(method, params, Pending::Setup)
            })
            .collect()
    }

    fn permission(&self, value: &Value) -> PermissionRequest {
        let call = &value["params"]["toolCall"];
        let raw = &call["rawInput"];
        let command = raw["command"].as_str().map(String::from).or_else(|| {
            raw["command"].as_array().map(|parts| {
                parts
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join(" ")
            })
        });
        let path = call["locations"][0]["path"]
            .as_str()
            .or_else(|| raw["path"].as_str())
            .or_else(|| raw["file_path"].as_str())
            .map(String::from);
        let kind = match call["kind"].as_str().unwrap_or("") {
            "read" | "search" | "think" => ActionKind::Read,
            "edit" | "delete" | "move" => ActionKind::Edit,
            "fetch" => ActionKind::Network,
            "execute" => command
                .as_deref()
                .map(classify_command)
                .unwrap_or(ActionKind::Run),
            _ => command
                .as_deref()
                .map(classify_command)
                .unwrap_or(ActionKind::Other),
        };
        PermissionRequest {
            id: value["id"].to_string(),
            tool: call["title"]
                .as_str()
                .or(call["kind"].as_str())
                .unwrap_or("tool")
                .into(),
            kind,
            path,
            command,
            input: value["params"].clone(),
        }
    }

    fn update(&self, update: &Value) -> Vec<RunnerEvent> {
        let text = || update["content"]["text"].as_str().unwrap_or("").to_owned();
        match update["sessionUpdate"].as_str().unwrap_or("") {
            "agent_message_chunk" => vec![RunnerEvent::Delta { text: text() }],
            "agent_thought_chunk" => vec![RunnerEvent::Thinking { text: text() }],
            "plan" => {
                let items = update["entries"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .enumerate()
                    .map(|(index, entry)| TodoItem {
                        id: format!("p{}", index + 1),
                        title: entry["content"]
                            .as_str()
                            .unwrap_or("")
                            .chars()
                            .take(160)
                            .collect(),
                        status: todo_status(entry["status"].as_str().unwrap_or("")).into(),
                    });
                vec![RunnerEvent::Todos {
                    items: items.collect(),
                }]
            }
            _ => Vec::new(),
        }
    }
}

/// Token counts from a prompt result's usage or `_meta`, whichever it sent.
fn usage(result: &Value) -> Usage {
    let source = if result["usage"].is_object() {
        &result["usage"]
    } else {
        &result["_meta"]
    };
    let count = |keys: &[&str]| {
        keys.iter()
            .find_map(|key| source[*key].as_u64())
            .unwrap_or(0)
    };
    Usage {
        input: count(&["inputTokens", "input_tokens"]),
        output: count(&["outputTokens", "output_tokens"]),
        cache_write: count(&[
            "cachedWriteTokens",
            "cacheWriteTokens",
            "cache_creation_input_tokens",
        ]),
        cache_read: count(&[
            "cachedReadTokens",
            "cacheReadTokens",
            "cache_read_input_tokens",
        ]),
        model: String::new(),
    }
}

impl Protocol for AcpProtocol {
    fn initial_input(&mut self) -> Vec<String> {
        let params = json!({"protocolVersion": 1, "clientCapabilities": {"fs": {"readTextFile": false, "writeTextFile": false}, "terminal": false}});
        vec![self.request("initialize", params, Pending::Initialize)]
    }

    fn on_line(&mut self, line: &str) -> Step {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            return Step::default();
        };
        let method = value["method"].as_str().unwrap_or("");
        if !method.is_empty() && value.get("id").is_some() {
            if method == "session/request_permission" {
                return Step::events(vec![RunnerEvent::PermissionRequest(
                    self.permission(&value),
                )]);
            }
            // Elicitations, file and terminal callbacks: the client offers none.
            let reply = json!({"jsonrpc": "2.0", "id": value["id"], "error": {"code": -32601, "message": "Not available in Misty."}});
            return Step {
                events: Vec::new(),
                writes: vec![reply.to_string()],
            };
        }
        if method == "session/update" {
            return Step::events(self.update(&value["params"]["update"]));
        }
        let Some(kind) = value["id"].as_u64().and_then(|id| self.pending.remove(&id)) else {
            return Step::default();
        };
        if let Some(error) = value.get("error") {
            let message = error["message"]
                .as_str()
                .unwrap_or("The coding tool refused the request.");
            return Step::events(vec![
                RunnerEvent::Error {
                    message: message.into(),
                },
                RunnerEvent::Done {
                    stop_reason: "error".into(),
                },
            ]);
        }
        let result = &value["result"];
        match kind {
            Pending::Initialize => {
                let params = json!({"cwd": self.launch.project_root, "mcpServers": []});
                Step {
                    events: Vec::new(),
                    writes: vec![self.request("session/new", params, Pending::NewSession)],
                }
            }
            Pending::NewSession => {
                self.session = result["sessionId"].as_str().unwrap_or("").to_owned();
                Step {
                    events: vec![RunnerEvent::Session {
                        id: self.session.clone(),
                    }],
                    writes: self.after_session(),
                }
            }
            Pending::Setup => {
                self.setups_left = self.setups_left.saturating_sub(1);
                let writes = if self.setups_left == 0 {
                    vec![self.prompt()]
                } else {
                    Vec::new()
                };
                Step {
                    events: Vec::new(),
                    writes,
                }
            }
            Pending::Prompt => Step::events(vec![
                RunnerEvent::Usage(usage(result)),
                RunnerEvent::Done {
                    stop_reason: result["stopReason"].as_str().unwrap_or("end_turn").into(),
                },
            ]),
        }
    }

    fn answer(
        &mut self,
        request: &PermissionRequest,
        allow: bool,
        _reason: &str,
    ) -> Option<String> {
        let id: Value = serde_json::from_str(&request.id).ok()?;
        let wanted = if allow { "allow_once" } else { "reject_once" };
        let option = request.input["options"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|option| option["kind"] == wanted)
            .and_then(|option| option["optionId"].as_str());
        let outcome = match option {
            Some(option_id) => json!({"outcome": "selected", "optionId": option_id}),
            None => json!({"outcome": "cancelled"}),
        };
        Some(json!({"jsonrpc": "2.0", "id": id, "result": {"outcome": outcome}}).to_string())
    }
}
