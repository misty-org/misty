// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/qoder_session.rs.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex as TokioMutex;
use tokio::time::{timeout, Instant};

use super::{EngineEvent, TurnCore, TurnState};

#[path = "acp_framing.rs"]
mod framing;
pub(crate) use framing::{
    encode_ndjson, jsonrpc_error_response, jsonrpc_id_key, jsonrpc_notification, jsonrpc_request,
    jsonrpc_result_response, parse_acp_line, AcpLine, AcpRpcError, LineRouter,
};

const ACP_PROTOCOL_VERSION: u32 = 1;
pub(crate) const RPC_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(15);
pub(crate) const SESSION_NEW_TIMEOUT: Duration = Duration::from_secs(90);
pub(crate) const SESSION_RESUME_TIMEOUT: Duration = Duration::from_secs(30);
pub(crate) const PROMPT_TIMEOUT: Option<Duration> = None;
const PROMPT_TRAILING_IDLE: Duration = Duration::from_millis(400);
const PROMPT_TRAILING_CAP: Duration = Duration::from_secs(2);
const CANCEL_SETTLE_TIMEOUT: Duration = Duration::from_secs(2);
pub(crate) const KILL_POLL: Duration = Duration::from_millis(150);
const POST_TERMINAL_DRAIN: Duration = Duration::from_millis(250);

pub(crate) const JSONRPC_METHOD_NOT_FOUND: i64 = -32601;
pub(crate) const JSONRPC_INVALID_PARAMS: i64 = -32602;
pub(crate) const JSONRPC_INTERNAL_ERROR: i64 = -32603;
pub(crate) const CANCELLED: &str = "ACP turn cancelled";

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum AcpUpdate {
    AgentMessageChunk {
        text: String,
    },
    AgentThoughtChunk {
        text: String,
    },
    ToolStarted {
        tool_id: String,
        tool_name: String,
        input: Option<Value>,
    },
    ToolCompleted {
        tool_id: String,
        tool_name: Option<String>,
        output: Option<Value>,
        error: Option<String>,
    },
    Ignore,
}

pub(crate) fn extract_content_text(content: Option<&Value>) -> String {
    let Some(content) = content else {
        return String::new();
    };
    if let Some(text) = content.as_str() {
        return text.to_string();
    }
    if let Some(text) = content.get("text").and_then(Value::as_str) {
        return text.to_string();
    }
    if let Some(thinking) = content.get("thinking").and_then(Value::as_str) {
        return thinking.to_string();
    }
    if let Some(parts) = content.as_array() {
        return parts
            .iter()
            .filter_map(|part| {
                part.as_str()
                    .map(str::to_string)
                    .or_else(|| part.get("text").and_then(Value::as_str).map(str::to_string))
                    .or_else(|| {
                        part.get("thinking")
                            .and_then(Value::as_str)
                            .map(str::to_string)
                    })
                    .or_else(|| {
                        let nested = extract_content_text(part.get("content"));
                        if nested.is_empty() {
                            None
                        } else {
                            Some(nested)
                        }
                    })
            })
            .collect::<Vec<_>>()
            .join("");
    }
    String::new()
}

