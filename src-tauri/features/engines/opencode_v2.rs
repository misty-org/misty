//! The OpenCode 2.x turn driver (declared from `opencode_session.rs`, which keeps 1.x's).
//!
//! Wire (checked against a live `opencode serve` 2.3.0 and its `/openapi.json`):
//! - `POST /api/session {location: {directory}}` → `{data: {id}}`; the session holds its agent
//!   and model, switched with `POST /api/session/:id/agent {agent}` and
//!   `POST /api/session/:id/model {model: {providerID, id, variant}}`.
//! - `GET /api/event` (SSE, every session's events, `{id, type, data}`) must be live before
//!   `POST /api/session/:id/prompt {text, files: [{uri}]}`; `/command {name, text}` and
//!   `/compact {}` stand in for it when the message is one of OpenCode's commands.
//! - The turn streams as `session.text.delta` / `session.reasoning.delta`, tools as
//!   `session.tool.input.started` → `called` → `success|failed`, usage on `session.step.ended`,
//!   and settles on `session.execution.succeeded|failed|interrupted`.
//! - The `question` tool asks through a form: `form.created` → answer card →
//!   `POST /api/session/:id/form/:formID/reply {answer: {q0: …}}` (or `DELETE` to dismiss).
//!   `permission.asked` answers at `POST /api/session/:id/permission/:requestID/reply
//!   {decision: once|always|reject}`.
//! - Stop sends `POST /api/session/:id/interrupt`.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::Method;
use serde_json::{json, Value};
use tokio::sync::mpsc;

use super::opencode_server::{self, data};
use super::{EngineEvent, SendRequest, TurnCore, TurnState};

const KILL_POLL: Duration = Duration::from_millis(150);
const CALL_TIMEOUT: Duration = Duration::from_secs(15);

#[path = "opencode_v2_events.rs"]
mod events;
#[path = "opencode_v2_forms.rs"]
mod forms;
#[path = "opencode_v2_session.rs"]
mod session;

use events::handle_event;
// The 1.x path reads its tokens the same way.
pub(super) use events::{after_compaction, usage_of};
pub(crate) use forms::answer_form;
pub(crate) use session::messages;
use session::{add_mcp_servers, choose_agent_and_model, context_windows};

/// Per-turn projection state for the 2.x event stream.
#[derive(Default)]
pub(super) struct View {
    /// Tool call id → tool name; only `session.tool.input.started` names the tool.
    tools: HashMap<String, String>,
    /// The model the step that is running uses, as `provider/model`.
    model: Option<String>,
    pub(super) last_usage: Option<Value>,
    /// `provider/model` → context window, from `GET /api/model`.
    context_windows: HashMap<String, u64>,
    started: bool,
    turn_ended: bool,
}

async fn call(
    method: Method,
    origin: &str,
    path: &str,
    directory: Option<&str>,
    body: Option<Value>,
) -> Result<Value, String> {
    opencode_server::call(method, origin, path, directory, body, CALL_TIMEOUT).await
}

