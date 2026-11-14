// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/opencode_session.rs.
//! OpenCode server-session turn driver: one codemoss send = one turn on the
//! managed `opencode serve`.
//!
//! Wire (verified live against opencode 1.18.30/1.18.31):
//! - `POST /session` (resume reuses the stored ses_ id) →
//!   `GET /event` (SSE, global stream filtered by sessionID) must be live
//!   before `POST /session/:id/prompt_async` (204, fire-and-forget).
//! - The turn streams as `message.part.updated` / `message.part.delta`
//!   (text+reasoning), tool parts carry their state, `session.status`
//!   busy→idle settles the turn, `session.error` fails it.
//! - The built-in `question` tool parks server-side: `question.asked` →
//!   answer card → `POST /question/:requestID/reply {answers: string[][]}`
//!   (or `/reject`). `permission.asked` is auto-answered: "once" per
//!   ask, or "always" under bypass (approve matching asks for the rest
//!   of the session) — either way the old headless run never prompted,
//!   same net outcome; config denies never reach us.
//! - Interrupt sends `POST /session/:id/abort`.
//!
//! OpenCode 2.x replaced this API with its `/api/…` one; a server that speaks it runs the turn in
//! [`v2`] instead.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use serde_json::{json, Value};
use tokio::sync::mpsc;

use super::opencode_server::{self, OpencodeServerState};
use super::{EngineEvent, SendRequest, TurnCore, TurnState};

/// The killed-flag poll cadence inside the select loop.
const KILL_POLL: Duration = Duration::from_millis(150);

/// Per-turn projection state for the SSE stream.
#[derive(Default)]
struct TurnView {
    /// (messageID, partID) → part type, so deltas route text vs reasoning
    /// (both delta on the part's `text` field; the type only arrives with
    /// `message.part.updated`).
    part_types: HashMap<(String, String), String>,
    /// Usage from the latest finished assistant message (Done snapshot).
    last_usage: Option<Value>,
    /// `"provider/model"` → effective context window, read once per turn from
    /// the server's merged config. opencode's usage payload carries only token
    /// counts, so the window has to be attached from here or the gauge falls
    /// back to its assumed 200k.
    context_windows: HashMap<String, u64>,
    turn_ended: bool,
    saw_content: bool,
    /// The same, for a 2.x server's turn.
    v2: v2::View,
}

#[path = "opencode_v2.rs"]
mod v2;

/// Drive one send as a server turn. Mirrors `run_host_turn`'s settle
/// contract: dispatch events until a terminal done/error, settle parked
/// questions first, then drain this run's registry entries.
pub(crate) async fn run_server_turn(
    core: TurnCore,
    req: SendRequest,
    bin: String,
    server: Arc<OpencodeServerState>,
    killed: Arc<AtomicBool>,
    virtual_pid: u32,
) {
    run_server_turn_with_probe_port(
        core,
        req,
        bin,
        server,
        killed,
        virtual_pid,
        opencode_server::DEFAULT_PORT,
    )
    .await
}

