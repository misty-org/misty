// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/qoder_session.rs.
//! Qoder ACP turn driver: one send = one `qodercli --acp` child speaking
//! JSON-RPC over stdio, settled like [`super::dsh_session::run_host_turn`].
//!
//! Wire (reference-verified against qodercli 1.1.28; mode handling against
//! the 1.1.79 bundle):
//! - Spawn: `--acp --permission-mode bypass_permissions` (see ACP_LAUNCH_ARGS).
//! - Handshake: initialize → session/new | session/resume (req.session_id)
//!   → session/set_model? → session/set_config_option (reasoning_effort)?
//!   → session/set_mode bypassPermissions (only when not already bypass)
//!   → session/prompt.
//! - The turn streams as session/update notifications and settles on the
//!   typed prompt response — which qodercli slips BETWEEN notifications
//!   (first user chunk → result → thought/tool/final text), so after the
//!   response lands the reader keeps draining until idle (trailing drain),
//!   or the turn loses its tail.
//! - Interrupt writes session/cancel; the CLI usually answers with a typed
//!   cancelled response within ~2s, then the child is killed.
//! - Agent-initiated requests are answered by this client: permission
//!   requests auto-allow (headless, bypassPermissions mode), fs/* is served
//!   confined to the workspace root.

use std::collections::HashMap;
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

fn attach_context_window(mut usage: Value) -> Value {
    if usage.get("model_context_window").is_some() {
        return usage;
    }

    let window = usage
        .get("context_window")
        .or_else(|| usage.get("contextWindow"))
        .or_else(|| usage.get("model_context_window"))
        .and_then(|v| match v {
            Value::Number(n) => n.as_i64(),
            Value::String(s) => s.parse().ok(),
            _ => None,
        })
        .filter(|&w| w > 0);

    if let Some(w) = window {
        if let Some(obj) = usage.as_object_mut() {
            obj.insert("model_context_window".to_string(), Value::Number(w.into()));
        }
    }

    usage
}

use super::{EngineEvent, SendRequest, TurnCore, TurnState, VirtualRunGuard};

#[path = "qoder_session_framing.rs"]
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
const MODEL_PROBE_TIMEOUT: Duration = Duration::from_secs(15);
const MODEL_PROBE_TOTAL: Duration = Duration::from_secs(20);

