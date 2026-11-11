// The Claude Code adapter: one `claude -p` process per turn, speaking stream-json on both pipes.
//
// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong),
// src-tauri/src/engine/claude.rs and reader.rs. See NOTICE.

use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::ChildStdin;

use super::resolve;
use super::turn::{kill_tree, own_group, Decision, EngineEvent, RunMode, TurnLink, TurnRequest};

/// Claude Code's own name for each of Misty's modes. In Auto it edits files without asking and
/// asks Misty about everything else, which native code answers; nothing skips its permission checks.
fn permission_mode(mode: RunMode) -> &'static str {
    match mode {
        RunMode::Ask => "default",
        RunMode::Auto => "acceptEdits",
        RunMode::Plan => "plan",
    }
}

fn arguments(request: &TurnRequest) -> Vec<String> {
    let mut arguments: Vec<String> = [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--permission-prompt-tool",
        "stdio",
        "--permission-mode",
        permission_mode(request.mode),
    ]
    .into_iter()
    .map(str::to_string)
    .collect();
    if let Some(model) = request.model.as_deref().filter(|model| !model.is_empty()) {
        arguments.extend(["--model".into(), model.into()]);
    }
    if let Some(servers) = &request.mcp_servers {
        arguments.extend([
            "--mcp-config".into(),
            json!({ "mcpServers": servers }).to_string(),
        ]);
    }
    if !request.session.is_empty() {
        arguments.extend(["--resume".into(), request.session.clone()]);
    }
    arguments
}

/// A tool call whose input is still arriving in pieces.
#[derive(Default)]
struct OpenTool {
    id: String,
    name: String,
    input: String,
}

/// What one turn has seen so far, to match results to calls and pieces to blocks.
#[derive(Default)]
struct Reading {
    open: HashMap<u64, OpenTool>,
    names: HashMap<String, String>,
}

/// How a line ends the turn, if it does.
enum Ending {
    Done,
    Failed(String),
}

async fn write_line(stdin: &mut ChildStdin, line: &Value) -> bool {
    let mut text = line.to_string();
    text.push('\n');
    stdin.write_all(text.as_bytes()).await.is_ok() && stdin.flush().await.is_ok()
}

fn permission_reply(request: &str, decision: &Decision, input: &Value) -> Value {
    let response = match decision {
        Decision::Allow => json!({ "behavior": "allow", "updatedInput": input }),
        Decision::Deny(message) => json!({ "behavior": "deny", "message": message }),
    };
    json!({
        "type": "control_response",
        "response": { "subtype": "success", "request_id": request, "response": response },
    })
}

fn result_text(block: &Value) -> Value {
    match &block["content"] {
        Value::Array(parts) => Value::String(
            parts
                .iter()
                .filter_map(|part| part["text"].as_str())
                .collect::<Vec<_>>()
                .join("\n"),
        ),
        other => other.clone(),
    }
}

fn read_stream_event(event: &Value, reading: &mut Reading, link: &TurnLink) {
    let index = event["index"].as_u64().unwrap_or(0);
    match event["type"].as_str().unwrap_or("") {
        "content_block_start" if event["content_block"]["type"] == "tool_use" => {
            let block = &event["content_block"];
            reading.open.insert(
                index,
                OpenTool {
                    id: block["id"].as_str().unwrap_or("").into(),
                    name: block["name"].as_str().unwrap_or("").into(),
                    input: String::new(),
                },
            );
        }
        "content_block_delta" => match event["delta"]["type"].as_str().unwrap_or("") {
            "text_delta" => {
                if let Some(text) = event["delta"]["text"].as_str() {
                    link.report(EngineEvent::Text(text.into()));
                }
            }
            "thinking_delta" => {
                if let Some(text) = event["delta"]["thinking"].as_str() {
                    link.report(EngineEvent::Thinking(text.into()));
                }
            }
            "input_json_delta" => {
                if let (Some(tool), Some(piece)) = (
                    reading.open.get_mut(&index),
                    event["delta"]["partial_json"].as_str(),
                ) {
                    tool.input.push_str(piece);
                }
            }
            _ => {}
        },
        "content_block_stop" => {
            if let Some(tool) = reading.open.remove(&index) {
                let input = serde_json::from_str(&tool.input).unwrap_or(Value::Null);
                reading.names.insert(tool.id.clone(), tool.name.clone());
                link.report(EngineEvent::ToolStarted {
                    id: tool.id,
                    name: tool.name,
                    input,
                });
            }
        }
        _ => {}
    }
}