fn extract_tool_call_id(update: &Value) -> Option<String> {
    update
        .get("toolCallId")
        .or_else(|| update.get("toolCallID"))
        .or_else(|| update.get("tool_call_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn extract_tool_name(update: &Value) -> Option<String> {
    update
        .get("_meta")
        .and_then(|meta| meta.get("qoder"))
        .and_then(|qoder| qoder.get("toolName"))
        .and_then(Value::as_str)
        .or_else(|| update.get("title").and_then(Value::as_str))
        .or_else(|| update.get("kind").and_then(Value::as_str))
        .or_else(|| update.get("name").and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn extract_tool_content_text(update: &Value) -> String {
    let from_blocks = extract_content_text(update.get("content"));
    if !from_blocks.trim().is_empty() {
        return from_blocks;
    }
    let from_raw = extract_content_text(update.get("rawOutput"));
    if !from_raw.trim().is_empty() {
        return from_raw;
    }
    extract_content_text(update.get("output"))
}

pub(crate) fn is_error_prefixed_text(text: &str) -> bool {
    text.trim_start().starts_with("[Error]")
}

pub(crate) fn map_session_update(update: &Value) -> AcpUpdate {
    let kind = update
        .get("sessionUpdate")
        .and_then(Value::as_str)
        .unwrap_or("");
    match kind {
        "agent_message_chunk" => {
            let text = extract_content_text(update.get("content"));
            if text.is_empty() {
                AcpUpdate::Ignore
            } else {
                AcpUpdate::AgentMessageChunk { text }
            }
        }
        "agent_thought_chunk" => {
            let text = extract_content_text(update.get("content"));
            if text.is_empty() {
                AcpUpdate::Ignore
            } else {
                AcpUpdate::AgentThoughtChunk { text }
            }
        }
        "tool_call" => {
            let status = update
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("pending");
            let Some(tool_id) = extract_tool_call_id(update) else {
                return AcpUpdate::Ignore;
            };
            let tool_name = extract_tool_name(update).unwrap_or_else(|| "tool".to_string());
            let input = update
                .get("rawInput")
                .cloned()
                .or_else(|| update.get("input").cloned());
            if status == "completed" || status == "failed" {
                let output = update
                    .get("rawOutput")
                    .cloned()
                    .or_else(|| update.get("output").cloned())
                    .or_else(|| update.get("content").cloned());
                let error = (status == "failed")
                    .then(|| extract_tool_content_text(update).trim().to_string())
                    .filter(|value| !value.is_empty());
                return AcpUpdate::ToolCompleted {
                    tool_id,
                    tool_name: Some(tool_name),
                    output,
                    error,
                };
            }
            if status != "pending" && status != "in_progress" {
                return AcpUpdate::Ignore;
            }
            AcpUpdate::ToolStarted {
                tool_id,
                tool_name,
                input,
            }
        }
        "tool_call_update" => {
            let status = update.get("status").and_then(Value::as_str).unwrap_or("");
            if status != "completed" && status != "failed" {
                return AcpUpdate::Ignore;
            }
            let Some(tool_id) = extract_tool_call_id(update) else {
                return AcpUpdate::Ignore;
            };
            let output = update
                .get("rawOutput")
                .cloned()
                .or_else(|| update.get("output").cloned())
                .or_else(|| update.get("content").cloned());
            let error = (status == "failed")
                .then(|| extract_tool_content_text(update).trim().to_string())
                .filter(|value| !value.is_empty());
            AcpUpdate::ToolCompleted {
                tool_id,
                tool_name: extract_tool_name(update),
                output,
                error,
            }
        }
        _ => AcpUpdate::Ignore,
    }
}

pub(crate) fn session_update_from_notification(params: &Value) -> AcpUpdate {
    let update = params.get("update").unwrap_or(params);
    map_session_update(update)
}

#[derive(Debug, Default, Clone, PartialEq)]
pub(crate) struct AcpSessionState {
    pub title: Option<String>,
    pub mode: Option<String>,
    pub model: Option<String>,
    pub effort: Option<String>,
}

pub(crate) fn non_empty(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub(crate) fn session_state_update(params: &Value) -> Option<AcpSessionState> {
    let update = params.get("update").unwrap_or(params);
    match update.get("sessionUpdate").and_then(Value::as_str)? {
        "session_info_update" => Some(AcpSessionState {
            title: non_empty(update.get("title")),
            ..Default::default()
        }),
        "current_mode_update" => Some(AcpSessionState {
            mode: non_empty(update.get("currentModeId").or_else(|| update.get("modeId"))),
            ..Default::default()
        }),
        "config_option_update" => Some(config_options_state(update.get("configOptions")?)),
        _ => None,
    }
}

pub(crate) fn config_options_state(options: &Value) -> AcpSessionState {
    let mut state = AcpSessionState::default();
    for option in options.as_array().into_iter().flatten() {
        let Some(value) = non_empty(option.get("currentValue")) else {
            continue;
        };
        let id = option.get("id").and_then(Value::as_str).unwrap_or("");
        let category = option.get("category").and_then(Value::as_str).unwrap_or("");
        let slot = match (category, id) {
            ("mode", _) | (_, "mode") => &mut state.mode,
            ("model", _) | (_, "model") => &mut state.model,
            ("thought_level", _) | (_, "reasoning_effort" | "effort" | "thought_level") => {
                &mut state.effort
            }
            _ => continue,
        };
        slot.get_or_insert(value);
    }
    state
}

impl AcpSessionState {
    pub(crate) fn follow(&mut self, next: AcpSessionState) -> Vec<EngineEvent> {
        fn take(known: &mut Option<String>, reported: Option<String>) -> Option<String> {
            let reported = reported?;
            if known.as_deref() == Some(reported.as_str()) {
                return None;
            }
            *known = Some(reported.clone());
            Some(reported)
        }
        let mut events = Vec::new();
        if let Some(title) = take(&mut self.title, next.title) {
            events.push(EngineEvent::SessionTitle(title));
        }
        if let Some(mode) = take(&mut self.mode, next.mode) {
            events.push(EngineEvent::SessionMode(mode));
        }
        let model = take(&mut self.model, next.model);
        let effort = take(&mut self.effort, next.effort);
        if model.is_some() || effort.is_some() {
            events.push(EngineEvent::SessionChoice { model, effort });
        }
        events
    }
}

pub(crate) fn report_session_state(core: &TurnCore, state: &mut TurnState, params: &Value) {
    if let Some(update) = session_state_update(params) {
        for event in AcpSessionState::default().follow(update) {
            core.dispatch_event(state, event);
        }
    }
}

pub(crate) fn permission_auto_answer(params: &Value) -> Result<Value, String> {
    let options = params
        .get("options")
        .and_then(Value::as_array)
        .ok_or_else(|| "session/request_permission missing options".to_string())?;
    let option = options.iter().find(|option| {
        option
            .get("kind")
            .and_then(Value::as_str)
            .map(|kind| kind.to_ascii_lowercase().starts_with("allow"))
            .unwrap_or(false)
    });
    let option_id = option
        .and_then(|option| {
            option
                .get("optionId")
                .or_else(|| option.get("option_id"))
                .or_else(|| option.get("id"))
                .and_then(Value::as_str)
        })
        .ok_or_else(|| "session/request_permission has no allow* option".to_string())?;
    Ok(json!({
        "outcome": {
            "outcome": "selected",
            "optionId": option_id,
        }
    }))
}

#[allow(
    clippy::disallowed_methods,
    reason = "resolves paths against the run's own folder, which need not be linked"
)]
pub(crate) fn confine_path_to_workspace(
    workspace_root: &Path,
    requested: &str,
    for_write: bool,
) -> Result<PathBuf, String> {
    let requested = requested.trim();
    if requested.is_empty() {
        return Err("empty path".to_string());
    }
    let candidate = PathBuf::from(requested);
    let absolute = if candidate.is_absolute() {
        candidate
    } else {
        workspace_root.join(candidate)
    };
    let root = std::fs::canonicalize(workspace_root).unwrap_or_else(|_| {
        if workspace_root.is_absolute() {
            workspace_root.to_path_buf()
        } else {
            std::env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join(workspace_root)
        }
    });
    let resolved = if for_write && !absolute.exists() {
        let mut ancestor = absolute.as_path();
        let mut remainder = Vec::new();
        loop {
            let Some(parent) = ancestor.parent() else {
                break absolute.clone();
            };
            remainder.push(
                ancestor
                    .file_name()
                    .ok_or_else(|| "invalid path".to_string())?,
            );
            if parent.exists() {
                let mut resolved =
                    std::fs::canonicalize(parent).unwrap_or_else(|_| parent.to_path_buf());
                for component in remainder.iter().rev() {
                    resolved.push(component);
                }
                break resolved;
            }
            ancestor = parent;
        }
    } else {
        std::fs::canonicalize(&absolute).unwrap_or(absolute.clone())
    };
    if resolved == root || resolved.starts_with(&root) {
        Ok(resolved)
    } else {
        Err(format!(
            "path '{}' escapes workspace root '{}'",
            requested,
            root.display()
        ))
    }
}

#[allow(
    clippy::disallowed_methods,
    reason = "serves the ACP agent's file requests inside the run's own folder, which need not be linked"
)]
pub(crate) fn handle_fs_read(workspace_root: &Path, params: &Value) -> Result<Value, String> {
    let path = params
        .get("path")
        .and_then(Value::as_str)
        .ok_or_else(|| "fs/read_text_file missing path".to_string())?;
    let confined = confine_path_to_workspace(workspace_root, path, false)?;
    let content = std::fs::read_to_string(&confined).map_err(|error| error.to_string())?;
    Ok(json!({ "content": content }))
}

#[allow(
    clippy::disallowed_methods,
    reason = "serves the ACP agent's file requests inside the run's own folder, which need not be linked"
)]
pub(crate) fn handle_fs_write(workspace_root: &Path, params: &Value) -> Result<Value, String> {
    let path = params
        .get("path")
        .and_then(Value::as_str)
        .ok_or_else(|| "fs/write_text_file missing path".to_string())?;
    let content = params
        .get("content")
        .and_then(Value::as_str)
        .ok_or_else(|| "fs/write_text_file missing content".to_string())?;
    let confined = confine_path_to_workspace(workspace_root, path, true)?;
    if let Some(parent) = confined.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::write(&confined, content).map_err(|error| error.to_string())?;
    Ok(json!({}))
}

