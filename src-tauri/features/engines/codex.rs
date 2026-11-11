// The Codex adapter: one `codex app-server` process per turn, speaking JSON-RPC lines.
//
// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong),
// src-tauri/src/engine/codex_app.rs. See NOTICE.

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{ChildStdin, ChildStdout};

use super::resolve;
use super::turn::{kill_tree, own_group, Decision, EngineEvent, RunMode, TurnLink, TurnRequest};

/// Codex's sandbox and approval policy for each of Misty's modes. In Ask it stops for approval,
/// which reaches the person; in Auto it works inside the folder; in Plan it can only read.
fn limits(mode: RunMode) -> (&'static str, &'static str) {
    match mode {
        RunMode::Ask => ("workspace-write", "untrusted"),
        RunMode::Auto => ("workspace-write", "never"),
        RunMode::Plan => ("read-only", "never"),
    }
}

struct Wire {
    stdin: ChildStdin,
    lines: Lines<BufReader<ChildStdout>>,
    next: u64,
}

impl Wire {
    async fn send(&mut self, message: &Value) -> Result<(), String> {
        let mut text = message.to_string();
        text.push('\n');
        self.stdin
            .write_all(text.as_bytes())
            .await
            .map_err(|_| "Codex closed its input.".to_string())?;
        self.stdin
            .flush()
            .await
            .map_err(|_| "Codex closed its input.".to_string())
    }

    async fn read(&mut self) -> Option<Value> {
        loop {
            let line = self.lines.next_line().await.ok()??;
            if let Ok(value) = serde_json::from_str::<Value>(&line) {
                return Some(value);
            }
        }
    }

    /// Sends a request and returns its result. Anything else that arrives first is handed to
    /// `aside`, so nothing the server says while it answers is lost.
    async fn call(
        &mut self,
        method: &str,
        params: Value,
        link: &TurnLink,
        state: &mut Turn,
    ) -> Result<Value, String> {
        self.next += 1;
        let id = self.next;
        self.send(&json!({ "id": id, "method": method, "params": params }))
            .await?;
        loop {
            let message = tokio::select! {
                message = self.read() => message,
                () = link.stopped() => return Err(String::new()),
            };
            let message = message.ok_or("Codex stopped answering.")?;
            if message["id"].as_u64() == Some(id) && message.get("method").is_none() {
                if let Some(error) = message.get("error") {
                    return Err(error["message"]
                        .as_str()
                        .unwrap_or("Codex refused the request.")
                        .to_string());
                }
                return Ok(message["result"].clone());
            }
            self.handle(&message, link, state).await?;
        }
    }

    /// One message from the server that isn't the answer being waited for: a notification, or a
    /// request of its own that needs a reply.
    async fn handle(
        &mut self,
        message: &Value,
        link: &TurnLink,
        state: &mut Turn,
    ) -> Result<(), String> {
        let method = message["method"].as_str().unwrap_or("");
        let params = &message["params"];
        if let Some(id) = message.get("id").filter(|id| !id.is_null()) {
            let result = match method {
                "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" => {
                    let tool = if method.contains("commandExecution") {
                        "shell"
                    } else {
                        "edit"
                    };
                    let request = params["itemId"]
                        .as_str()
                        .or(params["callId"].as_str())
                        .unwrap_or("approval")
                        .to_string();
                    let decision = link.ask(request, tool.into(), params.clone()).await;
                    json!({ "decision": if decision == Decision::Allow { "accept" } else { "decline" } })
                }
                "item/permissions/requestApproval" => json!({ "permissions": {} }),
                "mcpServer/elicitation/request" => json!({ "action": "decline" }),
                _ => json!({}),
            };
            return self.send(&json!({ "id": id, "result": result })).await;
        }
        read_notification(method, params, link, state);
        Ok(())
    }
}

/// What the turn has reported about how it ended.
#[derive(Default)]
struct Turn {
    finished: bool,
    failure: Option<String>,
}

fn item_tool(item: &Value) -> Option<(String, Value)> {
    let name = match item["type"].as_str()? {
        "commandExecution" => "shell".to_string(),
        "fileChange" => "edit".to_string(),
        "webSearch" => "web_search".to_string(),
        "mcpToolCall" | "dynamicToolCall" => item["tool"].as_str().unwrap_or("tool").to_string(),
        "imageGeneration" => "image".to_string(),
        _ => return None,
    };
    Some((name, item.clone()))
}

