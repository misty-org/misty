// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/minimax_acp.rs.
//! MiniMax Code ACP turn driver (`mcode acp`). Same settle contract as the
//! shared grok/kimi driver (`grok_acp.rs`): events until a terminal
//! done/error, pending question cards settled first, then this run's
//! registry entries drained. Framing and read loop come from the qoder
//! driver's primitives (`qoder_session.rs`); only the handshake, the
//! config surface and the permission channel are MiniMax's own.
//!
//! Wire notes (live-verified against mcode 0.5.1):
//! - `initialize` → `session/new {cwd, mcpServers}` (or `session/load` to
//!   re-attach; `agentCapabilities.loadSession` is on). session/new
//!   advertises `modes` (default/plan) and `configOptions`:
//!   `permissionMode` (`default`=Ask / `auto` / `bypassPermissions`=Full
//!   access) and `model` (values are internal `m:<provider>:<model>:v:
//!   <variant>` selectors — friendly ids are rejected with -32602).
//! - Thinking effort has no standalone knob: it rides the model variant
//!   (`v:thinking` vs none), so a model pick folds the requested effort in.
//! - `session/prompt` streams `session/update` notifications
//!   (`agent_message_chunk`, `agent_thought_chunk`, `tool_call`,
//!   `tool_call_update`, `usage_update` {used, size}) and resolves
//!   `{stopReason}` with no `_meta` — end-of-turn usage comes from
//!   `usage_update`, not the prompt result.
//! - `promptCapabilities.image` is false: images travel as absolute paths
//!   inside the text block for the agent's own file tools.
//! - Interactive permission asks are standard ACP
//!   `session/request_permission` requests from the CLI: the read loop
//!   parks them as question cards and `answer_question` releases them
//!   through the registry-held stdin, exactly like grok's ask channel.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Map, Value};

use super::qoder_session::{
    initialize_params, jsonrpc_result_response, session_update_from_notification, spawn_piped_acp,
    teardown, AcpLine, AcpProcess, JSONRPC_INVALID_PARAMS, JSONRPC_METHOD_NOT_FOUND,
    PROMPT_TIMEOUT, RPC_HANDSHAKE_TIMEOUT, SESSION_NEW_TIMEOUT, SESSION_RESUME_TIMEOUT,
};
use super::{BuiltCommand, Engine, EngineEvent, SendRequest, TurnCore, TurnState, VirtualRunGuard};

/// Model catalog probe budget: a temp-dir session/new skips any workspace
/// scan, so the handshake lands in seconds; the cap is pure slow-machine
/// headroom (same convention as the qoder probe).
const MODEL_PROBE_TIMEOUT: Duration = Duration::from_secs(15);
const MODEL_PROBE_TOTAL: Duration = Duration::from_secs(20);

/// One model row from the session's own `model` config option, resolved to
/// the picker's `provider/model` id. `is_default` marks the option the
/// session booted with (the CLI's configured default), which leads the list.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ProbeModel {
    pub id: String,
    pub name: Option<String>,
    pub is_default: bool,
}

/// Per-turn projection state: usage from the prompt result (the Done payload)
/// and the tool names seen at tool_call start, so a later name-less
/// tool_call_update can patch the row it belongs to.
#[derive(Default)]
struct TurnView {
    last_usage: Option<Value>,
    tool_names: HashMap<String, String>,
}

