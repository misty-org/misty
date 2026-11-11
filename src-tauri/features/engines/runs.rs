// A chat turn on an outside engine: started from the same request as Misty's own runs, and
// reported as the same run events, so the chat shows it without knowing which engine answered.
//
// What an engine may do is decided here, in native code, from the mode the run started with:
// that mode picks the engine's own flags, and in Ask each thing it wants to do goes to the person
// through the same question Misty's own agent asks.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};
use std::time::Instant;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::agents::run_control::local_runs::publish_native;
use crate::agents::run_control::tool_policy::RunFacts;
use crate::app::runtime::MistyRuntime;
use crate::browser::agent_pages::action_confirm::{ask_tool, Answer, ToolAsk};

use super::turn::{self, Decision, EngineEvent, RunMode, TurnControl, TurnRequest};
use super::{store, EngineKind};

static RUNNING: LazyLock<Mutex<HashMap<String, TurnControl>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
/// Each live run's request, which the tool gate reads the run's mode and account from.
static REQUESTS: LazyLock<Mutex<HashMap<String, Value>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// The request a live run on an outside engine started with.
pub(crate) fn request_of(run_id: &str) -> Option<Value> {
    REQUESTS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .get(run_id)
        .cloned()
}

fn keep_request(run_id: &str, body: Option<Value>) {
    let mut held = REQUESTS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    match body {
        Some(body) => held.insert(run_id.to_string(), body),
        None => held.remove(run_id),
    };
}

fn running() -> std::sync::MutexGuard<'static, HashMap<String, TurnControl>> {
    RUNNING
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Whether this request names an outside engine, and so belongs here and not to Misty's runtime.
pub(crate) fn wants(body: &Value) -> bool {
    body["engine"]["id"]
        .as_str()
        .is_some_and(|id| EngineKind::from_id(id).is_some())
}

pub(crate) fn is_live(run_id: &str) -> bool {
    running().contains_key(run_id)
}

/// Stops a run on an outside engine. False when the run isn't one of these.
pub(crate) fn cancel(run_id: &str) -> bool {
    match running().get(run_id) {
        Some(control) => {
            control.stop();
            true
        }
        None => false,
    }
}

/// Multi-run: the live runs working in exactly this folder (multirun.rs).
pub(crate) fn live_in(folder: &std::path::Path) -> Vec<String> {
    REQUESTS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .iter()
        .filter(|(_, body)| {
            body["engine"]["folder"]
                .as_str()
                .is_some_and(|named| std::path::Path::new(named) == folder)
        })
        .map(|(run, _)| run.clone())
        .collect()
}

pub fn stop_all() {
    for control in running().values() {
        control.stop();
    }
}

/// What a tool call is about, in one line, from whichever field the engine names it by.
fn summary(input: &Value) -> String {
    let field = [
        "command",
        "file_path",
        "path",
        "url",
        "pattern",
        "query",
        "description",
    ]
    .iter()
    .find_map(|name| input[name].as_str())
    .or_else(|| input["item"]["command"].as_str())
    .or_else(|| {
        input["command"]
            .as_array()
            .and_then(|parts| parts.last()?.as_str())
    });
    let text = match field {
        Some(text) => text.to_string(),
        None if input.is_null() => String::new(),
        None => input.to_string(),
    };
    clip(&text, 600)
}

fn clip(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text.to_string();
    }
    let mut clipped: String = text.chars().take(limit).collect();
    clipped.push('…');
    clipped
}

fn output_text(output: &Value) -> String {
    match output {
        Value::String(text) => clip(text, 4000),
        Value::Null => String::new(),
        other => clip(&other.to_string(), 4000),
    }
}

/// Turns what the engine reports into the run's events and sends them to the chat.
struct Reporter {
    app: AppHandle,
    run_id: String,
    sent: u64,
    /// The answer since the last tool call: what the chat shows as the reply when the turn ends.
    answer: String,
    thinking: bool,
    started: HashMap<String, Instant>,
}

impl Reporter {
    fn send(&mut self, mut event: Value) {
        self.sent += 1;
        event["id"] = json!(format!("{}:{}", self.run_id, self.sent));
        event["runId"] = json!(self.run_id);
        publish_native(&self.app, &self.run_id, &event);
    }