/// `probe_port` is injectable: tests have the driver adopt a mock server without taking the default port.
async fn run_server_turn_with_probe_port(
    core: TurnCore,
    req: SendRequest,
    bin: String,
    server: Arc<OpencodeServerState>,
    killed: Arc<AtomicBool>,
    virtual_pid: u32,
    probe_port: u16,
) {
    let mut state = TurnState::new(req.session_id.clone());
    let mut view = TurnView::default();
    let preassigned_session_id = req.session_id.clone();
    let result = turn_inner(
        &core, &mut state, &mut view, &req, &bin, &server, &killed, probe_port,
    )
    .await;
    // Pending questions die with the turn: settle their cards BEFORE any
    // terminal dispatch, or the monotonic saw_done/saw_error guard would drop
    // these and leave answerable cards pointing at a settled turn.
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
        core.dispatch_event(&mut state, EngineEvent::Error(error));
    }
    if !state.saw_done && !state.saw_error {
        // User-initiated stop commits the partial turn as done; an SSE drop
        // mid-turn without any content is an error (reported by turn_inner).
        let session_id = state.native_session_id.clone();
        let usage = if killed.load(Ordering::SeqCst) {
            None
        } else {
            view.last_usage
                .clone()
                .or_else(|| view.v2.last_usage.clone())
        };
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
    server: &Arc<OpencodeServerState>,
    killed: &Arc<AtomicBool>,
    probe_port: u16,
) -> Result<(), String> {
    let origin = opencode_server::ensure_server(server, bin, probe_port).await?;
    if opencode_server::is_v2(&origin) {
        return v2::turn(core, state, &mut view.v2, req, &origin, killed).await;
    }
    let directory = req.workspace.to_string_lossy().to_string();
    // The `/` menu lists the commands OpenCode reports for this folder. Reading them as each turn
    // starts puts `/review` and the person's own commands there from the first turn on, not only
    // after a command has been sent once.
    tokio::spawn(report_commands(origin.clone(), directory.clone()));

    // The context gauge needs the model's window; opencode's usage payload
    // never carries one, so read the server's merged config once per turn and
    // attach it on each usage event (a probe failure just keeps the gauge's
    // own fallback — never fails the turn).
    view.context_windows = load_context_windows(&origin, &directory).await;

    // Session continuity: resume the stored ses_ id, else create one. The
    // question tool only exists server-side, so the session must live on the
    // server even though the transcript renders here.
    let session_id = match req.session_id.as_deref() {
        Some(id) => id.to_string(),
        None => create_session(&origin, &directory, &req.prompt).await?,
    };
    core.dispatch_event(state, EngineEvent::SessionId(session_id.clone()));
    // Misty's Space server, as a remote MCP server on this session, and an agent's own servers
    // (a stdio one as a local server). A server that won't take one only loses those tools; the
    // turn goes on.
    if let Some(servers) = req.mcp_servers.as_ref().and_then(Value::as_object) {
        for (name, server) in servers {
            let config = match server["command"].as_str() {
                Some(command) => {
                    let mut line = vec![json!(command)];
                    line.extend(server["args"].as_array().cloned().unwrap_or_default());
                    json!({
                        "type": "local",
                        "command": line,
                        "environment": server["env"].as_object().cloned().unwrap_or_default(),
                        "enabled": true,
                    })
                }
                None => json!({
                    "type": "remote",
                    "url": server["url"],
                    "headers": server["headers"],
                    "enabled": true,
                }),
            };
            let _ = opencode_server::post(
                &origin,
                "/mcp",
                &directory,
                Some(json!({ "name": name, "config": config })),
            )
            .await;
        }
    }

    // The SSE stream must be live before the prompt, or a question asked at
    // the very top of the turn would park unnoticed. Spawning the reader is
    // not enough — wait for the subscription to actually connect (bounded:
    // a wedged stream must not stall sends, but the user hears about it).
    let (mut events, ready) = spawn_event_stream(&origin, &directory, session_id.clone());
    let ready = tokio::time::timeout(Duration::from_secs(5), ready).await;
    if !matches!(ready, Ok(Ok(true))) {
        core.dispatch_event(
            state,
            EngineEvent::Warn(
                "The event stream isn't ready; questions asked in this turn may not show."
                    .to_string(),
            ),
        );
    }
    prompt(&origin, &directory, &session_id, req).await?;

    let mut kill_poll = tokio::time::interval(KILL_POLL);
    kill_poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    // Wire value for answering permission asks this turn: bypass remembers
    // approvals session-wide ("always"), every other mode approves each ask
    // individually ("once").
    let permission_reply = permission_reply(req.permission.as_deref());
    loop {
        tokio::select! {
            frame = events.recv() => match frame {
                Some(value) => {
                    handle_server_event(core, state, view, &value, &origin, &directory, permission_reply).await;
                    if view.turn_ended {
                        return Ok(());
                    }
                }
                // The server dropped the stream mid-turn: without it neither
                // content nor asks arrive. Done/error already seen settles
                // normally; anything else is a transport failure.
                None => {
                    if view.turn_ended || state.saw_done || state.saw_error {
                        return Ok(());
                    }
                    return Err("OpenCode's event stream broke off; this turn's result is unknown".to_string());
                }
            },
            _ = kill_poll.tick() => {
                if killed.load(Ordering::SeqCst) {
                    let _ = opencode_server::post(
                        &origin,
                        &format!("/session/{session_id}/abort"),
                        &directory,
                        None,
                    )
                    .await;
                    return Ok(());
                }
            }
        }
    }
}