/// One 2.x turn on the server at `origin`.
pub(super) async fn turn(
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut View,
    req: &SendRequest,
    origin: &str,
    killed: &Arc<AtomicBool>,
) -> Result<(), String> {
    let directory = req.workspace.to_string_lossy().to_string();
    tokio::spawn(super::report_commands(origin.to_owned(), directory.clone()));
    view.context_windows = context_windows(origin, &directory).await;

    let session_id = match req.session_id.as_deref() {
        Some(id) => id.to_string(),
        None => {
            let created = call(
                Method::POST,
                origin,
                "/api/session",
                None,
                Some(json!({ "location": { "directory": directory } })),
            )
            .await
            .map_err(|e| format!("OpenCode could not create a session: {e}"))?;
            data(&created)
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_string)
                .ok_or("OpenCode created no session id")?
        }
    };
    core.dispatch_event(state, EngineEvent::SessionId(session_id.clone()));
    add_mcp_servers(req, origin, &directory).await;
    if let Err(error) = choose_agent_and_model(req, origin, &session_id).await {
        core.dispatch_event(state, EngineEvent::Warn(error));
    }

    let (mut events, ready) = event_stream(origin, session_id.clone());
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
    // The send may answer only once the turn is done, so it runs on its own and its failure
    // comes back here; the event stream carries the turn meanwhile.
    let (sent_tx, mut sent) = tokio::sync::oneshot::channel::<Result<(), String>>();
    {
        let (origin, directory, session_id) =
            (origin.to_owned(), directory.clone(), session_id.clone());
        let (path, body) = send_body(&origin, &directory, &session_id, req).await?;
        tokio::spawn(async move {
            let result = opencode_server::call(
                Method::POST,
                &origin,
                &path,
                None,
                Some(body),
                Duration::from_secs(60 * 60),
            )
            .await
            .map(|_| ())
            .map_err(|e| format!("OpenCode did not take the message: {e}"));
            let _ = sent_tx.send(result);
        });
    }

    let mut kill_poll = tokio::time::interval(KILL_POLL);
    kill_poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let permission_reply = super::permission_reply(req.permission.as_deref());
    let mut send_settled = false;
    loop {
        tokio::select! {
            frame = events.recv() => match frame {
                Some(value) => {
                    handle_event(core, state, view, &value, origin, &directory, &session_id, permission_reply).await;
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
            result = &mut sent, if !send_settled => {
                send_settled = true;
                if let Ok(Err(error)) = result {
                    return Err(error);
                }
            }
            _ = kill_poll.tick() => {
                if killed.load(Ordering::SeqCst) {
                    let _ = call(Method::POST, origin, &format!("/api/session/{session_id}/interrupt"), None, None).await;
                    return Ok(());
                }
            }
        }
    }
}

/// Where the message goes and with what: OpenCode's `/compact` (`/summarize` too) and its own
/// commands have their calls, everything else is a prompt with the pictures as data-URL files.
async fn send_body(
    origin: &str,
    directory: &str,
    session_id: &str,
    req: &SendRequest,
) -> Result<(String, Value), String> {
    let session = format!("/api/session/{session_id}");
    if req.images.is_empty() {
        if let Some((name, arguments)) = super::command_in(&req.prompt) {
            if matches!(name, "compact" | "summarize") && arguments.is_empty() {
                return Ok((format!("{session}/compact"), json!({})));
            }
            let known = super::commands(origin, directory).await;
            if known.iter().any(|known| known == name) {
                return Ok((
                    format!("{session}/command"),
                    json!({ "name": name, "text": arguments }),
                ));
            }
        }
    }
    let mut files = Vec::new();
    for raw in &req.images {
        let (mime, image) = super::super::images::load_image(raw, &req.workspace)?;
        files.push(json!({ "uri": format!("data:{mime};base64,{image}") }));
    }
    let mut body = json!({ "text": req.prompt });
    if !files.is_empty() {
        body["files"] = json!(files);
    }
    Ok((format!("{session}/prompt"), body))
}

/// The SSE reader for `GET /api/event`, forwarding this session's frames. The oneshot says
/// whether the stream connected (the server's first frame is `server.connected`).
fn event_stream(
    origin: &str,
    session_id: String,
) -> (mpsc::Receiver<Value>, tokio::sync::oneshot::Receiver<bool>) {
    let (tx, rx) = mpsc::channel::<Value>(64);
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel::<bool>();
    let origin = origin.to_owned();
    tokio::spawn(async move {
        let client = reqwest::Client::new();
        let response = opencode_server::request(&client, Method::GET, &origin, "/api/event", None)
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
                    let Some(raw) = line.strip_prefix("data:") else {
                        continue;
                    };
                    let Ok(value) = serde_json::from_str::<Value>(raw.trim()) else {
                        continue;
                    };
                    if event_session(&value) == Some(session_id.as_str())
                        && tx.send(value).await.is_err()
                    {
                        return;
                    }
                }
            }
        }
    });
    (rx, ready_rx)
}

/// The session an event belongs to: `data.sessionID`, or the form's for `form.created`.
fn event_session(value: &Value) -> Option<&str> {
    value
        .pointer("/data/sessionID")
        .or_else(|| value.pointer("/data/form/sessionID"))
        .and_then(Value::as_str)
}

#[cfg(test)]
#[path = "opencode_v2_tests.rs"]
mod tests;
#[cfg(test)]
#[path = "opencode_v2_live_tests.rs"]
mod live_tests;
