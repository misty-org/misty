// The OpenCode adapter: one `opencode serve` process shared by every turn, driven over HTTP, with
// its event stream read for the turn's session.
//
// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong),
// src-tauri/src/engine/opencode_server.rs and opencode_session.rs. See NOTICE.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use futures_util::StreamExt;
use serde_json::{json, Value};
use tokio::sync::Mutex;

use super::resolve;
use super::turn::{own_group, Decision, EngineEvent, RunMode, TurnLink, TurnRequest};

struct Server {
    base: String,
    /// Kept so the server ends with the app; an adopted server has none.
    _child: Option<tokio::process::Child>,
}

static SERVER: Mutex<Option<Server>> = Mutex::const_new(None);

fn client() -> reqwest::Client {
    reqwest::Client::new()
}

async fn healthy(base: &str) -> bool {
    let answer = client()
        .get(format!("{base}/global/health"))
        .timeout(Duration::from_millis(800))
        .send()
        .await;
    match answer {
        Ok(answer) => answer
            .json::<Value>()
            .await
            .is_ok_and(|body| body["healthy"] == true),
        Err(_) => false,
    }
}

fn free_port() -> Result<u16, String> {
    std::net::TcpListener::bind(("127.0.0.1", 0))
        .and_then(|listener| listener.local_addr())
        .map(|address| address.port())
        .map_err(|error| format!("No port is free for OpenCode: {error}"))
}

/// The server's address, starting it on this computer if it isn't running. It listens on
/// 127.0.0.1 only.
async fn server(program: &Path) -> Result<String, String> {
    let mut held = SERVER.lock().await;
    if let Some(server) = held.as_ref() {
        if healthy(&server.base).await {
            return Ok(server.base.clone());
        }
    }
    let port = free_port()?;
    let base = format!("http://127.0.0.1:{port}");
    let mut command = resolve::command_for(program);
    command
        .args([
            "serve",
            "--hostname",
            "127.0.0.1",
            "--port",
            &port.to_string(),
        ])
        .env("PATH", resolve::search_path())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    own_group(&mut command);
    let child = command
        .spawn()
        .map_err(|error| format!("OpenCode could not be started: {error}"))?;
    for _ in 0..80 {
        if healthy(&base).await {
            *held = Some(Server {
                base: base.clone(),
                _child: Some(child),
            });
            return Ok(base);
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    Err("OpenCode did not start in time.".into())
}

/// Ends the shared server, as the app quits.
pub async fn stop_server() {
    SERVER.lock().await.take();
}

struct Session<'a> {
    base: &'a str,
    folder: String,
    id: String,
}

impl Session<'_> {
    async fn post(&self, path: &str, body: Value) -> Result<Value, String> {
        let answer = client()
            .post(format!("{}{path}", self.base))
            .query(&[("directory", &self.folder)])
            .json(&body)
            .send()
            .await
            .map_err(|error| format!("OpenCode did not answer: {error}"))?;
        let status = answer.status();
        let text = answer.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(format!("OpenCode refused the request ({status}): {text}"));
        }
        Ok(serde_json::from_str(&text).unwrap_or(Value::Null))
    }
}

/// What the stream has shown of this turn so far.
#[derive(Default)]
struct Reading {
    kinds: HashMap<String, String>,
    started: HashSet<String>,
    finished: HashSet<String>,
    worked: bool,
}

enum Ending {
    Done,
    Failed(String),
}

fn of_session(properties: &Value, session: &str) -> bool {
    [
        &properties["sessionID"],
        &properties["part"]["sessionID"],
        &properties["info"]["sessionID"],
    ]
    .iter()
    .any(|id| id.as_str() == Some(session))
}

