//! DeepSeek Shell through `dsh web`. Sessions it hosts run their tools without
//! asking first, and its plan mode only steers the model, so it gets the same
//! treatment as Grok: Auto only, on a project where the person remembered
//! edits, installs and pushes, with a pre-push hook that refuses unless pushing
//! is remembered. Approval requests it does send still reach the bridge.
//!
//! RPC is `POST /api/{method}` with the session cookie; progress arrives over
//! one WebSocket (`/api/remote.mux`) carrying the session's follow stream and
//! the approvals stream.
use serde_json::{json, Value};

use super::{
    super::{
        acp_engines::push_guard_env,
        events::{PermissionRequest, RunnerEvent},
        CommandSpec, Launch, LaunchMode, RunnerError,
    },
    text_at,
    wire::{dsh_approval, dsh_chunk, dsh_rejected, dsh_reply},
    HostAuth, HostCall, HostStep, HostedProtocol, HostedRunner, StreamKind,
};

pub struct DshRunner;

impl HostedRunner for DshRunner {
    fn server(&self, launch: &Launch, port: u16) -> Result<CommandSpec, RunnerError> {
        if launch.task.trim().is_empty() {
            return Err(RunnerError::Invalid("the task is empty"));
        }
        if launch.mode != LaunchMode::AutoEdit {
            return Err(RunnerError::Unsupported("DeepSeek Shell runs only in Auto"));
        }
        Ok(CommandSpec {
            program: "dsh".into(),
            args: [
                "web",
                "--host",
                "127.0.0.1",
                "--port",
                &port.to_string(),
                "--no-open",
            ]
            .map(String::from)
            .into(),
            env: push_guard_env(&launch.grants)?,
            cwd: launch.project_root.clone(),
        })
    }

    fn auth(&self) -> HostAuth {
        HostAuth::TokenCookie
    }

    fn stream(&self) -> StreamKind {
        StreamKind::WebSocket
    }

    fn protocol(&self, launch: &Launch) -> Box<dyn HostedProtocol> {
        Box::new(DshProtocol::new(launch))
    }
}

pub struct DshProtocol {
    root: String,
    task: String,
    resume: Option<String>,
    session: Option<String>,
    client: Option<String>,
    following: bool,
    prompted: bool,
}

/// A host RPC: `POST /api/{method}`.
fn rpc(tag: &'static str, method: &str, args: Value) -> HostCall {
    HostCall::Post {
        tag,
        path: format!("/api/{method}"),
        body: json!({
            "type": "client-request",
            "rpcId": uuid::Uuid::new_v4().to_string(),
            "method": method,
            "payload": { "args": args },
        }),
    }
}

impl DshProtocol {
    pub fn new(launch: &Launch) -> Self {
        Self {
            root: launch.project_root.to_string_lossy().into_owned(),
            task: launch.task.clone(),
            resume: launch.session.clone(),
            session: None,
            client: None,
            following: false,
            prompted: false,
        }
    }

    /// The prompt goes once both streams are open, so no approval is missed.
    fn prompt_when_ready(&mut self) -> Vec<HostCall> {
        let (Some(session), true, Some(_), false) =
            (&self.session, self.following, &self.client, self.prompted)
        else {
            return Vec::new();
        };
        self.prompted = true;
        vec![rpc(
            "prompt",
            "session/prompt",
            json!({ "request": {
                "requestId": uuid::Uuid::new_v4().to_string(),
                "sessionId": session,
                "mode": "queue",
                "content": [{ "type": "text", "text": self.task }],
            }}),
        )]
    }

    fn follow(&mut self, value: &Value) -> Vec<RunnerEvent> {
        match text_at(value, "/type") {
            Some("snapshot") => {
                self.following = true;
                Vec::new()
            }
            Some("assistant-stream") => dsh_chunk(value).into_iter().collect(),
            Some("event") => {
                let data = &value["event"]["data"];
                match text_at(value, "/event/type") {
                    Some("turn/end") => {
                        match text_at(data, "/reason/kind").unwrap_or("completed") {
                            "completed" => vec![RunnerEvent::Done {
                                stop_reason: "success".into(),
                            }],
                            kind => vec![RunnerEvent::Error {
                                message: format!("DeepSeek Shell stopped ({kind})."),
                            }],
                        }
                    }
                    _ => Vec::new(),
                }
            }
            _ => Vec::new(),
        }
    }

