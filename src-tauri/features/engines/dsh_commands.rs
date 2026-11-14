// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/dsh_session.rs.
//! How a DSH send reaches the host (declared from `dsh_session.rs`): a message that names one of
//! the host's slash commands (commands/list) runs through commands/execute, anything else goes as
//! a prompt; plus the RPC call and client for the host's long calls.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};

use super::{client_time_zone, dsh_images, SendRequest, Ws, KILL_POLL};

/// How long a slash command's handler may run. commands/execute answers only once it settles,
/// and /compact makes a summary call to the model first.
const COMMAND_TIMEOUT: Duration = Duration::from_secs(15 * 60);
/// How long after a command settles the turn waits for the agent to start working on it
/// (`/plan <message>` steers a message in, `/goal <objective>` queues the goal's first round).
/// A command that starts nothing ends the turn with its own answer once this passes.
pub(super) const COMMAND_TURN_GRACE: Duration = Duration::from_secs(3);

/// Sends the message as a prompt (`session/prompt`, queued behind any running turn).
pub(super) async fn send_prompt(
    origin: &str,
    session_id: &str,
    req: &SendRequest,
    prompt_images: &[dsh_images::DshPromptImage],
    ws: &mut Ws,
) -> Result<(), String> {
    let mut prompt_request = json!({
        "requestId": format!("codemoss-{}", uuid::Uuid::new_v4()),
        "sessionId": session_id,
        "mode": "queue",
        "content": dsh_images::build_prompt_content(&req.prompt, prompt_images),
        "clientTimeZone": client_time_zone(),
    });
    if let Some(effort) = req
        .effort
        .as_deref()
        .map(str::trim)
        .filter(|e| !e.is_empty())
    {
        prompt_request["effort"] = json!(effort);
        prompt_request["reasoningEffort"] = json!(effort);
    }
    let prompt = crate::engines::support::dsh_host::host_call_rpc(
        origin,
        "session/prompt",
        json!({ "request": prompt_request }),
    )
    .await;
    if let Err(error) = prompt {
        let _ = ws.close(None).await;
        return Err(format!(
            "The task couldn't be sent: {}",
            dsh_images::format_prompt_refusal(&error)
        ));
    }
    Ok(())
}

/// Classifies the /plan answer (a pure function, for tests), as [`command_outcome`] does.
pub(super) fn plan_execute_outcome(result: &Value) -> Result<(), String> {
    command_outcome("plan", result).map(|_| ())
}

/// Classifies a commands/execute answer (a pure function, for tests): an unknown command returns
/// undefined (null or no commandId on the wire), so HTTP 200 isn't success; a handler error
/// (result.kind=="error") is refused too. A success gives the handler's text, which may be empty.
pub(super) fn command_outcome(name: &str, result: &Value) -> Result<String, String> {
    if result.get("commandId").and_then(Value::as_str).is_none() {
        return Err(format!(
            "The host didn't confirm the /{name} command (it answered undefined): the plugin that provides it may be missing"
        ));
    }
    let text = result
        .pointer("/result/text")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if result.pointer("/result/kind").and_then(Value::as_str) == Some("error") {
        return Err(format!("The /{name} command failed: {text}"));
    }
    Ok(text)
}

// ==================== slash commands ====================

/// Hands commands/list (`CommandDescriptor[]`: name, description, input.hint) to the composer's
/// `/` menu. The descriptors already have the ACP command shape `reported.rs` reads.
pub(super) fn report_commands(listed: &Value) {
    if let Some(commands) = listed.as_array() {
        crate::engines::reported::acp_update(
            "dsh",
            &json!({ "sessionUpdate": "available_commands_update", "availableCommands": commands }),
        );
    }
}

/// The command line a message is, when it names one of the host's commands; None for a prompt.
/// DSH's syntax: a slash at byte zero, a lowercase name of letters, digits, `_` and `-`, then the
/// end or whitespace. The internal tail Misty may append to a prompt is no part of the line.
pub(super) fn command_line(prompt: &str, listed: &Value) -> Option<String> {
    let visible = prompt
        .find("\n\n[CCGUI internal ")
        .map_or(prompt, |index| &prompt[..index]);
    let line = visible.trim();
    let name = command_name(line);
    let well_formed = line.starts_with('/')
        && !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
        && line[1 + name.len()..]
            .chars()
            .next()
            .is_none_or(char::is_whitespace);
    let known = listed.as_array().is_some_and(|commands| {
        commands
            .iter()
            .any(|command| command.get("name").and_then(Value::as_str) == Some(name))
    });
    (well_formed && known).then(|| line.to_string())
}

