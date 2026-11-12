// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/grok_acp.rs.
//! Shared native ACP turn lifecycle for grok and Kimi.
//! Kimi's handshake and elicitation forms are implemented in `kimi_acp`.
//!
//! grok drives its own channel: the app prepares the command (channel flags,
//! GROK_HOME staging, model/effort) and this driver owns the child for the
//! whole turn — spawn, handshake, prompt, teardown. The framing and read loop
//! are shared verbatim with the qoder driver (`qoder_session.rs`): grok speaks
//! the same ACP dialect, so only the handshake, the update projection and the
//! question channel differ.
//!
//! Live-verified against grok 1.0.40:
//! - `initialize`, then `session/new {cwd, mcpServers}` (or `session/load` to
//!   re-attach). The CLI assigns the session id, so the id adopted from the
//!   handshake is what a later resume must send back.
//! - `session/prompt {sessionId, prompt}` streams `session/update`
//!   notifications (`agent_message_chunk`, `agent_thought_chunk`, `tool_call`,
//!   `tool_call_update`) and resolves `{stopReason, _meta}` when the turn ends;
//!   `_meta` carries the turn's token totals.
//! - The CLI calls BACK for file access (`fs/read_text_file` and
//!   `fs/write_text_file`) while the prompt is running and stalls the whole
//!   turn until the client answers, so the router must serve those methods
//!   (workspace-confined) instead of dropping them.
//! - Asking the user is a JSON-RPC **request from the CLI**
//!   (`_x.ai/ask_user_question`), not a tool-call payload: only a response
//!   frame written back on this child's stdin releases it. The read loop
//!   therefore hands that line to `answer_question` through the registry
//!   instead of answering it inline, exactly like claude's control protocol.
//! - The release frame is `{outcome:"accepted", answers:{<question text>:
//!   <label|[labels]>}}`, or `{outcome:"cancelled"}` to dismiss.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::{json, Map, Value};
use tokio::process::Command;

use super::qoder_session::{
    initialize_params, jsonrpc_id_key, jsonrpc_result_response,
    session_update_from_notification, spawn_piped_acp, teardown, AcpLine, AcpProcess,
    QoderSessionUpdate, PROMPT_TIMEOUT, RPC_HANDSHAKE_TIMEOUT, SESSION_NEW_TIMEOUT,
    SESSION_RESUME_TIMEOUT,
};
use super::{BuiltCommand, EngineEvent, SendRequest, TurnCore, TurnState, VirtualRunGuard};

/// The agent-initiated request that asks the user to choose. `session/update`
/// notifications never carry it; it is the only method this driver parks.
const ASK_METHOD: &str = "_x.ai/ask_user_question";
/// grok's answer outcomes (`accepted | chat_about_this | skip_interview |
/// cancelled`). A dismissal maps to `cancelled`, which the CLI turns into
/// "carry on with your best judgment".
const ACCEPTED_OUTCOME: &str = "accepted";
const DISMISS_OUTCOME: &str = "cancelled";

/// Per-turn projection state: usage from the prompt result (the Done payload)
/// and the tool names seen at tool_call start, so a later name-less
/// tool_call_update can patch the row it belongs to.
#[derive(Default)]
struct TurnView {
    last_usage: Option<Value>,
    tool_names: HashMap<String, String>,
}

