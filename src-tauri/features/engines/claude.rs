// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/claude.rs.
use super::{
    command_for_binary, images, push_session_id, tool_call_message_with_id,
    tool_call_patch_with_id, BuiltCommand, Engine, EngineEvent, SendRequest,
};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;

#[path = "claude_denials.rs"]
mod denials;

use denials::{
    extract_absolute_path, is_question_tool, looks_like_permission_denial, tool_result_block_text,
    tool_result_error_blocks,
};

pub struct ClaudeEngine {
    pending_tool_json: Mutex<HashMap<(String, u64), PendingTool>>,
    tool_names: Mutex<HashMap<String, String>>,
    tool_paths: Mutex<HashMap<String, String>>,
    compact_post_tokens: Mutex<Option<i64>>,
    stopped_task_result_pending: Mutex<bool>,
    streamed_text: Mutex<bool>,
    local_text: Mutex<String>,
}

struct PendingTool {
    name: String,
    id: Option<String>,
    json: String,
    tool_call_id: Option<String>,
    path_shown: bool,
}

impl ClaudeEngine {
    pub fn new() -> Self {
        Self {
            pending_tool_json: Mutex::new(HashMap::new()),
            tool_names: Mutex::new(HashMap::new()),
            tool_paths: Mutex::new(HashMap::new()),
            compact_post_tokens: Mutex::new(None),
            stopped_task_result_pending: Mutex::new(false),
            streamed_text: Mutex::new(false),
            local_text: Mutex::new(String::new()),
        }
    }
}

#[path = "claude_sandbox.rs"]
mod sandbox;

#[path = "claude_control.rs"]
pub(crate) mod control;

#[path = "claude_tasks.rs"]
mod tasks;
pub(crate) use tasks::{background_tasks, forget_background_tasks, BackgroundTask};
use tasks::{record_background_tasks, record_task_update};

#[path = "claude_local.rs"]
mod local;
use local::local_command_reply;

#[path = "claude_usage.rs"]
mod usage;
use sandbox::{extra_dirs, folder_sandbox_runs, folder_sandbox_settings};

const MISTY_TOOL_TIMEOUT_MS: u64 = 300_000;
use usage::{attach_reported_context_window, compact_usage};

const CLAUDE_MODES: &[super::modes::EngineMode] = {
    use super::modes::{mode, ModeKind::*};
    &[
        mode("default", "Manual", Asks, "manual"),
        mode("acceptEdits", "Accept edits", Edits, "auto"),
        mode("plan", "Plan", Plans, "plan"),
        mode(
            "bypassPermissions",
            "Bypass permissions",
            NoAsking,
            "bypass",
        ),
    ]
};

fn manual_mode_value() -> &'static str {
    match super::modes::reported("claude") {
        Some(listed) if listed.iter().any(|id| id == "manual") => "manual",
        _ => "default",
    }
}

impl Default for ClaudeEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl Engine for ClaudeEngine {
    fn id(&self) -> &'static str {
        "claude"
    }

    fn reports_served(&self) -> bool {
        true
    }

    fn supports_images(&self) -> bool {
        true
    }
    fn supports_mcp(&self) -> bool {
        true
    }

    fn supports_web_search(&self) -> bool {
        true
    }
    fn supports_effort(&self) -> bool {
        true
    }
    fn modes_help_flag(&self) -> Option<&'static str> {
        Some("--permission-mode")
    }
    fn mode_values(&self, id: &'static str) -> Vec<&'static str> {
        if id == "default" {
            vec!["manual", "default"]
        } else {
            vec![id]
        }
    }
    fn modes(&self) -> &'static [super::modes::EngineMode] {
        CLAUDE_MODES
    }
    fn folder_sandbox(&self) -> bool {
        folder_sandbox_runs()
    }

    fn supports_tool_constraints(&self) -> bool {
        true
    }

    fn build_command(&self, req: &SendRequest, bin: &str) -> Result<BuiltCommand, String> {
        let mut cmd = command_for_binary(bin);
        cmd.arg("-p");
        cmd.arg("--input-format");
        cmd.arg("stream-json");
        cmd.arg("--output-format");
        cmd.arg("stream-json");
        cmd.arg("--verbose");
        cmd.arg("--include-partial-messages");
        cmd.arg("--permission-prompt-tool");
        cmd.arg("stdio");
        let mut preapproved: Vec<&str> = Vec::new();
        let extra_dirs = extra_dirs(req);
        let memory_dir = super::agent_memory::claude_memory_dir(req);
        let mut memory_settings = memory_dir
            .as_ref()
            .map(|dir| serde_json::json!({ "autoMemoryDirectory": dir }));
        if let Some(tools) = req.allowed_tools.as_deref() {
            cmd.arg("--permission-mode");
            cmd.arg("plan");
            cmd.arg("--allowedTools");
            for tool in tools {
                cmd.arg(tool);
            }
            cmd.arg("--disallowedTools");
            for tool in ["Bash", "Edit", "Write", "NotebookEdit", "Task"] {
                if !tools.iter().any(|allowed| allowed == tool) {
                    cmd.arg(tool);
                }
            }
        } else {
            match self.resolve_permission(req.permission.as_deref()) {
                "bypass" => {
                    cmd.arg("--dangerously-skip-permissions");
                    let mut settings = folder_sandbox_settings(&extra_dirs);
                    if let Some(dir) = memory_settings.take() {
                        settings["autoMemoryDirectory"] = dir["autoMemoryDirectory"].clone();
                    }
                    cmd.arg("--settings");
                    cmd.arg(settings.to_string());
                }
                mode => {
                    cmd.arg("--permission-mode");
                    cmd.arg(match mode {
                        "manual" => manual_mode_value(),
                        "plan" => "plan",
                        _ => "acceptEdits",
                    });
                    if mode == "auto" {
                        preapproved.extend(["WebSearch", "WebFetch"]);
                    }
                }
            }
        }
        if let Some(settings) = memory_settings.filter(|_| req.provider_id.is_none()) {
            cmd.arg("--settings");
            cmd.arg(settings.to_string());
        }
        let mut mcp_servers = req
            .mcp_servers
            .as_ref()
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        if let Some(misty) = mcp_servers.get_mut("misty").and_then(Value::as_object_mut) {
            misty
                .entry("timeout")
                .or_insert(serde_json::json!(MISTY_TOOL_TIMEOUT_MS));
        }
        let mut cleanup_files = Vec::new();
        if !mcp_servers.is_empty() {
            let config = serde_json::json!({ "mcpServers": mcp_servers });
            cmd.arg("--mcp-config");
            if mcp_servers.keys().any(|name| name != "misty") {
                let path = stage_private_json(
                    &crate::engines::support::paths::app_home().join("claude-staging"),
                    "mcp",
                    &config,
                )?;
                cmd.arg(&path);
                cleanup_files.push(path);
            } else {
                cmd.arg(config.to_string());
            }
        }
        if !preapproved.is_empty() {
            cmd.arg("--allowedTools");
            for tool in preapproved {
                cmd.arg(tool);
            }
        }
        if let Some(model) = req.model.as_deref() {
            cmd.arg("--model");
            cmd.arg(model);
        }
        if let Some(effort) = req.effort.as_deref() {
            cmd.arg("--effort");
            cmd.arg(effort);
            cmd.env("CLAUDE_CODE_EFFORT_LEVEL", effort);
        }
        if req.service_tier.as_deref() == Some("fast")
            && super::models::claude_fast_offered(req.model.as_deref())
        {
            cmd.arg("--fast-mode");
            cmd.arg("on");
        }
        for dir in &extra_dirs {
            cmd.arg("--add-dir");
            cmd.arg(dir);
        }
        let mut warming = false;
        let mut preassigned = None;
        if let Some(session_id) = req.session_id.as_deref() {
            if super::warm_up::unborn(session_id) {
                warming = super::warm_up::take_warming(session_id);
                if !warming {
                    super::warm_up::born(session_id);
                }
                cmd.arg("--session-id");
                preassigned = Some(session_id.to_string());
            } else {
                cmd.arg("--resume");
            }
            cmd.arg(session_id);
        }
        let stdin_payload = if warming {
            None
        } else {
            Some(images::claude_stdin_message(
                &req.prompt,
                &req.images,
                &req.workspace,
            )?)
        };
        Ok(BuiltCommand {
            command: cmd,
            stdin_payload,
            keep_stdin_open: true,
            cleanup_files,
            preassigned_session_id: preassigned,
        })
    }

    fn parse_line(&self, line: &str, out: &mut Vec<EngineEvent>) {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            return;
        };
        let parent = value
            .get("parent_tool_use_id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
            .map(str::to_string);
        if let Some(parent) = parent {
            let mut nested = Vec::new();
            self.parse_value(&value, &mut nested);
            if !nested.is_empty() {
                out.push(EngineEvent::Scope {
                    parent: Some(parent),
                });
                out.append(&mut nested);
                out.push(EngineEvent::Scope { parent: None });
            }
            return;
        }
        self.parse_value(&value, out);
    }
}