/// The name in a `/name args` line, without the slash.
pub(super) fn command_name(line: &str) -> &str {
    let rest = line.strip_prefix('/').unwrap_or("");
    rest.split(char::is_whitespace).next().unwrap_or("")
}

/// Runs a command line through commands/execute {agentId, line, submittedAttachments}. None when
/// the person stops the turn before it settles (dropping the request is how the host's handler
/// sees the cancel).
pub(super) async fn execute_command(
    origin: &str,
    session_id: &str,
    line: &str,
    attachments: Vec<Value>,
    killed: &Arc<AtomicBool>,
) -> Result<Option<Value>, String> {
    let call = host_call_slow(
        origin,
        "commands/execute",
        json!({
            "agentId": session_id,
            "line": line,
            "submittedAttachments": attachments,
        }),
        COMMAND_TIMEOUT,
    );
    tokio::pin!(call);
    let mut kill_poll = tokio::time::interval(KILL_POLL);
    loop {
        tokio::select! {
            result = &mut call => return result.map(Some),
            _ = kill_poll.tick() => {
                if killed.load(Ordering::SeqCst) {
                    return Ok(None);
                }
            }
        }
    }
}

/// One RPC round-trip that may take minutes (a command's handler). `host_call` keeps the probes'
/// three-second budget; this sends the same client-request envelope and cookie with `timeout`.
pub(crate) async fn host_call_slow(
    origin: &str,
    method: &str,
    args: Value,
    timeout: Duration,
) -> Result<Value, String> {
    let mut request = slow_client(origin)
        .post(format!("{origin}/api/{method}"))
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .timeout(timeout);
    if let Some(cookie) = crate::engines::support::dsh_host::host_cookie(origin) {
        request = request.header(reqwest::header::COOKIE, cookie);
    }
    let body = json!({
        "type": "client-request",
        "rpcId": uuid::Uuid::new_v4().to_string(),
        "method": method,
        "payload": { "args": args },
    });
    let response = request
        .body(body.to_string())
        .send()
        .await
        .map_err(|e| format!("Couldn't connect to {origin} ({e})"))?;
    if response.status().as_u16() == 401 {
        return Err(format!(
            "{method} unauthorized (401): the host credentials are missing or expired. Restart the DSH host from the settings."
        ));
    }
    let text = response
        .text()
        .await
        .map_err(|e| format!("{method}: couldn't read the response ({e})"))?;
    let envelope: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    if envelope.get("type").and_then(Value::as_str) != Some("server-response") {
        return Err(format!(
            "{method}: the response has the wrong shape (not a server-response)"
        ));
    }
    let result = envelope.get("result").cloned().unwrap_or(Value::Null);
    if result.get("ok").and_then(Value::as_bool) == Some(true) {
        return Ok(result.get("value").cloned().unwrap_or(Value::Null));
    }
    let message = result
        .pointer("/error/message")
        .and_then(Value::as_str)
        .unwrap_or("unknown error");
    Err(format!("{method} refused: {message}"))
}

/// An HTTP client for the host's long calls and downloads, timed per request. Like the probes'
/// client, a host on this machine is dialed directly, never through the configured proxy.
pub(crate) fn slow_client(origin: &str) -> &'static reqwest::Client {
    static LOCAL: std::sync::LazyLock<reqwest::Client> = std::sync::LazyLock::new(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(2))
            .no_proxy()
            .build()
            .expect("reqwest client")
    });
    static REMOTE: std::sync::LazyLock<reqwest::Client> = std::sync::LazyLock::new(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .build()
            .expect("reqwest client")
    });
    let authority = origin
        .split_once("://")
        .map_or(origin, |(_, rest)| rest)
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    let local = ["127.0.0.1", "localhost", "[::1]", "0.0.0.0"]
        .iter()
        .any(|host| authority == *host || authority.starts_with(&format!("{host}:")));
    if local {
        &LOCAL
    } else {
        &REMOTE
    }
}