    fn report(&mut self, event: EngineEvent) {
        match event {
            EngineEvent::Text(text) => {
                self.thinking = false;
                self.answer.push_str(&text);
                self.send(json!({ "type": "response.delta", "delta": text }));
            }
            EngineEvent::Thinking(_) => {
                if !self.thinking {
                    self.thinking = true;
                    self.send(json!({ "type": "assistant.status", "phase": "thinking" }));
                }
            }
            EngineEvent::ToolStarted { id, name, input } => {
                self.thinking = false;
                // The chat turns what was said so far into a note above the tool's row.
                self.answer.clear();
                self.started.insert(id.clone(), Instant::now());
                self.send(json!({ "type": "tool.started", "toolCallId": id, "toolName": name }));
                let detail = summary(&input);
                if !detail.is_empty() {
                    self.send(json!({
                        "type": "tool.detail",
                        "toolCallId": id,
                        "toolName": name,
                        "activity": { "detail": detail },
                    }));
                }
            }
            EngineEvent::ToolFinished {
                id,
                name,
                output,
                failed,
            } => {
                let took = self
                    .started
                    .remove(&id)
                    .map_or(0, |began| began.elapsed().as_millis() as u64);
                let text = output_text(&output);
                if failed {
                    self.send(json!({
                        "type": "tool.failed",
                        "toolCallId": id,
                        "toolName": name,
                        "durationMs": took,
                        "error": clip(&text, 600),
                    }));
                } else {
                    self.send(json!({
                        "type": "tool.completed",
                        "toolCallId": id,
                        "toolName": name,
                        "durationMs": took,
                    }));
                }
                if !text.is_empty() {
                    self.send(json!({
                        "type": "tool.detail",
                        "toolCallId": id,
                        "toolName": name,
                        "activity": { "output": text },
                    }));
                }
            }
            EngineEvent::Notice(text) => {
                self.send(json!({ "type": "assistant.status", "text": clip(&text, 300) }));
            }
            // Kept by the caller, or of no use to the chat yet.
            EngineEvent::Session(_)
            | EngineEvent::Model(_)
            | EngineEvent::Usage(_)
            | EngineEvent::Permission { .. } => {}
        }
    }

    fn finish(&mut self, outcome: Result<(), String>, stopped: bool) {
        if stopped {
            self.send(json!({ "type": "invocation.canceled", "state": "canceled" }));
            return;
        }
        match outcome {
            Ok(()) => {
                let text = self.answer.trim().to_string();
                self.send(json!({
                    "type": "assistant.message",
                    "text": text,
                    "summary": clip(&text, 200),
                }));
                self.send(json!({ "type": "invocation.completed", "state": "completed" }));
            }
            Err(error) => self.send(json!({
                "type": "invocation.failed",
                "state": "failed",
                "error": clip(&error, 1200),
            })),
        }
    }
}

/// Whether the engine may go ahead with what it asked for. Auto runs don't stop for ordinary
/// work, a plan changes nothing, and in Ask the person answers the same question Misty's own
/// agent would raise.
async fn decide(
    app: &AppHandle,
    facts: &RunFacts,
    mode: RunMode,
    tool: &str,
    input: &Value,
) -> Decision {
    match mode {
        RunMode::Auto => Decision::Allow,
        RunMode::Plan => Decision::Deny("This chat is planning, so nothing is changed yet.".into()),
        RunMode::Ask => {
            let about = summary(input);
            let control = if about.is_empty() {
                tool.to_string()
            } else {
                format!("{tool}: {about}")
            };
            let answer = ask_tool(
                app,
                ToolAsk {
                    account: &facts.account,
                    kind: "action",
                    control: &control,
                    reason: "This chat asks before an agent changes files or runs a command.",
                    site: "",
                    agent_id: &facts.agent_id,
                    task_id: &facts.task_id,
                },
            )
            .await;
            match answer {
                Answer::Allowed => Decision::Allow,
                Answer::Refused => Decision::Deny(
                    "The person declined this. Do not retry it; continue without it or ask them."
                        .into(),
                ),
                Answer::Unanswered => Decision::Deny("Nobody answered in time.".into()),
            }
        }
    }
}

