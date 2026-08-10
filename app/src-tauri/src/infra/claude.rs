use std::{
    env,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Command, ExitStatus, Stdio},
    sync::{Arc, Mutex},
    thread,
};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{ApiError, ApiResult};

#[derive(Clone)]
pub struct ClaudeService {
    state: Arc<Mutex<ClaudeState>>,
}

#[derive(Debug, Default)]
struct ClaudeState {
    running: bool,
    abort_requested: bool,
    child_pid: Option<u32>,
    session_id: Option<String>,
    events: Vec<ClaudeStreamEvent>,
    last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeStatus {
    pub installed: bool,
    pub running: bool,
    pub session_id: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSendRequest {
    pub prompt: String,
    pub cwd: Option<String>,
    pub resume_session: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ClaudeEventKind {
    System,
    Text,
    ToolUse,
    ToolResult,
    Result,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeStreamEvent {
    pub kind: ClaudeEventKind,
    pub session_id: Option<String>,
    pub text: String,
    pub tool_name: String,
    pub tool_input: String,
    pub tool_use_id: String,
    pub tool_result: String,
    pub cost_usd: f64,
}

impl ClaudeStreamEvent {
    fn error(text: impl Into<String>) -> Self {
        Self {
            kind: ClaudeEventKind::Error,
            session_id: None,
            text: text.into(),
            tool_name: String::new(),
            tool_input: String::new(),
            tool_use_id: String::new(),
            tool_result: String::new(),
            cost_usd: 0.0,
        }
    }
}

impl ClaudeService {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(ClaudeState::default())),
        }
    }

    pub fn status(&self) -> ClaudeStatus {
        let state = self.state.lock().expect("claude state poisoned");
        ClaudeStatus {
            installed: resolve_claude_path().is_some(),
            running: state.running,
            session_id: state.session_id.clone(),
            error: state.last_error.clone(),
        }
    }

    pub fn send_message(&self, request: ClaudeSendRequest) -> ApiResult<ClaudeStatus> {
        let prompt = request.prompt.trim().to_owned();
        if prompt.is_empty() {
            return Err(ApiError::Message("Claude prompt is empty.".to_owned()));
        }
        let claude_path = resolve_claude_path().ok_or_else(|| {
            ApiError::Message(
                "Claude CLI was not found. Install Claude Code and make `claude` available on PATH."
                    .to_owned(),
            )
        })?;
        let cwd = request
            .cwd
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from);
        if let Some(path) = &cwd {
            if !path.is_dir() {
                return Err(ApiError::Message(format!(
                    "Claude working directory does not exist: {}",
                    path.display()
                )));
            }
        }

        let resume_session = request.resume_session.unwrap_or(true);
        let session_id = {
            let mut state = self.state.lock().expect("claude state poisoned");
            if state.running {
                return Err(ApiError::Message(
                    "Claude is already running a request.".to_owned(),
                ));
            }
            let session_id = resume_session.then(|| state.session_id.clone()).flatten();
            state.events.clear();
            state.last_error = None;
            state.running = true;
            state.abort_requested = false;
            state.child_pid = None;
            session_id
        };

        let mut command = Command::new(&claude_path);
        command
            .arg("-p")
            .arg(&prompt)
            .arg("--output-format")
            .arg("stream-json")
            .arg("--verbose")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(session_id) = session_id.as_deref().filter(|value| !value.is_empty()) {
            command.arg("--resume").arg(session_id);
        }
        if let Some(cwd) = &cwd {
            command.current_dir(cwd);
        }

        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                let mut state = self.state.lock().expect("claude state poisoned");
                state.running = false;
                state.last_error = Some(format!("Could not start Claude: {error}"));
                return Err(ApiError::Message(format!(
                    "Could not start Claude: {error}"
                )));
            }
        };

        {
            let mut state = self.state.lock().expect("claude state poisoned");
            state.child_pid = Some(child.id());
        }

        if let Some(stdout) = child.stdout.take() {
            let state = self.state.clone();
            thread::spawn(move || read_claude_stdout(stdout, state));
        }
        if let Some(stderr) = child.stderr.take() {
            let state = self.state.clone();
            thread::spawn(move || read_claude_stderr(stderr, state));
        }

        let state = self.state.clone();
        thread::spawn(move || {
            let wait_result = child.wait();
            let mut state = state.lock().expect("claude state poisoned");
            state.running = false;
            state.child_pid = None;
            match wait_result {
                Ok(status) if !status.success() && !state.abort_requested => {
                    let message = claude_exit_status_message(status);
                    state.last_error = Some(message.clone());
                    state.events.push(ClaudeStreamEvent::error(message));
                }
                Err(error) if !state.abort_requested => {
                    let message = format!("Claude process wait failed: {error}");
                    state.last_error = Some(message.clone());
                    state.events.push(ClaudeStreamEvent::error(message));
                }
                _ => {}
            }
            state.abort_requested = false;
        });

        Ok(self.status())
    }

    pub fn drain_events(&self) -> Vec<ClaudeStreamEvent> {
        let mut state = self.state.lock().expect("claude state poisoned");
        let mut events = Vec::new();
        events.append(&mut state.events);
        events
    }

    pub fn abort(&self) -> ApiResult<ClaudeStatus> {
        let pid = {
            let state = self.state.lock().expect("claude state poisoned");
            state.child_pid
        };
        if let Some(pid) = pid {
            kill_process(pid)?;
        }
        let mut state = self.state.lock().expect("claude state poisoned");
        state.running = false;
        state.abort_requested = true;
        state.child_pid = None;
        state
            .events
            .push(ClaudeStreamEvent::error("Claude request aborted."));
        Ok(ClaudeStatus {
            installed: resolve_claude_path().is_some(),
            running: state.running,
            session_id: state.session_id.clone(),
            error: state.last_error.clone(),
        })
    }
}