pub(crate) fn answer_agent_request(
    workspace_root: &Path,
    id: &Value,
    method: &str,
    params: &Value,
) -> Value {
    match method {
        "session/request_permission" => match permission_auto_answer(params) {
            Ok(result) => jsonrpc_result_response(id, result),
            Err(message) => jsonrpc_error_response(id, JSONRPC_INVALID_PARAMS, &message),
        },
        "fs/read_text_file" => match handle_fs_read(workspace_root, params) {
            Ok(result) => jsonrpc_result_response(id, result),
            Err(message) => jsonrpc_error_response(id, JSONRPC_INVALID_PARAMS, &message),
        },
        "fs/write_text_file" => match handle_fs_write(workspace_root, params) {
            Ok(result) => jsonrpc_result_response(id, result),
            Err(message) => jsonrpc_error_response(id, JSONRPC_INVALID_PARAMS, &message),
        },
        _ => jsonrpc_error_response(id, JSONRPC_METHOD_NOT_FOUND, "Method not found"),
    }
}

pub(crate) fn initialize_params() -> Value {
    json!({
        "protocolVersion": ACP_PROTOCOL_VERSION,
        "clientCapabilities": {
            "fs": {
                "readTextFile": true,
                "writeTextFile": true,
            }
        }
    })
}