/// Drive one send as a MiniMax ACP turn.
pub(super) async fn run_acp_turn(
    core: TurnCore,
    req: SendRequest,
    built: BuiltCommand,
    killed: Arc<AtomicBool>,
    virtual_pid: u32,
) {
    let BuiltCommand {
        mut command,
        cleanup_files,
        ..
    } = built;
    let mut state = TurnState::new(req.session_id.clone());
    let mut view = TurnView::default();
    let preassigned_session_id = req.session_id.clone();
    // Abort-safe backstop: the by-name removals below only run when the task
    // finishes normally. An abort or a panic would otherwise leave this run's
    // keys pinning a concurrency slot until app exit.
    let _registry_guard =
        VirtualRunGuard::new(Arc::clone(&core.registry), core.run_id.clone(), virtual_pid);
    let result = turn_inner(&core, &mut state, &mut view, &req, &mut command, &killed).await;
    // Pending questions die with the turn: settle their cards BEFORE any
    // terminal dispatch, or the monotonic saw_done/saw_error guard in
    // dispatch_event would drop these and leave answerable cards pointing at
    // a settled turn.
    for key in [
        state.native_session_id.clone(),
        Some(core.run_id.clone()),
        preassigned_session_id.clone(),
    ]
    .into_iter()
    .flatten()
    {
        for request_id in core.registry.take_questions(&key) {
            core.dispatch_event(&mut state, EngineEvent::QuestionSettled { request_id });
        }
    }
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
    // A resumed conversation was keyed under the incoming session id, and the
    // handshake may have rekeyed it to the CLI's own id: drop both aliases.
    if let Some(session_id) = state.native_session_id.clone() {
        core.registry.remove_if_pid(&session_id, virtual_pid);
    }
    if let Some(session_id) = preassigned_session_id {
        core.registry.remove_if_pid(&session_id, virtual_pid);
    }
    core.sink.flush();
    super::cleanup_staged_files(&cleanup_files);
}

async fn turn_inner(
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    req: &SendRequest,
    command: &mut tokio::process::Command,
    killed: &Arc<AtomicBool>,
) -> Result<(), String> {
    let mut spawned = spawn_piped_acp(command, &core.engine_id, &req.workspace)?;
    spawned.acp.reports_as = Some(core.engine_id.clone());
    // The registry entry exists before this task runs, so a parked question's
    // answer always finds this child's stdin (and the session-id alias clones
    // it later, making `answer_question` work by either key).
    core.registry
        .set_stdin(&core.run_id, Arc::clone(&spawned.acp.stdin));
    let result = handshake_and_prompt(&mut spawned.acp, core, state, view, req, killed).await;
    // ACP is a session protocol: the CLI stays resident after the prompt
    // response, so every exit path tears the tree down.
    teardown(&mut spawned.child).await;
    match result {
        Ok(()) => Ok(()),
        Err(error) => Err(terminal_message(error, &spawned.stderr_buf)),
    }
}

async fn handshake_and_prompt(
    acp: &mut AcpProcess,
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    req: &SendRequest,
    killed: &AtomicBool,
) -> Result<(), String> {
    let agent = acp
        .routed(
            "initialize",
            initialize_params(),
            RPC_HANDSHAKE_TIMEOUT,
            killed,
            None,
            &mut |_| None,
        )
        .await?;
    let servers = crate::engines::gate::acp_mcp_servers(req, &agent);
    let gate = crate::engines::gate::AcpGate::of(core, req);
    let (session_id, session_result) = attach_session(acp, req, servers, killed).await?;
    core.dispatch_event(state, EngineEvent::SessionId(session_id.clone()));

    apply_session_config(acp, &session_id, &session_result, req, core, state, killed).await?;

    let blocks = prompt_blocks(&req.prompt, &req.images, &req.workspace);
    let workspace = req.workspace.clone();
    // One router for the whole prompt: updates, agent requests and the
    // permission ask all mutate the same turn state, so they cannot live in
    // separate callbacks.
    let mut router = |line: &AcpLine| match line {
        AcpLine::Notification { method, params } if method == "session/update" => {
            if let Some(usage) = usage_update(params) {
                view.last_usage = Some(usage.clone());
                core.dispatch_event(state, EngineEvent::Usage(usage));
            }
            handle_session_update(core, state, view, params);
            None
        }
        // Forms this client cannot render release the CLI instead of holding
        // it parked until the prompt times out.
        AcpLine::AgentRequest { id, method, .. } if method == "elicitation/create" => {
            Some(jsonrpc_result_response(id, json!({ "action": "decline" })))
        }
        // Permission asks and client file writes go to Misty's gate, which answers later on
        // this child's stdin.
        AcpLine::AgentRequest { id, method, params } => {
            crate::engines::gate::acp_agent_request(Some(&gate), &workspace, id, method, params)
        }
        _ => None,
    };
    let result = acp
        .routed(
            "session/prompt",
            json!({ "sessionId": session_id, "prompt": blocks }),
            PROMPT_TIMEOUT,
            killed,
            Some(&session_id),
            &mut router,
        )
        .await?;
    if let Some(usage) = prompt_usage(&result) {
        view.last_usage = Some(usage.clone());
        core.dispatch_event(state, EngineEvent::Usage(usage));
    }
    Ok(())
}