impl ClaudeEngine {
    fn parse_value(&self, value: &Value, out: &mut Vec<EngineEvent>) {
        let value = value.clone();
        let event_type = value.get("type").and_then(Value::as_str).unwrap_or("");
        if event_type == "rate_limit_event" {
            crate::engine_config::usage_limits::record_claude_rate_limit(&value);
        }
        match event_type {
            "system" => {
                push_session_id(&value, "session_id", out);
                let subtype = value.get("subtype").and_then(Value::as_str);
                if subtype == Some("api_retry") {
                    out.push(EngineEvent::Retry {
                        attempt: value.get("attempt").and_then(Value::as_u64).unwrap_or(0),
                        max: value
                            .get("max_retries")
                            .and_then(Value::as_u64)
                            .unwrap_or(0),
                        message: format_api_retry(&value),
                    });
                } else if subtype == Some("init") {
                    super::reported::claude_init("claude", &value);
                    let servers = value
                        .get("mcp_servers")
                        .or_else(|| value.get("mcpServers"))
                        .and_then(Value::as_array)
                        .map(|items| {
                            items
                                .iter()
                                .filter_map(|item| {
                                    let name = item
                                        .get("name")
                                        .and_then(Value::as_str)
                                        .map(str::trim)
                                        .filter(|name| !name.is_empty())?;
                                    let status = item
                                        .get("status")
                                        .and_then(Value::as_str)
                                        .map(str::trim)
                                        .filter(|status| !status.is_empty())
                                        .map(str::to_string);
                                    Some((name.to_string(), status))
                                })
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default();
                    if !servers.is_empty() {
                        let tools = value
                            .get("tools")
                            .and_then(Value::as_array)
                            .map(|items| {
                                items
                                    .iter()
                                    .filter_map(Value::as_str)
                                    .map(str::to_string)
                                    .collect::<Vec<_>>()
                            })
                            .unwrap_or_default();
                        out.push(EngineEvent::McpServers { servers, tools });
                    }
                } else if subtype == Some("task_notification") {
                    if value.get("status").and_then(Value::as_str) == Some("stopped") {
                        if let Ok(mut lock) = self.stopped_task_result_pending.lock() {
                            *lock = true;
                        }
                    }
                } else if subtype == Some("background_tasks_changed") {
                    let pending = value
                        .get("tasks")
                        .and_then(Value::as_array)
                        .map_or(0, Vec::len);
                    record_background_tasks(&value);
                    out.push(EngineEvent::BackgroundTasks { pending });
                } else if subtype == Some("task_updated") {
                    record_task_update(&value);
                } else if subtype == Some("compact_boundary") {
                    if let Some(post_tokens) = value
                        .get("compactMetadata")
                        .and_then(|m| m.get("postTokens").or_else(|| m.get("post_tokens")))
                        .and_then(Value::as_i64)
                    {
                        if let Ok(mut lock) = self.compact_post_tokens.lock() {
                            *lock = Some(post_tokens);
                        }
                        let usage_obj = serde_json::json!({
                            "input_tokens": post_tokens,
                            "total_tokens": post_tokens,
                        });
                        out.push(EngineEvent::Usage(usage_obj));
                    }
                }
            }
            "stream_event" => {
                let before = out.len();
                parse_stream_event(
                    &self.pending_tool_json,
                    &self.tool_names,
                    &self.tool_paths,
                    &value,
                    out,
                );
                self.note_streamed_text(&out[before..]);
            }
            "assistant" => {
                push_session_id(&value, "session_id", out);
                let reported_model = value
                    .get("message")
                    .and_then(|m| m.get("model"))
                    .or_else(|| value.get("model"))
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string);
                let reported_effort = value
                    .get("message")
                    .and_then(|m| m.get("thinking_effort").or_else(|| m.get("effort")))
                    .or_else(|| value.get("thinking_effort"))
                    .or_else(|| value.get("effort"))
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string);
                if let Some(model) = reported_model.clone() {
                    out.push(EngineEvent::Model(model));
                }
                if let Some(effort) = reported_effort.clone() {
                    out.push(EngineEvent::Effort(effort));
                }
                let synthetic = reported_model
                    .as_deref()
                    .is_some_and(|model| model.starts_with('<'));
                if synthetic {
                    self.keep_local_text(&value);
                }
                let served_model = reported_model.filter(|model| !model.starts_with('<'));
                if served_model.is_some() || reported_effort.is_some() {
                    out.push(EngineEvent::Served {
                        model: served_model,
                        effort: reported_effort,
                    });
                }
            }
            "user" => {
                for (id, text) in tool_result_error_blocks(&value) {
                    if !looks_like_permission_denial(&text) {
                        continue;
                    }
                    let tool = id
                        .as_ref()
                        .and_then(|id| self.tool_names.lock().ok()?.get(id).cloned());
                    if is_question_tool(tool.as_deref()) {
                        continue;
                    }
                    let path = id
                        .as_ref()
                        .and_then(|id| self.tool_paths.lock().ok()?.get(id).cloned())
                        .or_else(|| extract_absolute_path(&text));
                    out.push(EngineEvent::PermissionDenied {
                        tool,
                        path,
                        message: text,
                        tool_use_id: id,
                    });
                }
                if let Some(content) = value
                    .get("message")
                    .and_then(|m| m.get("content"))
                    .and_then(Value::as_array)
                {
                    for block in content {
                        if block.get("type").and_then(Value::as_str) == Some("tool_result") {
                            let block_text = tool_result_block_text(block);
                            if looks_like_permission_denial(&block_text) {
                                continue;
                            }
                            let tool_call_id = block.get("tool_use_id").and_then(Value::as_str);
                            let errored = block
                                .get("is_error")
                                .and_then(Value::as_bool)
                                .unwrap_or(false)
                                .then(|| serde_json::json!({ "isError": true, "content": block_text }));
                            let res = errored
                                .as_ref()
                                .or_else(|| value.get("toolUseResult"))
                                .or_else(|| block.get("content"));
                            let name = tool_call_id
                                .and_then(|id| {
                                    self.tool_names
                                        .lock()
                                        .ok()
                                        .and_then(|map| map.get(id).cloned())
                                })
                                .unwrap_or_default();
                            out.push(super::tool_result_patch_with_id(name, res, tool_call_id));
                        }
                    }
                }
            }
            "result" => {
                let stopped_task_result = self
                    .stopped_task_result_pending
                    .lock()
                    .map(|mut lock| std::mem::take(&mut *lock))
                    .unwrap_or(false);
                if stopped_task_result
                    && value.get("num_turns").and_then(Value::as_u64) == Some(0)
                    && value.get("is_error").and_then(Value::as_bool) != Some(true)
                    && value
                        .get("result")
                        .and_then(Value::as_str)
                        .is_none_or(|text| text.trim().is_empty())
                {
                    return;
                }
                let (streamed, local_text) = self.take_local_output();
                if let Some(denials) = value.get("permission_denials").and_then(Value::as_array) {
                    for denial in denials {
                        let tool = denial
                            .get("tool_name")
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|t| !t.is_empty())
                            .map(str::to_string);
                        if is_question_tool(tool.as_deref()) {
                            continue;
                        }
                        let path = denial.get("tool_input").and_then(super::tool_path_arg);
                        let tool_use_id = denial
                            .get("tool_use_id")
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|id| !id.is_empty())
                            .map(str::to_string);
                        if tool.is_some() || path.is_some() {
                            out.push(EngineEvent::PermissionDenied {
                                tool,
                                path,
                                message: String::new(),
                                tool_use_id,
                            });
                        }
                    }
                }
                let session_id = value
                    .get("session_id")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string);
                let raw_usage = value.get("usage").cloned();
                let usage = if let Ok(mut lock) = self.compact_post_tokens.lock() {
                    match lock.take() {
                        Some(post_tokens) => Some(compact_usage(post_tokens, raw_usage.as_ref())),
                        None => raw_usage,
                    }
                } else {
                    raw_usage
                }
                .map(|usage| attach_reported_context_window(usage, &value))
                .map(|mut usage| {
                    if let (Some(cost), Some(object)) = (
                        value.get("total_cost_usd").and_then(Value::as_f64),
                        usage.as_object_mut(),
                    ) {
                        object.insert("cost_usd".to_string(), Value::from(cost));
                    }
                    usage
                });
                let is_error = value
                    .get("is_error")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let subtype = value.get("subtype").and_then(Value::as_str).unwrap_or("");
                if is_error || subtype.starts_with("error") {
                    let listed = value
                        .get("errors")
                        .and_then(Value::as_array)
                        .map(|errors| {
                            errors
                                .iter()
                                .filter_map(Value::as_str)
                                .collect::<Vec<_>>()
                                .join("\n")
                        })
                        .filter(|text| !text.is_empty());
                    let message = value
                        .get("result")
                        .and_then(Value::as_str)
                        .filter(|text| !text.is_empty())
                        .map(str::to_string)
                        .or(listed)
                        .unwrap_or_else(|| "The turn failed".to_string());
                    out.push(EngineEvent::Error(message));
                } else {
                    if let Some(text) = local_command_reply(streamed, local_text, &value) {
                        out.push(EngineEvent::Delta(text));
                    }
                    out.push(EngineEvent::Done { session_id, usage });
                }
            }
            "control_request" => {
                let request = value.get("request");
                let subtype = request
                    .and_then(|r| r.get("subtype"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let request_id = value
                    .get("request_id")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                if request_id.is_empty() {
                    return;
                }
                if subtype == "can_use_tool" {
                    let tool_name = request
                        .and_then(|r| r.get("tool_name"))
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    if tool_name == "AskUserQuestion" {
                        out.push(EngineEvent::Question {
                            request_id: request_id.to_string(),
                            tool_use_id: request
                                .and_then(|r| r.get("tool_use_id"))
                                .and_then(Value::as_str)
                                .map(str::to_string),
                            input: request
                                .and_then(|r| r.get("input"))
                                .cloned()
                                .unwrap_or(Value::Null),
                        });
                    } else {
                        out.push(EngineEvent::ControlPermission {
                            request_id: request_id.to_string(),
                            tool_name,
                            input: request
                                .and_then(|r| r.get("input"))
                                .cloned()
                                .unwrap_or(Value::Null),
                        });
                    }
                } else if subtype == "elicitation" {
                    out.push(EngineEvent::ElicitationDecline {
                        request_id: request_id.to_string(),
                    });
                } else {
                    out.push(EngineEvent::ControlRequestError {
                        request_id: request_id.to_string(),
                        subtype: subtype.to_string(),
                    });
                }
            }
            "control_cancel_request" => {
                if let Some(request_id) = value.get("request_id").and_then(Value::as_str) {
                    out.push(EngineEvent::QuestionSettled {
                        request_id: request_id.to_string(),
                    });
                }
            }
            _ => {}
        }
    }
}

