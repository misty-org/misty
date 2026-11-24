// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/qoder_session.rs.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::time::timeout;

use super::acp_session::{
    config_options_state, initialize_params, is_error_prefixed_text, non_empty,
    session_state_update, session_update_from_notification, spawn_piped_acp, teardown, AcpProcess,
    AcpSessionState, AcpUpdate, SpawnedAcp, PROMPT_TIMEOUT, RPC_HANDSHAKE_TIMEOUT,
    SESSION_NEW_TIMEOUT, SESSION_RESUME_TIMEOUT,
};
use super::{EngineEvent, SendRequest, TurnCore, TurnState, VirtualRunGuard};

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

const MODEL_PROBE_TIMEOUT: Duration = Duration::from_secs(15);
const MODEL_PROBE_TOTAL: Duration = Duration::from_secs(20);

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
        AcpUpdate::AgentMessageChunk { text } => {
            if is_error_prefixed_text(&text) {
                view.pending_error_chunks.push(text);
                return;
            }
            core.dispatch_event(state, EngineEvent::Delta(text));
        }
        AcpUpdate::AgentThoughtChunk { text } => {
            core.dispatch_event(state, EngineEvent::Thinking(text));
        }
        AcpUpdate::ToolStarted {
            tool_id,
            tool_name,
            input,
        } => {
            view.tool_names.insert(tool_id, tool_name.clone());
            core.dispatch_event(state, super::tool_call_message(tool_name, input.as_ref()));
        }
        AcpUpdate::ToolCompleted {
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
        AcpUpdate::Ignore => {}
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