/// Re-attach the conversation's session, or open a fresh one. An unknown or
/// expired resume id is the normal failure, and a fresh session keeps the
/// user's message alive instead of failing the whole send.
async fn attach_session(
    acp: &mut AcpProcess,
    req: &SendRequest,
    servers: Value,
    killed: &AtomicBool,
) -> Result<(String, Value), String> {
    let cwd = req.workspace.to_string_lossy().to_string();
    let mut loaded = None;
    if let Some(session_id) = req.session_id.as_deref() {
        let load = acp
            .routed(
                "session/load",
                json!({ "cwd": cwd, "mcpServers": servers.clone(), "sessionId": session_id }),
                SESSION_RESUME_TIMEOUT,
                killed,
                None,
                &mut |_| None,
            )
            .await;
        match load {
            Ok(result) => loaded = Some(result),
            // An interrupt is not a failed resume: retrying it as a new
            // session would spawn work the user just cancelled.
            Err(error) => {
                if killed.load(Ordering::SeqCst) {
                    return Err(error);
                }
            }
        }
    }
    let session_result = match loaded {
        Some(result) => result,
        None => {
            let mut params = json!({ "cwd": cwd, "mcpServers": servers });
            let additional = existing_dirs(&req.additional_dirs).await;
            if !additional.is_empty() {
                params["additionalDirectories"] = json!(additional);
            }
            acp.routed(
                "session/new",
                params,
                SESSION_NEW_TIMEOUT,
                killed,
                None,
                &mut |_| None,
            )
            .await?
        }
    };
    let session_id = extract_session_id(&session_result)
        .or_else(|| req.session_id.clone())
        .ok_or_else(|| "MiniMax session handshake returned no sessionId".to_string())?;
    Ok((session_id, session_result))
}

/// Grant only the additional roots that still exist: a stale grant must not
/// fail the whole handshake.
async fn existing_dirs(dirs: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for dir in dirs {
        match tokio::fs::metadata(dir).await {
            Ok(metadata) if metadata.is_dir() => out.push(dir.clone()),
            _ => eprintln!("[minimax] skipping a granted root that is not a directory"),
        }
    }
    out
}

