// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/dsh_session.rs.
//! DSH host-session turn driver: one codemoss send = one host turn, streamed
//! over the gateway mux.
//!
//! Wire (verified live against dsh 0.1.2):
//! - RPC is plain HTTP ([`crate::engines::support::dsh_host::host_call`], cookie-authenticated):
//!   `workspace/create` → `session/create` (resume passes the known
//!   sessionId) → `session/selectModel`? → `session/prompt` (mode "queue");
//!   interrupt sends `session/cancel`. Attachments ride the prompt as base64
//!   image content parts, after [`super::dsh_images`] declares the input
//!   modality on hand-declared `llm-pi-ai` routes (`settings/mutate`).
//! - Streams share one WebSocket, `ws://<origin>/api/remote.mux` with the
//!   auth cookie: open `$events` (the ready frame yields the events clientId;
//!   waterfall frames are approval/question calls, answered via
//!   `$events/result`) and `session/follow` with **`assistantStream: true`** —
//!   the opt-in that adds live `assistant-stream` frames (start / chunk
//!   {block-start, text-delta, reasoning-delta, usage, finish, block-end} /
//!   end committed). Without the opt-in only durable session events flow
//!   (assistant/message lands whole — that is tmd-cli's subscription).
//! - Durable follow events project to tool rows; durable `assistant/message`
//!   renders only when an attempt streamed no deltas (fallback), so live
//!   text never doubles.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

use super::{dsh_images, EngineEvent, SendRequest, TurnCore, TurnState, VirtualRunGuard};
use crate::engines::support::dsh_host::host_call;

#[path = "dsh_commands.rs"]
mod commands;
use commands::{
    command_line, command_name, command_outcome, execute_command, plan_execute_outcome,
    report_commands, send_prompt, COMMAND_TURN_GRACE,
};
pub(crate) use commands::{host_call_slow, slow_client};

/// Extract and normalize the context-window field. DSH's `TokenUsage` carries no window; it
/// comes only in `request/context` events (`RequestContext.contextWindow`), so the caller passes
/// that event's cached value as `fallback`. A usage report with its own window wins; otherwise
/// the host's declared window is filled in, without which the frontend could only assume 200k.
fn attach_context_window(mut usage: Value, fallback: Option<i64>) -> Value {
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
        .filter(|&w| w > 0)
        .or(fallback.filter(|&w| w > 0));

    if let Some(w) = window {
        if let Some(obj) = usage.as_object_mut() {
            obj.insert("model_context_window".to_string(), Value::Number(w.into()));
        }
    }

    usage
}

/// The window announced by `request/context` (`RequestContext { provider, model,
/// contextWindow? }`): the only window source among DSH's published events. It is cached on the
/// view to fill in this turn's usage events and the done payload.
fn context_window_of(data: &Value) -> Option<i64> {
    data.get("contextWindow")
        .or_else(|| data.get("context_window"))
        .and_then(|v| match v {
            Value::Number(n) => n.as_i64(),
            Value::String(s) => s.parse().ok(),
            _ => None,
        })
        .filter(|&w| w > 0)
}

const STREAM_EVENTS: &str = "events";
const STREAM_FOLLOW: &str = "follow";
/// Follow history replay is useless here (codemoss renders its own stored
/// conversation); the smallest window keeps the opening snapshot light.
const FOLLOW_MAX_MESSAGES: u32 = 1;
/// The killed-flag poll cadence inside the WS select loop.
const KILL_POLL: Duration = Duration::from_millis(150);
/// Wait for the follow snapshot (proof the subscription is live) at most
/// this long before dispatching the prompt.
const FOLLOW_READY_TIMEOUT: Duration = Duration::from_secs(5);
/// How long the plan permission waits for the host to echo plan/mode{active:true}: with no open
/// turn /plan commits at once and appends that log event, so a timeout means the host didn't confirm.
const PLAN_MODE_CONFIRM_TIMEOUT: Duration = Duration::from_secs(10);

type Ws =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// Per-turn view state: live deltas arrive per assistant attempt, and the
/// durable `assistant/message` settlement must not double-render them.
#[derive(Default)]
struct TurnView {
    attempt_streamed_text: bool,
    last_usage: Option<Value>,
    /// A `turn/start` came through: the agent is working, so the turn waits for its end.
    turn_started: bool,
    turn_ended: bool,
    /// The context window `request/context` announced (valid for this turn). It backs up usage
    /// reports without one and rides on the done payload, or the frontend falls back to an
    /// assumed 200k when the turn ends.
    context_window: Option<i64>,
    /// `$events` clientId from the ready frame; required on every answer.
    events_client_id: Option<String>,
    /// callId → tool name from dispatched `tool/call` rows, so the matching
    /// `tool/result` patch can find the row it belongs to.
    tool_names: HashMap<String, String>,
    /// The workspace path: an identity field of the plan-review record (record.workspace_path).
    workspace: String,
}

