//! Tools with no way to ask mid-turn: Antigravity and Pi. Misty only gives
//! them work that can't need a pause: in Ask, read-only planning; in Auto,
//! edits inside the project. Anything they would need to ask about (pushing,
//! installing) the Misty agent asks for separately.
use serde_json::{json, Value};

use super::{
    events::{PermissionRequest, RunnerEvent, Usage},
    Capabilities, CommandSpec, EngineId, Launch, LaunchMode, Protocol, Runner, RunnerError, Step,
    Transport,
};

const LAUNCH_ONLY: Capabilities = Capabilities {
    interactive_asks: false,
    plan_mode: true,
    todos: false,
    rate_limits: false,
    full_access_only: false,
};

fn refuse_ask(launch: &Launch) -> Result<(), RunnerError> {
    match launch.mode {
        LaunchMode::Ask => Err(RunnerError::Unsupported(
            "this tool can't ask before acting, so in Ask it only plans",
        )),
        _ if launch.task.trim().is_empty() => Err(RunnerError::Invalid("the task is empty")),
        _ => Ok(()),
    }
}

fn usage(value: &Value) -> Usage {
    let count = |keys: &[&str]| {
        keys.iter()
            .find_map(|key| value[*key].as_u64())
            .unwrap_or(0)
    };
    Usage {
        input: count(&["input_tokens", "inputTokens", "input"]),
        output: count(&["output_tokens", "outputTokens", "output"]),
        cache_write: count(&["cache_creation_input_tokens", "cacheWrite", "cache_write"]),
        cache_read: count(&["cache_read_input_tokens", "cacheRead", "cache_read"]),
        model: String::new(),
    }
}

/// Antigravity's print mode: one child per turn printing stream-json.
pub struct AgyRunner;

impl Runner for AgyRunner {
    fn engine(&self) -> EngineId {
        EngineId::Agy
    }
    fn transport(&self) -> Transport {
        Transport::LaunchOnly
    }
    fn capabilities(&self) -> Capabilities {
        LAUNCH_ONLY
    }
    fn build_command(&self, launch: &Launch) -> Result<CommandSpec, RunnerError> {
        refuse_ask(launch)?;
        let mode = if launch.mode == LaunchMode::Plan {
            "plan"
        } else {
            "accept-edits"
        };
        let root = launch.project_root.to_string_lossy().into_owned();
        let mut args: Vec<String> = [
            "--output-format",
            "stream-json",
            "--print-timeout",
            "60m",
            "--disable-slash-commands",
            "--mode",
            mode,
            "--add-dir",
        ]
        .map(String::from)
        .to_vec();
        args.push(root);
        if let Some(session) = launch.session.as_deref().filter(|s| !s.is_empty()) {
            args.extend(["--conversation".into(), session.into()]);
        }
        args.extend(["--print".into(), launch.task.clone()]);
        Ok(CommandSpec {
            program: "agy".into(),
            args,
            env: Vec::new(),
            cwd: launch.project_root.clone(),
        })
    }
    fn protocol(&self, _launch: &Launch) -> Box<dyn Protocol> {
        Box::new(AgyProtocol)
    }
}

struct AgyProtocol;

impl Protocol for AgyProtocol {
    fn initial_input(&mut self) -> Vec<String> {
        Vec::new()
    }
    fn on_line(&mut self, line: &str) -> Step {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            return Step::default();
        };
        let events = match value["type"].as_str().unwrap_or("") {
            "init" => value["conversation_id"]
                .as_str()
                .map(|id| vec![RunnerEvent::Session { id: id.into() }])
                .unwrap_or_default(),
            "step_update" => value["text_delta"]
                .as_str()
                .map(|text| vec![RunnerEvent::Delta { text: text.into() }])
                .unwrap_or_default(),
            "result" => {
                let mut events = vec![RunnerEvent::Usage(usage(&value["usage"]))];
                if let Some(error) = value["error"].as_str().filter(|e| !e.is_empty()) {
                    events.push(RunnerEvent::Error {
                        message: error.into(),
                    });
                }
                events.push(RunnerEvent::Done {
                    stop_reason: value["status"].as_str().unwrap_or("done").into(),
                });
                events
            }
            "error" => vec![RunnerEvent::Error {
                message: value["message"]
                    .as_str()
                    .unwrap_or("Antigravity stopped with an error.")
                    .into(),
            }],
            _ => Vec::new(),
        };
        Step::events(events)
    }
    fn answer(
        &mut self,
        _request: &PermissionRequest,
        _allow: bool,
        _reason: &str,
    ) -> Option<String> {
        None
    }
}

/// Pi's RPC mode: NDJSON commands on stdin. Plan launches allow only its
/// read-only tools.
pub struct PiRunner;

impl Runner for PiRunner {
    fn engine(&self) -> EngineId {
        EngineId::Pi
    }
    fn transport(&self) -> Transport {
        Transport::LaunchOnly
    }
    fn capabilities(&self) -> Capabilities {
        LAUNCH_ONLY
    }
    fn build_command(&self, launch: &Launch) -> Result<CommandSpec, RunnerError> {
        refuse_ask(launch)?;
        let mut args: Vec<String> = vec!["--mode".into(), "rpc".into()];
        if launch.mode == LaunchMode::Plan {
            args.extend([
                "--no-extensions".into(),
                "--tools".into(),
                "read,grep,find,ls".into(),
            ]);
        }
        if let Some(session) = launch.session.as_deref().filter(|s| !s.is_empty()) {
            args.extend(["--session".into(), session.into()]);
        }
        Ok(CommandSpec {
            program: "pi".into(),
            args,
            env: Vec::new(),
            cwd: launch.project_root.clone(),
        })
    }
    fn protocol(&self, launch: &Launch) -> Box<dyn Protocol> {
        Box::new(PiProtocol {
            task: launch.task.clone(),
        })
    }
}

struct PiProtocol {
    task: String,
}

impl Protocol for PiProtocol {
    fn initial_input(&mut self) -> Vec<String> {
        vec![json!({"type": "prompt", "message": self.task}).to_string()]
    }
    fn on_line(&mut self, line: &str) -> Step {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            return Step::default();
        };
        let events = match value["type"].as_str().unwrap_or("") {
            "session" => value["id"]
                .as_str()
                .map(|id| vec![RunnerEvent::Session { id: id.into() }])
                .unwrap_or_default(),
            "message_update" => {
                let event = &value["assistantMessageEvent"];
                let text = event["delta"].as_str().unwrap_or("").to_owned();
                match event["type"].as_str().unwrap_or("") {
                    "text_delta" => vec![RunnerEvent::Delta { text }],
                    "thinking_delta" => vec![RunnerEvent::Thinking { text }],
                    _ => Vec::new(),
                }
            }
            "message_end" => {
                let usage_value = &value["message"]["usage"];
                if usage_value.is_object() {
                    vec![RunnerEvent::Usage(usage(usage_value))]
                } else {
                    Vec::new()
                }
            }
            "agent_end" if value["willRetry"] != true => vec![RunnerEvent::Done {
                stop_reason: "end".into(),
            }],
            _ => Vec::new(),
        };
        Step::events(events)
    }
    fn answer(
        &mut self,
        _request: &PermissionRequest,
        _allow: bool,
        _reason: &str,
    ) -> Option<String> {
        None
    }
}