fn format_api_retry(value: &Value) -> String {
    let attempt = value.get("attempt").and_then(Value::as_u64).unwrap_or(0);
    let max = value
        .get("max_retries")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let delay_ms = value
        .get("retry_delay_ms")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let detail = value
        .get("error")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|e| !e.is_empty() && *e != "unknown");
    let mut msg = match value.get("error_status").and_then(Value::as_u64) {
        Some(code) => format!("API error (HTTP {code})"),
        None => match detail {
            Some(detail) => format!("API error: {detail}"),
            None => "API error".to_string(),
        },
    };
    msg.push_str(&format!(
        "; retrying ({attempt}/{max}) in {:.1}s",
        delay_ms as f64 / 1000.0
    ));
    msg
}

fn parse_stream_event(
    pending: &Mutex<HashMap<(String, u64), PendingTool>>,
    tool_names: &Mutex<HashMap<String, String>>,
    tool_paths: &Mutex<HashMap<String, String>>,
    value: &Value,
    out: &mut Vec<EngineEvent>,
) {
    let Some(event) = value.get("event") else {
        return;
    };
    let agent = value
        .get("parent_tool_use_id")
        .and_then(Value::as_str)
        .unwrap_or("");
    match event.get("type").and_then(Value::as_str) {
        Some("message_start") => out.push(EngineEvent::Generation { active: true }),
        Some("message_stop") => out.push(EngineEvent::Generation { active: false }),
        Some("content_block_delta") => parse_content_block_delta(pending, agent, event, out),
        Some("content_block_start") => {
            parse_content_block_start(pending, agent, tool_names, tool_paths, event, out)
        }
        Some("content_block_stop") => {
            parse_content_block_stop(pending, agent, tool_paths, event, out)
        }
        _ => {}
    }
}