pub(crate) struct AcpProcess {
    pub(crate) stdin: Arc<TokioMutex<Option<ChildStdin>>>,
    reader: BufReader<ChildStdout>,
    line_buf: Vec<u8>,
    next_id: u64,
    workspace_root: PathBuf,
    pub(crate) gate: Option<crate::engines::gate::AcpGate>,
    pub(crate) reports_as: Option<String>,
}

impl AcpProcess {
    pub(crate) fn new(
        stdin: Arc<TokioMutex<Option<ChildStdin>>>,
        stdout: ChildStdout,
        workspace_root: PathBuf,
    ) -> Self {
        Self {
            stdin,
            reader: BufReader::new(stdout),
            line_buf: Vec::new(),
            next_id: 1,
            workspace_root,
            gate: None,
            reports_as: None,
        }
    }

    pub(crate) async fn write_line(&mut self, value: &Value) -> Result<(), String> {
        let bytes = encode_ndjson(value)?;
        let mut stdin = self.stdin.lock().await;
        let handle = stdin
            .as_mut()
            .ok_or_else(|| "the ACP session's stdin is already closed".to_string())?;
        handle
            .write_all(&bytes)
            .await
            .map_err(|error| format!("failed to write ACP request: {error}"))?;
        handle
            .flush()
            .await
            .map_err(|error| format!("failed to flush ACP request: {error}"))?;
        Ok(())
    }