fn read_claude_stdout(stdout: impl std::io::Read, state: Arc<Mutex<ClaudeState>>) {
    let reader = BufReader::new(stdout);
    for line in reader.lines().map_while(Result::ok) {
        push_claude_output_line(&line, &state);
    }
}

fn read_claude_stderr(stderr: impl std::io::Read, state: Arc<Mutex<ClaudeState>>) {
    let reader = BufReader::new(stderr);
    for line in reader.lines().map_while(Result::ok) {
        push_claude_output_line(&line, &state);
    }
}

fn push_claude_output_line(line: &str, state: &Arc<Mutex<ClaudeState>>) {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return;
    }
    match parse_claude_json_line(trimmed) {
        Ok(events) => {
            let mut state = state.lock().expect("claude state poisoned");
            for event in events {
                if let Some(session_id) = event
                    .session_id
                    .as_deref()
                    .filter(|value| !value.is_empty())
                {
                    state.session_id = Some(session_id.to_owned());
                }
                state.events.push(event);
            }
        }
        Err(message) => {
            let mut state = state.lock().expect("claude state poisoned");
            state.last_error = Some(message.clone());
            state.events.push(ClaudeStreamEvent::error(message));
        }
    }
}

fn parse_claude_json_line(line: &str) -> Result<Vec<ClaudeStreamEvent>, String> {
    let value: Value = serde_json::from_str(line).map_err(|_| line.to_owned())?;
    let event_type = value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let mut events = Vec::new();

    match event_type {
        "system" => {
            events.push(ClaudeStreamEvent {
                kind: ClaudeEventKind::System,
                session_id: value
                    .get("session_id")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
                text: String::new(),
                tool_name: String::new(),
                tool_input: String::new(),
                tool_use_id: String::new(),
                tool_result: String::new(),
                cost_usd: 0.0,
            });
        }
        "assistant" => {
            let blocks = value
                .get("message")
                .and_then(|message| message.get("content"))
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            for block in blocks {
                match block
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                {
                    "text" => events.push(ClaudeStreamEvent {
                        kind: ClaudeEventKind::Text,
                        session_id: None,
                        text: block
                            .get("text")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_owned(),
                        tool_name: String::new(),
                        tool_input: String::new(),
                        tool_use_id: String::new(),
                        tool_result: String::new(),
                        cost_usd: 0.0,
                    }),
                    "tool_use" => events.push(ClaudeStreamEvent {
                        kind: ClaudeEventKind::ToolUse,
                        session_id: None,
                        text: String::new(),
                        tool_name: block
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_owned(),
                        tool_input: block
                            .get("input")
                            .map(|input| serde_json::to_string_pretty(input).unwrap_or_default())
                            .unwrap_or_default(),
                        tool_use_id: block
                            .get("id")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_owned(),
                        tool_result: String::new(),
                        cost_usd: 0.0,
                    }),
                    _ => {}
                }
            }
        }
        "user" => {
            let blocks = value
                .get("message")
                .and_then(|message| message.get("content"))
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            for block in blocks {
                if block.get("type").and_then(Value::as_str) == Some("tool_result") {
                    events.push(ClaudeStreamEvent {
                        kind: ClaudeEventKind::ToolResult,
                        session_id: None,
                        text: String::new(),
                        tool_name: String::new(),
                        tool_input: String::new(),
                        tool_use_id: block
                            .get("tool_use_id")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_owned(),
                        tool_result: claude_content_text(block.get("content")),
                        cost_usd: 0.0,
                    });
                }
            }
        }
        "tool_result" => events.push(ClaudeStreamEvent {
            kind: ClaudeEventKind::ToolResult,
            session_id: None,
            text: String::new(),
            tool_name: String::new(),
            tool_input: String::new(),
            tool_use_id: value
                .get("tool_use_id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            tool_result: claude_content_text(value.get("content")),
            cost_usd: 0.0,
        }),
        "result" => events.push(ClaudeStreamEvent {
            kind: ClaudeEventKind::Result,
            session_id: value
                .get("session_id")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
            text: value
                .get("result")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            tool_name: String::new(),
            tool_input: String::new(),
            tool_use_id: String::new(),
            tool_result: String::new(),
            cost_usd: value
                .get("total_cost_usd")
                .and_then(Value::as_f64)
                .unwrap_or(0.0),
        }),
        _ => {}
    }

    Ok(events)
}

fn claude_content_text(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(value)) => value.clone(),
        Some(Value::Array(blocks)) => blocks
            .iter()
            .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
            .map(|block| {
                block
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
            })
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        Some(value) => value.to_string(),
        None => String::new(),
    }
}