/// Drive one send as a host turn. Mirrors `run_reader`'s settle contract:
/// dispatch events until a terminal done/error, then drain this run's
/// registry entries. Transport/rpc failures surface as `EngineEvent::Error`.
pub(crate) async fn run_host_turn(
    core: TurnCore,
    req: SendRequest,
    host: Arc<crate::engines::support::dsh_host::DshHostState>,
    killed: Arc<AtomicBool>,
    virtual_pid: u32,
) {
    let mut state = TurnState::new(req.session_id.clone());
    let mut view = TurnView::default();
    let preassigned_session_id = req.session_id.clone();
    view.workspace = req.workspace.to_string_lossy().into_owned();
    // Abort-safe backstop: the by-name removals below only run when the task
    // finishes normally. An abort or a panic would otherwise leave this run's
    // keys pinning a concurrency slot until app exit.
    let _registry_guard =
        VirtualRunGuard::new(Arc::clone(&core.registry), core.run_id.clone(), virtual_pid);
    let result = turn_inner(&core, &mut state, &mut view, &req, &host, &killed).await;
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
        // A parked plan review dies with the run and expires.
        super::reader::expire_parked_plans(&core, &mut state, &key);
    }
    if let Err(error) = result {
        core.dispatch_event(&mut state, EngineEvent::Error(error));
    }
    // An interrupted run commits its partial output as a normal turn end —
    // the same contract as the SIGKILL'd process path.
    if !state.saw_done && !state.saw_error {
        let usage = if killed.load(Ordering::SeqCst) {
            None
        } else {
            // With no usage report but a window the host announced, done carries the window too,
            // or the frontend falls back to an assumed 200k at the end of the turn.
            view.last_usage
                .clone()
                .or_else(|| {
                    view.context_window
                        .map(|window| json!({ "contextWindow": window }))
                })
                .map(|usage| attach_context_window(usage, view.context_window))
        };
        let session_id = state.native_session_id.clone();
        core.dispatch_event(&mut state, EngineEvent::Done { session_id, usage });
    }
    core.registry.remove_if_pid(&core.run_id, virtual_pid);
    // Clean up both the native session id (if the engine reported one) and
    // the preassigned session id (if we resumed an existing conversation).
    // A resumed session was keyed at spawn under req.session_id, so we must
    // remove that alias even if the native id differs or never arrived.
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
    host: &Arc<crate::engines::support::dsh_host::DshHostState>,
    killed: &Arc<AtomicBool>,
) -> Result<(), String> {
    // The host must be up before anything else: ensure adopts or spawns it
    // (serialized internally, so a chat send racing autostart is safe).
    let settings = crate::engines::support::settings::read_settings().unwrap_or_default();
    let origin = crate::engines::support::dsh_host::configured_origin(&settings);
    crate::engines::support::dsh_host::ensure_host(host, &settings).await?;
    let cookie = crate::engines::support::dsh_host::host_cookie(&origin);

    // Workspace: registered by path so resumed sessions keep their identity.
    let workspace = host_call(
        &origin,
        "workspace/create",
        json!({ "request": { "path": req.workspace.to_string_lossy() } }),
    )
    .await?
    .pointer("/workspace/workspaceId")
    .and_then(Value::as_str)
    .map(str::to_string)
    .ok_or("workspace/create returned no workspaceId")?;

    // Session continuity: codemoss passes back the native id it received via
    // the "session" event; a fresh id comes back for a new conversation.
    let mut create_args = json!({ "request": { "workspaceId": workspace } });
    if let Some(session_id) = req.session_id.as_deref() {
        create_args["request"]["sessionId"] = Value::String(session_id.to_string());
    }
    let session_id = host_call(&origin, "session/create", create_args)
        .await?
        .pointer("/sessionId")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or("session/create returned no sessionId")?;
    core.dispatch_event(state, EngineEvent::SessionId(session_id.clone()));
    // The host's slash commands for this session (its plugins register them): reported for the
    // composer's `/` menu, and a message that names one runs through commands/execute instead of
    // reaching the model as text, as it does in the host's own composer.
    let listed = host_call(&origin, "commands/list", json!({ "agentId": session_id })).await;
    if let Ok(listed) = &listed {
        report_commands(listed);
    }
    let command = listed
        .as_ref()
        .ok()
        .and_then(|listed| command_line(&req.prompt, listed));
    // Plan review mode: commands/list first checks whether the host includes the plan-mode
    // plugin, and its absence is an error. HTTP 200 doesn't mean the command exists, and this
    // never falls back to running in auto.
    let plan_mode = req.permission.as_deref() == Some("plan");
    if plan_mode {
        ensure_plan_command(&listed)?;
    }

    // Model: the picker's ids are `provider/model` selector ids (models.rs).
    if let Some(model) = req.model.as_deref().filter(|m| m.contains('/')) {
        let (provider, model) = model.split_once('/').unwrap_or(("", model));
        if !provider.is_empty() && !model.is_empty() {
            let mut select_args = json!({ "request": { "sessionId": session_id, "provider": provider, "model": model } });
            if let Some(effort) = req
                .effort
                .as_deref()
                .map(str::trim)
                .filter(|e| !e.is_empty())
            {
                select_args["request"]["effort"] = json!(effort);
                select_args["request"]["reasoningEffort"] = json!(effort);
            }
            let selected = host_call(&origin, "session/selectModel", select_args).await;
            if selected.is_err() {
                core.dispatch_event(
                    state,
                    EngineEvent::Warn(format!("The model switch didn't take; the session keeps its current model: {model}")),
                );
            }
        }
    }

    // Attachments: load through the shared image pipeline, then make sure
    // the session's route actually admits images — hand-declared llm-pi-ai
    // routes default to text-only until ccgui writes the modality claim.
    let prompt_images = dsh_images::load_prompt_images(&req.images, &req.workspace)?;
    if !prompt_images.is_empty() {
        let Some((provider, model)) =
            dsh_images::current_selection(&origin, req.model.as_deref()).await
        else {
            return Err(
                "DSH needs a model chosen before it can send pictures: the host reported no current provider/model".to_string(),
            );
        };
        dsh_images::ensure_image_admission(&origin, &provider, &model).await?;
    }

    let mut ws = mux_connect(&origin, cookie.as_deref()).await?;
    // Streams must be live before the prompt so no turn event races the
    // subscription: the follow snapshot proves the follow subscription landed,
    // and the $events ready frame carries the clientId every question answer
    // needs. Waiting for both kills the race where a waterfall frame arrived
    // before the ready frame and the question was skipped as "not ready".
    let opened = ws_open_and_wait(&mut ws, &session_id).await;
    view.events_client_id = opened.events_client_id;
    if view.events_client_id.is_none() {
        core.dispatch_event(
            state,
            EngineEvent::Warn(
                "The question channel isn't ready; questions in this turn will be skipped"
                    .to_string(),
            ),
        );
    }
    if plan_mode {
        // Enter plan mode: commands/execute "/plan", and send the prompt only once the follow
        // stream echoes plan/mode{active:true}.
        enter_plan_mode(&origin, &session_id, &mut ws, opened.plan_active).await?;
    }

    // A command settles before its answer comes back and opens no turn of its own; when it
    // starts the agent working, the follow stream carries that turn like a prompt's.
    let grace = match command {
        Some(line) => {
            let attachments = dsh_images::build_prompt_content("", &prompt_images).split_off(1);
            let Some(result) =
                execute_command(&origin, &session_id, &line, attachments, killed).await?
            else {
                let _ = ws.close(None).await;
                return Ok(());
            };
            let text = command_outcome(command_name(&line), &result)?;
            if !text.trim().is_empty() {
                core.dispatch_event(state, EngineEvent::Delta(format!("{text}\n\n")));
            }
            Some(tokio::time::Instant::now() + COMMAND_TURN_GRACE)
        }
        None => {
            send_prompt(&origin, &session_id, req, &prompt_images, &mut ws).await?;
            None
        }
    };
    let grace_deadline = grace.unwrap_or_else(tokio::time::Instant::now);

    let (mut write, mut read) = ws.split();
    let mut kill_poll = tokio::time::interval(KILL_POLL);
    kill_poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            frame = read.next() => match frame {
                Some(Ok(Message::Text(text))) => {
                    let Ok(parsed) = serde_json::from_str::<Value>(text.as_str()) else {
                        continue;
                    };
                    if parsed.get("type").and_then(Value::as_str) != Some("item") {
                        continue;
                    }
                    let stream_id = parsed.get("streamId").and_then(Value::as_str).unwrap_or("");
                    let value = parsed.get("value").cloned().unwrap_or(Value::Null);
                    match stream_id {
                        STREAM_FOLLOW => handle_follow(core, state, view, &value),
                        STREAM_EVENTS => {
                            handle_events_frame(core, state, view, &value, &origin).await;
                        }
                        _ => {}
                    }
                    if view.turn_ended {
                        break;
                    }
                }
                Some(Ok(_)) => {} // ping/pong/binary: keep the loop going
                Some(Err(error)) => {
                    if killed.load(Ordering::SeqCst) || view.turn_ended {
                        break;
                    }
                    return Err(format!("The dsh session stream broke: {error}"));
                }
                None => {
                    if killed.load(Ordering::SeqCst) || view.turn_ended {
                        break;
                    }
                    return Err("The dsh session stream closed".to_string());
                }
            },
            // A command that started no turn is done once the grace passes.
            _ = tokio::time::sleep_until(grace_deadline), if grace.is_some() && !view.turn_started => break,
            _ = kill_poll.tick() => {
                if killed.load(Ordering::SeqCst) {
                    // Best-effort server-side cancel; if this races the
                    // turn's completion the host simply ignores it.
                    let _ = host_call(
                        &origin,
                        "session/cancel",
                        json!({ "request": { "sessionId": session_id } }),
                    )
                    .await;
                    break;
                }
            }
        }
    }
    let _ = write.close().await;
    Ok(())
}

// ==================== plan mode entry ====================

/// The preflight check: commands/list confirms the plan command exists. A missing plugin (no
/// plan in the list) or a failed check is an error, never a fallback to auto.
fn ensure_plan_command(listed: &Result<Value, String>) -> Result<(), String> {
    let listed = listed.as_ref().map_err(|error| {
        format!("Couldn't confirm the host's plan command (commands/list failed): {error}")
    })?;
    if !plan_command_listed(listed) {
        return Err(
            "This dsh host doesn't include the plan-mode plugin (no plan command in commands/list), so plan review can't start; it won't run in auto instead"
                .to_string(),
        );
    }
    Ok(())
}

/// Whether commands/list lists the plan command (a pure function, for tests).
fn plan_command_listed(listed: &Value) -> bool {
    listed
        .as_array()
        .map(|commands| {
            commands
                .iter()
                .any(|command| command.get("name").and_then(Value::as_str) == Some("plan"))
        })
        .unwrap_or(false)
}

/// How the plan permission starts: commands/execute {agentId, line:"/plan",
/// submittedAttachments:[]}, then wait for the follow stream to echo plan/mode{active:true}. Any
/// failed step is an error, never a fallback to auto.
async fn enter_plan_mode(
    origin: &str,
    session_id: &str,
    ws: &mut Ws,
    already_active: bool,
) -> Result<(), String> {
    let result = host_call(
        origin,
        "commands/execute",
        json!({
            "agentId": session_id,
            "line": "/plan",
            "submittedAttachments": [],
        }),
    )
    .await
    .map_err(|error| format!("Couldn't enter plan mode (commands/execute /plan): {error}"))?;
    plan_execute_outcome(&result)?;
    if already_active {
        // The snapshot already shows plan.active: this /plan is a no-op and appends no plan/mode
        // event, so there is nothing to wait for.
        return Ok(());
    }
    await_plan_mode_active(ws).await
}

/// Waits for the follow stream to echo plan/mode{active:true} (with no open turn, /plan commits
/// at once and appends that event to the session log, which the follow stream carries). A
/// timeout or a broken stream means the host didn't confirm, an error; other events meanwhile
/// (plan/mode:false included) are ignored as usual.
async fn await_plan_mode_active(ws: &mut Ws) -> Result<(), String> {
    let started = tokio::time::Instant::now();
    while started.elapsed() < PLAN_MODE_CONFIRM_TIMEOUT {
        let remaining = PLAN_MODE_CONFIRM_TIMEOUT - started.elapsed();
        match tokio::time::timeout(remaining, ws.next()).await {
            Ok(Some(Ok(Message::Text(text)))) => {
                let Ok(value) = serde_json::from_str::<Value>(text.as_str()) else {
                    continue;
                };
                if value.get("type").and_then(Value::as_str) != Some("item")
                    || value.get("streamId").and_then(Value::as_str) != Some(STREAM_FOLLOW)
                {
                    continue;
                }
                if value.pointer("/value/event/type").and_then(Value::as_str) == Some("plan/mode")
                    && value
                        .pointer("/value/event/data/active")
                        .and_then(Value::as_bool)
                        == Some(true)
                {
                    return Ok(());
                }
            }
            Ok(Some(Ok(_))) => {} // ping/pong/binary: keep waiting
            _ => break,
        }
    }
    Err(
        "Timed out waiting for plan/mode active: the host didn't confirm plan mode, so the send stopped (it doesn't fall back to auto)"
            .to_string(),
    )
}

