//! OpenCode through `opencode serve`: one session per chat, prompts sent with
//! `prompt_async`, progress read from the server's SSE event stream. OpenCode
//! allows edits and commands by default, so Misty starts it with inline config
//! that makes them ask; every ask reaches the bridge and is answered once,
//! never "always".
use std::collections::{HashMap, HashSet};

use serde_json::{json, Value};

use super::{
    super::{
        events::{PermissionRequest, RunnerEvent},
        CommandSpec, Launch, LaunchMode, RunnerError,
    },
    text_at,
    wire::{opencode_error, opencode_permission, opencode_usage},
    HostAuth, HostCall, HostStep, HostedProtocol, HostedRunner, StreamKind,
};

/// Inline config: every change asks.
const ASK_CONFIG: &str = r#"{"permission":{"edit":"ask","bash":"ask","webfetch":"ask"}}"#;

pub struct OpencodeRunner;

impl HostedRunner for OpencodeRunner {
    fn server(&self, launch: &Launch, port: u16) -> Result<CommandSpec, RunnerError> {
        if launch.task.trim().is_empty() {
            return Err(RunnerError::Invalid("the task is empty"));
        }
        Ok(CommandSpec {
            program: "opencode".into(),
            args: [
                "serve",
                "--hostname",
                "127.0.0.1",
                "--port",
                &port.to_string(),
            ]
            .map(String::from)
            .into(),
            env: vec![("OPENCODE_CONFIG_CONTENT".into(), ASK_CONFIG.into())],
            cwd: launch.project_root.clone(),
        })
    }

    fn auth(&self) -> HostAuth {
        HostAuth::None {
            health: "/global/health",
        }
    }

    fn stream(&self) -> StreamKind {
        StreamKind::Sse
    }

    fn protocol(&self, launch: &Launch) -> Box<dyn HostedProtocol> {
        Box::new(OpencodeProtocol::new(launch))
    }
}

pub struct OpencodeProtocol {
    directory: String,
    task: String,
    plan: bool,
    model: Option<(String, String)>,
    session: Option<String>,
    /// Each message part's kind (text or reasoning), so deltas go to the right place.
    parts: HashMap<String, String>,
    /// Assistant messages whose usage is already counted.
    counted: HashSet<String>,
    busy: bool,
}

impl OpencodeProtocol {
    pub fn new(launch: &Launch) -> Self {
        let model = launch.model.as_deref().and_then(|model| {
            let (provider, id) = model.split_once('/')?;
            Some((provider.to_owned(), id.to_owned()))
        });
        Self {
            directory: launch.project_root.to_string_lossy().into_owned(),
            task: launch.task.clone(),
            plan: launch.mode == LaunchMode::Plan,
            model,
            session: launch.session.clone(),
            parts: HashMap::new(),
            counted: HashSet::new(),
            busy: false,
        }
    }

    fn path(&self, path: &str) -> String {
        let query: String = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("directory", &self.directory)
            .finish();
        format!("{path}?{query}")
    }

    fn post(&self, tag: &'static str, path: &str, body: Value) -> HostCall {
        HostCall::Post {
            tag,
            path: self.path(path),
            body,
        }
    }

    fn begin(&self, session: &str) -> Vec<HostCall> {
        let mut body = json!({ "parts": [{ "type": "text", "text": self.task }] });
        if self.plan {
            body["agent"] = json!("plan");
        }
        if let Some((provider, model)) = &self.model {
            body["model"] = json!({ "providerID": provider, "modelID": model });
        }
        vec![
            HostCall::OpenStream {
                path: self.path("/event"),
                frames: Vec::new(),
            },
            self.post("prompt", &format!("/session/{session}/prompt_async"), body),
        ]
    }

    fn mine(&self, properties: &Value) -> bool {
        let session = ["/sessionID", "/part/sessionID", "/info/sessionID"]
            .iter()
            .find_map(|pointer| text_at(properties, pointer));
        session.is_some() && session == self.session.as_deref()
    }
}

impl HostedProtocol for OpencodeProtocol {
    fn start(&mut self) -> Vec<HostCall> {
        match self.session.clone() {
            Some(session) => self.begin(&session),
            None => {
                let title: String = self.task.chars().take(40).collect();
                vec![self.post("session", "/session", json!({ "title": title }))]
            }
        }
    }