fn claude_exit_status_message(status: ExitStatus) -> String {
    match status.code() {
        Some(code) => format!("Claude exited with status code {code}."),
        None => "Claude exited before completing the request.".to_string(),
    }
}

fn resolve_claude_path() -> Option<PathBuf> {
    if let Ok(path) = env::var("CLAUDE_BIN") {
        let candidate = PathBuf::from(path);
        if executable_exists(&candidate) {
            return Some(candidate);
        }
    }

    let command = if cfg!(target_os = "windows") {
        ("where", vec!["claude"])
    } else {
        ("/bin/sh", vec!["-c", "command -v claude 2>/dev/null"])
    };
    if let Ok(output) = Command::new(command.0).args(command.1).output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(first) = stdout.lines().find(|line| !line.trim().is_empty()) {
                let candidate = PathBuf::from(first.trim());
                if executable_exists(&candidate) {
                    return Some(candidate);
                }
            }
        }
    }

    let mut candidates = Vec::new();
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".local/bin/claude"));
    }
    candidates.push(PathBuf::from("/opt/homebrew/bin/claude"));
    candidates.push(PathBuf::from("/usr/local/bin/claude"));
    candidates.into_iter().find(|path| executable_exists(path))
}

fn executable_exists(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        path.metadata()
            .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        true
    }
}

