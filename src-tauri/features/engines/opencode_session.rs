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

const KILL_POLL: Duration = Duration::from_millis(150);

#[derive(Default)]
struct TurnView {
    part_types: HashMap<(String, String), String>,
    last_usage: Option<Value>,
    context_windows: HashMap<String, u64>,
    turn_ended: bool,
    saw_content: bool,
    v2: v2::View,
}

#[path = "opencode_v2.rs"]
mod v2;

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

#[allow(clippy::too_many_arguments)]
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
    tokio::spawn(report_commands(origin.clone(), directory.clone()));

    view.context_windows = load_context_windows(&origin, &directory).await;

    let session_id = match req.session_id.as_deref() {
        Some(id) => id.to_string(),
        None => create_session(&origin, &directory, &req.prompt).await?,
    };
    core.dispatch_event(state, EngineEvent::SessionId(session_id.clone()));
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

pub(super) fn with_message_cost(mut usage: Value, info: &Value) -> Value {
    if let Some(cost) = info
        .get("cost")
        .and_then(Value::as_f64)
        .filter(|cost| *cost > 0.0)
    {
        usage["cost_usd"] = serde_json::json!(cost);
    }
    usage
}

pub(crate) fn is_compaction_summary(info: &Value) -> bool {
    info.get("summary").and_then(Value::as_bool) == Some(true)
        || ["agent", "mode"]
            .iter()
            .any(|key| info.get(*key).and_then(Value::as_str) == Some("compaction"))
}

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

fn command_in(prompt: &str) -> Option<(&str, &str)> {
    let text = prompt.trim().strip_prefix('/')?;
    let (name, arguments) = text
        .split_once(char::is_whitespace)
        .map_or((text, ""), |(name, rest)| (name, rest.trim()));
    (!name.is_empty() && !name.contains('/')).then_some((name, arguments))
}

pub(crate) async fn report_commands(origin: String, directory: String) {
    commands(&origin, &directory).await;
}

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

pub(crate) fn is_user_message(message: &Value) -> bool {
    message.pointer("/info/role").and_then(Value::as_str) == Some("user")
}

pub(crate) fn last_user_message(messages: &[Value]) -> Option<&Value> {
    messages
        .iter()
        .rev()
        .find(|message| is_user_message(message))
}

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
    for raw in &req.images {
        let (mime, data) = super::images::load_image(raw, &req.workspace)?;
        parts.push(json!({
            "type": "file",
            "mime": mime,
            "url": format!("data:{mime};base64,{data}"),
        }));
    }
    let mut body = json!({ "parts": parts });
    if let Some(model) = req.model.as_deref().and_then(|m| m.split_once('/')) {
        body["model"] = json!({ "providerID": model.0, "modelID": model.1 });
    }
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

fn permission_reply(permission: Option<&str>) -> &'static str {
    use super::Engine;
    if super::opencode::OpenCodeEngine.resolve_permission(permission) == "bypass" {
        "always"
    } else {
        "once"
    }
}

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
                _ => core.dispatch_event(state, EngineEvent::Delta(delta.to_string())),
            }
        }
        "message.updated" => {
            let info = properties.get("info").cloned().unwrap_or(Value::Null);
            if info.get("role").and_then(Value::as_str) != Some("assistant") {
                return;
            }
            if let Some(tokens) = info.get("tokens").filter(|t| t.is_object()) {
                let usage = v2::usage_of(tokens, None);
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
            if let Some(message) = extract_error_message(&info) {
                core.dispatch_event(state, EngineEvent::Warn(message));
            }
        }
        "session.compacted" => {
            core.dispatch_event(state, EngineEvent::Usage(v2::after_compaction(json!({}))));
        }
        "session.status" => {
            let status = properties.pointer("/status/type").and_then(Value::as_str);
            match status {
                Some("idle") => {
                    view.turn_ended = true;
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