// ==================== frame projection ====================

/// One follow-stream item: durable session events + the opted-in
/// `assistant-stream` live frames.
fn handle_follow(core: &TurnCore, state: &mut TurnState, view: &mut TurnView, value: &Value) {
    match value.get("type").and_then(Value::as_str) {
        Some("snapshot") => {} // history replay: codemoss renders its own log
        Some("event") => {
            let event = value.get("event").cloned().unwrap_or(Value::Null);
            let event_type = event.get("type").and_then(Value::as_str).unwrap_or("");
            let data = event.get("data").cloned().unwrap_or(Value::Null);
            handle_session_event(core, state, view, event_type, &data);
        }
        Some("assistant-stream") => handle_assistant_stream(core, state, view, value),
        _ => {}
    }
}

fn handle_session_event(
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    event_type: &str,
    data: &Value,
) {
    match event_type {
        "tool/call" => {
            let name = data.get("name").and_then(Value::as_str).unwrap_or("tool");
            if let Some(call_id) = data.get("callId").and_then(Value::as_str) {
                view.tool_names
                    .insert(call_id.to_string(), name.to_string());
            }
            let args = data
                .get("arguments")
                .and_then(Value::as_str)
                .and_then(|text| serde_json::from_str::<Value>(text).ok())
                .or_else(|| data.get("arguments").cloned());
            core.dispatch_event(
                state,
                super::tool_call_message_with_id(
                    name,
                    args.as_ref(),
                    data.get("callId").and_then(Value::as_str),
                ),
            );
        }
        "tool/result" => {
            let call_id = data
                .pointer("/message/source/callId")
                .and_then(Value::as_str)
                .unwrap_or("");
            let name = view
                .tool_names
                .get(call_id)
                .cloned()
                .unwrap_or_else(|| "tool".to_string());
            let content = data
                .pointer("/message/content")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let text = content
                .iter()
                .filter_map(|block| block.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n");
            let is_error = content
                .iter()
                .any(|block| block.get("isError").and_then(Value::as_bool) == Some(true));
            core.dispatch_event(
                state,
                super::tool_result_patch_with_id(
                    &name,
                    Some(&json!({ "text": text, "isError": is_error })),
                    (!call_id.is_empty()).then_some(call_id),
                ),
            );
        }
        "assistant/message" => {
            // Settlement of the streamed attempt: render only when the live
            // deltas never flowed, else the message would appear twice.
            if !view.attempt_streamed_text {
                let text = message_text(data);
                if !text.is_empty() {
                    core.dispatch_event(state, EngineEvent::Delta(format!("{text}\n\n")));
                }
            }
            view.attempt_streamed_text = false;
        }
        "turn/start" => view.turn_started = true,
        "turn/end" => {
            view.turn_ended = true;
            let kind = data
                .pointer("/reason/kind")
                .and_then(Value::as_str)
                .unwrap_or("completed");
            if kind != "completed" {
                core.dispatch_event(state, EngineEvent::Warn(format!("The turn ended ({kind})")));
            }
        }
        // Plan review's companion status events: plan/mode:false after approval and the pending
        // inactive projection are ordinary session log events, neither a way out of review
        // (/plan off isn't a shortcut out) nor errors.
        "plan/mode" => {}
        // The request context: DSH announces the request's real window here
        // (provider/model/contextWindow), the only window source among its published events
        // (TokenUsage and session/modelCatalog carry none). Paired per request: every
        // announcement overwrites the cache (one without a window clears the previous value, so
        // a window never carries over to the next request), and this turn's usage/done get it.
        // Without it the frontend could only assume 200k, and a 1M model would show as 200k.
        "request/context" => {
            view.context_window = context_window_of(data);
        }
        _ => {} // user/message / step/* / system/message / title: UI noise here
    }
}

/// `assistant-stream` live frames: start / chunk / end. Chunks carry the
/// model's raw deltas (text-delta, reasoning-delta, usage, finish, …).
fn handle_assistant_stream(
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    value: &Value,
) {
    let frame = value.get("frame").cloned().unwrap_or(Value::Null);
    match frame.get("type").and_then(Value::as_str) {
        Some("start") => view.attempt_streamed_text = false,
        Some("chunk") => {
            let chunk = frame.get("chunk").cloned().unwrap_or(Value::Null);
            match chunk.get("type").and_then(Value::as_str) {
                Some("text-delta") => {
                    let text = chunk.get("text").and_then(Value::as_str).unwrap_or("");
                    if !text.is_empty() {
                        view.attempt_streamed_text = true;
                        core.dispatch_event(state, EngineEvent::Delta(text.to_string()));
                    }
                }
                Some("reasoning-delta") => {
                    let text = chunk.get("text").and_then(Value::as_str).unwrap_or("");
                    if !text.is_empty() {
                        core.dispatch_event(state, EngineEvent::Thinking(text.to_string()));
                    }
                }
                Some("usage") => {
                    if let Some(usage) = chunk.get("usage") {
                        let usage = attach_context_window(usage.clone(), view.context_window);
                        view.last_usage = Some(usage.clone());
                        core.dispatch_event(state, EngineEvent::Usage(usage));
                    }
                }
                _ => {} // block-start / block-end / tool-call-delta / finish
            }
        }
        _ => {} // end frames: the durable events settle the turn
    }
}

// ==================== $events (approvals / questions) ====================

async fn handle_events_frame(
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    value: &Value,
    origin: &str,
) {
    match value.get("type").and_then(Value::as_str) {
        // The events client id, required on every $events/result answer.
        Some("ready") => {
            if let Some(client_id) = value.get("clientId").and_then(Value::as_str) {
                view.events_client_id = Some(client_id.to_string());
            }
        }
        Some("waterfall") => {
            let Some(event_id) = value.get("eventId").and_then(Value::as_str) else {
                return;
            };
            let kind = value.get("event").and_then(Value::as_str).unwrap_or("");
            let Some(client_id) = view.events_client_id.clone() else {
                core.dispatch_event(
                    state,
                    EngineEvent::Warn("An approval or question request arrived before the event channel was ready, so it was skipped".to_string()),
                );
                return;
            };
            // Questions park host-side until the user answers from the card
            // (answer_question posts the outcome); approvals keep the v1
            // auto-allow policy; unknown waterfall kinds reject as before.
            if kind == "user-questions/request" {
                park_question(core, state, view, value, origin, &client_id, event_id).await;
                return;
            }
            // v1 policy: approvals auto-allow — API-created sessions already
            // run tools without a permission flow (the headless engine had
            // the same implicit behavior), and codemoss has no approval UI
            // for host sessions yet.
            let (outcome, notice) = if kind == "approval/request" {
                (json!({ "kind": "result", "value": "allowed-once" }), None)
            } else {
                (
                    json!({
                        "kind": "rejected",
                        "error": { "code": "cancelled", "message": "the user cancelled ask_user_question" },
                    }),
                    Some("Cancelled an interaction request of an unknown kind".to_string()),
                )
            };
            let answered = host_call(
                origin,
                "$events/result",
                json!({ "clientId": client_id, "eventId": event_id, "outcome": outcome }),
            )
            .await;
            match (answered, notice) {
                (Err(_), _) => core.dispatch_event(
                    state,
                    EngineEvent::Warn(
                        "Answering an approval or question failed; this turn may be stuck"
                            .to_string(),
                    ),
                ),
                (Ok(_), Some(notice)) => {
                    core.dispatch_event(state, EngineEvent::Warn(notice));
                }
                (Ok(_), None) => {}
            }
        }
        // Cancellation of a pending waterfall previously delivered under the
        // same id: settle the card so it never stays answerable against a
        // request the host already withdrew.
        Some("cancel") => {
            if let Some(event_id) = value.get("eventId").and_then(Value::as_str) {
                core.dispatch_event(
                    state,
                    EngineEvent::QuestionSettled {
                        request_id: event_id.to_string(),
                    },
                );
            }
        }
        _ => {}
    }
}

/// Park a `user-questions/request` waterfall: surface the question card and
/// stash the answer context under the same request id. `$events/result` needs
/// the origin + clientId + eventId triple plus the original request (question
/// ids), none of which the UI projection carries — so the parked value is the
/// answer context, not the render input.
async fn park_question(
    core: &TurnCore,
    state: &mut TurnState,
    view: &TurnView,
    value: &Value,
    origin: &str,
    client_id: &str,
    event_id: &str,
) {
    let request = value.get("request").cloned().unwrap_or(Value::Null);
    // A plan-review presentation intent (recognized by intent.kind alone) takes the typed review
    // path instead of becoming an ordinary question card.
    if let Some(question) = plan_review_question(&request) {
        park_plan_review(core, state, view, &question, origin, client_id, event_id).await;
        return;
    }
    let questions = render_questions(&request);
    if questions.is_empty() {
        // A question nobody can see must not park the host forever: reject
        // the waterfall and say so.
        reject_waterfall(origin, client_id, event_id, "empty question request").await;
        core.dispatch_event(
            state,
            EngineEvent::Warn("An empty question request arrived and was skipped".to_string()),
        );
        return;
    }
    core.dispatch_event(
        state,
        EngineEvent::Question {
            request_id: event_id.to_string(),
            tool_use_id: None,
            input: json!({ "questions": questions }),
        },
    );
    // dispatch_event parked the render input under this request id; overwrite
    // it with the answer context the answer command actually needs.
    if let Some(entry) = core.registry.get(&core.run_id) {
        if let Ok(mut parked) = entry.questions.lock() {
            parked.insert(
                event_id.to_string(),
                json!({
                    "dsh": {
                        "origin": origin,
                        "clientId": client_id,
                        "eventId": event_id,
                        "request": request,
                    }
                }),
            );
        }
    }
}
/// Reject a waterfall the UI can never answer, so the host does not park
/// forever on a request we refuse to surface.
async fn reject_waterfall(origin: &str, client_id: &str, event_id: &str, message: &str) {
    let _ = host_call(
        origin,
        "$events/result",
        json!({
            "clientId": client_id,
            "eventId": event_id,
            "outcome": {
                "kind": "rejected",
                "error": { "name": "UserQuestionError", "code": "cancelled", "message": message },
            },
        }),
    )
    .await;
}

/// Recognizes a plan-review intent (by intent.kind=="plan-review" alone; it is questions[0]).
fn plan_review_question(request: &Value) -> Option<Value> {
    request
        .get("questions")?
        .as_array()?
        .first()
        .filter(|question| {
            question.pointer("/intent/kind").and_then(Value::as_str) == Some("plan-review")
        })
        .cloned()
}

/// The body's first markdown heading (the same rule as dsh-plan-mode's firstHeading: 1-6 #s at
/// the line start + whitespace + text); None without one, and the caller picks a default name.
fn first_heading(plan: &str) -> Option<String> {
    plan.lines().find_map(|line| {
        let line = line.trim_end();
        let hashes = line.chars().take_while(|c| *c == '#').count();
        if !(1..=6).contains(&hashes) {
            return None;
        }
        let rest = &line[hashes..];
        if !rest.starts_with(char::is_whitespace) {
            return None;
        }
        let title = rest.trim();
        (!title.is_empty()).then(|| title.to_string())
    })
}

/// A plan-review presentation intent (dsh-plan-mode's exit_plan_mode comes down through
/// userQuestions.ask; questions[0].detail is the full markdown and intent.approve the native
/// approve label): builds a typed PlanReview and dispatches PlanReviewReady. The reader stores
/// it with its revision and parks the native request. The native reply context (the
/// $events/result frames) stays with the context in the backend registry and never rides on the
/// event payload.
async fn park_plan_review(
    core: &TurnCore,
    state: &mut TurnState,
    view: &TurnView,
    question: &Value,
    origin: &str,
    client_id: &str,
    event_id: &str,
) {
    let content = question
        .get("detail")
        .and_then(Value::as_str)
        .filter(|detail| !detail.trim().is_empty());
    let approve = question
        .pointer("/intent/approve")
        .and_then(Value::as_str)
        .filter(|label| !label.is_empty());
    let question_id = question
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty());
    let (Some(content), Some(approve), Some(question_id)) = (content, approve, question_id) else {
        // Fail closed: without the body, the approve label or the question id no review true to
        // the native meaning can be built. Reject the waterfall so the host unblocks, and warn;
        // never fall back to an ordinary question card (that would lose the review's meaning).
        reject_waterfall(origin, client_id, event_id, "malformed plan-review request").await;
        core.dispatch_event(
            state,
            EngineEvent::Warn(
                "A plan review request arrived incomplete (no body, approve label or question id) and was refused".to_string(),
            ),
        );
        return;
    };
    let title = first_heading(content).unwrap_or_else(|| "Plan review".to_string());
    let content_hash = super::plan_review::content_hash(content);
    // Reply frames use question_outcome/answer_question's $events/result shape
    // ({clientId, eventId, outcome:{kind:"result", value:{answers:[…]}}}). The approve frame:
    // selected=[intent.approve's real label] and never a custom key (the host checks
    // selected.length===1 && selected[0]===approve && custom===void 0). The feedback frame:
    // selected:[] + a custom placeholder, which respond_plan_review replaces with the person's
    // feedback when it sends.
    let outcome = |answers: Value| {
        json!({
            "clientId": client_id,
            "eventId": event_id,
            "outcome": { "kind": "result", "value": { "answers": [answers] } },
        })
    };
    let approve_frame = outcome(json!({ "id": question_id, "selected": [approve] }));
    let changes_frame = outcome(
        json!({ "id": question_id, "selected": [], "custom": super::PLAN_FEEDBACK_PLACEHOLDER }),
    );
    let now = super::plan_review::now_ms();
    let record = super::plan_review::PlanReview {
        plan_id: format!("dsh-plan-{event_id}"),
        engine: core.engine_id.clone(),
        session_id: state.native_session_id.clone().unwrap_or_default(),
        workspace_path: view.workspace.clone(),
        run_id: Some(core.run_id.clone()),
        revision: 0, // assigned when dispatch stores it; the adapter sets none
        title,
        content: content.to_string(),
        content_hash: content_hash.clone(),
        complete: true,
        review_kind: super::plan_review::PlanReviewKind::NativeRequest,
        native_plan_id: Some(question_id.to_string()),
        // Plan mode is soft guidance: after approval plan mode ends and tool calls go back to
        // the host session's own policy (v1 auto-allow); the review doesn't change permissions.
        exec_permission: "auto".to_string(),
        status: super::plan_review::PlanStatus::AwaitingReview,
        execution: super::plan_review::PlanExecution::NotStarted,
        decision: None,
        decision_intent_at: None,
        applied_at: None,
        created_at: now,
        updated_at: now,
        superseded_by: None,
    };
    // The parked context (as respond_plan_review reads it): route/origin/path/contentHash/frames
    // at the top level; dispatch adds the revision key, which the adapter leaves free.
    let context = json!({
        "route": "http",
        "origin": origin,
        "path": "$events/result",
        "contentHash": content_hash,
        "frames": { "approve": approve_frame, "changes": changes_frame },
    });
    core.dispatch_event(
        state,
        EngineEvent::PlanReviewReady {
            record: Box::new(record),
            context,
        },
    );
}