    pub(crate) async fn request(
        &mut self,
        method: &str,
        params: Value,
        timeout_dur: impl Into<Option<Duration>>,
        killed: &AtomicBool,
        cancel_session_id: Option<&str>,
        on_update: &mut (dyn FnMut(&Value) + Send),
    ) -> Result<Value, String> {
        let workspace = self.workspace_root.clone();
        let gate = self.gate.clone();
        let mut router = |line: &AcpLine| match line {
            AcpLine::Notification { method, params } if method == "session/update" => {
                on_update(params);
                None
            }
            AcpLine::AgentRequest { id, method, params } => {
                crate::engines::gate::acp_agent_request(
                    gate.as_ref(),
                    &workspace,
                    id,
                    method,
                    params,
                )
            }
            _ => None,
        };
        self.routed(
            method,
            params,
            timeout_dur,
            killed,
            cancel_session_id,
            &mut router,
        )
        .await
    }

    pub(crate) async fn routed(
        &mut self,
        method: &str,
        params: Value,
        timeout_dur: impl Into<Option<Duration>>,
        killed: &AtomicBool,
        cancel_session_id: Option<&str>,
        router: &mut LineRouter<'_>,
    ) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        let expected_key = id.to_string();
        self.write_line(&jsonrpc_request(id, method, params))
            .await?;
        let deadline = timeout_dur.into().map(|limit| Instant::now() + limit);
        let drain_trailing = method == "session/prompt";
        let mut settled: Option<Value> = None;
        let mut drain_deadline: Option<Instant> = None;
        let mut cancel_sent_at: Option<Instant> = None;
        loop {
            if killed.load(Ordering::SeqCst) {
                match (cancel_sent_at, cancel_session_id) {
                    (None, Some(session_id)) => {
                        let _ = self
                            .notify("session/cancel", json!({ "sessionId": session_id }))
                            .await;
                        cancel_sent_at = Some(Instant::now());
                    }
                    (None, None) => return Err(CANCELLED.to_string()),
                    (Some(sent), _) if sent.elapsed() > CANCEL_SETTLE_TIMEOUT => {
                        return Err(CANCELLED.to_string());
                    }
                    (Some(_), _) => {}
                }
            }
            let wait = if settled.is_some() {
                let cap_remaining = drain_deadline
                    .map(|until| until.saturating_duration_since(Instant::now()))
                    .unwrap_or(PROMPT_TRAILING_IDLE);
                if cap_remaining.is_zero() {
                    return Ok(settled.take().unwrap_or(Value::Null));
                }
                PROMPT_TRAILING_IDLE.min(cap_remaining)
            } else {
                let remaining =
                    deadline.map(|until| until.saturating_duration_since(Instant::now()));
                if remaining == Some(Duration::ZERO) {
                    return Err(format!("{method} timed out"));
                }
                remaining.map_or(KILL_POLL, |remaining| remaining.min(KILL_POLL))
            };

            let read = timeout(
                wait,
                super::read_line_capped(&mut self.reader, &mut self.line_buf),
            )
            .await;
            let bytes = match read {
                Ok(Ok(super::LineRead::Line(bytes))) => bytes,
                Ok(Ok(super::LineRead::Eof)) => {
                    return match settled.take() {
                        Some(result) => Ok(result),
                        None => Err(format!("{method} ended: ACP stdout closed")),
                    };
                }
                Ok(Ok(super::LineRead::TooLong)) => {
                    return Err(format!(
                        "{method} emitted a line over {} MiB without a newline; run terminated",
                        super::MAX_LINE_BYTES / (1024 * 1024),
                    ));
                }
                Ok(Err(error)) => {
                    return match settled.take() {
                        Some(result) => Ok(result),
                        None => Err(format!("{method} stdout error: {error}")),
                    };
                }
                Err(_) => {
                    if let Some(result) = settled.take() {
                        return Ok(result);
                    }
                    if deadline.is_some_and(|until| until <= Instant::now()) {
                        return Err(format!("{method} timed out"));
                    }
                    continue;
                }
            };
            let text = String::from_utf8_lossy(&bytes);
            let line = text.trim();
            if line.is_empty() {
                continue;
            }
            let Ok(value) = serde_json::from_str::<Value>(line) else {
                continue;
            };
            let parsed = parse_acp_line(&value);
            if let (Some(engine), AcpLine::Notification { method, params }) =
                (&self.reports_as, &parsed)
            {
                if method == "session/update" {
                    super::reported::acp_update(engine, params);
                }
            }
            match parsed {
                AcpLine::Response {
                    id: response_id,
                    result,
                    error,
                } => {
                    if jsonrpc_id_key(&response_id).as_deref() != Some(expected_key.as_str()) {
                        continue;
                    }
                    if let Some(error) = error {
                        return Err(format!("rpc:{}:{method}: {}", error.code, error.message));
                    }
                    let result = result.unwrap_or(Value::Null);
                    if !drain_trailing {
                        return Ok(result);
                    }
                    settled = Some(result);
                    drain_deadline = Some(Instant::now() + PROMPT_TRAILING_CAP);
                }
                other => {
                    if let Some(response) = router(&other) {
                        self.write_line(&response).await?;
                    }
                }
            }
        }
    }

    pub(crate) async fn listen(
        &mut self,
        wait: Duration,
        router: &mut LineRouter<'_>,
    ) -> Result<bool, String> {
        let bytes = match timeout(
            wait,
            super::read_line_capped(&mut self.reader, &mut self.line_buf),
        )
        .await
        {
            Err(_) => return Ok(false),
            Ok(Ok(super::LineRead::Line(bytes))) => bytes,
            Ok(Ok(super::LineRead::Eof)) => return Err("ACP stdout closed".to_string()),
            Ok(Ok(super::LineRead::TooLong)) => {
                return Err("the ACP agent sent a line too long to read".to_string())
            }
            Ok(Err(error)) => return Err(format!("ACP stdout error: {error}")),
        };
        let text = String::from_utf8_lossy(&bytes);
        let Ok(value) = serde_json::from_str::<Value>(text.trim()) else {
            return Ok(true);
        };
        let parsed = parse_acp_line(&value);
        if let (Some(engine), AcpLine::Notification { method, params }) =
            (&self.reports_as, &parsed)
        {
            if method == "session/update" {
                super::reported::acp_update(engine, params);
            }
        }
        if !matches!(parsed, AcpLine::Response { .. }) {
            if let Some(response) = router(&parsed) {
                self.write_line(&response).await?;
            }
        }
        Ok(true)
    }

    async fn notify(&mut self, method: &str, params: Value) -> Result<(), String> {
        self.write_line(&jsonrpc_notification(method, params)).await
    }
}