    fn on_response(&mut self, tag: &str, status: u16, body: Value) -> HostStep {
        if !(200..300).contains(&status) {
            return HostStep::error(match tag {
                "session" => "OpenCode couldn't start a session.",
                "prompt" => "OpenCode didn't accept the task.",
                _ => "OpenCode refused a request.",
            });
        }
        if tag != "session" {
            return HostStep::default();
        }
        let Some(id) = text_at(&body, "/id").map(str::to_owned) else {
            return HostStep::error("OpenCode couldn't start a session.");
        };
        self.session = Some(id.clone());
        HostStep {
            events: vec![RunnerEvent::Session { id: id.clone() }],
            calls: self.begin(&id),
        }
    }

    fn on_message(&mut self, message: Value) -> HostStep {
        let kind = text_at(&message, "/type").unwrap_or("");
        let properties = message.get("properties").cloned().unwrap_or(Value::Null);
        if !self.mine(&properties) {
            return HostStep::default();
        }
        let mut events = Vec::new();
        match kind {
            "message.part.updated" => {
                let part = &properties["part"];
                if let (Some(id), Some(kind)) = (text_at(part, "/id"), text_at(part, "/type")) {
                    self.parts.insert(id.to_owned(), kind.to_owned());
                }
                if let Some(delta) = text_at(&properties, "/delta") {
                    events.extend(self.delta(text_at(part, "/id").unwrap_or(""), delta));
                }
            }
            "message.part.delta" => {
                let part = text_at(&properties, "/partID").unwrap_or("").to_owned();
                events.extend(self.delta(&part, text_at(&properties, "/delta").unwrap_or("")));
            }
            "message.updated" => {
                let info = &properties["info"];
                let id = text_at(info, "/id").unwrap_or("").to_owned();
                let finished = info
                    .pointer("/time/completed")
                    .is_some_and(|time| !time.is_null());
                if text_at(info, "/role") == Some("assistant")
                    && finished
                    && self.counted.insert(id)
                {
                    events.push(RunnerEvent::Usage(opencode_usage(info)));
                    if let Some(message) = opencode_error(info) {
                        events.push(RunnerEvent::Error { message });
                    }
                }
            }
            "session.status" => match text_at(&properties, "/status/type") {
                Some("busy") => self.busy = true,
                Some("idle") if self.busy => events.push(RunnerEvent::Done {
                    stop_reason: "success".into(),
                }),
                _ => {}
            },
            "session.error" => events.push(RunnerEvent::Error {
                message: opencode_error(&properties)
                    .unwrap_or_else(|| "OpenCode stopped with an error.".into()),
            }),
            "permission.asked" | "permission.updated" => {
                events.extend(opencode_permission(&properties).map(RunnerEvent::PermissionRequest));
            }
            // Misty has no way to answer OpenCode's own questions mid-turn.
            "question.asked" => {
                if let Some(id) = text_at(&properties, "/id") {
                    return HostStep::calls(vec![self.post(
                        "question",
                        &format!("/question/{id}/reject"),
                        json!({}),
                    )]);
                }
            }
            _ => {}
        }
        HostStep::events(events)
    }

    fn answer(&mut self, request: &PermissionRequest, allow: bool, reason: &str) -> Vec<HostCall> {
        let mut body = json!({ "reply": if allow { "once" } else { "reject" } });
        if !allow && !reason.is_empty() {
            body["message"] = json!(reason);
        }
        vec![self.post(
            "permission",
            &format!("/permission/{}/reply", request.id),
            body,
        )]
    }

    fn cancel(&mut self) -> Vec<HostCall> {
        match self.session.clone() {
            Some(session) => {
                vec![self.post("abort", &format!("/session/{session}/abort"), json!({}))]
            }
            None => Vec::new(),
        }
    }
}

impl OpencodeProtocol {
    fn delta(&self, part: &str, delta: &str) -> Option<RunnerEvent> {
        if delta.is_empty() {
            return None;
        }
        Some(match self.parts.get(part).map(String::as_str) {
            Some("reasoning") => RunnerEvent::Thinking { text: delta.into() },
            _ => RunnerEvent::Delta { text: delta.into() },
        })
    }
}
