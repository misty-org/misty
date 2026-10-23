//! Codex over its app-server JSON-RPC protocol. The session initializes, starts
//! (or resumes) a thread in the project with `approvalPolicy: "on-request"`, and
//! starts the turn. Every command and file change Codex wants comes back as an
//! approval request the bridge answers. Plan launches use the read-only sandbox.
use std::collections::HashMap;

use serde_json::{json, Value};

use super::{
    bridge::classify_command,
    events::{ActionKind, PermissionRequest, RunnerEvent},
    CommandSpec, Launch, LaunchMode, Protocol, Runner, RunnerError, Step,
};

mod notifications;

pub struct CodexRunner;

impl Runner for CodexRunner {
    fn build_command(&self, launch: &Launch) -> Result<CommandSpec, RunnerError> {
        if launch.task.trim().is_empty() {
            return Err(RunnerError::Invalid("the task is empty"));
        }
        Ok(CommandSpec {
            program: "codex".into(),
            args: vec!["app-server".into()],
            env: Vec::new(),
            cwd: launch.project_root.clone(),
        })
    }

    fn protocol(&self, launch: &Launch) -> Box<dyn Protocol> {
        Box::new(CodexProtocol {
            launch: launch.clone(),
            next_id: 1,
            pending: HashMap::new(),
            changes: HashMap::new(),
            model: String::new(),
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Pending {
    Initialize,
    Thread,
    Turn,
}

struct CodexProtocol {
    launch: Launch,
    next_id: u64,
    /// Our requests waiting for their response, by id.
    pending: HashMap<u64, Pending>,
    /// Paths each file change touches, from item/started, by item id.
    changes: HashMap<String, Vec<String>>,
    model: String,
}

impl CodexProtocol {
    fn request(&mut self, method: &str, params: Value, kind: Pending) -> String {
        let id = self.next_id;
        self.next_id += 1;
        self.pending.insert(id, kind);
        json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}).to_string()
    }

    fn start_thread(&mut self) -> String {
        if let Some(thread) = self.launch.session.clone().filter(|s| !s.is_empty()) {
            return self.request(
                "thread/resume",
                json!({"threadId": thread}),
                Pending::Thread,
            );
        }
        let sandbox = if self.launch.mode == LaunchMode::Plan {
            "read-only"
        } else {
            "workspace-write"
        };
        let mut params = json!({"cwd": self.launch.project_root, "approvalPolicy": "on-request", "sandbox": sandbox});
        if let Some(model) = self.launch.model.as_deref().filter(|m| !m.is_empty()) {
            params["model"] = json!(model);
        }
        self.request("thread/start", params, Pending::Thread)
    }

    /// A server-to-client request: an approval, or something we decline.
    fn server_request(&mut self, value: &Value) -> Step {
        let id = value["id"].to_string();
        let params = &value["params"];
        let method = value["method"].as_str().unwrap_or("");
        let (kind, path, command) = match method {
            "item/commandExecution/requestApproval" => {
                let command = params["command"].as_str().map(String::from).or_else(|| {
                    params["command"].as_array().map(|parts| {
                        parts
                            .iter()
                            .filter_map(Value::as_str)
                            .collect::<Vec<_>>()
                            .join(" ")
                    })
                });
                let kind = command
                    .as_deref()
                    .map(classify_command)
                    .unwrap_or(ActionKind::Other);
                (kind, params["cwd"].as_str().map(String::from), command)
            }
            "item/fileChange/requestApproval" => {
                let item = params["itemId"].as_str().unwrap_or("");
                let paths = self.changes.get(item).cloned().unwrap_or_default();
                // A request for write access to a root names it; otherwise
                // the change's own paths, any one outside the project first.
                let path = params["grantRoot"].as_str().map(String::from).or_else(|| {
                    paths
                        .iter()
                        .find(|p| !super::bridge::inside(&self.launch.project_root, p))
                        .or(paths.first())
                        .cloned()
                });
                (ActionKind::Edit, path, None)
            }
            _ => {
                // Elicitations, extra permissions and questions get a safe no.
                let result = match method {
                    "item/tool/requestUserInput" => json!({"answers": {}}),
                    "item/permissions/requestApproval" => json!({"permissions": {}}),
                    _ => json!({"action": "decline"}),
                };
                let reply =
                    json!({"jsonrpc": "2.0", "id": value["id"], "result": result}).to_string();
                return Step {
                    events: Vec::new(),
                    writes: vec![reply],
                };
            }
        };
        Step::events(vec![RunnerEvent::PermissionRequest(PermissionRequest {
            id,
            tool: method
                .trim_start_matches("item/")
                .trim_end_matches("/requestApproval")
                .into(),
            kind,
            path,
            command,
            input: params.clone(),
        })])
    }
}

impl Protocol for CodexProtocol {
    fn initial_input(&mut self) -> Vec<String> {
        vec![self.request(
            "initialize",
            json!({"clientInfo": {"name": "misty", "version": env!("CARGO_PKG_VERSION")}}),
            Pending::Initialize,
        )]
    }

    fn on_line(&mut self, line: &str) -> Step {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            return Step::default();
        };
        if value.get("method").is_some() && value.get("id").is_some() {
            return self.server_request(&value);
        }
        if let Some(method) = value["method"].as_str() {
            return Step::events(self.notification(method, &value["params"]));
        }
        let Some(kind) = value["id"].as_u64().and_then(|id| self.pending.remove(&id)) else {
            return Step::default();
        };
        if let Some(error) = value.get("error") {
            let message = error["message"]
                .as_str()
                .unwrap_or("Codex refused the request.");
            return Step::events(vec![
                RunnerEvent::Error {
                    message: message.into(),
                },
                RunnerEvent::Done {
                    stop_reason: "failed".into(),
                },
            ]);
        }
        match kind {
            Pending::Initialize => Step {
                events: Vec::new(),
                writes: vec![
                    json!({"jsonrpc": "2.0", "method": "initialized"}).to_string(),
                    self.start_thread(),
                ],
            },
            Pending::Thread => {
                let thread = value["result"]["thread"]["id"]
                    .as_str()
                    .unwrap_or("")
                    .to_owned();
                if let Some(model) = value["result"]["model"].as_str() {
                    self.model = model.into();
                }
                let input = json!([{"type": "text", "text": self.launch.task}]);
                let turn = self.request(
                    "turn/start",
                    json!({"threadId": thread, "input": input}),
                    Pending::Turn,
                );
                Step {
                    events: vec![RunnerEvent::Session { id: thread }],
                    writes: vec![turn],
                }
            }
            Pending::Turn => Step::default(),
        }
    }

    fn answer(
        &mut self,
        request: &PermissionRequest,
        allow: bool,
        _reason: &str,
    ) -> Option<String> {
        let id: Value = serde_json::from_str(&request.id).ok()?;
        Some(json!({"jsonrpc": "2.0", "id": id, "result": {"decision": if allow { "accept" } else { "decline" }}}).to_string())
    }
}