/// Effective model context windows from the server's merged config:
/// `provider.<pid>.models.<mid>.limit.context` → `"pid/mid"`. Best effort —
/// a missing/unreachable config just yields an empty map, and the gauge keeps
/// its own fallback.
async fn load_context_windows(origin: &str, directory: &str) -> HashMap<String, u64> {
    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
    else {
        return HashMap::new();
    };
    let Ok(response) = opencode_server::request(
        &client,
        reqwest::Method::GET,
        origin,
        "/config",
        Some(directory),
    )
    .send()
    .await
    else {
        return HashMap::new();
    };
    if !response.status().is_success() {
        return HashMap::new();
    }
    match response.json::<Value>().await {
        Ok(config) => parse_context_windows(&config),
        Err(_) => HashMap::new(),
    }
}

/// Pull `provider.<pid>.models.<mid>.limit.context` into a `"pid/mid"` map.
fn parse_context_windows(config: &Value) -> HashMap<String, u64> {
    let mut windows = HashMap::new();
    let Some(providers) = config.get("provider").and_then(Value::as_object) else {
        return windows;
    };
    for (provider_id, provider) in providers {
        let Some(models) = provider.get("models").and_then(Value::as_object) else {
            continue;
        };
        for (model_id, model) in models {
            if let Some(context) = model.pointer("/limit/context").and_then(Value::as_u64) {
                windows.insert(format!("{provider_id}/{model_id}"), context);
            }
        }
    }
    windows
}

/// 1.x prices a whole assistant message, every step of the turn, as its `cost`: it goes on the
/// message's usage report as `cost_usd`, which the chat shows. A message with no price adds none.
pub(super) fn with_message_cost(mut usage: Value, info: &Value) -> Value {
    if let Some(cost) = info.get("cost").and_then(Value::as_f64).filter(|cost| *cost > 0.0) {
        usage["cost_usd"] = serde_json::json!(cost);
    }
    usage
}

/// Whether an assistant message is the summary a compaction wrote: 1.x marks it `summary: true`
/// and runs it on its `compaction` agent (`mode` in older releases).
pub(crate) fn is_compaction_summary(info: &Value) -> bool {
    info.get("summary").and_then(Value::as_bool) == Some(true)
        || ["agent", "mode"]
            .iter()
            .any(|key| info.get(*key).and_then(Value::as_str) == Some("compaction"))
}

/// Attach the model's window to a usage payload when opencode didn't report
/// one, keyed as `model_context_window` — the field the rest of the app reads.
/// The provider/model come off the assistant message, so resumed sessions and
/// model switches both resolve correctly.
fn attach_context_window(mut usage: Value, info: &Value, windows: &HashMap<String, u64>) -> Value {
    if usage.get("model_context_window").is_some() {
        return usage;
    }
    let provider = info.get("providerID").and_then(Value::as_str).unwrap_or("");
    let model = info.get("modelID").and_then(Value::as_str).unwrap_or("");
    if provider.is_empty() || model.is_empty() {
        return usage;
    }
    if let Some(window) = windows.get(&format!("{provider}/{model}")) {
        if let Some(object) = usage.as_object_mut() {
            object.insert("model_context_window".to_string(), Value::from(*window));
        }
    }
    usage
}

async fn create_session(origin: &str, directory: &str, prompt: &str) -> Result<String, String> {
    let title: String = prompt.trim().chars().take(40).collect();
    let body = if title.is_empty() {
        json!({})
    } else {
        json!({ "title": title })
    };
    let client = reqwest::Client::new();
    let created = opencode_server::request(
        &client,
        reqwest::Method::POST,
        origin,
        "/session",
        Some(directory),
    )
    .json(&body)
    .send()
    .await
    .map_err(|e| format!("OpenCode could not create a session: {e}"))?
    .json::<Value>()
    .await
    .map_err(|e| format!("OpenCode's session reply could not be read: {e}"))?;
    created
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "OpenCode created no session id".to_string())
}

/// A message that names one of OpenCode's commands, split into the name and what follows it.
fn command_in(prompt: &str) -> Option<(&str, &str)> {
    let text = prompt.trim().strip_prefix('/')?;
    let (name, arguments) = text
        .split_once(char::is_whitespace)
        .map_or((text, ""), |(name, rest)| (name, rest.trim()));
    (!name.is_empty() && !name.contains('/')).then_some((name, arguments))
}