/// The session id from a handshake result: `session/new` returns it at the
/// top level; `session/load` may report it only under `_meta.sessionId`.
fn extract_session_id(value: &Value) -> Option<String> {
    value
        .get("sessionId")
        .or_else(|| value.get("session_id"))
        .or_else(|| value.get("_meta").and_then(|meta| meta.get("sessionId")))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

/// Apply the requested permission and model through the config surface
/// verified live on mcode 0.5.1: permission lives in the `permissionMode`
/// config option (`default`=Ask / `auto` / `bypassPermissions`), plan is a
/// session mode, and the `model` option only accepts values from its own
/// advertised list (`m:<provider>:<model>:v:<variant>` — friendly
/// `provider/model` ids are rejected with -32602). Everything resolves
/// against the session's own options; a build that offers none gets one
/// Warn and keeps its defaults instead of failing every send.
async fn apply_session_config(
    acp: &mut AcpProcess,
    session_id: &str,
    session_result: &Value,
    req: &SendRequest,
    core: &TurnCore,
    state: &mut TurnState,
    killed: &AtomicBool,
) -> Result<(), String> {
    let requested = super::minimax::MiniMaxEngine.resolve_permission(req.permission.as_deref());
    if requested == "plan" {
        if let Some(mode) = mode_id(req.permission.as_deref(), session_result) {
            set_mode(acp, session_id, &mode, killed).await?;
        } else {
            core.dispatch_event(
                state,
                EngineEvent::Warn(
                    "MiniMax CLI offers no plan session mode; this turn uses the CLI's own default permissions".to_string(),
                ),
            );
        }
    } else {
        let value = permission_config_value(requested);
        match set_config_option(acp, session_id, "permissionMode", value, killed).await {
            Ok(()) => {}
            // A build without the option keeps its own policy; the CLI
            // default (`auto`) already matches the GUI's default mode.
            Err(error)
                if error.code == JSONRPC_METHOD_NOT_FOUND
                    || error.code == JSONRPC_INVALID_PARAMS =>
            {
                core.dispatch_event(
                    state,
                    EngineEvent::Warn(format!(
                        "MiniMax CLI offers no permission mode setting; this turn uses the CLI's own default permissions (asked for {value})"
                    )),
                );
            }
            Err(error) => {
                return Err(format!(
                    "MiniMax permission mode `{value}` setup failed: {}",
                    error.message
                ));
            }
        }
    }

    if let Some(model) = req
        .model
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty())
    {
        match resolve_model_value(session_result, model, req.effort.as_deref()) {
            Some(value) => {
                if let Err(error) =
                    set_config_option(acp, session_id, "model", &value, killed).await
                {
                    return Err(format!(
                        "MiniMax model `{model}` setup failed: {}",
                        error.message
                    ));
                }
            }
            // Not in the CLI's own list (stale picker id or a custom model
            // this account cannot run): keep the CLI default, say so.
            None => {
                core.dispatch_event(
                    state,
                    EngineEvent::Warn(format!(
                        "MiniMax CLI's model list has no {model}; this turn uses the CLI's own default model"
                    )),
                );
            }
        }
    }
    Ok(())
}

/// GUI permission mode → the verified `permissionMode` option values
/// (`default`=Ask / `auto`). Its `bypassPermissions` (Full access) is never
/// used: MiniMax has no sandbox that keeps it inside its folder (no Bypass).
fn permission_config_value(requested: &str) -> &'static str {
    match requested {
        "manual" => "default",
        _ => "auto",
    }
}

/// One model option value `m:<provider>:<model>:v:<variant>` split into
/// (`provider/model`, variant). Non-conforming values are skipped.
fn parse_model_option_value(value: &str) -> Option<(String, String)> {
    let mut parts = value.split(':');
    if parts.next()? != "m" {
        return None;
    }
    let provider = parts.next()?.trim();
    let model = parts.next()?.trim();
    let variant = match (parts.next(), parts.next()) {
        (Some("v"), Some(v)) => v.trim(),
        _ => "",
    };
    if provider.is_empty() || model.is_empty() {
        return None;
    }
    Some((format!("{provider}/{model}"), variant.to_string()))
}