/// Reads one line of Claude Code's output. Permission requests are answered on `stdin` here,
/// because the engine waits for the answer before it goes on.
async fn read_line(
    line: &Value,
    reading: &mut Reading,
    link: &TurnLink,
    stdin: &mut ChildStdin,
) -> Option<Ending> {
    if let Some(session) = line["session_id"].as_str().filter(|id| !id.is_empty()) {
        link.report(EngineEvent::Session(session.into()));
    }
    match line["type"].as_str().unwrap_or("") {
        "stream_event" => read_stream_event(&line["event"], reading, link),
        "assistant" => {
            if let Some(model) = line["message"]["model"].as_str() {
                link.report(EngineEvent::Model(model.into()));
            }
        }
        "user" => {
            for block in line["message"]["content"].as_array().into_iter().flatten() {
                if block["type"] != "tool_result" {
                    continue;
                }
                let id = block["tool_use_id"].as_str().unwrap_or("").to_string();
                link.report(EngineEvent::ToolFinished {
                    name: reading.names.get(&id).cloned().unwrap_or_default(),
                    id,
                    output: result_text(block),
                    failed: block["is_error"].as_bool().unwrap_or(false),
                });
            }
        }
        "control_request" => {
            let request = line["request_id"].as_str().unwrap_or("").to_string();
            let asked = &line["request"];
            let reply = if asked["subtype"] == "can_use_tool" {
                let tool = asked["tool_name"].as_str().unwrap_or("").to_string();
                let input = asked["input"].clone();
                let decision = link.ask(request.clone(), tool, input.clone()).await;
                permission_reply(&request, &decision, &input)
            } else {
                json!({
                    "type": "control_response",
                    "response": {
                        "subtype": "error",
                        "request_id": request,
                        "error": "Misty does not answer this kind of request.",
                    },
                })
            };
            write_line(stdin, &reply).await;
        }
        "result" => {
            if !line["usage"].is_null() {
                link.report(EngineEvent::Usage(line["usage"].clone()));
            }
            let failed = line["is_error"].as_bool().unwrap_or(false)
                || line["subtype"]
                    .as_str()
                    .is_some_and(|kind| kind.starts_with("error"));
            return Some(if failed {
                Ending::Failed(
                    line["result"]
                        .as_str()
                        .filter(|text| !text.is_empty())
                        .unwrap_or("Claude Code stopped with an error.")
                        .into(),
                )
            } else {
                Ending::Done
            });
        }
        _ => {}
    }
    None
}

/// Runs one turn. Returns when the engine has finished, failed, or been stopped.
pub async fn run(program: &Path, request: TurnRequest, link: TurnLink) -> Result<(), String> {
    let mut command = resolve::command_for(program);
    command
        .args(arguments(&request))
        .current_dir(&request.folder)
        .env("PATH", resolve::search_path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    own_group(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("Claude Code could not be started: {error}"))?;
    let pid = child.id();
    let mut stdin = child.stdin.take().ok_or("Claude Code has no input.")?;
    let stdout = child.stdout.take().ok_or("Claude Code has no output.")?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or("Claude Code has no error output.")?;
    // Keep the end of what it complains about, for the message when it dies without a result.
    let complaints = tokio::spawn(async move {
        let mut text = String::new();
        let _ = stderr.read_to_string(&mut text).await;
        let from = text.len().saturating_sub(2000);
        text.get(from..).unwrap_or(&text).trim().to_string()
    });
    // Pictures come first, then the words, as Claude Code's own input takes them.
    let mut content: Vec<Value> = request
        .images
        .iter()
        .map(|image| {
            json!({
                "type": "image",
                "source": { "type": "base64", "media_type": image.mime, "data": image.data },
            })
        })
        .collect();
    content.push(json!({ "type": "text", "text": request.prompt }));
    let said = write_line(
        &mut stdin,
        &json!({ "type": "user", "message": { "role": "user", "content": content } }),
    )
    .await;
    if !said {
        if let Some(pid) = pid {
            kill_tree(pid);
        }
        return Err("Claude Code closed before it took the message.".into());
    }
    let mut lines = BufReader::new(stdout).lines();
    let mut reading = Reading::default();
    let mut ending = None;
    loop {
        let line = tokio::select! {
            line = lines.next_line() => line,
            () = link.stopped() => break,
        };
        let Ok(Some(line)) = line else { break };
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if let Some(end) = read_line(&value, &mut reading, &link, &mut stdin).await {
            ending = Some(end);
            break;
        }
    }
    // Closing its input lets it exit by itself; a stopped or stuck one is ended with its helpers.
    drop(stdin);
    if link.is_stopped() || ending.is_none() {
        if let Some(pid) = pid {
            kill_tree(pid);
        }
    }
    let _ = tokio::time::timeout(std::time::Duration::from_secs(5), child.wait()).await;
    if link.is_stopped() {
        return Ok(());
    }
    match ending {
        Some(Ending::Done) => Ok(()),
        Some(Ending::Failed(message)) => Err(message),
        None => {
            let complaint = complaints.await.unwrap_or_default();
            Err(if complaint.is_empty() {
                "Claude Code stopped without an answer.".into()
            } else {
                complaint
            })
        }
    }
}