/// Reads OpenCode's commands for this folder and keeps them for the `/` menu, on its own task.
pub(crate) async fn report_commands(origin: String, directory: String) {
    commands(&origin, &directory).await;
}

/// OpenCode's commands for this folder (`GET /command`, 2.x's `GET /api/command`), kept for the
/// `/` menu.
async fn commands(origin: &str, directory: &str) -> Vec<String> {
    let path = if opencode_server::is_v2(origin) {
        "/api/command"
    } else {
        "/command"
    };
    let get = || {
        opencode_server::call(
            reqwest::Method::GET,
            origin,
            path,
            Some(directory),
            None,
            Duration::from_secs(10),
        )
    };
    let Ok(mut list) = get().await else {
        return Vec::new();
    };
    // 2.x can answer an empty list while it is still loading a folder it hasn't opened before;
    // it always has its built-in commands once loaded, so an empty answer is asked again.
    for _ in 0..4 {
        let empty = opencode_server::data(&list)
            .as_array()
            .is_some_and(Vec::is_empty);
        if !(empty && opencode_server::is_v2(origin)) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
        match get().await {
            Ok(again) => list = again,
            Err(_) => break,
        }
    }
    let named = opencode_server::data(&list).as_array().map(|items| {
        items
            .iter()
            .filter_map(|item| {
                Some(json!({
                    "name": item.get("name")?.as_str()?,
                    "description": item.get("description").and_then(Value::as_str).unwrap_or(""),
                }))
            })
            .collect::<Vec<_>>()
    });
    let Some(named) = named else {
        return Vec::new();
    };
    let names = named
        .iter()
        .filter_map(|item| item["name"].as_str().map(str::to_owned))
        .collect();
    super::reported::acp_update(
        "opencode",
        &json!({ "sessionUpdate": "available_commands_update", "availableCommands": named }),
    );
    names
}

/// Runs a message that is one of OpenCode's own commands through its command call, or
/// `/compact` (`/summarize` in its terminal app too) through its summarize call; false when the
/// message is an ordinary prompt. The call answers only once the command is done, so it runs on
/// its own while the event stream carries the turn.
async fn run_command(origin: &str, directory: &str, session_id: &str, req: &SendRequest) -> bool {
    if !req.images.is_empty() {
        return false;
    }
    let Some((name, arguments)) = command_in(&req.prompt) else {
        return false;
    };
    let (path, body) = if matches!(name, "compact" | "summarize") && arguments.is_empty() {
        let Some((provider, model)) = compact_model(origin, directory, session_id, req).await
        else {
            return false;
        };
        (
            "summarize",
            json!({ "providerID": provider, "modelID": model }),
        )
    } else if commands(origin, directory)
        .await
        .iter()
        .any(|known| known == name)
    {
        let mut body = json!({ "command": name, "arguments": arguments });
        if let Some(model) = req.model.as_deref() {
            body["model"] = json!(model);
        }
        // In Plan the command runs on the plan agent, as a message sent there does and as
        // OpenCode's terminal app passes the agent it is on.
        if req.permission.as_deref() == Some("plan") {
            body["agent"] = json!("plan");
        }
        if let Some(effort) = req
            .effort
            .as_deref()
            .map(str::trim)
            .filter(|e| !e.is_empty())
        {
            body["variant"] = json!(effort);
        }
        ("command", body)
    } else {
        return false;
    };
    let url = format!("/session/{session_id}/{path}");
    let directory = directory.to_owned();
    let origin = origin.to_owned();
    tokio::spawn(async move {
        let client = reqwest::Client::new();
        let _ = opencode_server::request(
            &client,
            reqwest::Method::POST,
            &origin,
            &url,
            Some(&directory),
        )
        .json(&body)
        .send()
        .await;
    });
    true
}

/// The model `/compact` summarizes with. OpenCode's terminal app uses the one it is on: here
/// that is the chat's choice, else the one the session's last message ran on, else the
/// server's configured model. None when there is none of them.
async fn compact_model(
    origin: &str,
    directory: &str,
    session_id: &str,
    req: &SendRequest,
) -> Option<(String, String)> {
    if let Some((provider, model)) = req.model.as_deref().and_then(|m| m.split_once('/')) {
        return Some((provider.to_owned(), model.to_owned()));
    }
    let messages = messages(origin, directory, session_id)
        .await
        .unwrap_or_default();
    if let Some(model) = last_user_message(&messages).and_then(message_model) {
        return Some(model);
    }
    let config = opencode_server::call(
        reqwest::Method::GET,
        origin,
        "/config",
        Some(directory),
        None,
        Duration::from_secs(10),
    )
    .await
    .ok()?;
    let (provider, model) = config.get("model")?.as_str()?.split_once('/')?;
    Some((provider.to_owned(), model.to_owned()))
}