/// Pick the model option value matching the requested `provider/model` id,
/// preferring the `thinking` variant unless the requested effort is off
/// (the CLI bakes thinking into the model variant; there is no separate
/// effort option). None when no advertised option matches — the caller
/// keeps the CLI's own default then.
fn resolve_model_value(
    session_result: &Value,
    requested: &str,
    effort: Option<&str>,
) -> Option<String> {
    let base = requested.split('#').next().unwrap_or(requested).trim();
    let options = session_result["configOptions"]
        .as_array()?
        .iter()
        .find(|option| option["id"] == "model")?["options"]
        .as_array()?;
    let candidates: Vec<(String, String)> = options
        .iter()
        .filter_map(|option| {
            let value = option["value"].as_str()?;
            let (candidate, variant) = parse_model_option_value(value)?;
            candidate
                .eq_ignore_ascii_case(base)
                .then(|| (value.to_string(), variant))
        })
        .collect();
    let want_plain = matches!(effort, Some("off") | Some("none"));
    candidates
        .iter()
        .find(|(_, variant)| {
            if want_plain {
                variant.is_empty()
            } else {
                variant == "thinking"
            }
        })
        .or_else(|| candidates.first())
        .map(|(value, _)| value.clone())
}

async fn set_mode(
    acp: &mut AcpProcess,
    session_id: &str,
    mode: &str,
    killed: &AtomicBool,
) -> Result<(), String> {
    let outcome = acp
        .routed(
            "session/set_mode",
            json!({ "sessionId": session_id, "modeId": mode }),
            RPC_HANDSHAKE_TIMEOUT,
            killed,
            None,
            &mut |_| None,
        )
        .await;
    match outcome {
        Ok(_) => Ok(()),
        Err(error) if rpc_code(&error) == Some(JSONRPC_METHOD_NOT_FOUND) => {
            // The session advertised modes but this build rejects the
            // switch: keep the CLI default rather than failing the send.
            eprintln!("[minimax] session/set_mode unsupported on this build: {error}");
            Ok(())
        }
        Err(error) => Err(format!("MiniMax mode `{mode}` setup failed: {error}")),
    }
}

/// One `session/set_config_option` call, keeping the typed rpc error so the
/// caller can distinguish "this build has no such option" from a real
/// failure.
async fn set_config_option(
    acp: &mut AcpProcess,
    session_id: &str,
    config_id: &str,
    value: &str,
    killed: &AtomicBool,
) -> Result<(), super::qoder_session::AcpRpcError> {
    let outcome = acp
        .routed(
            "session/set_config_option",
            json!({ "sessionId": session_id, "configId": config_id, "value": value }),
            RPC_HANDSHAKE_TIMEOUT,
            killed,
            None,
            &mut |_| None,
        )
        .await;
    match outcome {
        Ok(_) => Ok(()),
        Err(error) => Err(rpc_error(&error, "session/set_config_option")),
    }
}

/// The routed error string embeds `rpc:{method}:{code}:{message}`; recover
/// the typed parts instead of string-matching the whole thing.
fn rpc_error(raw: &str, method: &str) -> super::qoder_session::AcpRpcError {
    let code = rpc_code(raw).unwrap_or(super::qoder_session::JSONRPC_INTERNAL_ERROR);
    let message = raw
        .strip_prefix("rpc:")
        .and_then(|rest| rest.split_once(':'))
        .filter(|(seen_method, _)| *seen_method == method)
        .and_then(|(_, rest)| rest.split_once(':'))
        .map(|(_, message)| message.trim())
        .filter(|message| !message.is_empty())
        .unwrap_or(raw);
    super::qoder_session::AcpRpcError {
        code,
        message: message.to_string(),
    }
}

fn rpc_code(raw: &str) -> Option<i64> {
    raw.strip_prefix("rpc:")?
        .split_once(':')?
        .1
        .split(':')
        .next()?
        .trim()
        .parse()
        .ok()
}