/// Starts a turn on the engine the request names. Returns once it is running; its events follow.
pub(crate) async fn start(app: &AppHandle, run_id: String, body: Value) -> Result<(), String> {
    let engine = body["engine"]["id"]
        .as_str()
        .and_then(EngineKind::from_id)
        .ok_or("That engine has no adapter.")?;
    let facts = RunFacts::of_request(&run_id, &body);
    let folder_text = body["engine"]["folder"].as_str().unwrap_or("").to_string();
    if folder_text.is_empty() {
        return Err(format!(
            "Link a project folder to this Space first, so {} has somewhere to work.",
            engine.name()
        ));
    }
    let folder = PathBuf::from(&folder_text);
    let db = app.state::<MistyRuntime>().environment.store();
    let conversation = body["conversation_id"].as_str().unwrap_or("").to_string();
    // The folder must be one the person linked themselves: a page can't point an engine elsewhere.
    let (linked, session) = {
        let (db, account, folder, conversation, folder_text) = (
            db.clone(),
            facts.account.clone(),
            folder.clone(),
            conversation.clone(),
            folder_text.clone(),
        );
        tokio::task::spawn_blocking(move || {
            // Multi-run: a worktree it made for this account counts too (multirun.rs). That
            // record is written only by native code, so a page still can't name a folder.
            let linked = store::is_linked(&db, &account, &folder).unwrap_or(false)
                || super::multirun::is_worktree(&db, &account, &folder);
            let session = store::session(&db, &account, &conversation, engine.id(), &folder_text);
            (linked, session)
        })
        .await
        .map_err(|error| error.to_string())?
    };
    if !linked || !file_access::fs::is_dir(&folder) {
        return Err("That folder isn't linked to a Space on this computer.".into());
    }
    let mode = if facts.planning {
        RunMode::Plan
    } else if facts.auto {
        RunMode::Auto
    } else {
        RunMode::Ask
    };
    let pick = |name: &str| {
        body["engine"][name]
            .as_str()
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    keep_request(&run_id, Some(body.clone()));
    let request = TurnRequest {
        folder,
        prompt: body["prompt"].as_str().unwrap_or("").to_string(),
        session: session.unwrap_or_default(),
        mode,
        model: pick("model"),
        effort: pick("effort"),
        // The Space's tools, for an engine that takes MCP servers on its command line.
        mcp_servers: super::mcp::servers_for(app, &run_id).await,
        images: turn::images_of(&body["attachments"]),
    };
    let (link, control, mut events) = turn::link();
    running().insert(run_id.clone(), control.clone());
    let app = app.clone();
    tokio::spawn(async move {
        let mut reporter = Reporter {
            app: app.clone(),
            run_id: run_id.clone(),
            sent: 0,
            answer: String::new(),
            thinking: false,
            started: HashMap::new(),
        };
        reporter.send(json!({ "type": "invocation.started", "state": "running" }));
        let stopped_check = control.clone();
        let work = tokio::spawn(engine.run(request, link));
        while let Some(event) = events.recv().await {
            match event {
                EngineEvent::Permission {
                    request,
                    tool,
                    input,
                } => {
                    reporter
                        .send(json!({ "type": "assistant.status", "phase": "awaiting_approval" }));
                    let decision = decide(&app, &facts, mode, &tool, &input).await;
                    control.answer(&request, decision);
                }
                EngineEvent::Session(session) => {
                    let (db, account, conversation, folder) = (
                        db.clone(),
                        facts.account.clone(),
                        conversation.clone(),
                        folder_text.clone(),
                    );
                    let _ = tokio::task::spawn_blocking(move || {
                        store::keep_session(
                            &db,
                            &account,
                            &conversation,
                            engine.id(),
                            &folder,
                            &session,
                        )
                    })
                    .await;
                }
                other => reporter.report(other),
            }
        }
        let outcome = work
            .await
            .unwrap_or_else(|_| Err(format!("{} stopped unexpectedly.", engine.name())));
        let stopped = {
            let mut held = running();
            held.remove(&run_id);
            drop(held);
            keep_request(&run_id, None);
            super::mcp::forget(&run_id);
            stopped_check.is_stopped()
        };
        reporter.finish(outcome, stopped);
    });
    Ok(())
}