fn kill_process(pid: u32) -> ApiResult<()> {
    let status = if cfg!(target_os = "windows") {
        Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status()
    } else {
        Command::new("kill")
            .arg("-TERM")
            .arg(pid.to_string())
            .status()
    }
    .map_err(|error| ApiError::Message(format!("Could not stop Claude: {error}")))?;

    if status.success() {
        Ok(())
    } else {
        Err(ApiError::Message(format!(
            "Could not stop Claude process {pid}."
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::{executable_exists, parse_claude_json_line, ClaudeEventKind};
    use std::path::PathBuf;

    #[test]
    fn parses_text_and_tool_events() {
        let events = parse_claude_json_line(
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Hi"},{"type":"tool_use","id":"toolu_1","name":"Read","input":{"file_path":"a.txt"}}]}}"#,
        )
        .expect("events");

        assert_eq!(events.len(), 2);
        assert!(matches!(events[0].kind, ClaudeEventKind::Text));
        assert_eq!(events[0].text, "Hi");
        assert!(matches!(events[1].kind, ClaudeEventKind::ToolUse));
        assert_eq!(events[1].tool_name, "Read");
        assert!(events[1].tool_input.contains("a.txt"));
    }

    #[test]
    fn parses_user_tool_result_blocks() {
        let events = parse_claude_json_line(
            r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_1","content":[{"type":"text","text":"file contents"}]}]}}"#,
        )
        .expect("events");

        assert_eq!(events.len(), 1);
        assert!(matches!(events[0].kind, ClaudeEventKind::ToolResult));
        assert_eq!(events[0].tool_use_id, "toolu_1");
        assert_eq!(events[0].tool_result, "file contents");
    }

    #[test]
    fn parses_result_session_and_cost() {
        let events = parse_claude_json_line(
            r#"{"type":"result","session_id":"session_1","result":"Done","total_cost_usd":0.12}"#,
        )
        .expect("events");

        assert_eq!(events.len(), 1);
        assert!(matches!(events[0].kind, ClaudeEventKind::Result));
        assert_eq!(events[0].session_id.as_deref(), Some("session_1"));
        assert_eq!(events[0].text, "Done");
        assert_eq!(events[0].cost_usd, 0.12);
    }

    #[cfg(unix)]
    #[test]
    fn executable_detection_rejects_non_executable_files() {
        use std::os::unix::fs::PermissionsExt;

        let root = unique_test_dir("claude-non-executable");
        std::fs::create_dir_all(&root).unwrap();
        let candidate = root.join("claude");
        std::fs::write(&candidate, b"#!/bin/sh\n").unwrap();
        let mut permissions = std::fs::metadata(&candidate).unwrap().permissions();
        permissions.set_mode(0o644);
        std::fs::set_permissions(&candidate, permissions).unwrap();

        assert!(!executable_exists(&candidate));

        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn executable_detection_accepts_executable_files() {
        use std::os::unix::fs::PermissionsExt;

        let root = unique_test_dir("claude-executable");
        std::fs::create_dir_all(&root).unwrap();
        let candidate = root.join("claude");
        std::fs::write(&candidate, b"#!/bin/sh\n").unwrap();
        let mut permissions = std::fs::metadata(&candidate).unwrap().permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&candidate, permissions).unwrap();

        assert!(executable_exists(&candidate));

        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(not(unix))]
    #[test]
    fn executable_detection_accepts_existing_files_on_non_unix() {
        let root = unique_test_dir("claude-file");
        std::fs::create_dir_all(&root).unwrap();
        let candidate = root.join("claude.exe");
        std::fs::write(&candidate, b"").unwrap();

        assert!(executable_exists(&candidate));

        let _ = std::fs::remove_dir_all(root);
    }

    fn unique_test_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "misty-claude-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }
}