fn read_notification(method: &str, params: &Value, link: &TurnLink, state: &mut Turn) {
    match method {
        "item/agentMessage/delta" => {
            if let Some(text) = params["delta"].as_str() {
                link.report(EngineEvent::Text(text.into()));
            }
        }
        "item/reasoning/textDelta" | "item/reasoning/summaryTextDelta" => {
            if let Some(text) = params["delta"].as_str() {
                link.report(EngineEvent::Thinking(text.into()));
            }
        }
        "item/started" => {
            if let Some((name, input)) = item_tool(&params["item"]) {
                link.report(EngineEvent::ToolStarted {
                    id: params["item"]["id"].as_str().unwrap_or("").into(),
                    name,
                    input,
                });
            }
        }
        "item/completed" => {
            let item = &params["item"];
            if let Some((name, output)) = item_tool(item) {
                let status = item["status"].as_str().unwrap_or("");
                link.report(EngineEvent::ToolFinished {
                    id: item["id"].as_str().unwrap_or("").into(),
                    name,
                    output: item.get("aggregatedOutput").cloned().unwrap_or(output),
                    failed: status == "failed" || status == "declined",
                });
            }
        }
        "thread/tokenUsage/updated" => {
            link.report(EngineEvent::Usage(params["tokenUsage"].clone()))
        }
        "error" => {
            if let Some(text) = params["error"]["message"]
                .as_str()
                .or(params["message"].as_str())
            {
                link.report(EngineEvent::Notice(text.into()));
            }
        }
        "turn/completed" => {
            state.finished = true;
            if params["turn"]["status"] == "failed" {
                state.failure = Some(
                    params["turn"]["error"]["message"]
                        .as_str()
                        .unwrap_or("Codex could not finish the turn.")
                        .to_string(),
                );
            }
        }
        _ => {}
    }
}