fn parse_content_block_delta(
    pending: &Mutex<HashMap<(String, u64), PendingTool>>,
    agent: &str,
    event: &Value,
    out: &mut Vec<EngineEvent>,
) {
    let Some(delta) = event.get("delta") else {
        return;
    };
    match delta.get("type").and_then(Value::as_str) {
        Some("text_delta") | Some("thinking_delta") => {
            let is_thinking = delta.get("type").and_then(Value::as_str) == Some("thinking_delta");
            let key = if is_thinking { "thinking" } else { "text" };
            let Some(text) = delta.get(key).and_then(Value::as_str) else {
                return;
            };
            if text.is_empty() {
                return;
            }
            if is_thinking {
                out.push(EngineEvent::Thinking(text.to_string()));
            } else {
                out.push(EngineEvent::Delta(text.to_string()));
            }
        }
        Some("input_json_delta") => {
            let Some(partial) = delta.get("partial_json").and_then(Value::as_str) else {
                return;
            };
            if partial.is_empty() {
                return;
            }
            let Some(index) = event.get("index").and_then(Value::as_u64) else {
                return;
            };
            let mut early = None;
            if let Ok(mut map) = pending.lock() {
                if let Some(tool) = map.get_mut(&(agent.to_string(), index)) {
                    tool.json.push_str(partial);
                    if !tool.path_shown {
                        if tool.json.len() > 4096 {
                            tool.path_shown = true;
                        } else if let Some(path) = streamed_path(&tool.json) {
                            tool.path_shown = true;
                            if serde_json::from_str::<Value>(tool.json.trim()).is_err() {
                                early = Some((tool.name.clone(), path, tool.tool_call_id.clone()));
                            }
                        }
                    }
                }
            }
            if let Some((name, path, tool_call_id)) = early {
                out.push(tool_call_patch_with_id(
                    name,
                    Some(&serde_json::json!({ "file_path": path })),
                    tool_call_id.as_deref(),
                ));
            }
        }
        _ => {}
    }
}

fn streamed_path(json: &str) -> Option<String> {
    ["file_path", "notebook_path", "path"]
        .iter()
        .find_map(|key| {
            let at = json.find(&format!("\"{key}\""))? + key.len() + 2;
            let rest = json[at..]
                .trim_start()
                .strip_prefix(':')?
                .trim_start()
                .strip_prefix('"')?;
            let mut escaped = false;
            let (end, _) = rest.char_indices().find(|&(_, c)| {
                if escaped {
                    escaped = false;
                    false
                } else if c == '\\' {
                    escaped = true;
                    false
                } else {
                    c == '"'
                }
            })?;
            let path: String = serde_json::from_str(&format!("\"{}\"", &rest[..end])).ok()?;
            let path = path.trim();
            (!path.is_empty()).then(|| path.to_string())
        })
}

fn parse_content_block_start(
    pending: &Mutex<HashMap<(String, u64), PendingTool>>,
    agent: &str,
    tool_names: &Mutex<HashMap<String, String>>,
    tool_paths: &Mutex<HashMap<String, String>>,
    event: &Value,
    out: &mut Vec<EngineEvent>,
) {
    let Some(block) = event.get("content_block") else {
        return;
    };
    if block.get("type").and_then(Value::as_str) != Some("tool_use") {
        return;
    }
    let name = block
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("tool")
        .to_string();
    let input = block.get("input");
    if let Some(id) = block.get("id").and_then(Value::as_str) {
        if let Ok(mut map) = tool_names.lock() {
            map.insert(id.to_string(), name.clone());
        }
        if let Some(path) = input.and_then(super::tool_path_arg) {
            if let Ok(mut map) = tool_paths.lock() {
                map.insert(id.to_string(), path);
            }
        }
    }
    let tool_call_id = block.get("id").and_then(Value::as_str).map(str::to_string);
    if let Some(index) = event.get("index").and_then(Value::as_u64) {
        if let Ok(mut map) = pending.lock() {
            map.insert(
                (agent.to_string(), index),
                PendingTool {
                    name: name.clone(),
                    id: block.get("id").and_then(Value::as_str).map(str::to_string),
                    json: String::new(),
                    tool_call_id: tool_call_id.clone(),
                    path_shown: false,
                },
            );
        }
    }
    out.push(tool_call_message_with_id(
        name,
        input,
        tool_call_id.as_deref(),
    ));
}

fn parse_content_block_stop(
    pending: &Mutex<HashMap<(String, u64), PendingTool>>,
    agent: &str,
    tool_paths: &Mutex<HashMap<String, String>>,
    event: &Value,
    out: &mut Vec<EngineEvent>,
) {
    let Some(index) = event.get("index").and_then(Value::as_u64) else {
        return;
    };
    let Some(tool) = pending
        .lock()
        .ok()
        .and_then(|mut map| map.remove(&(agent.to_string(), index)))
    else {
        return;
    };
    let trimmed = tool.json.trim();
    if trimmed.is_empty() {
        return;
    }
    let Ok(args) = serde_json::from_str::<Value>(trimmed) else {
        return;
    };
    if let (Some(id), Some(path)) = (tool.id.as_ref(), super::tool_path_arg(&args)) {
        if let Ok(mut map) = tool_paths.lock() {
            map.insert(id.clone(), path);
        }
    }
    out.push(tool_call_patch_with_id(
        tool.name,
        Some(&args),
        tool.tool_call_id.as_deref(),
    ));
}

fn stage_private_json(
    directory: &std::path::Path,
    prefix: &str,
    value: &serde_json::Value,
) -> Result<std::path::PathBuf, String> {
    stage_private_json_with_writer(directory, prefix, value, |file, content| {
        use std::io::Write;
        file.write_all(content)
    })
}