/// Permission → ACP session mode. Only the plan request routes here (the
/// other modes live in the `permissionMode` config option); matched
/// heuristically against the modes the session actually advertises, since
/// mode ids are CLI vocabulary. Object entries (`{id, name}`) and flat id
/// strings both match.
fn mode_id(permission: Option<&str>, session_result: &Value) -> Option<String> {
    let modes = session_result["modes"]["availableModes"]
        .as_array()
        .or_else(|| session_result["availableModes"].as_array())?;
    let requested = super::minimax::MiniMaxEngine.resolve_permission(permission);
    let needle: &[&str] = match requested {
        "plan" => &["plan"],
        "manual" => &["ask", "manual"],
        _ => &["auto", "accept", "smart"],
    };
    let object_match = modes.iter().find_map(|mode| {
        let object = mode.as_object()?;
        let id = object.get("id")?.as_str()?;
        let haystack = format!(
            "{} {}",
            id,
            object.get("name").and_then(Value::as_str).unwrap_or("")
        )
        .to_lowercase();
        needle
            .iter()
            .find(|word| haystack.contains(*word))
            .map(|_| id.to_string())
    });
    object_match.or_else(|| {
        modes
            .iter()
            .filter_map(|mode| mode.as_str())
            .find_map(|id| {
                let lowered = id.to_lowercase();
                needle
                    .iter()
                    .find(|word| lowered.contains(*word))
                    .map(|_| id.to_string())
            })
    })
}

/// ACP prompt content blocks. mcode advertises `promptCapabilities.image:
/// false` (live 0.5.1), so pictures ride as absolute paths inside the text
/// block for the agent's own file tools to read — no image blocks.
fn prompt_blocks(text: &str, images: &[String], workspace: &Path) -> Vec<Value> {
    let prompt = super::images::minimax_prompt_with_images(text, images, workspace);
    vec![json!({ "type": "text", "text": prompt })]
}