/// The session's messages (`GET /session/:id/message`), oldest first, each `{info, parts}`.
pub(crate) async fn messages(
    origin: &str,
    directory: &str,
    session_id: &str,
) -> Result<Vec<Value>, String> {
    if opencode_server::is_v2(origin) {
        return v2::messages(origin, session_id).await;
    }
    let list = opencode_server::call(
        reqwest::Method::GET,
        origin,
        &format!("/session/{session_id}/message"),
        Some(directory),
        None,
        Duration::from_secs(15),
    )
    .await?;
    Ok(list.as_array().cloned().unwrap_or_default())
}

/// Whether a `{info, parts}` message is one the person sent.
pub(crate) fn is_user_message(message: &Value) -> bool {
    message.pointer("/info/role").and_then(Value::as_str) == Some("user")
}

/// The last message the person sent, of `messages` (oldest first).
pub(crate) fn last_user_message(messages: &[Value]) -> Option<&Value> {
    messages
        .iter()
        .rev()
        .find(|message| is_user_message(message))
}

/// The `(provider, model)` a user message ran on.
fn message_model(message: &Value) -> Option<(String, String)> {
    let model = message.pointer("/info/model")?;
    Some((
        model.get("providerID")?.as_str()?.to_owned(),
        model.get("modelID")?.as_str()?.to_owned(),
    ))
}

async fn prompt(
    origin: &str,
    directory: &str,
    session_id: &str,
    req: &SendRequest,
) -> Result<(), String> {
    if run_command(origin, directory, session_id, req).await {
        return Ok(());
    }
    let mut parts = vec![json!({ "type": "text", "text": req.prompt })];
    // Images ride as data-URL file parts (the serve transport).
    for raw in &req.images {
        let (mime, data) = super::images::load_image(raw, &req.workspace)?;
        parts.push(json!({
            "type": "file",
            "mime": mime,
            "url": format!("data:{mime};base64,{data}"),
        }));
    }
    let mut body = json!({ "parts": parts });
    // GUI model selectors are `provider/model`; prompt_async wants the split.
    if let Some(model) = req.model.as_deref().and_then(|m| m.split_once('/')) {
        body["model"] = json!({ "providerID": model.0, "modelID": model.1 });
    }
    // "plan" selects the read-only plan agent; "auto" is the default build agent.
    if req.permission.as_deref() == Some("plan") {
        body["agent"] = json!("plan");
    }
    if let Some(effort) = req
        .effort
        .as_deref()
        .map(str::trim)
        .filter(|e| !e.is_empty())
    {
        body["variant"] = json!(effort);
    }
    let client = reqwest::Client::new();
    let response = opencode_server::request(
        &client,
        reqwest::Method::POST,
        origin,
        &format!("/session/{session_id}/prompt_async"),
        Some(directory),
    )
    .json(&body)
    .send()
    .await
    .map_err(|e| format!("OpenCode did not take the prompt: {e}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().await.unwrap_or_default();
        return Err(format!(
            "OpenCode did not take the prompt ({status}): {detail}"
        ));
    }
    Ok(())
}

/// Spawn the global SSE reader (`GET /event`) and forward decoded frames for
/// this session only. The channel closes when the stream ends. The oneshot
/// reports whether the subscription connected, so the prompt can gate on it.
fn spawn_event_stream(
    origin: &str,
    directory: &str,
    session_id: String,
) -> (mpsc::Receiver<Value>, tokio::sync::oneshot::Receiver<bool>) {
    let (tx, rx) = mpsc::channel::<Value>(64);
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel::<bool>();
    let origin = origin.to_string();
    let directory = directory.to_string();
    tokio::spawn(async move {
        let client = reqwest::Client::new();
        let response = opencode_server::request(
            &client,
            reqwest::Method::GET,
            &origin,
            "/event",
            Some(&directory),
        )
        .send()
        .await;
        let Ok(response) = response else {
            let _ = ready_tx.send(false);
            return;
        };
        let _ = ready_tx.send(response.status().is_success());
        let mut buffer = String::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let Ok(chunk) = chunk else { break };
            buffer.push_str(&String::from_utf8_lossy(&chunk));
            // SSE frames are blank-line separated; only `data:` lines matter.
            while let Some(at) = buffer.find("\n\n") {
                let frame = buffer[..at].to_string();
                buffer.drain(..at + 2);
                for line in frame.lines() {
                    let Some(data) = line.strip_prefix("data:") else {
                        continue;
                    };
                    let Ok(value) = serde_json::from_str::<Value>(data.trim()) else {
                        continue;
                    };
                    // Only this turn's session: the global stream mixes every
                    // session on the server. Session-less frames (heartbeats,
                    // server.connected) never match and drop here.
                    let matches_session = value
                        .pointer("/properties/sessionID")
                        .and_then(Value::as_str)
                        == Some(session_id.as_str());
                    if matches_session && tx.send(value).await.is_err() {
                        return;
                    }
                }
            }
        }
    });
    (rx, ready_rx)
}