/// Runs one turn. Returns when the engine has finished, failed, or been stopped.
pub async fn run(program: &Path, request: TurnRequest, link: TurnLink) -> Result<(), String> {
    let mut command = resolve::command_for(program);
    command.arg("app-server");
    if let Some(effort) = request
        .effort
        .as_deref()
        .filter(|effort| !effort.is_empty())
    {
        command.args(["-c", &format!("model_reasoning_effort=\"{effort}\"")]);
    }
    // The Space's tools, as an MCP server Codex connects to itself. Its token goes in the
    // environment, never on the command line, where other programs could read it.
    if let Some(misty) = request
        .mcp_servers
        .as_ref()
        .map(|servers| &servers["misty"])
    {
        let token = misty["headers"]["Authorization"]
            .as_str()
            .and_then(|value| value.strip_prefix("Bearer "));
        if let (Some(url), Some(token)) = (misty["url"].as_str(), token) {
            command
                .args(["-c", &format!("mcp_servers.misty.url=\"{url}\"")])
                .args([
                    "-c",
                    "mcp_servers.misty.bearer_token_env_var=\"MISTY_MCP_TOKEN\"",
                ])
                .env("MISTY_MCP_TOKEN", token);
        }
    }
    command
        .current_dir(&request.folder)
        .env("PATH", resolve::search_path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    own_group(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("Codex could not be started: {error}"))?;
    let pid = child.id();
    let stdin = child.stdin.take().ok_or("Codex has no input.")?;
    let stdout = child.stdout.take().ok_or("Codex has no output.")?;
    let mut stderr = child.stderr.take().ok_or("Codex has no error output.")?;
    let complaints = tokio::spawn(async move {
        let mut text = String::new();
        let _ = stderr.read_to_string(&mut text).await;
        let from = text.len().saturating_sub(2000);
        text.get(from..).unwrap_or(&text).trim().to_string()
    });
    let mut wire = Wire {
        stdin,
        lines: BufReader::new(stdout).lines(),
        next: 0,
    };
    let mut state = Turn::default();
    let outcome = converse(&mut wire, &request, &link, &mut state).await;
    drop(wire);
    if let Some(pid) = pid {
        kill_tree(pid);
    }
    let _ = tokio::time::timeout(Duration::from_secs(5), child.wait()).await;
    if link.is_stopped() {
        return Ok(());
    }
    match outcome {
        Ok(()) => state.failure.map_or(Ok(()), Err),
        Err(message) if message.is_empty() => {
            let complaint = complaints.await.unwrap_or_default();
            Err(if complaint.is_empty() {
                "Codex stopped without an answer.".into()
            } else {
                complaint
            })
        }
        Err(message) => Err(message),
    }
}

async fn converse(
    wire: &mut Wire,
    request: &TurnRequest,
    link: &TurnLink,
    state: &mut Turn,
) -> Result<(), String> {
    wire.call(
        "initialize",
        json!({
            "clientInfo": { "name": "misty", "title": "Misty", "version": env!("CARGO_PKG_VERSION") },
            "capabilities": {},
        }),
        link,
        state,
    )
    .await?;
    let (sandbox, approval) = limits(request.mode);
    let mut thread = json!({
        "cwd": request.folder,
        "sandbox": sandbox,
        "approvalPolicy": approval,
    });
    if let Some(model) = request.model.as_deref().filter(|model| !model.is_empty()) {
        thread["model"] = json!(model);
    }
    let started = if request.session.is_empty() {
        wire.call("thread/start", thread, link, state).await?
    } else {
        thread["threadId"] = json!(request.session);
        wire.call("thread/resume", thread, link, state).await?
    };
    let thread_id = started["thread"]["id"]
        .as_str()
        .ok_or("Codex did not open a session.")?
        .to_string();
    link.report(EngineEvent::Session(thread_id.clone()));
    let mut turn = json!({
        "threadId": thread_id,
        "input": [{ "type": "text", "text": request.prompt }],
    });
    if let Some(model) = request.model.as_deref().filter(|model| !model.is_empty()) {
        turn["model"] = json!(model);
    }
    if let Some(effort) = request
        .effort
        .as_deref()
        .filter(|effort| !effort.is_empty())
    {
        turn["effort"] = json!(effort);
    }
    let begun = wire.call("turn/start", turn, link, state).await?;
    let turn_id = begun["turn"]["id"].as_str().unwrap_or("").to_string();
    while !state.finished {
        let message = tokio::select! {
            message = wire.read() => message,
            () = link.stopped() => {
                // Ask it to stop cleanly, then give it a moment before the process is ended.
                wire.next += 1;
                let id = wire.next;
                let _ = wire
                    .send(&json!({
                        "id": id,
                        "method": "turn/interrupt",
                        "params": { "threadId": thread_id, "turnId": turn_id },
                    }))
                    .await;
                let _ = tokio::time::timeout(Duration::from_secs(2), wire.read()).await;
                return Ok(());
            }
        };
        let Some(message) = message else {
            return Err(String::new());
        };
        wire.handle(&message, link, state).await?;
    }
    Ok(())
}

/// The models this Codex install offers, asked from Codex itself, with its own default first.
pub async fn models(program: &Path) -> Vec<(String, bool)> {
    let mut command = resolve::command_for(program);
    command
        .arg("app-server")
        .env("PATH", resolve::search_path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    own_group(&mut command);
    let Ok(mut child) = command.spawn() else {
        return Vec::new();
    };
    let pid = child.id();
    let (Some(stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
        return Vec::new();
    };
    let mut wire = Wire {
        stdin,
        lines: BufReader::new(stdout).lines(),
        next: 0,
    };
    let asked = async {
        for (id, method, params) in [
            (
                1,
                "initialize",
                json!({ "clientInfo": { "name": "misty", "title": "Misty", "version": "0" }, "capabilities": {} }),
            ),
            (2, "model/list", json!({})),
        ] {
            wire.send(&json!({ "id": id, "method": method, "params": params }))
                .await
                .ok()?;
            loop {
                let message = wire.read().await?;
                if message["id"].as_u64() == Some(id) && message.get("method").is_none() {
                    if id == 2 {
                        return Some(message["result"]["data"].clone());
                    }
                    break;
                }
            }
        }
        None
    };
    let listed = tokio::time::timeout(Duration::from_secs(15), asked)
        .await
        .ok()
        .flatten();
    if let Some(pid) = pid {
        kill_tree(pid);
    }
    let mut models: Vec<(String, bool)> = listed
        .as_ref()
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|model| {
            let id = model["id"].as_str().or(model["model"].as_str())?;
            Some((
                id.to_string(),
                model["isDefault"].as_bool().unwrap_or(false),
            ))
        })
        .collect();
    models.sort_by_key(|(_, default)| !default);
    models
}