/// One `session/update` notification projected to engine events. mcode
/// speaks the shared ACP update vocabulary, so the mapping matches the
/// grok/qoder drivers'.
fn handle_session_update(
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    params: &Value,
) {
    match session_update_from_notification(params) {
        super::qoder_session::QoderSessionUpdate::AgentMessageChunk { text } => {
            core.dispatch_event(state, EngineEvent::Delta(text));
        }
        super::qoder_session::QoderSessionUpdate::AgentThoughtChunk { text } => {
            core.dispatch_event(state, EngineEvent::Thinking(text));
        }
        super::qoder_session::QoderSessionUpdate::ToolStarted {
            tool_id,
            tool_name,
            input,
        } => {
            view.tool_names.insert(tool_id, tool_name.clone());
            core.dispatch_event(state, super::tool_call_message(tool_name, input.as_ref()));
        }
        super::qoder_session::QoderSessionUpdate::ToolCompleted {
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
        super::qoder_session::QoderSessionUpdate::Ignore => {}
    }
}

/// Kimi-style mid-turn usage notifications (`usage_update` with the
/// window's used/size); absent on builds that only report end-of-turn
/// totals.
fn usage_update(params: &Value) -> Option<Value> {
    let update = &params["update"];
    if update["sessionUpdate"] != "usage_update" {
        return None;
    }
    Some(
        json!({"input_tokens": update["used"].as_u64()?, "model_context_window": update["size"].as_u64()?}),
    )
}

/// The prompt result's `_meta` token totals, projected onto the names the
/// frontend's usage parser reads (same convention as grok).
fn prompt_usage(result: &Value) -> Option<Value> {
    let meta = result.get("_meta").filter(|meta| meta.is_object())?;
    let input = meta.get("inputTokens").and_then(Value::as_u64);
    let output = meta.get("outputTokens").and_then(Value::as_u64);
    let total = match meta.get("totalTokens").and_then(Value::as_u64) {
        Some(total) => total,
        None => input? + output?,
    };
    let mut usage = Map::new();
    usage.insert("totalTokens".to_string(), json!(total));
    if let Some(input) = input {
        usage.insert("inputTokens".to_string(), json!(input));
    }
    if let Some(output) = output {
        usage.insert("outputTokens".to_string(), json!(output));
    }
    Some(Value::Object(usage))
}

/// Live model catalog via a throwaway `mcode acp` handshake in the temp
/// dir (session/new there skips any workspace scan). The caller caches the
/// last success; failures degrade to an error so it can fall back.
pub(crate) async fn probe_models(bin: &str) -> Result<Vec<ProbeModel>, String> {
    let cwd = std::env::temp_dir();
    let killed = AtomicBool::new(false);
    let probe = async {
        let mut command = super::command_for_binary(bin);
        command.arg("acp");
        let mut spawned = spawn_piped_acp(&mut command, "minimax", &cwd)?;
        let inner = probe_handshake(&mut spawned.acp, &killed).await;
        teardown(&mut spawned.child).await;
        inner
    };
    tokio::time::timeout(MODEL_PROBE_TOTAL, probe)
        .await
        .map_err(|_| "minimax model probe timed out".to_string())?
}

async fn probe_handshake(
    acp: &mut AcpProcess,
    killed: &AtomicBool,
) -> Result<Vec<ProbeModel>, String> {
    acp.routed(
        "initialize",
        initialize_params(),
        RPC_HANDSHAKE_TIMEOUT,
        killed,
        None,
        &mut |_| None,
    )
    .await?;
    let session_result = acp
        .routed(
            "session/new",
            json!({ "cwd": std::env::temp_dir().to_string_lossy(), "mcpServers": [] }),
            MODEL_PROBE_TIMEOUT,
            killed,
            None,
            &mut |_| None,
        )
        .await?;
    Ok(models_from_config_options(&session_result))
}

/// Group the session's `model` config options into picker rows: variant
/// entries (`m:<provider>:<model>:v:<variant>`) collapse to one
/// `provider/model` row each in the CLI's own menu order (thinking effort
/// folds in at send time), and the option matching the session's current
/// value — the CLI's configured default — leads the list.
pub(crate) fn models_from_config_options(session_result: &Value) -> Vec<ProbeModel> {
    let model_option = session_result["configOptions"]
        .as_array()
        .and_then(|options| options.iter().find(|option| option["id"] == "model"));
    let Some(options) = model_option
        .and_then(|model| model["options"].as_array())
        .filter(|options| !options.is_empty())
    else {
        return Vec::new();
    };
    let current_base = model_option
        .and_then(|model| model["currentValue"].as_str())
        .and_then(parse_model_option_value)
        .map(|(base, _)| base);
    let mut rows: Vec<ProbeModel> = Vec::new();
    for option in options {
        let Some((base, _variant)) = option["value"].as_str().and_then(parse_model_option_value)
        else {
            continue;
        };
        if rows.iter().any(|row| row.id == base) {
            continue;
        }
        // The CLI's own label carries the variant suffix ("MiniMax-M3 ·
        // thinking"); strip it and fall back to the id.
        let name = option["name"]
            .as_str()
            .map(|name| name.split(" · ").next().unwrap_or(name).trim().to_string())
            .filter(|name| !name.is_empty());
        rows.push(ProbeModel {
            is_default: current_base.as_deref() == Some(base.as_str()),
            id: base,
            name,
        });
    }
    if let Some(index) = rows
        .iter()
        .position(|row| row.is_default)
        .filter(|i| *i > 0)
    {
        let row = rows.remove(index);
        rows.insert(0, row);
    }
    rows
}

/// Terminal message precedence (mirrors qoder/grok): the rpc error's message
/// part, then the CLI's stderr tail, then the raw error.
fn terminal_message(raw: String, stderr_buf: &Arc<Mutex<String>>) -> String {
    let bare = raw
        .strip_prefix("rpc:")
        .and_then(|rest| rest.split_once(':'))
        .map(|(_, message)| message.trim())
        .filter(|message| !message.is_empty());
    if let Some(message) = bare {
        return message.to_string();
    }
    let stderr_tail = stderr_buf
        .lock()
        .map(|tail| tail.trim().to_string())
        .unwrap_or_default();
    if !stderr_tail.is_empty() {
        return stderr_tail;
    }
    raw
}

#[cfg(test)]
#[path = "minimax_acp_tests.rs"]
mod tests;