/// Reply sent to `permission.asked`: bypass pre-approves matching asks for
/// the rest of the session ("always"), every other mode approves each ask
/// individually ("once"). Explicit `deny` rules never produce an ask, so
/// they hold under either reply.
fn permission_reply(permission: Option<&str>) -> &'static str {
    use super::Engine;
    if super::opencode::OpenCodeEngine.resolve_permission(permission) == "bypass" {
        "always"
    } else {
        "once"
    }
}

/// One server event for this session, projected to engine events.
async fn handle_server_event(
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    value: &Value,
    origin: &str,
    directory: &str,
    permission_reply: &str,
) {
    let kind = value.get("type").and_then(Value::as_str).unwrap_or("");
    let properties = value.get("properties").cloned().unwrap_or(Value::Null);
    match kind {
        "message.part.updated" => {
            let part = properties.get("part").cloned().unwrap_or(Value::Null);
            let part_type = part.get("type").and_then(Value::as_str).unwrap_or("");
            let key = (
                part.get("messageID")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                part.get("id")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
            );
            view.part_types.insert(key, part_type.to_string());
            if part_type == "tool" {
                handle_tool_part(core, state, &part);
            }
        }
        "message.part.delta" => {
            let key = (
                properties
                    .get("messageID")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                properties
                    .get("partID")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
            );
            let delta = properties
                .get("delta")
                .and_then(Value::as_str)
                .unwrap_or("");
            if delta.is_empty() {
                return;
            }
            view.saw_content = true;
            match view.part_types.get(&key).map(String::as_str) {
                Some("reasoning") => {
                    core.dispatch_event(state, EngineEvent::Thinking(delta.to_string()))
                }
                // Unknown parts default to text: part.updated normally lands
                // before the first delta, and text is the common case.
                _ => core.dispatch_event(state, EngineEvent::Delta(delta.to_string())),
            }
        }
        "message.updated" => {
            let info = properties.get("info").cloned().unwrap_or(Value::Null);
            if info.get("role").and_then(Value::as_str) != Some("assistant") {
                return;
            }
            // Finished assistant messages carry the authoritative token usage.
            if let Some(tokens) = info.get("tokens").filter(|t| t.is_object()) {
                let usage = v2::usage_of(tokens, None);
                // The summary `/compact` writes is a message too (`summary: true`), and its
                // tokens size the context from before.
                let usage = if is_compaction_summary(&info) {
                    v2::after_compaction(usage)
                } else {
                    usage
                };
                let usage = attach_context_window(usage, &info, &view.context_windows);
                let usage = with_message_cost(usage, &info);
                view.last_usage = Some(usage.clone());
                core.dispatch_event(state, EngineEvent::Usage(usage));
            }
            // A model/API error embedded in the assistant message fails the
            // turn when nothing else recovers it.
            if let Some(message) = extract_error_message(&info) {
                core.dispatch_event(state, EngineEvent::Warn(message));
            }
        }
        // A compaction's end names no size either, so the bar's count clears here too, even when
        // the summary message didn't say what it was.
        "session.compacted" => {
            core.dispatch_event(state, EngineEvent::Usage(v2::after_compaction(json!({}))));
        }
        "session.status" => {
            let status = properties.pointer("/status/type").and_then(Value::as_str);
            match status {
                Some("idle") => {
                    view.turn_ended = true;
                    // Done is dispatched by the caller after the question
                    // drain, with the usage snapshot attached.
                }
                Some("retry") => {
                    core.dispatch_event(
                        state,
                        EngineEvent::Retry {
                            attempt: properties
                                .pointer("/status/attempt")
                                .and_then(Value::as_u64)
                                .unwrap_or(0),
                            max: 0,
                            message: properties
                                .pointer("/status/message")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_string(),
                        },
                    );
                }
                Some("busy") => {
                    // Clears any retry indicator on the run status line.
                    core.dispatch_event(
                        state,
                        EngineEvent::Retry {
                            attempt: 0,
                            max: 0,
                            message: String::new(),
                        },
                    );
                }
                _ => {}
            }
        }
        "session.error" => {
            let message = extract_error_message(&properties)
                .unwrap_or_else(|| "OpenCode session error".to_string());
            view.turn_ended = true;
            core.dispatch_event(state, EngineEvent::Error(message));
        }
        "question.asked" => park_question(core, state, &properties, origin, directory),
        "question.replied" | "question.rejected" => {
            if let Some(request_id) = properties
                .get("requestID")
                .and_then(Value::as_str)
                .map(str::to_string)
            {
                core.dispatch_event(state, EngineEvent::QuestionSettled { request_id });
            }
        }
        "permission.asked" => {
            // Bypass answers "always" (the server remembers it for the session). Every other
            // mode asks Misty's gate, off the event loop so the stream keeps flowing, and
            // answers "once" or "reject".
            if let Some(request_id) = properties.get("id").and_then(Value::as_str) {
                let path = format!("/permission/{request_id}/reply");
                if permission_reply == "always" {
                    let _ = opencode_server::post(
                        origin,
                        &path,
                        directory,
                        Some(json!({ "reply": permission_reply })),
                    )
                    .await;
                } else {
                    let tool = properties
                        .get("permission")
                        .or_else(|| properties.get("type"))
                        .and_then(Value::as_str)
                        .unwrap_or("tool")
                        .to_string();
                    let input = properties
                        .get("metadata")
                        .cloned()
                        .unwrap_or_else(|| properties.clone());
                    let (run_id, origin, directory) = (
                        core.run_id.clone(),
                        origin.to_string(),
                        directory.to_string(),
                    );
                    tokio::spawn(async move {
                        let reply = match crate::engines::gate::ask(&run_id, &tool, input).await {
                            crate::engines::gate::Decision::Allow => json!({ "reply": "once" }),
                            crate::engines::gate::Decision::Deny(message) => {
                                json!({ "reply": "reject", "message": message })
                            }
                        };
                        let _ =
                            opencode_server::post(&origin, &path, &directory, Some(reply)).await;
                    });
                }
            }
        }
        _ => {}
    }
}