pub(crate) struct SpawnedAcp {
    pub(crate) child: Child,
    pub(crate) acp: AcpProcess,
    pub(crate) stderr_buf: Arc<Mutex<String>>,
    #[cfg(windows)]
    pub(crate) _tree_guard: Option<Arc<super::job::KillOnCloseJob>>,
}

pub(crate) fn spawn_piped_acp(
    command: &mut Command,
    label: &str,
    workspace: &Path,
) -> Result<SpawnedAcp, String> {
    command
        .current_dir(workspace)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    super::hide_console(command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("failed to spawn {label}: {error}"))?;
    #[cfg(windows)]
    let tree_guard = super::job::assign_kill_on_close(&child);
    let (stdin, stdout, stderr) =
        match (child.stdin.take(), child.stdout.take(), child.stderr.take()) {
            (Some(stdin), Some(stdout), Some(stderr)) => (stdin, stdout, stderr),
            _ => {
                let _ = child.start_kill();
                return Err("missing stdio pipe after spawn".to_string());
            }
        };
    Ok(SpawnedAcp {
        child,
        acp: AcpProcess::new(
            Arc::new(TokioMutex::new(Some(stdin))),
            stdout,
            workspace.to_path_buf(),
        ),
        stderr_buf: super::spawn_stderr_capture(stderr),
        #[cfg(windows)]
        _tree_guard: tree_guard,
    })
}

pub(crate) async fn teardown(child: &mut Child) {
    if let Some(pid) = child.id() {
        super::kill_process_group(pid);
    }
    let _ = child.kill().await;
    let _ = timeout(POST_TERMINAL_DRAIN, child.wait()).await;
}

#[cfg(test)]
#[path = "acp_session_tests.rs"]
mod tests;