/// Drive one send as a grok ACP turn. Mirrors the shared settle contract
/// (qoder/dsh): events until a terminal done/error, pending question cards
/// settled first, then this run's registry entries drained. Transport and rpc
/// failures surface as `EngineEvent::Error` — except on interrupt, where the
/// partial output commits as a normal turn end.
pub(super) async fn run_acp_turn(
    core: TurnCore,
    mut req: SendRequest,
    built: BuiltCommand,
    killed: Arc<AtomicBool>,
    virtual_pid: u32,
) {
    let BuiltCommand {
        mut command,
        cleanup_files,
        ..
    } = built;
    if core.engine_id == "kimi" {
        req.model = super::kimi_acp::selected_model(req.model.as_deref(), &command);
    }
    let mut state = TurnState::new(req.session_id.clone());
    let mut view = TurnView::default();
    let preassigned_session_id = req.session_id.clone();
    // Abort-safe backstop: the by-name removals below only run when the task
    // finishes normally. An abort or a panic would otherwise leave this run's
    // keys pinning a concurrency slot until app exit.
    let _registry_guard =
        VirtualRunGuard::new(Arc::clone(&core.registry), core.run_id.clone(), virtual_pid);
    let result = turn_inner(&core, &mut state, &mut view, &req, &mut command, &killed).await;
    // Pending questions and parked plan reviews die with the turn: settle the
    // cards and expire the reviews BEFORE any terminal dispatch, or the
    // monotonic saw_done/saw_error guard in dispatch_event would drop these
    // and leave answerable surfaces pointing at a settled turn.
    let parked_keys = [
        state.native_session_id.clone(),
        Some(core.run_id.clone()),
        preassigned_session_id.clone(),
    ];
    settle_parked(&core, &mut state, parked_keys);
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
    // The staged GROK_HOME channel dir holds this send's credentials and is
    // private to this run; the CLI is gone, so nothing may read it again.
    super::cleanup_staged_files(&cleanup_files);
}

/// Shared settle contract for every key this run was registered under
/// (native session id, run id, preassigned alias): pending question cards are
/// settled first, then parked plan reviews expire with the run (the settle duty of
/// ccgui's plan-review design). kimi never parks plan events, so the expiry is always a
/// no-op on that path; calling it unconditionally keeps the shared driver
/// honest if either engine ever parks a plan.
fn settle_parked(core: &TurnCore, state: &mut TurnState, keys: [Option<String>; 3]) {
    for key in keys.into_iter().flatten() {
        for request_id in core.registry.take_questions(&key) {
            core.dispatch_event(state, EngineEvent::QuestionSettled { request_id });
        }
        super::reader::expire_parked_plans(core, state, &key);
    }
}

async fn turn_inner(
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    req: &SendRequest,
    command: &mut Command,
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
    let agent = acp.routed(
        "initialize",
        if core.engine_id == "kimi" {
            super::kimi_acp::initialization()
        } else {
            initialize_params()
        },
        RPC_HANDSHAKE_TIMEOUT,
        killed,
        None,
        &mut |_| None,
    )
    .await?;
    let servers = crate::engines::gate::acp_mcp_servers(req, &agent);
    let gate = crate::engines::gate::AcpGate::of(core, req);
    let session_id = if core.engine_id == "kimi" {
        let (session_id, effort) =
            super::kimi_acp::attach_session(acp, req, servers.clone(), killed).await?;
        if let Some(effort) = effort {
            core.dispatch_event(state, EngineEvent::Effort(effort));
        }
        session_id
    } else {
        attach_session(acp, req, servers, killed).await?
    };
    core.dispatch_event(state, EngineEvent::SessionId(session_id.clone()));

    let blocks = prompt_blocks(&req.prompt, &req.images, &req.workspace)?;
    let workspace = req.workspace.clone();
    // One router for the whole prompt: updates, agent requests and the ask all
    // mutate the same turn state, so they cannot live in separate callbacks.
    let result = {
        let mut router = |line: &AcpLine| match line {
            AcpLine::Notification { method, params } if method == "session/update" => {
                // ACP's `usage_update`: how full the context is, from any engine that sends it.
                if let Some(usage) = super::kimi_acp::usage(params) {
                    view.last_usage = Some(usage.clone());
                    core.dispatch_event(state, EngineEvent::Usage(usage));
                }
                handle_session_update(core, state, view, params);
                None
            }
            AcpLine::AgentRequest { id, method, params }
                if core.engine_id == "kimi" && method == "elicitation/create" =>
            {
                super::kimi_acp::park_question(core, state, id, params)
            }
            // The ask is the user's line to answer: return None so the frame is
            // written by `answer_question` (via the registry-held stdin), not
            // by the read loop.
            AcpLine::AgentRequest { id, method, params } if method == ASK_METHOD => {
                park_question(core, state, id, params)
            }
            AcpLine::AgentRequest { id, method, params } => {
                crate::engines::gate::acp_agent_request(Some(&gate), &workspace, id, method, params)
            }
            _ => None,
        };
        acp.routed(
            "session/prompt",
            json!({ "sessionId": session_id, "prompt": blocks }),
            PROMPT_TIMEOUT,
            killed,
            Some(&session_id),
            &mut router,
        )
        .await?
    };
    if let Some(usage) = prompt_usage(&result) {
        view.last_usage = Some(usage.clone());
        core.dispatch_event(state, EngineEvent::Usage(usage));
    }
    Ok(())
}