/// One tool part's state transition: "running" opens the row,
/// completed/error patches its result (the pi row convention).
fn handle_tool_part(core: &TurnCore, state: &mut TurnState, part: &Value) {
    let name = part.get("tool").and_then(Value::as_str).unwrap_or("tool");
    let tool_state = part.get("state").cloned().unwrap_or(Value::Null);
    let status = tool_state
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("");
    match status {
        "completed" | "error" => {
            let result = if status == "error" {
                json!({
                    "text": tool_state.get("error").and_then(Value::as_str).unwrap_or("tool error"),
                    "isError": true,
                })
            } else {
                tool_state.get("output").cloned().unwrap_or(Value::Null)
            };
            core.dispatch_event(state, super::tool_result_patch(name, Some(&result)));
        }
        "running" | "pending" => {
            core.dispatch_event(
                state,
                super::tool_call_message(name, tool_state.get("input")),
            );
        }
        _ => {}
    }
}

/// Park a server-side question: surface the card and stash the answer
/// context (HTTP reply needs origin + requestId + the original questions for
/// answer ordering) under the same request id.
fn park_question(
    core: &TurnCore,
    state: &mut TurnState,
    properties: &Value,
    origin: &str,
    directory: &str,
) {
    let request_id = properties
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let questions = render_questions(properties);
    if request_id.is_empty() || questions.is_empty() {
        return;
    }
    core.dispatch_event(
        state,
        EngineEvent::Question {
            request_id: request_id.clone(),
            tool_use_id: None,
            input: json!({ "questions": questions }),
        },
    );
    // dispatch_event parked the render input; overwrite with the answer
    // context the answer command actually needs.
    if let Some(entry) = core.registry.get(&core.run_id) {
        if let Ok(mut parked) = entry.questions.lock() {
            parked.insert(
                request_id,
                json!({
                    "opencode": {
                        "origin": origin,
                        "directory": directory,
                        "requestId": properties.get("id").cloned().unwrap_or(Value::Null),
                        "request": properties,
                    }
                }),
            );
        }
    }
}