fn stage_private_json_with_writer(
    directory: &std::path::Path,
    prefix: &str,
    value: &serde_json::Value,
    write: impl FnOnce(&mut file_access::fs::File, &[u8]) -> std::io::Result<()>,
) -> Result<std::path::PathBuf, String> {
    let content = serde_json::to_vec(value)
        .map_err(|_| format!("Cannot serialize Claude Code {prefix} settings"))?;
    file_access::fs::create_dir_all(directory)
        .map_err(|e| format!("create Claude Code staging directory: {e}"))?;
    let path = directory.join(format!("{prefix}-{}.json", uuid::Uuid::new_v4()));
    let mut options = file_access::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        options.mode(0o600);
    }
    let mut file = options
        .open(&path)
        .map_err(|e| format!("create private Claude Code settings: {e}"))?;
    if let Err(error) = write(&mut file, &content) {
        drop(file);
        let _ = file_access::fs::remove_file(&path);
        return Err(format!("write private Claude Code settings: {error}"));
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn init_event_reports_mcp_servers_and_tools() {
        let line = serde_json::json!({
            "type": "system",
            "subtype": "init",
            "session_id": "s-1",
            "mcp_servers": [
                { "name": "alpha", "status": "connected" },
                { "name": "broken", "status": "failed" },
                { "name": "  " }
            ],
            "tools": ["Bash", "mcp__alpha__search", 7]
        })
        .to_string();
        let mut out = Vec::new();
        ClaudeEngine::new().parse_line(&line, &mut out);
        let (servers, tools) = out
            .iter()
            .find_map(|event| match event {
                EngineEvent::McpServers { servers, tools } => Some((servers, tools)),
                _ => None,
            })
            .expect("init must emit an MCP snapshot event");
        assert_eq!(
            servers,
            &vec![
                ("alpha".to_string(), Some("connected".to_string())),
                ("broken".to_string(), Some("failed".to_string())),
            ]
        );
        assert_eq!(
            tools,
            &vec!["Bash".to_string(), "mcp__alpha__search".to_string()]
        );

        let mut out = Vec::new();
        ClaudeEngine::new().parse_line(
            &serde_json::json!({
                "type": "system",
                "subtype": "init",
                "session_id": "s-2",
                "mcp_servers": []
            })
            .to_string(),
            &mut out,
        );
        assert!(!out
            .iter()
            .any(|event| matches!(event, EngineEvent::McpServers { .. })));
    }

    #[test]
    fn assistant_snapshot_reports_the_served_selection() {
        let mut out = Vec::new();
        ClaudeEngine::new().parse_line(
            &serde_json::json!({
                "type": "assistant",
                "session_id": "s-1",
                "message": { "model": "claude-opus-4", "thinking_effort": "high" }
            })
            .to_string(),
            &mut out,
        );
        assert!(
            out.iter().any(|e| matches!(
                e,
                EngineEvent::Served { model: Some(model), effort: Some(effort) }
                    if model == "claude-opus-4" && effort == "high"
            )),
            "got {out:?}"
        );

        let mut out = Vec::new();
        ClaudeEngine::new().parse_line(
            &serde_json::json!({
                "type": "assistant",
                "message": { "model": "<synthetic>" }
            })
            .to_string(),
            &mut out,
        );
        assert!(
            !out.iter().any(|e| matches!(e, EngineEvent::Served { .. })),
            "got {out:?}"
        );

        let mut out = Vec::new();
        ClaudeEngine::new().parse_line(
            &serde_json::json!({
                "type": "assistant",
                "session_id": "s-1",
                "effort": "max",
                "message": { "model": "claude-opus-4" }
            })
            .to_string(),
            &mut out,
        );
        assert!(
            out.iter()
                .any(|e| matches!(e, EngineEvent::Effort(level) if level == "max")),
            "got {out:?}"
        );
        assert!(
            out.iter().any(|e| matches!(
                e,
                EngineEvent::Served { model: Some(_), effort: Some(effort) } if effort == "max"
            )),
            "got {out:?}"
        );
    }

    #[test]
    fn assistant_message_reports_actual_thinking_effort() {
        let line = serde_json::json!({
            "type": "assistant",
            "session_id": "s-1",
            "message": { "model": "claude-opus-4", "thinking_effort": "high" }
        })
        .to_string();
        let mut out = Vec::new();
        ClaudeEngine::new().parse_line(&line, &mut out);
        assert!(
            out.iter()
                .any(|e| matches!(e, EngineEvent::Effort(level) if level == "high")),
            "got {out:?}"
        );

        let mut out = Vec::new();
        ClaudeEngine::new().parse_line(
            &serde_json::json!({ "type": "assistant", "thinking_effort": " low " }).to_string(),
            &mut out,
        );
        assert!(
            out.iter()
                .any(|e| matches!(e, EngineEvent::Effort(level) if level == "low")),
            "got {out:?}"
        );
        let mut out = Vec::new();
        ClaudeEngine::new().parse_line(
            &serde_json::json!({ "type": "assistant", "thinking_effort": "  " }).to_string(),
            &mut out,
        );
        assert!(
            !out.iter().any(|e| matches!(e, EngineEvent::Effort(_))),
            "got {out:?}"
        );
    }

    #[test]
    fn assistant_snapshot_without_effort_keeps_it_unreported() {
        let mut out = Vec::new();
        ClaudeEngine::new().parse_line(
            &serde_json::json!({
                "type": "assistant",
                "session_id": "s-1",
                "message": { "model": "claude-opus-4" }
            })
            .to_string(),
            &mut out,
        );
        assert!(
            out.iter().any(|event| matches!(
                event,
                EngineEvent::Served { model: Some(model), effort: None }
                    if model == "claude-opus-4"
            )),
            "model remains reported while effort stays unknown: {out:?}"
        );
        assert!(
            !out.iter()
                .any(|event| matches!(event, EngineEvent::Effort(_))),
            "missing stream effort must not be inferred: {out:?}"
        );
    }

    #[test]
    fn ask_user_question_control_request_emits_question() {
        let line = serde_json::json!({
            "type": "control_request",
            "request_id": "req-1",
            "request": {
                "subtype": "can_use_tool",
                "tool_name": "AskUserQuestion",
                "tool_use_id": "call_1",
                "requires_user_interaction": true,
                "input": { "questions": [ { "question": "Q?", "header": "H",
                    "options": [ {"label": "A", "description": "a"}, {"label": "B", "description": "b"} ] } ] }
            }
        })
        .to_string();
        let mut out = Vec::new();
        ClaudeEngine::new().parse_line(&line, &mut out);
        assert_eq!(out.len(), 1);
        match &out[0] {
            EngineEvent::Question {
                request_id,
                tool_use_id,
                input,
            } => {
                assert_eq!(request_id, "req-1");
                assert_eq!(tool_use_id.as_deref(), Some("call_1"));
                assert_eq!(input["questions"][0]["header"], "H");
            }
            other => panic!("expected question event, got {other:?}"),
        }
    }

    #[test]
    fn other_control_asks_go_to_the_gate() {
        let line = serde_json::json!({
            "type": "control_request",
            "request_id": "req-2",
            "request": { "subtype": "can_use_tool", "tool_name": "Bash", "input": {} }
        })
        .to_string();
        let mut out = Vec::new();
        ClaudeEngine::new().parse_line(&line, &mut out);
        match &out[..] {
            [EngineEvent::ControlPermission {
                request_id,
                tool_name,
                ..
            }] => {
                assert_eq!(request_id, "req-2");
                assert_eq!(tool_name, "Bash");
            }
            other => panic!("expected control permission event, got {other:?}"),
        }
    }

    #[test]
    fn control_cancel_request_settles_the_question() {
        let line = serde_json::json!({
            "type": "control_cancel_request",
            "request_id": "req-3"
        })
        .to_string();
        let mut out = Vec::new();
        ClaudeEngine::new().parse_line(&line, &mut out);
        match &out[..] {
            [EngineEvent::QuestionSettled { request_id }] => assert_eq!(request_id, "req-3"),
            other => panic!("expected settled event, got {other:?}"),
        }
    }

    #[test]
    fn mcp_elicitation_control_request_declines_in_place() {
        let line = serde_json::json!({
            "type": "control_request",
            "request_id": "req-elicit-1",
            "request": {
                "subtype": "elicitation",
                "mcp_server_name": "elicit-demo",
                "message": "Continue?",
                "requested_schema": { "type": "object", "properties": { "ok": { "type": "boolean" } } }
            }
        })
        .to_string();
        let mut out = Vec::new();
        ClaudeEngine::new().parse_line(&line, &mut out);
        match &out[..] {
            [EngineEvent::ElicitationDecline { request_id }] => {
                assert_eq!(request_id, "req-elicit-1");
            }
            other => panic!("expected elicitation decline event, got {other:?}"),
        }
    }

    #[test]
    fn unknown_control_request_subtypes_error_in_place() {
        let line = serde_json::json!({
            "type": "control_request",
            "request_id": "req-unknown-1",
            "request": { "subtype": "future_ask", "payload": {} }
        })
        .to_string();
        let mut out = Vec::new();
        ClaudeEngine::new().parse_line(&line, &mut out);
        match &out[..] {
            [EngineEvent::ControlRequestError {
                request_id,
                subtype,
            }] => {
                assert_eq!(request_id, "req-unknown-1");
                assert_eq!(subtype, "future_ask");
            }
            other => panic!("expected control error event, got {other:?}"),
        }
    }

    #[test]
    fn control_request_without_id_is_ignored() {
        let line = serde_json::json!({
            "type": "control_request",
            "request": { "subtype": "elicitation", "message": "Continue?" }
        })
        .to_string();
        let mut out = Vec::new();
        ClaudeEngine::new().parse_line(&line, &mut out);
        assert!(out.is_empty(), "no request_id, nothing to answer: {out:?}");
    }

    #[test]
    fn stream_message_boundaries_open_and_close_the_generation_window() {
        let engine = ClaudeEngine::new();
        let start = serde_json::json!({
            "type": "stream_event",
            "event": { "type": "message_start", "message": { "id": "msg_1" } }
        })
        .to_string();
        let stop = serde_json::json!({
            "type": "stream_event",
            "event": { "type": "message_stop" }
        })
        .to_string();
        let mut out = Vec::new();
        engine.parse_line(&start, &mut out);
        engine.parse_line(&stop, &mut out);
        assert_eq!(out.len(), 2);
        assert!(matches!(&out[0], EngineEvent::Generation { active: true }));
        assert!(matches!(&out[1], EngineEvent::Generation { active: false }));
    }

    #[test]
    fn tool_use_block_start_emits_tool_message() {
        let line = serde_json::json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_start",
                "index": 1,
                "content_block": { "type": "tool_use", "id": "toolu_1", "name": "Bash", "input": {} }
            }
        })
        .to_string();
        let mut out = Vec::new();
        ClaudeEngine::new().parse_line(&line, &mut out);
        assert_eq!(out.len(), 1);
        match &out[0] {
            EngineEvent::Message {
                role,
                text,
                args,
                tool_call_id,
                ..
            } => {
                assert_eq!(role, "tool");
                assert_eq!(text, "Bash");
                assert!(args.is_none());
                assert_eq!(tool_call_id.as_deref(), Some("toolu_1"));
            }
            _ => panic!("expected tool message"),
        }
    }

    #[test]
    fn tool_use_input_json_delta_patches_args() {
        let engine = ClaudeEngine::new();
        let start = serde_json::json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_start",
                "index": 1,
                "content_block": { "type": "tool_use", "id": "toolu_1", "name": "Read", "input": {} }
            }
        })
        .to_string();
        let delta = serde_json::json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_delta",
                "index": 1,
                "delta": { "type": "input_json_delta", "partial_json": "{\"file_path\":\"src/a.ts\"}" }
            }
        })
        .to_string();
        let stop = serde_json::json!({
            "type": "stream_event",
            "event": { "type": "content_block_stop", "index": 1 }
        })
        .to_string();
        let mut out = Vec::new();
        engine.parse_line(&start, &mut out);
        engine.parse_line(&delta, &mut out);
        assert_eq!(out.len(), 1);
        out.clear();
        engine.parse_line(&stop, &mut out);
        assert_eq!(out.len(), 1);
        match &out[0] {
            EngineEvent::Message {
                text,
                path,
                args,
                patch,
                tool_call_id,
                ..
            } => {
                assert_eq!(text, "Read");
                assert_eq!(path.as_deref(), Some("src/a.ts"));
                assert_eq!(args, &Some(serde_json::json!({"file_path": "src/a.ts"})));
                assert!(*patch);
                assert_eq!(tool_call_id.as_deref(), Some("toolu_1"));
            }
            _ => panic!("expected patched tool message"),
        }
    }

    #[test]
    fn a_streaming_write_shows_its_path_before_its_content_ends() {
        let engine = ClaudeEngine::new();
        let line = |event: serde_json::Value| {
            serde_json::json!({ "type": "stream_event", "event": event }).to_string()
        };
        let delta = |partial: &str| {
            line(serde_json::json!({
                "type": "content_block_delta",
                "index": 1,
                "delta": { "type": "input_json_delta", "partial_json": partial }
            }))
        };
        let mut out = Vec::new();
        engine.parse_line(
            &line(serde_json::json!({
                "type": "content_block_start",
                "index": 1,
                "content_block": { "type": "tool_use", "id": "toolu_w", "name": "Write", "input": {} }
            })),
            &mut out,
        );
        engine.parse_line(&delta("{\"file_pa"), &mut out);
        assert_eq!(out.len(), 1);
        engine.parse_line(&delta("th\":\"src/a b.ts\",\"content\":\"hel"), &mut out);
        assert_eq!(out.len(), 2);
        match &out[1] {
            EngineEvent::Message {
                path, args, patch, ..
            } => {
                assert_eq!(path.as_deref(), Some("src/a b.ts"));
                assert_eq!(
                    args,
                    &Some(serde_json::json!({ "file_path": "src/a b.ts" }))
                );
                assert!(*patch);
            }
            _ => panic!("expected the path patch"),
        }
        engine.parse_line(&delta("lo \\\"path\\\" there\"}"), &mut out);
        assert_eq!(out.len(), 2);
        engine.parse_line(
            &line(serde_json::json!({ "type": "content_block_stop", "index": 1 })),
            &mut out,
        );
        assert_eq!(out.len(), 3);
    }

    #[test]
    fn helper_agents_streaming_together_keep_their_own_tool_args() {
        let engine = ClaudeEngine::new();
        let line = |agent: &str, event: serde_json::Value| {
            let mut value = serde_json::json!({ "type": "stream_event", "event": event });
            if !agent.is_empty() {
                value["parent_tool_use_id"] = serde_json::json!(agent);
            }
            value.to_string()
        };
        let start = |id: &str| {
            serde_json::json!({
                "type": "content_block_start",
                "index": 1,
                "content_block": { "type": "tool_use", "id": id, "name": "Read", "input": {} }
            })
        };
        let delta = |path: &str| {
            serde_json::json!({
                "type": "content_block_delta",
                "index": 1,
                "delta": { "type": "input_json_delta", "partial_json": format!("{{\"file_path\":\"{path}\"}}") }
            })
        };
        let stop = serde_json::json!({ "type": "content_block_stop", "index": 1 });
        let mut out = Vec::new();
        engine.parse_line(&line("", start("toolu_main")), &mut out);
        engine.parse_line(&line("toolu_task", start("toolu_helper")), &mut out);
        engine.parse_line(&line("", delta("main.ts")), &mut out);
        engine.parse_line(&line("toolu_task", delta("helper.ts")), &mut out);
        engine.parse_line(&line("", stop.clone()), &mut out);
        engine.parse_line(&line("toolu_task", stop), &mut out);
        let patched: Vec<(Option<String>, Option<serde_json::Value>)> = out
            .iter()
            .filter_map(|event| match event {
                EngineEvent::Message {
                    patch: true,
                    tool_call_id,
                    args,
                    ..
                } => Some((tool_call_id.clone(), args.clone())),
                _ => None,
            })
            .collect();
        assert_eq!(
            patched,
            vec![
                (
                    Some("toolu_main".into()),
                    Some(serde_json::json!({ "file_path": "main.ts" }))
                ),
                (
                    Some("toolu_helper".into()),
                    Some(serde_json::json!({ "file_path": "helper.ts" }))
                ),
            ]
        );
    }

    #[test]
    fn tool_result_is_attributed_via_tool_use_id() {
        let engine = ClaudeEngine::new();
        let start = serde_json::json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_start",
                "index": 0,
                "content_block": { "type": "tool_use", "id": "toolu_1", "name": "Bash", "input": {} }
            }
        })
        .to_string();
        let user = serde_json::json!({
            "type": "user",
            "message": {
                "content": [
                    { "type": "tool_result", "tool_use_id": "toolu_1", "content": "On branch main" }
                ]
            }
        })
        .to_string();
        let mut out = Vec::new();
        engine.parse_line(&start, &mut out);
        out.clear();
        engine.parse_line(&user, &mut out);
        let patch = out
            .iter()
            .find(|e| {
                matches!(
                    e,
                    EngineEvent::Message {
                        patch: true,
                        result: Some(_),
                        ..
                    }
                )
            })
            .expect("expected a tool result patch");
        match patch {
            EngineEvent::Message {
                text,
                result,
                patch,
                tool_call_id,
                ..
            } => {
                assert_eq!(text, "Bash");
                assert_eq!(result, &Some(serde_json::json!("On branch main")));
                assert!(*patch);
                assert_eq!(tool_call_id.as_deref(), Some("toolu_1"));
            }
            _ => unreachable!(),
        }
    }

    #[test]
    fn task_create_result_carries_the_id_and_task_get_patches_nothing() {
        let engine = ClaudeEngine::new();
        let start = |id: &str, name: &str| {
            serde_json::json!({
                "type": "stream_event",
                "event": {
                    "type": "content_block_start",
                    "index": 0,
                    "content_block": { "type": "tool_use", "id": id, "name": name, "input": {} }
                }
            })
            .to_string()
        };
        let answer = |id: &str, envelope: Value, text: &str| {
            serde_json::json!({
                "type": "user",
                "message": { "content": [
                    { "type": "tool_result", "tool_use_id": id, "content": text }
                ]},
                "toolUseResult": envelope
            })
            .to_string()
        };
        let result_todos = |out: &[EngineEvent]| {
            out.iter()
                .find_map(|e| match e {
                    EngineEvent::Message {
                        patch: true,
                        result: Some(_),
                        todos,
                        ..
                    } => Some(todos.clone()),
                    _ => None,
                })
                .expect("expected a tool result patch")
        };

        let mut out = Vec::new();
        engine.parse_line(&start("toolu_c", "TaskCreate"), &mut out);
        out.clear();
        engine.parse_line(
            &answer(
                "toolu_c",
                serde_json::json!({"task": {"id": "1", "subject": "A"}}),
                "Task #1 created successfully: A",
            ),
            &mut out,
        );
        let created = result_todos(&out).expect("TaskCreate result is a todo fact");
        assert_eq!(created.items[0].id.as_deref(), Some("1"));
        assert_eq!(created.items[0].content, "A");

        out.clear();
        engine.parse_line(&start("toolu_g", "TaskGet"), &mut out);
        out.clear();
        engine.parse_line(
            &answer(
                "toolu_g",
                serde_json::json!({"task": {"id": "1", "subject": "A", "description": "",
                    "status": "completed", "blocks": [], "blockedBy": []}}),
                "Task #1: A\nStatus: completed\nDescription: ",
            ),
            &mut out,
        );
        assert!(
            result_todos(&out).is_none(),
            "TaskGet must not patch the todo list"
        );
    }

    #[test]
    fn api_retry_system_event_reports_progress_without_settling() {
        let line = serde_json::json!({
            "type": "system",
            "subtype": "api_retry",
            "attempt": 3,
            "max_retries": 10,
            "retry_delay_ms": 9560,
            "error_status": 529,
            "error": "overloaded",
            "session_id": "s-1"
        })
        .to_string();
        let mut out = Vec::new();
        ClaudeEngine::new().parse_line(&line, &mut out);
        assert_eq!(out.len(), 2);
        match &out[1] {
            EngineEvent::Retry {
                attempt,
                max,
                message,
            } => {
                assert_eq!((*attempt, *max), (3, 10));
                assert!(message.contains("529"), "{message}");
                assert!(message.contains("9.6s"), "{message}");
            }
            other => panic!("expected retry progress, got {other:?}"),
        }
    }

    #[test]
    fn api_retry_without_status_falls_back_to_error_text() {
        let line = serde_json::json!({
            "type": "system",
            "subtype": "api_retry",
            "attempt": 1,
            "max_retries": 10,
            "retry_delay_ms": 1000,
            "error_status": null,
            "error": "unknown"
        })
        .to_string();
        let mut out = Vec::new();
        ClaudeEngine::new().parse_line(&line, &mut out);
        match &out[0] {
            EngineEvent::Retry { message, .. } => {
                assert!(message.starts_with("API error;"), "{message}")
            }
            other => panic!("expected retry progress, got {other:?}"),
        }
    }

    #[test]
    fn text_block_start_emits_nothing() {
        let line = serde_json::json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_start",
                "index": 0,
                "content_block": { "type": "text", "text": "" }
            }
        })
        .to_string();
        let mut out = Vec::new();
        ClaudeEngine::new().parse_line(&line, &mut out);
        assert!(out.is_empty());
    }

    #[test]
    fn tool_result_permission_denial_surfaces_path() {
        let line = serde_json::json!({
            "type": "user",
            "message": {
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": "toolu_1",
                    "is_error": true,
                    "content": [{
                        "type": "text",
                        "text": "Claude requested permissions to read from C:\\dev\\frontend, but you haven't granted it yet."
                    }]
                }]
            }
        })
        .to_string();
        let mut out = Vec::new();
        ClaudeEngine::new().parse_line(&line, &mut out);
        assert_eq!(out.len(), 1);
        match &out[0] {
            EngineEvent::PermissionDenied {
                tool,
                path,
                message,
                ..
            } => {
                assert_eq!(*tool, None);
                assert_eq!(path.as_deref(), Some(r"C:\dev\frontend"));
                assert!(message.contains("requested permissions"));
            }
            _ => panic!("expected permission denial"),
        }
    }

    #[test]
    fn tool_result_denial_resolves_path_from_tool_input() {
        let engine = ClaudeEngine::new();
        let start = serde_json::json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_start",
                "index": 0,
                "content_block": { "type": "tool_use", "id": "toolu_9", "name": "Read", "input": {} }
            }
        })
        .to_string();
        let delta = serde_json::json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_delta",
                "index": 0,
                "delta": { "type": "input_json_delta", "partial_json": "{\"file_path\":\"/etc/hosts\"}" }
            }
        })
        .to_string();
        let stop = serde_json::json!({
            "type": "stream_event",
            "event": { "type": "content_block_stop", "index": 0 }
        })
        .to_string();
        let denial = serde_json::json!({
            "type": "user",
            "message": {
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": "toolu_9",
                    "is_error": true,
                    "content": "Claude requested permissions to read this file, but you haven't granted it yet."
                }]
            }
        })
        .to_string();
        let mut out = Vec::new();
        for line in [&start, &delta, &stop, &denial] {
            engine.parse_line(line, &mut out);
        }
        let denial = out
            .iter()
            .find(|e| matches!(e, EngineEvent::PermissionDenied { .. }))
            .expect("expected permission denial");
        match denial {
            EngineEvent::PermissionDenied {
                tool,
                path,
                tool_use_id,
                ..
            } => {
                assert_eq!(tool.as_deref(), Some("Read"));
                assert_eq!(path.as_deref(), Some("/etc/hosts"));
                assert_eq!(tool_use_id.as_deref(), Some("toolu_9"));
            }
            _ => unreachable!(),
        }
    }

    #[test]
    fn tool_result_non_error_and_non_denial_stay_silent() {
        let (is_error, text) = (
            false,
            "Claude requested permissions to read from /etc, but you haven't granted it yet.",
        );
        let line = serde_json::json!({
            "type": "user",
            "message": {
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": "toolu_1",
                    "is_error": is_error,
                    "content": text
                }]
            }
        })
        .to_string();
        let mut out = Vec::new();
        ClaudeEngine::new().parse_line(&line, &mut out);
        assert!(out.is_empty(), "is_error={is_error} text={text}");
    }

    #[test]
    fn a_failed_tool_result_settles_its_row_as_a_failure() {
        let line = serde_json::json!({
            "type": "user",
            "message": { "role": "user", "content": [{
                "type": "tool_result",
                "tool_use_id": "toolu_1",
                "is_error": true,
                "content": "file not found: /tmp/missing.txt"
            }]}
        })
        .to_string();
        let mut out = Vec::new();
        ClaudeEngine::new().parse_line(&line, &mut out);
        match &out[..] {
            [EngineEvent::Message {
                result: Some(result),
                patch: true,
                ..
            }] => {
                assert_eq!(result["isError"], true);
            }
            other => panic!("expected a failed result patch, got {other:?}"),
        }
    }

    #[test]
    fn result_permission_denials_emit_structured_events() {
        let line = serde_json::json!({
            "type": "result",
            "subtype": "success",
            "is_error": false,
            "session_id": "s-1",
            "permission_denials": [{
                "tool_name": "Read",
                "tool_use_id": "toolu_1",
                "tool_input": { "file_path": "/Users/x/secrets/key.pem" }
            }]
        })
        .to_string();
        let mut out = Vec::new();
        ClaudeEngine::new().parse_line(&line, &mut out);
        assert_eq!(out.len(), 2);
        match &out[0] {
            EngineEvent::PermissionDenied {
                tool,
                path,
                tool_use_id,
                ..
            } => {
                assert_eq!(tool.as_deref(), Some("Read"));
                assert_eq!(path.as_deref(), Some("/Users/x/secrets/key.pem"));
                assert_eq!(tool_use_id.as_deref(), Some("toolu_1"));
            }
            _ => panic!("expected permission denial"),
        }
        assert!(matches!(out[1], EngineEvent::Done { .. }));
    }

    #[test]
    fn declined_question_never_surfaces_as_permission_denial() {
        let engine = ClaudeEngine::new();
        let start = serde_json::json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_start",
                "index": 0,
                "content_block": {
                    "type": "tool_use", "id": "call_ask_1", "name": "AskUserQuestion", "input": {}
                }
            }
        })
        .to_string();
        let stop = serde_json::json!({
            "type": "stream_event",
            "event": { "type": "content_block_stop", "index": 0 }
        })
        .to_string();
        let declined = serde_json::json!({
            "type": "user",
            "message": {
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": "call_ask_1",
                    "is_error": true,
                    "content": [{ "type": "text", "text": "Permission denied by SDK" }]
                }]
            }
        })
        .to_string();
        let result = serde_json::json!({
            "type": "result",
            "subtype": "success",
            "is_error": false,
            "session_id": "s-1",
            "permission_denials": [{
                "tool_name": "AskUserQuestion",
                "tool_use_id": "call_ask_1",
                "tool_input": { "questions": [{ "question": "Which color?", "header": "Color" }] }
            }]
        })
        .to_string();
        let mut out = Vec::new();
        for line in [&start, &stop, &declined, &result] {
            engine.parse_line(line, &mut out);
        }
        assert!(
            !out.iter()
                .any(|e| matches!(e, EngineEvent::PermissionDenied { .. })),
            "declined question surfaced as a permission denial: {out:?}"
        );
        assert!(matches!(out.last(), Some(EngineEvent::Done { .. })));
    }

    #[test]
    fn extract_absolute_path_handles_windows_and_posix() {
        assert_eq!(
            extract_absolute_path("read from C:\\dev\\proj, but"),
            Some(r"C:\dev\proj".to_string())
        );
        assert_eq!(
            extract_absolute_path("write to \"/etc/hosts\"."),
            Some("/etc/hosts".to_string())
        );
        assert_eq!(extract_absolute_path("no path here"), None);
    }

    #[test]
    fn build_command_passes_effort_flag() {
        let engine = ClaudeEngine::new();
        let mut request = SendRequest {
            session_id: None,
            prompt: "hi".into(),
            prompt_contributions: vec![],
            images: vec![],
            workspace: std::path::PathBuf::from("/tmp"),
            model: None,
            effort: Some("xhigh".into()),
            service_tier: None,
            permission: None,
            additional_dirs: vec![],
            provider_id: None,
            mcp_servers: None,
            allowed_tools: None,
        };
        let built = engine.build_command(&request, "claude").unwrap();
        let args: Vec<String> = built
            .command
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        assert!(args.windows(2).any(|w| w == ["--effort", "xhigh"]));

        request.effort = Some("ultra".into());
        let built = engine.build_command(&request, "claude").unwrap();
        let args: Vec<String> = built
            .command
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        assert!(args.windows(2).any(|w| w == ["--effort", "ultra"]));
        assert_eq!(
            built
                .command
                .as_std()
                .get_envs()
                .find(|(k, _)| *k == "CLAUDE_CODE_EFFORT_LEVEL")
                .and_then(|(_, v)| v),
            Some(std::ffi::OsStr::new("ultra"))
        );
    }

    #[test]
    fn read_only_tool_constraints_force_plan_mode_and_whitelist() {
        let engine = ClaudeEngine::new();
        assert!(engine.supports_tool_constraints());
        let request = SendRequest {
            session_id: None,
            prompt: "hi".into(),
            prompt_contributions: Vec::new(),
            images: vec![],
            workspace: std::path::PathBuf::from("/tmp"),
            model: None,
            effort: None,
            service_tier: None,
            permission: Some("auto".into()),
            additional_dirs: vec![],
            provider_id: None,
            mcp_servers: None,
            allowed_tools: Some(vec!["Read".into(), "Grep".into()]),
        };
        let built = engine.build_command(&request, "claude").unwrap();
        let args: Vec<String> = built
            .command
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        assert!(args.windows(2).any(|w| w == ["--permission-mode", "plan"]));
        assert!(args.windows(2).any(|w| w == ["--allowedTools", "Read"]));
        let deny_at = args
            .iter()
            .position(|a| a == "--disallowedTools")
            .expect("deny list");
        for tool in ["Bash", "Edit", "Write", "NotebookEdit", "Task"] {
            assert!(
                args[deny_at + 1..].iter().any(|a| a == tool),
                "{tool} must be explicitly denied"
            );
        }
        assert!(!args
            .windows(2)
            .any(|w| w == ["--permission-mode", "acceptEdits"]));
    }

    #[test]
    fn failed_private_json_write_removes_the_partial_file() {
        let dir = std::env::temp_dir().join(format!(
            "ccgui-claude-write-failure-{}",
            uuid::Uuid::new_v4()
        ));
        let result = stage_private_json_with_writer(
            &dir,
            "mcp",
            &serde_json::json!({"mcpServers":{"other":{"headers":{"Authorization":"Bearer t"}}}}),
            |file, content| {
                use std::io::Write;
                file.write_all(&content[..content.len() / 2])?;
                Err(std::io::Error::new(
                    std::io::ErrorKind::WriteZero,
                    "injected write failure",
                ))
            },
        );
        assert!(result.unwrap_err().contains("injected write failure"));
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
        std::fs::remove_dir(dir).unwrap();
    }
}