async fn read_event(
    event: &Value,
    session: &Session<'_>,
    mode: RunMode,
    reading: &mut Reading,
    link: &TurnLink,
) -> Option<Ending> {
    let properties = &event["properties"];
    let kind = event["type"].as_str().unwrap_or("");
    if kind != "session.error" && !of_session(properties, &session.id) {
        return None;
    }
    match kind {
        "message.part.updated" => {
            let part = &properties["part"];
            let id = part["id"].as_str().unwrap_or("").to_string();
            let part_kind = part["type"].as_str().unwrap_or("").to_string();
            reading.kinds.insert(id.clone(), part_kind.clone());
            if part_kind != "tool" {
                return None;
            }
            reading.worked = true;
            let name = part["tool"].as_str().unwrap_or("tool").to_string();
            let state = &part["state"];
            match state["status"].as_str().unwrap_or("") {
                "pending" | "running" if reading.started.insert(id.clone()) => {
                    link.report(EngineEvent::ToolStarted {
                        id,
                        name,
                        input: state["input"].clone(),
                    });
                }
                status @ ("completed" | "error") if reading.finished.insert(id.clone()) => {
                    if reading.started.insert(id.clone()) {
                        link.report(EngineEvent::ToolStarted {
                            id: id.clone(),
                            name: name.clone(),
                            input: state["input"].clone(),
                        });
                    }
                    let failed = status == "error";
                    link.report(EngineEvent::ToolFinished {
                        id,
                        name,
                        output: if failed {
                            state["error"].clone()
                        } else {
                            state["output"].clone()
                        },
                        failed,
                    });
                }
                _ => {}
            }
        }
        "message.part.delta" => {
            let text = properties["delta"].as_str()?;
            reading.worked = true;
            let part = properties["partID"].as_str().unwrap_or("");
            if reading
                .kinds
                .get(part)
                .is_some_and(|kind| kind == "reasoning")
            {
                link.report(EngineEvent::Thinking(text.into()));
            } else {
                link.report(EngineEvent::Text(text.into()));
            }
        }
        "message.updated" => {
            let info = &properties["info"];
            if info["role"] == "assistant" && !info["tokens"].is_null() {
                link.report(EngineEvent::Usage(info["tokens"].clone()));
            }
        }
        "permission.asked" => {
            let request = properties["id"].as_str().unwrap_or("").to_string();
            let tool = properties["permission"]
                .as_str()
                .unwrap_or("tool")
                .to_string();
            // In Auto the engine may go on; native code decides that here, not the page.
            let decision = if mode == RunMode::Auto {
                Decision::Allow
            } else {
                link.ask(request.clone(), tool, properties.clone()).await
            };
            let reply = if decision == Decision::Allow {
                "once"
            } else {
                "reject"
            };
            let _ = session
                .post(
                    &format!("/permission/{request}/reply"),
                    json!({ "reply": reply }),
                )
                .await;
        }
        "session.status" => match properties["status"]["type"].as_str().unwrap_or("") {
            "busy" => reading.worked = true,
            "idle" if reading.worked => return Some(Ending::Done),
            "retry" => link.report(EngineEvent::Notice(
                properties["status"]["message"]
                    .as_str()
                    .unwrap_or("OpenCode is trying again.")
                    .into(),
            )),
            _ => {}
        },
        "session.idle" if reading.worked => return Some(Ending::Done),
        "session.error" => {
            if properties["sessionID"]
                .as_str()
                .is_some_and(|id| id != session.id)
            {
                return None;
            }
            let error = &properties["error"];
            return Some(Ending::Failed(
                error["data"]["message"]
                    .as_str()
                    .or(error["name"].as_str())
                    .unwrap_or("OpenCode could not finish the turn.")
                    .to_string(),
            ));
        }
        _ => {}
    }
    None
}

/// Runs one turn. Returns when the engine has finished, failed, or been stopped.
pub async fn run(program: &Path, request: TurnRequest, link: TurnLink) -> Result<(), String> {
    let base = server(program).await?;
    let folder = request.folder.to_string_lossy().to_string();
    let mut session = Session {
        base: &base,
        folder,
        id: request.session.clone(),
    };
    if session.id.is_empty() {
        let created = session.post("/session", json!({})).await?;
        session.id = created["id"]
            .as_str()
            .ok_or("OpenCode did not open a session.")?
            .to_string();
    }
    link.report(EngineEvent::Session(session.id.clone()));
    // The Space's tools, as a remote MCP server. A server that won't take it only loses those
    // tools; the turn goes on.
    if let Some(misty) = request
        .mcp_servers
        .as_ref()
        .map(|servers| &servers["misty"])
    {
        let _ = session
            .post(
                "/mcp",
                json!({
                    "name": "misty",
                    "config": {
                        "type": "remote",
                        "url": misty["url"],
                        "headers": misty["headers"],
                        "enabled": true,
                    },
                }),
            )
            .await;
    }
    // The stream is opened before the message is sent, so nothing it says is missed.
    let stream = client()
        .get(format!("{base}/event"))
        .query(&[("directory", &session.folder)])
        .send()
        .await
        .map_err(|error| format!("OpenCode's events could not be read: {error}"))?;
    let mut prompt = json!({ "parts": [{ "type": "text", "text": request.prompt }] });
    if let Some((provider, model)) = request
        .model
        .as_deref()
        .and_then(|model| model.split_once('/'))
    {
        prompt["model"] = json!({ "providerID": provider, "modelID": model });
    }
    if request.mode == RunMode::Plan {
        prompt["agent"] = json!("plan");
    }
    if let Some(effort) = request
        .effort
        .as_deref()
        .filter(|effort| !effort.is_empty())
    {
        prompt["variant"] = json!(effort);
    }
    session
        .post(&format!("/session/{}/prompt_async", session.id), prompt)
        .await?;
    let mut bytes = stream.bytes_stream();
    let mut pending = String::new();
    let mut reading = Reading::default();
    loop {
        let chunk = tokio::select! {
            chunk = bytes.next() => chunk,
            () = link.stopped() => {
                let _ = session.post(&format!("/session/{}/abort", session.id), json!({})).await;
                return Ok(());
            }
        };
        let Some(Ok(chunk)) = chunk else {
            return Err("OpenCode's events stopped before the turn ended.".into());
        };
        pending.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(end) = pending.find('\n') {
            let line: String = pending.drain(..=end).collect();
            let Some(data) = line.trim_end().strip_prefix("data:") else {
                continue;
            };
            let Ok(event) = serde_json::from_str::<Value>(data.trim_start()) else {
                continue;
            };
            match read_event(&event, &session, request.mode, &mut reading, &link).await {
                Some(Ending::Done) => return Ok(()),
                Some(Ending::Failed(message)) => return Err(message),
                None => {}
            }
        }
    }
}