/// Project a `question.asked` payload onto the card spec: `multiple` →
/// `multiSelect`, options pass through. `custom` needs nothing — the card
/// always offers free-form input. The answer command re-derives answer keys
/// from the parked original through this same mapping.
fn render_questions(properties: &Value) -> Vec<Value> {
    let Some(questions) = properties.get("questions").and_then(Value::as_array) else {
        return Vec::new();
    };
    questions
        .iter()
        .map(|question| {
            json!({
                "question": question.get("question").and_then(Value::as_str).unwrap_or(""),
                "header": question.get("header").and_then(Value::as_str).unwrap_or("Question"),
                "multiSelect": question.get("multiple").and_then(Value::as_bool).unwrap_or(false),
                "options": question.get("options").cloned().unwrap_or_else(|| json!([])),
            })
        })
        .collect()
}

/// Build the `/question/:requestID/reply` body from the UI's answer map
/// (rendered question text → label(s) or free-form text): one string array
/// per question, in the original order; free text travels as its own entry
/// (opencode treats unknown labels as custom text).
/// `request` is the parked `question.asked` properties object.
pub(crate) fn reply_answers(request: &Value, answers: &Value) -> Option<Vec<Vec<String>>> {
    let rendered = render_questions(request);
    let questions = request.get("questions").and_then(Value::as_array)?;
    let map = answers.as_object()?;
    let mut out = Vec::new();
    for (index, _) in questions.iter().enumerate() {
        let key = rendered
            .get(index)
            .and_then(|r| r.get("question"))
            .and_then(Value::as_str)
            .unwrap_or("");
        let selected: Vec<String> = match map.get(key) {
            Some(Value::Array(labels)) => labels
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect(),
            Some(Value::String(text)) => vec![text.clone()],
            _ => Vec::new(),
        };
        out.push(selected);
    }
    Some(out)
}

/// Answers a question parked by either driver, from its answer context (`{origin, directory,
/// requestId, …}`): 1.x replies at `/question/:id/reply` (dismissed: `/reject`), 2.x replies to
/// the form it parked. `None` answers mean the card was dismissed.
pub(crate) async fn answer_question(
    context: &Value,
    answers: Option<&Value>,
) -> Result<(), String> {
    if context.get("form").is_some() {
        return v2::answer_form(context, answers).await;
    }
    let origin = context
        .get("origin")
        .and_then(Value::as_str)
        .ok_or_else(|| "question answer context is missing the server origin".to_string())?;
    let directory = context
        .get("directory")
        .and_then(Value::as_str)
        .unwrap_or("");
    let request_id = context
        .get("requestId")
        .and_then(Value::as_str)
        .ok_or_else(|| "question answer context is missing the request id".to_string())?;
    let request = context.get("request").cloned().unwrap_or(Value::Null);
    // Dismissed = reject (the tool raises QuestionRejectedError, the model hears the person
    // declined to answer and goes on); otherwise reply, with answers in the questions' order.
    match answers {
        None => {
            opencode_server::post(
                origin,
                &format!("/question/{request_id}/reject"),
                directory,
                None,
            )
            .await
        }
        Some(answers) => {
            let answers = reply_answers(&request, answers)
                .ok_or_else(|| "question answer context is malformed".to_string())?;
            opencode_server::post(
                origin,
                &format!("/question/{request_id}/reply"),
                directory,
                Some(json!({ "answers": answers })),
            )
            .await
        }
    }
}

/// Extract a readable message from an opencode error object
/// (`{name, data: {message}}` shapes, with string fallbacks).
fn extract_error_message(value: &Value) -> Option<String> {
    for pointer in ["/error/data/message", "/error/message", "/data/message"] {
        if let Some(text) = value.pointer(pointer).and_then(Value::as_str) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    value
        .get("error")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
#[path = "opencode_session_tests.rs"]
mod tests;