/// Re-attach the conversation's session, or open a fresh one. grok cannot be
/// handed a session id at launch, so the id adopted from the previous
/// handshake is the only resume key there is; an unknown or expired id is the
/// normal failure here, and a fresh session keeps the user's message alive
/// instead of failing the whole send.
async fn attach_session(
    acp: &mut AcpProcess,
    req: &SendRequest,
    servers: Value,
    killed: &AtomicBool,
) -> Result<String, String> {
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
            acp.routed(
                "session/new",
                json!({ "cwd": cwd, "mcpServers": servers }),
                SESSION_NEW_TIMEOUT,
                killed,
                None,
                &mut |_| None,
            )
            .await?
        }
    };
    extract_session_id(&session_result)
        .or_else(|| req.session_id.clone())
        .ok_or_else(|| "grok session handshake returned no sessionId".to_string())
}

/// ACP prompt content blocks: text plus base64 image blocks.
fn prompt_blocks(text: &str, images: &[String], workspace: &Path) -> Result<Vec<Value>, String> {
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

/// The session id from a handshake result. `session/new` returns it at the top
/// level; `session/load` reports only the id it actually attached to, under
/// `_meta.sessionId` — the authoritative one if the CLI ever re-keys a loaded
/// conversation. The aliases cover a CLI that spells the key differently.
fn extract_session_id(value: &Value) -> Option<String> {
    value
        .get("sessionId")
        .or_else(|| value.get("session_id"))
        .or_else(|| value.get("id"))
        .or_else(|| value.get("_meta").and_then(|meta| meta.get("sessionId")))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

/// One `session/update` notification projected to engine events. grok speaks
/// the same ACP update vocabulary qoder does, so the mapping is shared rather
/// than re-derived.
fn handle_session_update(
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    params: &Value,
) {
    match session_update_from_notification(params) {
        QoderSessionUpdate::AgentMessageChunk { text } => {
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

/// Park one ask as a question card. `dispatch_event` stores the very `input`
/// payload it emits, so the parked value carries both what the card renders
/// (`questions`) and the context `answer_frame` needs to rebuild the response
/// (`grokAcp.rpcId`). Returns `Some` when there is nothing to ask: a card with
/// no question can never be answered, and parking it would hold the CLI until
/// the prompt times out.
fn park_question(
    core: &TurnCore,
    state: &mut TurnState,
    rpc_id: &Value,
    params: &Value,
) -> Option<Value> {
    let questions = normalize_questions(params);
    if questions.is_empty() {
        return Some(jsonrpc_result_response(
            rpc_id,
            json!({ "outcome": DISMISS_OUTCOME }),
        ));
    }
    let request_id = jsonrpc_id_key(rpc_id).unwrap_or_else(|| rpc_id.to_string());
    core.dispatch_event(
        state,
        EngineEvent::Question {
            request_id,
            tool_use_id: params
                .get("toolCallId")
                .and_then(Value::as_str)
                .map(str::to_string),
            input: json!({
                "questions": questions,
                "grokAcp": { "rpcId": rpc_id },
            }),
        },
    );
    None
}

/// Build the JSON-RPC response frame that releases one parked grok ask.
/// `parked` is the `grokAcp` context stored with the question, `answers` the
/// frontend's map (question text → label, or labels for a multi-select).
/// Rejecting a malformed answer beats dropping it: the card stays answerable
/// instead of silently releasing the CLI with nothing.
pub(super) fn answer_frame(parked: &Value, answers: Option<&Value>) -> Result<Value, String> {
    let id = parked
        .get("rpcId")
        .filter(|id| !id.is_null())
        .ok_or_else(|| "grok question answer context is missing the request id".to_string())?;
    Ok(jsonrpc_result_response(id, answer_outcome(answers)?))
}

/// The answer payload grok's protocol expects. `None` is the user dismissing
/// the card — the CLI is told to continue without answers, never left parked.
fn answer_outcome(answers: Option<&Value>) -> Result<Value, String> {
    let Some(answers) = answers else {
        return Ok(json!({ "outcome": DISMISS_OUTCOME }));
    };
    let map = answers.as_object().ok_or_else(|| {
        "grok question answers must be an object keyed by the question text".to_string()
    })?;
    for (question, choice) in map {
        let is_label = matches!(choice, Value::String(_));
        let is_labels =
            matches!(choice, Value::Array(labels) if labels.iter().all(Value::is_string));
        if !is_label && !is_labels {
            return Err(format!(
                "grok answer for question `{question}` must be a label or an array of labels"
            ));
        }
    }
    Ok(json!({ "outcome": ACCEPTED_OUTCOME, "answers": Value::Object(map.clone()) }))
}

/// Project grok's `questions` array onto the card contract (`QuestionSpec`):
/// `header` is a required short chip and grok sends none, so synthesise
/// `Q{n}`; `multiSelect` arrives as an explicit `null` for single-select asks
/// and must not reach the card as null. Options pass through untouched — their
/// `label`/`description`/`preview` are exactly what the card renders.
fn normalize_questions(params: &Value) -> Vec<Value> {
    params
        .get("questions")
        .and_then(Value::as_array)
        .map(|questions| {
            questions
                .iter()
                .enumerate()
                .map(|(index, question)| {
                    let header = question
                        .get("header")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|header| !header.is_empty())
                        .map(str::to_string)
                        .unwrap_or_else(|| format!("Q{}", index + 1));
                    json!({
                        "question": question
                            .get("question")
                            .and_then(Value::as_str)
                            .unwrap_or_default(),
                        "header": header,
                        "multiSelect": question
                            .get("multiSelect")
                            .and_then(Value::as_bool)
                            .unwrap_or(false),
                        "options": question
                            .get("options")
                            .filter(|options| options.is_array())
                            .cloned()
                            .unwrap_or_else(|| json!([])),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// grok reports the turn's totals in the prompt result's `_meta`. Project them
/// onto the names the frontend's usage parser reads: it knows `totalTokens`,
/// `inputTokens` and `outputTokens`, but not grok's `cachedReadTokens` — an
/// unrecognized cache key reports zero cache hits.
fn prompt_usage(result: &Value) -> Option<Value> {
    if let Some(usage) = turn_usage(result) {
        return Some(usage);
    }
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
    if let Some(cached) = meta.get("cachedReadTokens").and_then(Value::as_u64) {
        usage.insert("cacheRead".to_string(), json!(cached));
    }
    Some(Value::Object(usage))
}

/// Gemini CLI and Qwen Code put the turn's tokens in the prompt result's own `usage`
/// (`inputTokens`, `outputTokens`, `cachedReadTokens`, `thoughtTokens`, `totalTokens`). Their
/// input count includes the cached part, so the cached tokens are taken out of it here.
fn turn_usage(result: &Value) -> Option<Value> {
    let usage = result.get("usage").filter(|usage| usage.is_object())?;
    let number = |name: &str| usage.get(name).and_then(Value::as_u64);
    let cached = number("cachedReadTokens");
    let mut out = Map::new();
    if let Some(input) = number("inputTokens") {
        out.insert(
            "inputTokens".to_string(),
            json!(input.saturating_sub(cached.unwrap_or(0))),
        );
    }
    if let Some(cached) = cached {
        out.insert("cacheRead".to_string(), json!(cached));
    }
    if let Some(output) = number("outputTokens") {
        out.insert("outputTokens".to_string(), json!(output));
    }
    if let Some(thought) = number("thoughtTokens") {
        out.insert("thoughtTokens".to_string(), json!(thought));
    }
    (!out.is_empty()).then_some(Value::Object(out))
}

/// Terminal message precedence (mirrors qoder): the rpc error's message part,
/// then the CLI's stderr tail, then the raw error.
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
#[path = "grok_acp_tests.rs"]
mod tests;