    fn approvals(&mut self, value: &Value) -> HostStep {
        match text_at(value, "/type") {
            Some("ready") => {
                self.client = text_at(value, "/clientId").map(str::to_owned);
                HostStep::default()
            }
            Some("waterfall") => {
                let Some(event) = text_at(value, "/eventId").map(str::to_owned) else {
                    return HostStep::default();
                };
                if text_at(value, "/event") == Some("approval/request") {
                    return HostStep::events(vec![RunnerEvent::PermissionRequest(dsh_approval(
                        &event, value,
                    ))]);
                }
                // Misty can't answer the tool's own questions mid-turn.
                HostStep::calls(
                    self.result(&event, dsh_rejected("Misty can't answer this question.")),
                )
            }
            _ => HostStep::default(),
        }
    }

    fn result(&self, event: &str, outcome: Value) -> Vec<HostCall> {
        let Some(client) = &self.client else {
            return Vec::new();
        };
        vec![rpc(
            "result",
            "$events/result",
            json!({ "clientId": client, "eventId": event, "outcome": outcome }),
        )]
    }
}

impl HostedProtocol for DshProtocol {
    fn start(&mut self) -> Vec<HostCall> {
        vec![rpc(
            "workspace",
            "workspace/create",
            json!({ "request": { "path": self.root } }),
        )]
    }

    fn on_response(&mut self, tag: &str, status: u16, body: Value) -> HostStep {
        let value = dsh_reply(status, &body);
        match tag {
            "workspace" => match value.and_then(|value| text_at(value, "/workspaceId")) {
                Some(workspace) => {
                    let mut request = json!({ "workspaceId": workspace });
                    if let Some(resume) = &self.resume {
                        request["sessionId"] = json!(resume);
                    }
                    HostStep::calls(vec![rpc(
                        "session",
                        "session/create",
                        json!({ "request": request }),
                    )])
                }
                None => HostStep::error("DeepSeek Shell couldn't open the project."),
            },
            "session" => match value
                .and_then(|value| text_at(value, "/sessionId"))
                .map(str::to_owned)
            {
                Some(session) => {
                    self.session = Some(session.clone());
                    let follow = json!({ "type": "open", "streamId": "follow", "endpoint": "session/follow", "payload": { "args": { "request": {
                        "address": { "kind": "session", "sessionId": session }, "maxMessages": 1, "assistantStream": true } } } });
                    let events = json!({ "type": "open", "streamId": "events", "endpoint": "$events", "payload": { "args": {} } });
                    HostStep {
                        events: vec![RunnerEvent::Session { id: session }],
                        calls: vec![HostCall::OpenStream {
                            path: "/api/remote.mux".into(),
                            frames: vec![follow, events],
                        }],
                    }
                }
                None => HostStep::error("DeepSeek Shell couldn't start a session."),
            },
            "prompt" if value.is_none() => {
                HostStep::error("DeepSeek Shell didn't accept the task.")
            }
            _ => HostStep::default(),
        }
    }

    fn on_message(&mut self, message: Value) -> HostStep {
        if text_at(&message, "/type") != Some("item") {
            return HostStep::default();
        }
        let value = &message["value"];
        let mut step = match text_at(&message, "/streamId") {
            Some("follow") => HostStep::events(self.follow(value)),
            Some("events") => self.approvals(value),
            _ => HostStep::default(),
        };
        step.calls.extend(self.prompt_when_ready());
        step
    }

    fn answer(&mut self, request: &PermissionRequest, allow: bool, reason: &str) -> Vec<HostCall> {
        let outcome = if allow {
            json!({ "kind": "result", "value": "allowed-once" })
        } else {
            dsh_rejected(if reason.is_empty() {
                "Not allowed."
            } else {
                reason
            })
        };
        self.result(&request.id, outcome)
    }

    fn cancel(&mut self) -> Vec<HostCall> {
        match &self.session {
            Some(session) => vec![rpc(
                "cancel",
                "session/cancel",
                json!({ "request": { "sessionId": session } }),
            )],
            None => Vec::new(),
        }
    }
}