pub(crate) const JSONRPC_METHOD_NOT_FOUND: i64 = -32601;
pub(crate) const JSONRPC_INVALID_PARAMS: i64 = -32602;
pub(crate) const JSONRPC_INTERNAL_ERROR: i64 = -32603;
pub(crate) const CANCELLED: &str = "qoder turn cancelled";

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum QoderSessionUpdate {
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

pub(crate) fn map_session_update(update: &Value) -> QoderSessionUpdate {
    let kind = update
        .get("sessionUpdate")
        .and_then(Value::as_str)
        .unwrap_or("");
    match kind {
        "agent_message_chunk" => {
            let text = extract_content_text(update.get("content"));
            if text.is_empty() {
                QoderSessionUpdate::Ignore
            } else {
                QoderSessionUpdate::AgentMessageChunk { text }
            }
        }
        "agent_thought_chunk" => {
            let text = extract_content_text(update.get("content"));
            if text.is_empty() {
                QoderSessionUpdate::Ignore
            } else {
                QoderSessionUpdate::AgentThoughtChunk { text }
            }
        }
        "tool_call" => {
            let status = update
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("pending");
            let Some(tool_id) = extract_tool_call_id(update) else {
                return QoderSessionUpdate::Ignore;
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
                return QoderSessionUpdate::ToolCompleted {
                    tool_id,
                    tool_name: Some(tool_name),
                    output,
                    error,
                };
            }
            if status != "pending" && status != "in_progress" {
                return QoderSessionUpdate::Ignore;
            }
            QoderSessionUpdate::ToolStarted {
                tool_id,
                tool_name,
                input,
            }
        }
        "tool_call_update" => {
            let status = update.get("status").and_then(Value::as_str).unwrap_or("");
            if status != "completed" && status != "failed" {
                return QoderSessionUpdate::Ignore;
            }
            let Some(tool_id) = extract_tool_call_id(update) else {
                return QoderSessionUpdate::Ignore;
            };
            let output = update
                .get("rawOutput")
                .cloned()
                .or_else(|| update.get("output").cloned())
                .or_else(|| update.get("content").cloned());
            let error = (status == "failed")
                .then(|| extract_tool_content_text(update).trim().to_string())
                .filter(|value| !value.is_empty());
            QoderSessionUpdate::ToolCompleted {
                tool_id,
                tool_name: extract_tool_name(update),
                output,
                error,
            }
        }
        _ => QoderSessionUpdate::Ignore,
    }
}

pub(crate) fn session_update_from_notification(params: &Value) -> QoderSessionUpdate {
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

fn non_empty(value: Option<&Value>) -> Option<String> {
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

fn misty_mode_id(mode: &str) -> String {
    match mode {
        "acceptEdits" => "accept_edits",
        "dontAsk" => "dont_ask",
        "yolo" | "bypassPermissions" => "bypass_permissions",
        other => other,
    }
    .to_string()
}

fn handshake_state(session_result: &Value, req: &SendRequest, bypass_set: bool) -> AcpSessionState {
    let mut known = session_result
        .get("configOptions")
        .map(config_options_state)
        .unwrap_or_default();
    if let Some(mode) = non_empty(session_result.pointer("/modes/currentModeId")) {
        known.mode = Some(mode);
    }
    if let Some(model) = non_empty(session_result.pointer("/models/currentModelId")) {
        known.model = Some(model);
    }
    let asked = |value: &Option<String>| {
        value
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    if let Some(model) = asked(&req.model) {
        known.model = Some(model);
    }
    if let Some(effort) = asked(&req.effort) {
        known.effort = Some(effort);
    }
    if bypass_set {
        known.mode = Some("yolo".to_string());
    }
    known.mode = known.mode.as_deref().map(misty_mode_id);
    known
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
    reason = "serves Qoder's file requests inside the run's own folder, which need not be linked"
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
    reason = "serves Qoder's file requests inside the run's own folder, which need not be linked"
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

fn extract_session_id(value: &Value) -> Option<String> {
    value
        .get("sessionId")
        .or_else(|| value.get("session_id"))
        .or_else(|| value.get("id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn session_setting_error(setting: &str, value: &str, error: String) -> String {
    format!("Qoder {setting} `{value}` setup failed: {error}")
}

fn parse_rpc_error_message(message: &str) -> String {
    if let Some(rest) = message.strip_prefix("rpc:") {
        if let Some((_, text)) = rest.split_once(':') {
            return match text.split_once(": ") {
                Some((method, text))
                    if !method.is_empty() && !method.contains(char::is_whitespace) =>
                {
                    text.to_string()
                }
                _ => text.to_string(),
            };
        }
    }
    message.to_string()
}

fn assemble_prompt_blocks(
    text: &str,
    images: &[String],
    workspace: &Path,
) -> Result<Vec<Value>, String> {
    let mut blocks = vec![json!({ "type": "text", "text": text })];
    for raw in images {
        let (mime, base64) = super::images::load_image(raw, workspace)?;
        blocks.push(json!({
            "type": "image",
            "data": base64,
            "mimeType": mime,
        }));
    }
    Ok(blocks)
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

    async fn request(
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

const ACP_LAUNCH_ARGS: [&str; 3] = ["--acp", "--permission-mode", "bypass_permissions"];

async fn spawn_acp(bin: &str, workspace: &Path, launch: &str) -> Result<SpawnedAcp, String> {
    let mut command = super::command_for_binary(bin);
    match launch {
        "bypass" => {
            command.args(ACP_LAUNCH_ARGS);
        }
        "auto" => {
            command.args(["--acp", "--permission-mode", "accept_edits"]);
        }
        _ => {
            command.arg("--acp");
        }
    }
    spawn_piped_acp(&mut command, bin, workspace)
}

fn launch_level(req: &SendRequest) -> &'static str {
    use super::Engine;
    super::qoder::QoderEngine::new(super::qoder::QoderDistribution::Global)
        .resolve_permission(req.permission.as_deref())
}

fn bypass_mode_active(session_result: &Value) -> bool {
    matches!(
        session_result
            .pointer("/modes/currentModeId")
            .and_then(Value::as_str),
        Some("bypassPermissions" | "yolo")
    )
}

pub(crate) async fn teardown(child: &mut Child) {
    if let Some(pid) = child.id() {
        super::kill_process_group(pid);
    }
    let _ = child.kill().await;
    let _ = timeout(POST_TERMINAL_DRAIN, child.wait()).await;
}

#[derive(Default)]
struct TurnView {
    pending_error_chunks: Vec<String>,
    last_usage: Option<Value>,
    tool_names: HashMap<String, String>,
    session: AcpSessionState,
}

pub(crate) async fn run_acp_turn(
    core: TurnCore,
    req: SendRequest,
    bin: String,
    killed: Arc<AtomicBool>,
    virtual_pid: u32,
) {
    let mut state = TurnState::new(req.session_id.clone());
    let mut view = TurnView::default();
    let preassigned_session_id = req.session_id.clone();
    let _registry_guard =
        VirtualRunGuard::new(Arc::clone(&core.registry), core.run_id.clone(), virtual_pid);
    let result = turn_inner(&core, &mut state, &mut view, &req, &bin, &killed).await;
    if let Err(error) = result {
        if !killed.load(Ordering::SeqCst) {
            core.dispatch_event(&mut state, EngineEvent::Error(error));
        }
    }
    if !state.saw_done && !state.saw_error {
        let usage = if killed.load(Ordering::SeqCst) {
            None
        } else {
            view.last_usage.clone()
        };
        let session_id = state.native_session_id.clone();
        core.dispatch_event(&mut state, EngineEvent::Done { session_id, usage });
    }
    core.registry.remove_if_pid(&core.run_id, virtual_pid);
    if let Some(session_id) = state.native_session_id.clone() {
        core.registry.remove_if_pid(&session_id, virtual_pid);
    }
    if let Some(session_id) = preassigned_session_id {
        core.registry.remove_if_pid(&session_id, virtual_pid);
    }
    core.sink.flush();
}

async fn turn_inner(
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    req: &SendRequest,
    bin: &str,
    killed: &Arc<AtomicBool>,
) -> Result<(), String> {
    if super::qoder::is_qoder_ide_launcher_bin(bin) {
        return Err(
            "qoderBin must point to qodercli, not the Qoder IDE launcher (`qoder`)".to_string(),
        );
    }
    let fingerprint = super::warm::claim(&core.run_id);
    let mut warm = match super::warm::take_acp(core, req, fingerprint) {
        Some(warm) => {
            view.session = warm.item.known.clone();
            core.dispatch_event(state, EngineEvent::SessionId(warm.item.session_id.clone()));
            warm
        }
        None => {
            let mut spawned = spawn_acp(bin, &req.workspace, launch_level(req)).await?;
            core.registry
                .set_stdin(&core.run_id, Arc::clone(&spawned.acp.stdin));
            spawned.acp.gate = Some(crate::engines::gate::AcpGate::of(core, req));
            spawned.acp.reports_as = Some(core.engine_id.clone());
            let session_id = match handshake(&mut spawned.acp, core, state, view, req, killed).await
            {
                Ok(session_id) => session_id,
                Err(error) => {
                    teardown(&mut spawned.child).await;
                    return Err(terminal_message(error, view, &spawned.stderr_buf));
                }
            };
            super::warm::Warm {
                item: super::warm::WarmAcp {
                    spawned,
                    session_id,
                    effort: None,
                    known: Default::default(),
                },
                token: None,
                cleanup: Vec::new(),
            }
        }
    };
    warm.item.spawned.acp.gate = Some(crate::engines::gate::AcpGate::of(core, req));
    let session_id = warm.item.session_id.clone();
    let result = match prompt(
        &mut warm.item.spawned.acp,
        core,
        state,
        view,
        req,
        killed,
        &session_id,
    )
    .await
    {
        Ok(()) => Ok(()),
        Err(error) => Err(terminal_message(error, view, &warm.item.spawned.stderr_buf)),
    };
    warm.item.known = view.session.clone();
    let clean = result.is_ok() && !killed.load(Ordering::SeqCst);
    super::warm::park_acp(core, req, fingerprint, clean, warm);
    result
}

async fn handshake(
    acp: &mut AcpProcess,
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    req: &SendRequest,
    killed: &AtomicBool,
) -> Result<String, String> {
    let agent = acp
        .request(
            "initialize",
            initialize_params(),
            RPC_HANDSHAKE_TIMEOUT,
            killed,
            None,
            &mut |_| {},
        )
        .await?;
    let servers = crate::engines::gate::acp_mcp_servers(req, &agent);
    let cwd = req.workspace.to_string_lossy().to_string();
    let extra = additional_directories(&req.additional_dirs);
    let session_result = match req.session_id.as_deref() {
        Some(session_id) => {
            acp.request(
                "session/resume",
                json!({
                    "cwd": cwd,
                    "mcpServers": servers.clone(),
                    "sessionId": session_id,
                    "additionalDirectories": extra,
                }),
                SESSION_RESUME_TIMEOUT,
                killed,
                None,
                &mut |_| {},
            )
            .await?
        }
        None => {
            acp.request(
                "session/new",
                json!({ "cwd": cwd, "mcpServers": servers, "additionalDirectories": extra }),
                SESSION_NEW_TIMEOUT,
                killed,
                None,
                &mut |_| {},
            )
            .await?
        }
    };
    let session_id = extract_session_id(&session_result)
        .or_else(|| req.session_id.clone())
        .ok_or_else(|| "Qoder session handshake returned no sessionId".to_string())?;
    core.dispatch_event(state, EngineEvent::SessionId(session_id.clone()));

    if let Some(model) = req
        .model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        acp.request(
            "session/set_model",
            json!({ "sessionId": session_id, "modelId": model }),
            RPC_HANDSHAKE_TIMEOUT,
            killed,
            None,
            &mut |_| {},
        )
        .await
        .map_err(|error| session_setting_error("model", model, error))?;
    }
    if let Some(effort) = req
        .effort
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        acp.request(
            "session/set_config_option",
            json!({ "sessionId": session_id, "configId": "reasoning_effort", "value": effort }),
            RPC_HANDSHAKE_TIMEOUT,
            killed,
            None,
            &mut |_| {},
        )
        .await
        .map_err(|error| session_setting_error("reasoning effort", effort, error))?;
    }
    let bypass_set = launch_level(req) == "bypass" && !bypass_mode_active(&session_result);
    if bypass_set {
        acp.request(
            "session/set_mode",
            json!({ "sessionId": session_id, "modeId": "bypassPermissions" }),
            RPC_HANDSHAKE_TIMEOUT,
            killed,
            None,
            &mut |_| {},
        )
        .await?;
    }
    view.session = handshake_state(&session_result, req, bypass_set);
    Ok(session_id)
}

async fn prompt(
    acp: &mut AcpProcess,
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    req: &SendRequest,
    killed: &AtomicBool,
    session_id: &str,
) -> Result<(), String> {
    let prompt_blocks = assemble_prompt_blocks(&req.prompt, &req.images, &req.workspace)?;
    let result = acp
        .request(
            "session/prompt",
            json!({ "sessionId": session_id, "prompt": prompt_blocks }),
            PROMPT_TIMEOUT,
            killed,
            Some(session_id),
            &mut |params| handle_session_update(core, state, view, params),
        )
        .await?;
    if let Some(usage) = result.get("usage").filter(|usage| !usage.is_null()) {
        view.last_usage = Some(attach_context_window(usage.clone()));
        core.dispatch_event(
            state,
            EngineEvent::Usage(attach_context_window(usage.clone())),
        );
    }
    Ok(())
}

#[allow(
    clippy::disallowed_methods,
    reason = "checks the folders the person added to a Qoder run, which need not be linked"
)]
fn additional_directories(dirs: &[String]) -> Vec<&str> {
    dirs.iter()
        .map(String::as_str)
        .filter(|dir| Path::new(dir).is_dir())
        .collect()
}

fn handle_session_update(
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    params: &Value,
) {
    if let Some(usage) = super::kimi_acp::usage(params) {
        view.last_usage = Some(usage.clone());
        core.dispatch_event(state, EngineEvent::Usage(usage));
    }
    if let Some(update) = session_state_update(params) {
        let update = AcpSessionState {
            mode: update.mode.as_deref().map(misty_mode_id),
            ..update
        };
        for event in view.session.follow(update) {
            core.dispatch_event(state, event);
        }
        return;
    }
    match session_update_from_notification(params) {
        QoderSessionUpdate::AgentMessageChunk { text } => {
            if is_error_prefixed_text(&text) {
                view.pending_error_chunks.push(text);
                return;
            }
            core.dispatch_event(state, EngineEvent::Delta(text));
        }
        QoderSessionUpdate::AgentThoughtChunk { text } => {
            core.dispatch_event(state, EngineEvent::Thinking(text));
        }
        QoderSessionUpdate::ToolStarted {
            tool_id,
            tool_name,
            input,
        } => {
            view.tool_names.insert(tool_id, tool_name.clone());
            core.dispatch_event(state, super::tool_call_message(tool_name, input.as_ref()));
        }
        QoderSessionUpdate::ToolCompleted {
            tool_id,
            tool_name,
            output,
            error,
        } => {
            let name = tool_name
                .or_else(|| view.tool_names.get(&tool_id).cloned())
                .unwrap_or_else(|| "tool".to_string());
            let result = match (output, error) {
                (Some(output), _) => output,
                (None, Some(error)) => json!({ "text": error, "isError": true }),
                (None, None) => Value::Null,
            };
            core.dispatch_event(state, super::tool_result_patch(name, Some(&result)));
        }
        QoderSessionUpdate::Ignore => {}
    }
}

fn terminal_message(raw: String, view: &TurnView, stderr_buf: &Arc<Mutex<String>>) -> String {
    if !view.pending_error_chunks.is_empty() {
        return view.pending_error_chunks.join("\n");
    }
    let parsed = parse_rpc_error_message(&raw);
    if !parsed.trim().is_empty() {
        return parsed;
    }
    let stderr_tail = stderr_buf
        .lock()
        .map(|tail| tail.trim().to_string())
        .unwrap_or_default();
    if !stderr_tail.is_empty() {
        stderr_tail
    } else {
        raw
    }
}

pub(crate) struct QoderModelEntry {
    pub id: String,
    pub name: Option<String>,
    pub is_default: bool,
}

pub(crate) fn parse_models_from_session_new(result: &Value) -> Vec<QoderModelEntry> {
    let models_node = result.get("models").unwrap_or(result);
    let current = models_node
        .get("currentModelId")
        .or_else(|| models_node.get("current_model_id"))
        .and_then(Value::as_str);
    let mut models: Vec<QoderModelEntry> = models_node
        .get("availableModels")
        .or_else(|| models_node.get("available_models"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let id = entry
                .get("modelId")
                .or_else(|| entry.get("id"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|id| !id.is_empty())?
                .to_string();
            let name = entry
                .get("name")
                .or_else(|| entry.get("displayName"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|name| !name.is_empty() && *name != id)
                .map(str::to_string);
            let is_default = current == Some(id.as_str());
            Some(QoderModelEntry {
                id,
                name,
                is_default,
            })
        })
        .collect();
    if current.is_none() {
        if let Some(first) = models.first_mut() {
            first.is_default = true;
        }
    }
    models
}

pub(crate) async fn probe_models(bin: &str) -> Result<(Vec<QoderModelEntry>, Value), String> {
    if super::qoder::is_qoder_ide_launcher_bin(bin) {
        return Err(
            "qoderBin must point to qodercli, not the Qoder IDE launcher (`qoder`)".to_string(),
        );
    }
    let cwd = std::env::temp_dir();
    let killed = AtomicBool::new(false);
    let result = timeout(MODEL_PROBE_TOTAL, async {
        let mut spawned = spawn_acp(bin, &cwd, "manual").await?;
        let cwd_string = cwd.to_string_lossy().to_string();
        let result = async {
            spawned
                .acp
                .request(
                    "initialize",
                    initialize_params(),
                    RPC_HANDSHAKE_TIMEOUT,
                    &killed,
                    None,
                    &mut |_| {},
                )
                .await?;
            spawned
                .acp
                .request(
                    "session/new",
                    json!({ "cwd": cwd_string, "mcpServers": [] }),
                    MODEL_PROBE_TIMEOUT,
                    &killed,
                    None,
                    &mut |_| {},
                )
                .await
        }
        .await;
        teardown(&mut spawned.child).await;
        result
    })
    .await
    .map_err(|_| "Qoder's model catalog probe timed out".to_string())??;
    Ok((parse_models_from_session_new(&result), result))
}

pub(crate) async fn fork_session(
    bin: &str,
    workspace: &Path,
    session_id: &str,
    env: &HashMap<String, String>,
) -> Result<String, String> {
    if super::qoder::is_qoder_ide_launcher_bin(bin) {
        return Err(
            "qoderBin must point to qodercli, not the Qoder IDE launcher (`qoder`)".to_string(),
        );
    }
    let mut command = super::command_for_binary(bin);
    command.arg("--acp");
    command.envs(env);
    let killed = AtomicBool::new(false);
    let cwd = workspace.to_string_lossy().to_string();
    let result = timeout(FORK_TOTAL, async {
        let mut spawned = spawn_piped_acp(&mut command, bin, workspace)?;
        let result = async {
            spawned
                .acp
                .request(
                    "initialize",
                    initialize_params(),
                    RPC_HANDSHAKE_TIMEOUT,
                    &killed,
                    None,
                    &mut |_| {},
                )
                .await?;
            spawned
                .acp
                .request(
                    "session/fork",
                    json!({ "cwd": cwd, "mcpServers": [], "sessionId": session_id }),
                    SESSION_NEW_TIMEOUT,
                    &killed,
                    None,
                    &mut |_| {},
                )
                .await
        }
        .await;
        teardown(&mut spawned.child).await;
        result
    })
    .await
    .map_err(|_| "Qoder took too long to fork the session".to_string())?
    .map_err(|error| parse_rpc_error_message(&error).trim().to_string())?;
    extract_session_id(&result).ok_or_else(|| "Qoder's fork returned no sessionId".to_string())
}

const FORK_TOTAL: Duration = Duration::from_secs(120);

#[cfg(test)]
#[path = "qoder_session_tests.rs"]
mod tests;