/// Project a dsh `user-questions/request` payload onto the QuestionSpec shape
/// the UI renders (the claude control-protocol shape): `header` defaults,
/// `detail` folds into the question text, options pass through unchanged.
/// (A plan-review intent request is diverted to the review path at park_question's entry and
/// never goes through this mapping.) The answer command
/// re-derives answer keys from the parked original request through this same
/// mapping, so the two must never drift apart.
pub(crate) fn render_questions(request: &Value) -> Vec<Value> {
    let Some(questions) = request.get("questions").and_then(Value::as_array) else {
        return Vec::new();
    };
    questions
        .iter()
        .map(|question| {
            let mut text = question
                .get("question")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if let Some(detail) = question
                .get("detail")
                .and_then(Value::as_str)
                .filter(|detail| !detail.trim().is_empty())
            {
                text = format!("{text}\n\n{detail}");
            }
            json!({
                "question": text,
                "header": question.get("header").and_then(Value::as_str).unwrap_or("Question"),
                "multiSelect": question.get("multiSelect").and_then(Value::as_bool).unwrap_or(false),
                "options": question.get("options").cloned().unwrap_or_else(|| json!([])),
            })
        })
        .collect()
}

/// Build the `$events/result` outcome for a parked dsh question. `answers` is
/// the UI's map (rendered question text → picked label(s)); a free-form
/// string matching no option label travels as `custom`. `None` (or a
/// non-object) means the user dismissed the card.
pub(crate) fn question_outcome(request: &Value, answers: Option<&Value>) -> Value {
    let Some(answers) = answers.and_then(Value::as_object) else {
        return json!({
            "kind": "rejected",
            "error": { "name": "UserQuestionError", "code": "cancelled", "message": "the user cancelled ask_user_question" },
        });
    };
    let rendered = render_questions(request);
    let questions = request
        .get("questions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut items = Vec::new();
    for (index, question) in questions.iter().enumerate() {
        let id = question
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        // Answers key on the rendered question text (detail folded in), so
        // re-derive the same key rather than trusting the raw question.
        let key = rendered
            .get(index)
            .and_then(|r| r.get("question"))
            .and_then(Value::as_str)
            .unwrap_or("");
        let known_labels: Vec<&str> = question
            .get("options")
            .and_then(Value::as_array)
            .map(|options| {
                options
                    .iter()
                    .filter_map(|o| o.get("label").and_then(Value::as_str))
                    .collect()
            })
            .unwrap_or_default();
        let item = match answers.get(key) {
            Some(Value::Array(labels)) => json!({ "id": id, "selected": labels }),
            Some(Value::String(text)) if known_labels.contains(&text.as_str()) => {
                json!({ "id": id, "selected": [text] })
            }
            Some(Value::String(text)) => {
                json!({ "id": id, "selected": [], "custom": text })
            }
            _ => json!({ "id": id, "selected": [] }),
        };
        items.push(item);
    }
    json!({ "kind": "result", "value": { "answers": items } })
}

// ==================== transport helpers ====================

async fn mux_connect(origin: &str, cookie: Option<&str>) -> Result<Ws, String> {
    let authority = origin
        .strip_prefix("http://")
        .or_else(|| origin.strip_prefix("https://"))
        .unwrap_or(origin);
    let mut request = format!("ws://{authority}/api/remote.mux")
        .into_client_request()
        .map_err(|error| format!("The dsh session stream address is invalid: {error}"))?;
    if let Some(value) = cookie.and_then(|cookie| cookie.parse().ok()) {
        request
            .headers_mut()
            .insert(tokio_tungstenite::tungstenite::http::header::COOKIE, value);
    }
    let (stream, _response) = tokio_tungstenite::connect_async(request)
        .await
        .map_err(|error| format!("Couldn't connect the dsh session stream ({origin}): {error}"))?;
    Ok(stream)
}

async fn ws_send(ws: &mut Ws, payload: Value) -> Result<(), String> {
    ws.send(Message::Text(payload.to_string().into()))
        .await
        .map_err(|error| format!("Couldn't send on the dsh session stream: {error}"))
}

/// Streams opened on the mux: the events clientId plus the plan projection
/// read off the follow snapshot (under the plan permission it tells a no-op /plan from a
/// committed one: once active, no further plan/mode event comes to echo).
struct StreamsOpened {
    events_client_id: Option<String>,
    /// The plan projection's active bit in the follow snapshot (dsh-plan-mode's wire view
    /// {active, pending}); false when the snapshot is missing or the projection isn't registered.
    plan_active: bool,
}

/// Open both logical streams and wait for the follow snapshot (proof the
/// follow subscription is live) AND the `$events` ready frame (its clientId
/// heads every `$events/result` answer) before the caller dispatches the
/// prompt — with a bounded fallback so a gateway that skips either cannot
/// stall sends. Returns the events clientId when the ready frame arrived in
/// time; a late ready frame is still picked up by the main loop.
async fn ws_open_and_wait(ws: &mut Ws, session_id: &str) -> StreamsOpened {
    let opened = async {
        ws_send(
            ws,
            json!({
                "type": "open",
                "streamId": STREAM_FOLLOW,
                "endpoint": "session/follow",
                "payload": { "args": { "request": {
                    "address": { "kind": "session", "sessionId": session_id },
                    "maxMessages": FOLLOW_MAX_MESSAGES,
                    "assistantStream": true,
                } } },
            }),
        )
        .await?;
        ws_send(
            ws,
            json!({
                "type": "open",
                "streamId": STREAM_EVENTS,
                "endpoint": "$events",
                "payload": { "args": {} },
            }),
        )
        .await
    };
    if let Err(error) = opened.await {
        eprintln!("[dsh] mux stream open failed: {error}");
        return StreamsOpened {
            events_client_id: None,
            plan_active: false,
        };
    }
    let mut follow_ready = false;
    let mut events_client_id: Option<String> = None;
    let mut plan_active = false;
    let started = tokio::time::Instant::now();
    while started.elapsed() < FOLLOW_READY_TIMEOUT && !(follow_ready && events_client_id.is_some())
    {
        let next = tokio::time::timeout(FOLLOW_READY_TIMEOUT - started.elapsed(), ws.next()).await;
        match next {
            Ok(Some(Ok(Message::Text(text)))) => {
                let Ok(value) = serde_json::from_str::<Value>(text.as_str()) else {
                    continue;
                };
                if value.get("type").and_then(Value::as_str) != Some("item") {
                    continue;
                }
                match value.get("streamId").and_then(Value::as_str) {
                    Some(STREAM_FOLLOW)
                        if value.pointer("/value/type").and_then(Value::as_str)
                            == Some("snapshot") =>
                    {
                        follow_ready = true;
                        // The plan projection's trimmed view {active, pending} (dsh-plan-mode's
                        // planProjectionDefinition wire); absent means the plugin isn't registered.
                        plan_active = value
                            .pointer("/value/projections/values/plan/active")
                            .and_then(Value::as_bool)
                            .unwrap_or(false);
                    }
                    Some(STREAM_EVENTS)
                        if value.pointer("/value/type").and_then(Value::as_str)
                            == Some("ready") =>
                    {
                        events_client_id = value
                            .pointer("/value/clientId")
                            .and_then(Value::as_str)
                            .map(str::to_string);
                    }
                    _ => {}
                }
            }
            Ok(Some(Ok(_))) | Ok(Some(Err(_))) | Ok(None) | Err(_) => break,
        }
    }
    StreamsOpened {
        events_client_id,
        plan_active,
    }
}

fn message_text(data: &Value) -> String {
    data.pointer("/message/content")
        .and_then(Value::as_array)
        .map(|blocks| {
            blocks
                .iter()
                .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
                .filter_map(|block| block.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default()
}

fn client_time_zone() -> String {
    std::env::var("TZ")
        .ok()
        .map(|tz| tz.trim_matches('"').trim().to_string())
        .filter(|tz| !tz.is_empty() && tz.contains('/'))
        .unwrap_or_else(|| "UTC".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engines::support::event_sink::{Emit, EventSink};
    use crate::engines::ProcessRegistry;
    use std::path::PathBuf;
    use std::sync::Mutex as StdMutex;

    /// Test emitter collecting flushed event JSON for assertions.
    struct CollectingEmitter(StdMutex<Vec<String>>);

    impl Emit for CollectingEmitter {
        fn emit_json(&self, _name: &str, raw_json: &str) {
            self.0.lock().unwrap().push(raw_json.to_string());
        }
    }

    #[tokio::test]
    async fn tool_messages_preserve_call_id_in_emitted_payloads() {
        let emitter = Arc::new(CollectingEmitter(StdMutex::new(Vec::new())));
        let core = TurnCore {
            sink: EventSink::new(emitter.clone()),
            registry: Arc::new(ProcessRegistry::default()),
            engine_id: "dsh".to_string(),
            run_id: "test-run".to_string(),
            db: None,
            followup: None,
        };
        let mut state = TurnState::new(None);
        let mut view = TurnView::default();

        handle_session_event(
            &core,
            &mut state,
            &mut view,
            "tool/call",
            &json!({
                "callId": "call-17",
                "name": "bash",
                "arguments": { "command": "pnpm test" }
            }),
        );
        handle_session_event(
            &core,
            &mut state,
            &mut view,
            "tool/result",
            &json!({
                "message": {
                    "source": { "callId": "call-17" },
                    "content": [{ "type": "text", "text": "done", "isError": false }]
                }
            }),
        );
        core.sink.flush();

        let events = emitter.0.lock().unwrap().clone();
        let messages: Vec<Value> = collect_kinds(&events)
            .into_iter()
            .filter_map(|(kind, data)| (kind == "message").then_some(data))
            .collect();
        assert_eq!(messages.len(), 2);
        assert!(messages
            .iter()
            .all(|data| data.get("toolCallId").and_then(Value::as_str) == Some("call-17")));
    }

    /// End-to-end against the configured local host (skipped by default):
    /// `cargo test --lib dsh_session -- --ignored --nocapture`.
    /// Proves the full chain: ensure host → workspace/session → prompt →
    /// assistantStream deltas → done, with session + usage events present.
    #[tokio::test]
    #[ignore = "needs a running dsh host at the configured origin"]
    async fn streams_a_live_host_turn() {
        let emitter = Arc::new(CollectingEmitter(StdMutex::new(Vec::new())));
        let sink = EventSink::new(emitter.clone());
        let core = TurnCore {
            sink,
            registry: Arc::new(ProcessRegistry::default()),
            engine_id: "dsh".to_string(),
            run_id: "test-run".to_string(),
            db: None,
            followup: None,
        };
        let req = SendRequest {
            session_id: None,
            workspace: PathBuf::from("/tmp"),
            prompt: "Answer in one sentence: what is 1+1?".to_string(),
            prompt_contributions: Vec::new(),
            native_compact: false,
            images: Vec::new(),
            model: None,
            effort: None,
            service_tier: None,
            permission: None,
            additional_dirs: Vec::new(),
            provider_id: None,
            mcp_servers: None,
            allowed_tools: None,
        };
        run_host_turn(
            core,
            req,
            Arc::new(crate::engines::support::dsh_host::DshHostState::default()),
            Arc::new(AtomicBool::new(false)),
            4_000_000_001,
        )
        .await;

        let events = emitter.0.lock().unwrap().clone();
        for raw in &events {
            println!("event: {raw}");
        }
        assert!(!events.is_empty(), "no events flushed");
        // The sink batches each flush as a JSON array of events.
        let mut kinds: Vec<(String, Value)> = Vec::new();
        for raw in &events {
            let flushed: Value = serde_json::from_str(raw).expect("flushed batch must be JSON");
            let batch = flushed.as_array().cloned().unwrap_or_else(|| vec![flushed]);
            for value in batch {
                kinds.push((
                    value
                        .get("kind")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                    value.get("data").cloned().unwrap_or(Value::Null),
                ));
            }
        }
        let session = kinds
            .iter()
            .find(|(kind, _)| kind == "session")
            .map(|(_, data)| data.as_str().unwrap_or("").to_string());
        let session = session.expect("session id must be announced");
        assert!(
            session.starts_with("session-"),
            "unexpected session id {session}"
        );
        let deltas: String = kinds
            .iter()
            .filter(|(kind, _)| kind == "delta")
            .filter_map(|(_, data)| data.as_str())
            .collect();
        assert!(!deltas.trim().is_empty(), "no streamed deltas: {kinds:?}");
        assert!(
            kinds.iter().any(|(kind, _)| kind == "done"),
            "turn never settled: {kinds:?}"
        );
        assert!(
            !kinds.iter().any(|(kind, _)| kind == "error"),
            "unexpected error event: {kinds:?}"
        );
    }

    /// Resume + tools: turn 2 reuses turn 1's session id (codemoss passes it
    /// back as `session_id`), runs a tool, and projects a tool row plus its
    /// result patch. Same live-host gate as `streams_a_live_host_turn`.
    #[tokio::test]
    #[ignore = "needs a running dsh host at the configured origin"]
    async fn resumes_session_and_streams_tool_rows() {
        let run = |session_id: Option<String>, prompt: &str| {
            let prompt = prompt.to_string();
            async move {
                let emitter = Arc::new(CollectingEmitter(StdMutex::new(Vec::new())));
                let core = TurnCore {
                    sink: EventSink::new(emitter.clone()),
                    registry: Arc::new(ProcessRegistry::default()),
                    engine_id: "dsh".to_string(),
                    run_id: "test-run".to_string(),
                    db: None,
                    followup: None,
                };
                let req = SendRequest {
                    session_id,
                    workspace: PathBuf::from("/tmp"),
                    prompt,
                    prompt_contributions: Vec::new(),
                    native_compact: false,
                    images: Vec::new(),
                    model: None,
                    effort: None,
                    service_tier: None,
                    permission: None,
                    additional_dirs: Vec::new(),
                    provider_id: None,
                    mcp_servers: None,
                    allowed_tools: None,
                };
                run_host_turn(
                    core,
                    req,
                    Arc::new(crate::engines::support::dsh_host::DshHostState::default()),
                    Arc::new(AtomicBool::new(false)),
                    4_000_000_002,
                )
                .await;
                let events = emitter.0.lock().unwrap().clone();
                let kinds = collect_kinds(&events);
                (kinds, announced_session(&events))
            }
        };

        let (kinds1, session_id) = run(None, "Answer in one sentence: why is the sky blue?").await;
        assert!(
            !session_id.is_empty(),
            "turn 1 announced no session: {kinds1:?}"
        );
        assert!(
            !kinds1.iter().any(|(kind, _)| kind == "error"),
            "turn 1 errored: {kinds1:?}"
        );

        // Resume: every payload must carry the session id from the first
        // event on (TurnState preseeded), and the tool row must stream.
        let (kinds2, session_id2) = run(
            Some(session_id.clone()),
            "Use the bash tool to run echo codemoss-stream-check, then tell me the output.",
        )
        .await;
        assert_eq!(
            session_id2, session_id,
            "resumed turn changed the session id"
        );
        assert!(
            kinds2.iter().any(|(kind, data)| kind == "message"
                && data.get("role").and_then(Value::as_str) == Some("tool")),
            "no tool row streamed: {kinds2:?}"
        );
        assert!(
            kinds2.iter().any(|(kind, data)| kind == "message"
                && data.get("patch").and_then(Value::as_bool) == Some(true)
                && data.get("result").is_some()),
            "no tool result patch: {kinds2:?}"
        );
        assert!(kinds2.iter().any(|(kind, _)| kind == "done"), "{kinds2:?}");
        assert!(
            !kinds2.iter().any(|(kind, _)| kind == "error"),
            "turn 2 errored: {kinds2:?}"
        );
    }

    /// A TurnCore with a registry entry under its run id (so question parking
    /// has somewhere to land) plus the collected flushes for assertions.
    fn test_core() -> (TurnCore, Arc<ProcessRegistry>, Arc<CollectingEmitter>) {
        let emitter = Arc::new(CollectingEmitter(StdMutex::new(Vec::new())));
        let registry = Arc::new(ProcessRegistry::default());
        registry.insert(
            "test-run".to_string(),
            crate::engines::registry::ChildEntry {
                child: None,
                pid: 4_000_000_099,
                run_id: "test-run".to_string(),
                killed: Arc::new(AtomicBool::new(false)),
                reader_abort: Arc::new(std::sync::OnceLock::new()),
                stdin: None,
                questions: Arc::new(StdMutex::new(HashMap::new())),
                plans: Arc::new(StdMutex::new(HashMap::new())),
            },
        );
        let core = TurnCore {
            sink: EventSink::new(emitter.clone()),
            registry: Arc::clone(&registry),
            engine_id: "dsh".to_string(),
            run_id: "test-run".to_string(),
            db: None,
            followup: None,
        };
        (core, registry, emitter)
    }

    #[test]
    fn render_questions_maps_the_dsh_shape_onto_the_card_spec() {
        let request = json!({
            "questions": [
                {
                    "id": "q1",
                    "question": "选哪个？",
                    "header": "方案",
                    "multiSelect": true,
                    "options": [{ "label": "A", "description": "a" }, { "label": "B" }],
                },
                {
                    "id": "q2",
                    "question": "为什么选这个方案？",
                    "detail": "背景：上一轮评审要求收紧范围",
                    // no header / options: defaults kick in
                },
            ]
        });
        let rendered = render_questions(&request);
        assert_eq!(rendered.len(), 2);
        assert_eq!(rendered[0]["question"], "选哪个？");
        assert_eq!(rendered[0]["header"], "方案");
        assert_eq!(rendered[0]["multiSelect"], true);
        assert_eq!(rendered[0]["options"][0]["label"], "A");
        // An ordinary question's detail still folds into its text; a plan-review intent request
        // doesn't use this mapping (park_question diverts it; see the review tests).
        assert_eq!(
            rendered[1]["question"],
            "为什么选这个方案？\n\n背景：上一轮评审要求收紧范围"
        );
        assert_eq!(rendered[1]["header"], "Question");
        assert_eq!(rendered[1]["multiSelect"], false);
        assert_eq!(rendered[1]["options"], json!([]));
        assert_eq!(render_questions(&json!({})), Vec::<Value>::new());
        // Only intent.kind=="plan-review" is a plan review; another intent, or none, still takes
        // the question path.
        assert!(plan_review_question(&request).is_none());
        let review_request = json!({
            "questions": [{
                "id": "plan-review",
                "question": "Approve this plan and leave plan mode?",
                "detail": "# 计划\nstep 1",
                "intent": { "kind": "plan-review", "approve": "Approve" },
            }]
        });
        assert!(plan_review_question(&review_request).is_some());
        let other_intent = json!({
            "questions": [{ "id": "q", "question": "x", "intent": { "kind": "confirm" } }]
        });
        assert!(plan_review_question(&other_intent).is_none());
    }

    #[test]
    fn question_outcome_maps_labels_custom_and_dismiss() {
        let request = json!({
            "questions": [
                { "id": "q1", "question": "单选", "options": [{ "label": "A" }, { "label": "B" }] },
                { "id": "q2", "question": "多选", "multiSelect": true,
                  "options": [{ "label": "x" }, { "label": "y" }] },
                { "id": "q3", "question": "自由", "options": [{ "label": "A" }] },
            ]
        });
        let answers = json!({ "单选": "A", "多选": ["x", "y"], "自由": "随便写写" });
        let outcome = question_outcome(&request, Some(&answers));
        assert_eq!(outcome["kind"], "result");
        assert_eq!(
            outcome["value"]["answers"][0],
            json!({ "id": "q1", "selected": ["A"] })
        );
        assert_eq!(
            outcome["value"]["answers"][1],
            json!({ "id": "q2", "selected": ["x", "y"] })
        );
        // Free-form text matching no option label travels as custom.
        assert_eq!(
            outcome["value"]["answers"][2],
            json!({ "id": "q3", "selected": [], "custom": "随便写写" })
        );
        // Dismissed card → cancelled rejection.
        let dismissed = question_outcome(&request, None);
        assert_eq!(dismissed["kind"], "rejected");
        assert_eq!(dismissed["error"]["code"], "cancelled");
        // An unanswered question still echoes its id with an empty selection.
        let partial = question_outcome(&request, Some(&json!({})));
        assert_eq!(
            partial["value"]["answers"][0],
            json!({ "id": "q1", "selected": [] })
        );
    }

    #[tokio::test]
    async fn question_waterfall_emits_card_and_parks_answer_context() {
        let (core, registry, emitter) = test_core();
        let mut state = TurnState::new(None);
        let mut view = TurnView {
            events_client_id: Some("client-1".to_string()),
            ..TurnView::default()
        };
        let frame = json!({
            "type": "waterfall",
            "event": "user-questions/request",
            "eventId": "evt-1",
            "agentId": "agent-1",
            "request": {
                "questions": [
                    { "id": "q1", "question": "选哪个？", "options": [{ "label": "A" }, { "label": "B" }] }
                ]
            },
        });
        handle_events_frame(
            &core,
            &mut state,
            &mut view,
            &frame,
            "http://127.0.0.1:3080",
        )
        .await;
        core.sink.flush();

        // Card pushed to the UI…
        let kinds = collect_kinds(&emitter.0.lock().unwrap());
        let question = kinds
            .iter()
            .find(|(kind, _)| kind == "question")
            .map(|(_, data)| data.clone())
            .expect("no question event pushed");
        assert_eq!(question["requestId"], "evt-1");
        assert_eq!(question["input"]["questions"][0]["question"], "选哪个？");
        // …and the answer context parked under the same request id.
        let parked = registry
            .get("test-run")
            .and_then(|entry| {
                entry
                    .questions
                    .lock()
                    .ok()
                    .and_then(|q| q.get("evt-1").cloned())
            })
            .expect("answer context not parked");
        assert_eq!(parked["dsh"]["origin"], "http://127.0.0.1:3080");
        assert_eq!(parked["dsh"]["clientId"], "client-1");
        assert_eq!(parked["dsh"]["eventId"], "evt-1");
        assert_eq!(parked["dsh"]["request"]["questions"][0]["id"], "q1");
    }

    #[tokio::test]
    async fn waterfall_without_events_channel_warns_and_parks_nothing() {
        let (core, registry, emitter) = test_core();
        let mut state = TurnState::new(None);
        let mut view = TurnView::default(); // no events_client_id
        let frame = json!({
            "type": "waterfall",
            "event": "user-questions/request",
            "eventId": "evt-2",
            "request": { "questions": [{ "id": "q1", "question": "x" }] },
        });
        handle_events_frame(
            &core,
            &mut state,
            &mut view,
            &frame,
            "http://127.0.0.1:3080",
        )
        .await;
        core.sink.flush();
        let kinds = collect_kinds(&emitter.0.lock().unwrap());
        assert!(kinds.iter().any(|(kind, _)| kind == "warn"), "{kinds:?}");
        assert!(
            !kinds.iter().any(|(kind, _)| kind == "question"),
            "{kinds:?}"
        );
        let empty = registry
            .get("test-run")
            .map(|entry| entry.questions.lock().map(|q| q.is_empty()).unwrap_or(true));
        assert_eq!(empty, Some(true));
    }

    #[tokio::test]
    async fn waterfall_cancel_frame_settles_the_card() {
        let (core, _registry, emitter) = test_core();
        let mut state = TurnState::new(None);
        let mut view = TurnView {
            events_client_id: Some("client-1".to_string()),
            ..TurnView::default()
        };
        let frame = json!({
            "type": "waterfall",
            "event": "user-questions/request",
            "eventId": "evt-3",
            "request": { "questions": [{ "id": "q1", "question": "x", "options": [{ "label": "A" }] }] },
        });
        handle_events_frame(
            &core,
            &mut state,
            &mut view,
            &frame,
            "http://127.0.0.1:3080",
        )
        .await;
        handle_events_frame(
            &core,
            &mut state,
            &mut view,
            &json!({ "type": "cancel", "eventId": "evt-3" }),
            "http://127.0.0.1:3080",
        )
        .await;
        core.sink.flush();
        let kinds = collect_kinds(&emitter.0.lock().unwrap());
        assert!(
            kinds
                .iter()
                .any(|(kind, data)| kind == "question_settled" && data["requestId"] == "evt-3"),
            "{kinds:?}"
        );
    }
    /// A plan-review intent → a typed PlanReview record + parked native reply frames: the approve
    /// frame is selected=[intent.approve] with no custom key, the feedback frame selected:[] + a
    /// custom placeholder. The approve label comes from intent.approve (deliberately non-English
    /// here), and the title is the body's first markdown heading.
    #[tokio::test]
    async fn plan_review_intent_builds_record_and_parks_native_frames() {
        let (core, registry, emitter) = test_core();
        let mut state = TurnState::new(Some("session-1".to_string()));
        let mut view = TurnView {
            events_client_id: Some("client-1".to_string()),
            workspace: "/tmp/ws".to_string(),
            ..TurnView::default()
        };
        let content = "# 上线计划\n\n1. 迁移数据库\n2. 灰度发布";
        let frame = json!({
            "type": "waterfall",
            "event": "user-questions/request",
            "eventId": "evt-plan-1",
            "agentId": "session-1",
            "request": {
                "questions": [{
                    "id": "plan-review",
                    "header": "Plan review",
                    "question": "Approve this plan and leave plan mode?",
                    "detail": content,
                    "options": [
                        { "label": "批准执行", "description": "Leave plan mode" },
                        { "label": "继续规划", "description": "Stay in plan mode" },
                    ],
                    "intent": { "kind": "plan-review", "approve": "批准执行" },
                }]
            },
        });
        handle_events_frame(
            &core,
            &mut state,
            &mut view,
            &frame,
            "http://127.0.0.1:3080",
        )
        .await;
        core.sink.flush();

        // The review path: a plan_review event and no ordinary question card.
        let kinds = collect_kinds(&emitter.0.lock().unwrap());
        assert!(
            !kinds.iter().any(|(kind, _)| kind == "question"),
            "plan-review must not take the question path: {kinds:?}"
        );
        let record = kinds
            .iter()
            .find(|(kind, _)| kind == "plan_review")
            .map(|(_, data)| data.clone())
            .expect("no plan_review event pushed");
        assert_eq!(record["planId"], "dsh-plan-evt-plan-1");
        assert_eq!(record["engine"], "dsh");
        assert_eq!(record["sessionId"], "session-1");
        assert_eq!(record["workspacePath"], "/tmp/ws");
        assert_eq!(record["title"], "上线计划");
        assert_eq!(record["content"], content);
        assert_eq!(
            record["contentHash"],
            crate::engines::plan_review::content_hash(content)
        );
        assert_eq!(record["complete"], true);
        assert_eq!(record["reviewKind"], "native_request");
        assert_eq!(record["nativePlanId"], "plan-review");
        assert_eq!(record["status"], "awaiting_review");
        // The event payload never carries the native reply context.
        assert!(record.get("frames").is_none(), "{record}");
        assert!(record.get("context").is_none(), "{record}");

        // The parked context: {revision, route, origin, path, contentHash, frames} at the top
        // level (dispatch adds revision; with no db in the test it stays 0).
        let parked = registry
            .get("test-run")
            .and_then(|entry| {
                entry
                    .plans
                    .lock()
                    .ok()
                    .and_then(|plans| plans.get("dsh-plan-evt-plan-1").cloned())
            })
            .expect("native reply context not parked");
        assert_eq!(parked["revision"], 0);
        assert_eq!(parked["route"], "http");
        assert_eq!(parked["origin"], "http://127.0.0.1:3080");
        assert_eq!(parked["path"], "$events/result");
        assert_eq!(
            parked["contentHash"],
            crate::engines::plan_review::content_hash(content)
        );
        // The approve frame: the $events/result shape, selected=[intent.approve's real label],
        // and never a custom key (the host checks custom===void 0).
        let approve = &parked["frames"]["approve"];
        assert_eq!(approve["clientId"], "client-1");
        assert_eq!(approve["eventId"], "evt-plan-1");
        assert_eq!(
            approve["outcome"],
            json!({
                "kind": "result",
                "value": { "answers": [{ "id": "plan-review", "selected": ["批准执行"] }] },
            })
        );
        assert!(
            !approve.to_string().contains("custom"),
            "approve frame must not carry a custom key: {approve}"
        );
        // The feedback frame: selected:[] + a custom placeholder (replaced by the feedback on send).
        let changes = &parked["frames"]["changes"];
        assert_eq!(
            changes["outcome"],
            json!({
                "kind": "result",
                "value": { "answers": [{
                    "id": "plan-review",
                    "selected": [],
                    "custom": crate::engines::PLAN_FEEDBACK_PLACEHOLDER,
                }] },
            })
        );
    }

    /// An incomplete plan-review request (no intent.approve) fails closed: the waterfall is
    /// rejected with a warning, with no plan_review event, nothing parked and no question card.
    #[tokio::test]
    async fn malformed_plan_review_is_rejected_fail_closed() {
        // The refusal goes out over HTTP, and the client needs a TLS provider even for plain
        // HTTP; the app installs it at start.
        let _ = rustls::crypto::ring::default_provider().install_default();
        let (core, registry, emitter) = test_core();
        let mut state = TurnState::new(Some("session-1".to_string()));
        let mut view = TurnView {
            events_client_id: Some("client-1".to_string()),
            ..TurnView::default()
        };
        let frame = json!({
            "type": "waterfall",
            "event": "user-questions/request",
            "eventId": "evt-plan-2",
            "request": {
                "questions": [{
                    "id": "plan-review",
                    "question": "Approve?",
                    "detail": "# 计划\nstep 1",
                    "intent": { "kind": "plan-review" },
                }]
            },
        });
        handle_events_frame(
            &core,
            &mut state,
            &mut view,
            &frame,
            "http://127.0.0.1:3080",
        )
        .await;
        core.sink.flush();
        let kinds = collect_kinds(&emitter.0.lock().unwrap());
        assert!(kinds.iter().any(|(kind, _)| kind == "warn"), "{kinds:?}");
        assert!(
            !kinds
                .iter()
                .any(|(kind, _)| kind == "plan_review" || kind == "question"),
            "{kinds:?}"
        );
        let empty = registry.get("test-run").map(|entry| {
            entry
                .plans
                .lock()
                .map(|plans| plans.is_empty())
                .unwrap_or(true)
        });
        assert_eq!(empty, Some(true));
    }

    /// Classifying commands answers: undefined (null or no commandId on the wire) ≠ success; a
    /// handler error is refused too; and commands/list's plan check.
    #[test]
    fn commands_results_are_not_http_success() {
        // An unknown command → undefined → null on the wire: not success even with HTTP 200.
        assert!(plan_execute_outcome(&Value::Null).is_err());
        assert!(plan_execute_outcome(&json!({})).is_err());
        assert!(plan_execute_outcome(&json!({ "result": { "kind": "success" } })).is_err());
        // A handler error (such as /plan off with attachments) is refused with its own text.
        let error = plan_execute_outcome(
            &json!({ "commandId": "cmd-1", "result": { "kind": "error", "text": "boom" } }),
        )
        .unwrap_err();
        assert!(error.contains("boom"), "{error}");
        assert!(plan_execute_outcome(
            &json!({ "commandId": "cmd-1", "result": { "kind": "success", "text": "Plan mode on." } }),
        )
        .is_ok());
        // commands/list: no plan = the plugin isn't included.
        assert!(plan_command_listed(
            &json!([{ "name": "plan", "description": "Enter or leave plan mode" }])
        ));
        assert!(!plan_command_listed(&json!([{ "name": "compact" }])));
        assert!(!plan_command_listed(&json!([])));
        assert!(!plan_command_listed(&Value::Null));
    }

    /// The title is the body's first markdown heading (dsh-plan-mode's firstHeading rule);
    /// without one the record's title falls back to "Plan review".
    #[test]
    fn first_heading_matches_the_native_rule() {
        assert_eq!(first_heading("# 标题\nbody"), Some("标题".to_string()));
        assert_eq!(first_heading("前言\n## 二节"), Some("二节".to_string()));
        assert_eq!(first_heading("###### 六级"), Some("六级".to_string()));
        assert_eq!(first_heading("####### 七级"), None);
        assert_eq!(first_heading("#no-space"), None);
        assert_eq!(first_heading("# "), None);
        assert_eq!(first_heading("no heading at all"), None);
    }

    /// The host announces the request's real window on `request/context`
    /// (`RequestContext { provider, model, contextWindow? }` — the only carrier
    /// of a window in DSH's published session events; `session/modelCatalog`
    /// entries and `TokenUsage` both carry none). Dropping it left the UI on
    /// the 200k assumed fallback, so a 1M-capable provider (mify's
    /// `tongyi/deepseek-v4.1-flash`, contextWindow: 1000000) read as 200k.
    #[tokio::test]
    async fn request_context_window_reaches_usage_events() {
        let (core, _registry, emitter) = test_core();
        let mut state = TurnState::new(None);
        let mut view = TurnView::default();

        // The host's window announcement, before the turn's usage chunk.
        handle_session_event(
            &core,
            &mut state,
            &mut view,
            "request/context",
            &json!({
                "provider": "mify",
                "model": "tongyi/deepseek-v4.1-flash",
                "contextWindow": 1_000_000
            }),
        );
        handle_assistant_stream(
            &core,
            &mut state,
            &mut view,
            &json!({
                "type": "assistant-stream",
                "frame": {
                    "type": "chunk",
                    "chunk": {
                        "type": "usage",
                        "usage": { "inputTokens": 900_000, "outputTokens": 50 }
                    }
                }
            }),
        );
        core.sink.flush();

        let events = emitter.0.lock().unwrap().clone();
        let usage = collect_kinds(&events)
            .into_iter()
            .find(|(kind, _)| kind == "usage")
            .map(|(_, data)| data)
            .expect("a usage event must be emitted for the chunk");
        assert_eq!(
            usage.get("model_context_window").and_then(Value::as_i64),
            Some(1_000_000),
            "the window announced by request/context must reach the usage event: {usage}"
        );
    }

    /// Windows pair per request: a `request/context` without a window clears
    /// the previous announcement instead of lending it to the next request
    /// (e.g. a subagent on a different model mid-turn).
    #[tokio::test]
    async fn request_context_without_window_clears_the_previous_one() {
        let (core, _registry, emitter) = test_core();
        let mut state = TurnState::new(None);
        let mut view = TurnView::default();

        handle_session_event(
            &core,
            &mut state,
            &mut view,
            "request/context",
            &json!({ "provider": "mify", "model": "m", "contextWindow": 1_000_000 }),
        );
        // The next request announces no window: the cached 1M must not leak.
        handle_session_event(
            &core,
            &mut state,
            &mut view,
            "request/context",
            &json!({ "provider": "mify", "model": "m-small" }),
        );
        handle_assistant_stream(
            &core,
            &mut state,
            &mut view,
            &json!({
                "type": "assistant-stream",
                "frame": {
                    "type": "chunk",
                    "chunk": {
                        "type": "usage",
                        "usage": { "inputTokens": 100, "outputTokens": 5 }
                    }
                }
            }),
        );
        core.sink.flush();

        let events = emitter.0.lock().unwrap().clone();
        let usage = collect_kinds(&events)
            .into_iter()
            .find(|(kind, _)| kind == "usage")
            .map(|(_, data)| data)
            .expect("a usage event must be emitted for the chunk");
        assert_eq!(
            usage.get("model_context_window"),
            None,
            "a window-less request/context must clear the cached window: {usage}"
        );
    }

    /// Flatten the sink's batched flushes into (kind, data) pairs.
    fn collect_kinds(events: &[String]) -> Vec<(String, Value)> {
        let mut kinds = Vec::new();
        for raw in events {
            let flushed: Value = serde_json::from_str(raw).expect("flushed batch must be JSON");
            let batch = flushed.as_array().cloned().unwrap_or_else(|| vec![flushed]);
            for value in batch {
                kinds.push((
                    value
                        .get("kind")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                    value.get("data").cloned().unwrap_or(Value::Null),
                ));
            }
        }
        kinds
    }

    /// The native session id from the "session" event, or the preseeded one
    /// carried by every payload of a resumed turn.
    fn announced_session(events: &[String]) -> String {
        for raw in events {
            let flushed: Value = serde_json::from_str(raw).expect("flushed batch must be JSON");
            let batch = flushed.as_array().cloned().unwrap_or_else(|| vec![flushed]);
            for value in batch {
                if value.get("kind").and_then(Value::as_str) == Some("session") {
                    return value
                        .pointer("/data")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                }
                if let Some(id) = value.get("sessionId").and_then(Value::as_str) {
                    return id.to_string();
                }
            }
        }
        String::new()
    }
}
