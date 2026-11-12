//! The one bridge from the engine layer to the chat. desktop-cc-gui's dispatch writes each engine
//! event as a wire payload (`{runId, sessionId, engine, seq, kind, data}`); this turns them into
//! the run events Misty's own agent produces (`invocationEventTypes.ts`) and publishes them
//! through `local_runs.rs`, so one chat shows every engine. Only numbers, names and the engine's
//! own output leave native code; nothing here reaches a server.
//!
//! Anything that isn't an engine event (the history scan's progress, a sessions change) goes to
//! the windows as it is.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, LazyLock, Mutex, OnceLock};
use std::time::Instant;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::agents::run_control::local_runs::publish_native;

use super::support::event_sink::{Emit, ENGINE_EVENT_NAME};

#[path = "bridge_values.rs"]
mod values;

pub(crate) use values::context_usage;
use values::{clip, clip_value, output_text, question_cards, result_failed, summary};

/// A tool row that started and hasn't ended.
struct OpenTool {
    /// The engine's own id for the call, when it gave one.
    wire: Option<String>,
    name: String,
    /// The row's id in the chat.
    id: String,
    started: Instant,
}

/// What one run has shown so far.
#[derive(Default)]
struct RunView {
    sent: u64,
    /// The answer since the last tool row: what the chat shows as the reply when the turn ends.
    answer: String,
    thinking: bool,
    tools: Vec<OpenTool>,
    rows: u64,
    /// The engine sub-agent the next rows belong to (Claude Code's `parent_tool_use_id`).
    parent: Option<String>,
    /// The engine's session id, once it said.
    session: Option<String>,
    /// When the turn began and the model the engine said answered, for the run's details.
    began: Option<Instant>,
    model: Option<String>,
    ended: bool,
    /// Background tasks the engine still has running (Claude Code's `run_in_background`).
    pending: u64,
}

/// What the bridge tells the run's owner (`runs.rs`) as it happens.
pub(crate) enum RunNote {
    /// The engine's own session id for this chat, to continue it next time.
    Session(String),
    /// The turn ended, however it ended, and nothing of it runs on.
    Ended,
    /// The turn ended in the chat, but the engine's process lives on for a background task: the
    /// next message is written into it, or the engine's own follow-up turn reopens this one.
    Parked,
    /// A parked turn reopened for the engine's own follow-up turn.
    Resumed,
}

type Listener = Arc<dyn Fn(&str, RunNote) + Send + Sync>;

static RUNS: LazyLock<Mutex<HashMap<String, RunView>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static APP: OnceLock<AppHandle> = OnceLock::new();
static LISTENER: OnceLock<Listener> = OnceLock::new();

/// Follow-up parking (desktop-cc-gui's): a Claude Code process whose turn ended with a background
/// task still running stays alive, and the chat's next message is written into it instead of
/// starting a new one, which would stop the task. Its events keep the run id it was launched
/// with; this is which chat run shows them.
static ALIAS: LazyLock<Mutex<HashMap<String, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
/// Engine runs that may park.
static PARKABLE: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));
/// Parked engine runs: the chat run that last showed them, its event count and pending tasks.
static PARKED: LazyLock<Mutex<HashMap<String, (String, u64, u64)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn runs() -> std::sync::MutexGuard<'static, HashMap<String, RunView>> {
    RUNS.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn held<T>(lock: &'static LazyLock<Mutex<T>>) -> std::sync::MutexGuard<'static, T> {
    lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The chat run an engine run's events show under.
pub(crate) fn chat_run_of(engine_run: &str) -> String {
    held(&ALIAS)
        .get(engine_run)
        .cloned()
        .unwrap_or_else(|| engine_run.to_string())
}

/// The engine run (its process) behind a chat run.
pub(crate) fn engine_run_of(chat_run: &str) -> String {
    held(&ALIAS)
        .iter()
        .find(|(_, chat)| chat.as_str() == chat_run)
        .map(|(engine, _)| engine.clone())
        .unwrap_or_else(|| chat_run.to_string())
}

/// A parked engine run took the chat's next message: its events show under `chat_run` now.
pub(crate) fn redirect(engine_run: &str, chat_run: &str) {
    held(&ALIAS).insert(engine_run.to_string(), chat_run.to_string());
    let parked = held(&PARKED).remove(engine_run);
    if let (Some((_, _, pending)), Some(view)) = (parked, runs().get_mut(chat_run)) {
        view.pending = pending;
    }
}

/// The message couldn't be written after all; the chat run launches on its own.
pub(crate) fn unredirect(engine_run: &str) {
    held(&ALIAS).remove(engine_run);
}

/// An engine run is over for good: whatever it still held goes.
fn release(engine_run: &str) {
    let chat = held(&ALIAS).remove(engine_run);
    held(&PARKED).remove(engine_run);
    held(&PARKABLE).remove(engine_run);
    notify(engine_run, RunNote::Ended);
    if let Some(chat) = chat {
        notify(&chat, RunNote::Ended);
    }
}

/// The engine started a follow-up turn of its own in a parked process: the chat run that last
/// showed it opens again, and goes on from its last event.
fn reopen(engine_run: &str, chat_run: &str) -> bool {
    let Some((chat, sent, pending)) = held(&PARKED).remove(engine_run) else {
        return false;
    };
    if chat != chat_run {
        return false;
    }
    runs().insert(
        chat.clone(),
        RunView {
            sent,
            pending,
            began: Some(Instant::now()),
            ..RunView::default()
        },
    );
    notify(&chat, RunNote::Resumed);
    send_to(
        &chat,
        json!({ "type": "invocation.started", "state": "running" }),
    );
    true
}

/// The emitter the engine layer's sink writes to.
pub(crate) struct Bridge;

impl Bridge {
    pub(crate) fn install(
        app: &AppHandle,
        listener: impl Fn(&str, RunNote) + Send + Sync + 'static,
    ) -> Arc<Self> {
        let _ = APP.set(app.clone());
        let _ = LISTENER.set(Arc::new(listener));
        Arc::new(Self)
    }
}

impl Emit for Bridge {
    fn emit_json(&self, name: &str, raw_json: &str) {
        if name != ENGINE_EVENT_NAME {
            if let (Some(app), Ok(raw)) = (
                APP.get(),
                serde_json::value::RawValue::from_string(raw_json.to_string()),
            ) {
                let _ = app.emit(name, raw);
            }
            return;
        }
        let Ok(batch) = serde_json::from_str::<Vec<Value>>(raw_json) else {
            return;
        };
        for payload in batch {
            route(&payload);
        }
    }
}

/// Starts showing a run: its events from now on go to its chat. A `parkable` run (Claude Code in a
/// chat) may stay alive past its turn for a background task.
pub(crate) fn open(run_id: &str, parkable: bool) {
    if parkable {
        held(&PARKABLE).insert(run_id.to_string());
    }
    runs().insert(
        run_id.to_string(),
        RunView {
            began: Some(Instant::now()),
            ..RunView::default()
        },
    );
    send_to(
        run_id,
        json!({ "type": "invocation.started", "state": "running" }),
    );
}

/// Ends a run that never got going, or that the engine layer won't settle (a failed launch).
pub(crate) fn fail(run_id: &str, error: &str) {
    finish(run_id, Err(error.to_string()), false);
}

/// Ends a run the person stopped.
pub(crate) fn cancel(run_id: &str) {
    finish(run_id, Ok(()), true);
}

fn send_to(run_id: &str, event: Value) {
    let sent = {
        let mut held = runs();
        let Some(view) = held.get_mut(run_id) else {
            return;
        };
        view.sent += 1;
        view.sent
    };
    publish(run_id, sent, event);
}

fn publish(run_id: &str, sent: u64, mut event: Value) {
    let Some(app) = APP.get() else {
        return;
    };
    event["id"] = json!(format!("{run_id}:{sent}"));
    event["runId"] = json!(run_id);
    publish_native(app, run_id, &event);
}

fn notify(run_id: &str, note: RunNote) {
    if let Some(listener) = LISTENER.get() {
        listener(run_id, note);
    }
}

fn route(payload: &Value) {
    let Some(engine_run) = payload["runId"].as_str() else {
        return;
    };
    let kind = payload["kind"].as_str().unwrap_or("");
    let chat = chat_run_of(engine_run);
    let run_id = chat.as_str();
    if !runs().contains_key(run_id) {
        match kind {
            "turn_resumed" if reopen(engine_run, run_id) => {}
            // A parked process went away without another turn.
            "process_closed" => {
                release(engine_run);
                return;
            }
            _ => return,
        }
    }
    let data = &payload["data"];
    if let Some(session) = payload["sessionId"].as_str().filter(|id| !id.is_empty()) {
        adopt_session(run_id, session);
    }
    match kind {
        "delta" => delta(run_id, data.as_str().unwrap_or("")),
        "thinking" => thinking(run_id, data.as_str().unwrap_or("")),
        "message" => message(run_id, data),
        "session" => {
            if let Some(session) = data.as_str() {
                adopt_session(run_id, session);
            }
        }
        "scope" => {
            if let Some(view) = runs().get_mut(run_id) {
                view.parent = data["parent"].as_str().map(str::to_string);
            }
        }
        "usage" => {
            let (used, window) = context_usage(data);
            let mut event = json!({ "type": "usage.updated", "used": used, "window": window });
            let number = |names: &[&str]| names.iter().find_map(|name| data.get(*name).and_then(Value::as_u64));
            for (field, names) in [
                ("input", &["input_tokens", "inputTokens", "input"][..]),
                ("output", &["output_tokens", "outputTokens", "output"][..]),
                ("cacheRead", &["cache_read_input_tokens", "cachedInputTokens", "cacheRead"][..]),
                ("cacheWrite", &["cache_creation_input_tokens", "cacheWrite"][..]),
            ] {
                if let Some(value) = number(names) {
                    event[field] = json!(value);
                }
            }
            // OpenAI-style reports (Codex) count cached tokens inside the input; the buckets
            // sent on don't overlap.
            if let (Some(cached), Some(input)) = (
                number(&["cached_input_tokens"]),
                event.get("input").and_then(Value::as_u64),
            ) {
                event["cacheRead"] = json!(cached.min(input));
                event["input"] = json!(input.saturating_sub(cached));
            }
            if let Some(reasoning) = number(&[
                "reasoning_output_tokens",
                "reasoningOutputTokens",
                "thoughtTokens",
                "thought_tokens",
            ]) {
                event["reasoning"] = json!(reasoning);
            }
            if let Some(cost) = ["cost_usd", "total_cost_usd", "costUsd"]
                .iter()
                .find_map(|name| data.get(*name).and_then(Value::as_f64))
                .filter(|cost| cost.is_finite() && *cost >= 0.0)
            {
                event["costUsd"] = json!(cost);
            }
            let model = data["model"].as_str().map(str::to_string);
            if let Some(model) = &model {
                event["model"] = json!(model);
            }
            if let Some(view) = runs().get_mut(run_id) {
                if model.is_some() {
                    view.model = model;
                }
            }
            if used.is_some() || window.is_some() || event.get("input").is_some() {
                send_to(run_id, event);
            }
        }
        "warn" => send_to(
            run_id,
            json!({ "type": "assistant.status", "text": clip(data.as_str().unwrap_or(""), 300) }),
        ),
        "retry" => send_to(
            run_id,
            json!({
                "type": "engine.retry",
                "attempt": data["attempt"],
                "max": data["max"],
                "message": clip(data["message"].as_str().unwrap_or(""), 300),
            }),
        ),
        "compaction" => send_to(
            run_id,
            json!({ "type": "engine.compaction", "active": data["active"], "reason": data["reason"] }),
        ),
        "permission_denied" => {
            let tool = data["tool"].as_str().unwrap_or("");
            let message = data["message"].as_str().unwrap_or("");
            if let Some(wire) = data["toolUseId"].as_str() {
                close_tool(run_id, Some(wire), tool, Some(message.to_string()), None);
            }
            let text = if message.is_empty() {
                format!("{tool} was refused.")
            } else {
                message.to_string()
            };
            send_to(
                run_id,
                json!({ "type": "assistant.status", "text": clip(&text, 300) }),
            );
            let mut denied = json!({ "type": "permission.denied", "toolName": tool, "message": clip(&text, 600) });
            if let Some(wire) = data["toolUseId"].as_str() {
                denied["toolCallId"] = json!(wire);
            }
            if let Some(path) = data["path"].as_str().or_else(|| data["input"]["file_path"].as_str()) {
                denied["path"] = json!(path);
            }
            send_to(run_id, denied);
        }
        "question" => {
            let cards = question_cards(&data["input"]);
            send_to(
                run_id,
                json!({
                    "type": "engine.question",
                    "requestId": data["requestId"],
                    "toolCallId": data["toolUseId"],
                    "questions": cards,
                }),
            );
            send_to(
                run_id,
                json!({ "type": "assistant.status", "phase": "awaiting_input" }),
            );
        }
        "question_settled" => send_to(
            run_id,
            json!({ "type": "engine.question_settled", "requestId": data["requestId"] }),
        ),
        "plan_draft" => send_to(
            run_id,
            json!({
                "type": "engine.plan_draft",
                "planId": data["planId"],
                "text": data["text"],
                "replace": data["replace"],
            }),
        ),
        "plan_review" => send_to(
            run_id,
            json!({ "type": "engine.plan_review", "review": data }),
        ),
        "plan_review_settled" => send_to(
            run_id,
            json!({
                "type": "engine.plan_settled",
                "planId": data["planId"],
                "revision": data["revision"],
                "status": data["status"],
            }),
        ),
        "model" => {
            if let (Some(model), Some(view)) = (data.as_str(), runs().get_mut(run_id)) {
                view.model = Some(model.to_string());
            }
            send_to(run_id, json!({ "type": "engine.model", "model": data }))
        }
        "effort" => send_to(run_id, json!({ "type": "engine.model", "effort": data })),
        "served" => send_to(
            run_id,
            json!({ "type": "engine.model", "model": data["model"], "effort": data["effort"] }),
        ),
        "launch" => send_to(
            run_id,
            json!({ "type": "engine.model", "model": data["model"], "effort": data["effort"], "requested": true }),
        ),
        "background_tasks" => {
            if let Some(view) = runs().get_mut(run_id) {
                view.pending = data["pending"].as_u64().unwrap_or(0);
            }
            send_to(
                run_id,
                json!({ "type": "engine.background", "pending": data["pending"] }),
            )
        }
        // The process ended while a message written into it waited for its answer.
        "process_closed" => finish(
            run_id,
            Err("The engine stopped before it answered.".to_string()),
            false,
        ),
        "turn_resumed" => send_to(
            run_id,
            json!({ "type": "assistant.status", "phase": "working" }),
        ),
        "done" => finish(run_id, Ok(()), false),
        "error" => finish(
            run_id,
            Err(data.as_str().unwrap_or("The engine failed.").to_string()),
            false,
        ),
        _ => {}
    }
}

fn adopt_session(run_id: &str, session: &str) {
    let changed = {
        let mut held = runs();
        let Some(view) = held.get_mut(run_id) else {
            return;
        };
        if view.session.as_deref() == Some(session) {
            false
        } else {
            view.session = Some(session.to_string());
            true
        }
    };
    if changed {
        notify(run_id, RunNote::Session(session.to_string()));
    }
}

fn delta(run_id: &str, text: &str) {
    if text.is_empty() {
        return;
    }
    if let Some(view) = runs().get_mut(run_id) {
        view.thinking = false;
        view.answer.push_str(text);
    }
    send_to(run_id, json!({ "type": "response.delta", "delta": text }));
}

fn thinking(run_id: &str, text: &str) {
    if text.is_empty() {
        return;
    }
    let first = {
        let mut held = runs();
        let Some(view) = held.get_mut(run_id) else {
            return;
        };
        !std::mem::replace(&mut view.thinking, true)
    };
    if first {
        send_to(
            run_id,
            json!({ "type": "assistant.status", "phase": "thinking" }),
        );
    }
    send_to(run_id, json!({ "type": "thinking.delta", "delta": text }));
}

fn message(run_id: &str, data: &Value) {
    let role = data["role"].as_str().unwrap_or("");
    if role == "assistant" {
        // A whole message from an engine that doesn't stream (or a snapshot of what it already
        // streamed, which the engine layer leaves out).
        let text = data["text"].as_str().unwrap_or("");
        if !text.trim().is_empty() {
            let separated = runs()
                .get(run_id)
                .is_some_and(|view| !view.answer.is_empty() && !view.answer.ends_with('\n'));
            delta(
                run_id,
                &if separated {
                    format!("\n\n{text}")
                } else {
                    text.to_string()
                },
            );
        }
        return;
    }
    if role != "tool" {
        return;
    }
    let name = data["text"].as_str().unwrap_or("tool").to_string();
    let wire = data["toolCallId"].as_str().map(str::to_string);
    if let Some(todos) = data.get("todos").filter(|todos| todos.is_object()) {
        send_to(
            run_id,
            json!({ "type": "engine.todos", "items": todos["items"], "replace": todos["replace"] }),
        );
    }
    let patch = data["patch"].as_bool() == Some(true);
    match (patch, data.get("result")) {
        (false, _) => start_tool(run_id, wire, &name, data.get("args")),
        (true, None) | (true, Some(Value::Null)) => {
            if let Some(args) = data.get("args") {
                let id = runs().get(run_id).and_then(|view| {
                    find_tool(view, wire.as_deref(), &name)
                        .map(|index| view.tools[index].id.clone())
                });
                match id {
                    Some(id) => detail(run_id, &id, &name, args),
                    // An argument patch for a row that never opened (a resumed stream).
                    None => start_tool(run_id, wire, &name, Some(args)),
                }
            }
        }
        (true, Some(result)) => {
            let failed = result_failed(result);
            close_tool(run_id, wire.as_deref(), &name, failed, Some(result));
        }
    }
}

fn find_tool(view: &RunView, wire: Option<&str>, name: &str) -> Option<usize> {
    if let Some(wire) = wire {
        if let Some(index) = view
            .tools
            .iter()
            .position(|tool| tool.wire.as_deref() == Some(wire))
        {
            return Some(index);
        }
    }
    view.tools
        .iter()
        .position(|tool| tool.name == name || name.is_empty())
}

fn start_tool(run_id: &str, wire: Option<String>, name: &str, args: Option<&Value>) {
    let (id, parent) = {
        let mut held = runs();
        let Some(view) = held.get_mut(run_id) else {
            return;
        };
        view.rows += 1;
        view.thinking = false;
        let id = wire
            .clone()
            .unwrap_or_else(|| format!("{run_id}-tool-{}", view.rows));
        view.tools.push(OpenTool {
            wire,
            name: name.to_string(),
            id: id.clone(),
            started: Instant::now(),
        });
        // The chat turns what was said so far into a note above the tool's row.
        view.answer.clear();
        (id, view.parent.clone())
    };
    let mut event = json!({ "type": "tool.started", "toolCallId": id, "toolName": name });
    if let Some(parent) = parent {
        event["parentToolCallId"] = json!(parent);
    }
    if let Some(args) = args {
        event["args"] = clip_value(args);
        if let Some(path) = ["file_path", "path", "notebook_path"].iter().find_map(|k| args[*k].as_str()) {
            event["path"] = json!(path);
        }
    }
    send_to(run_id, event);
    if let Some(args) = args {
        detail(run_id, &id, name, args);
    }
}

fn detail(run_id: &str, id: &str, name: &str, args: &Value) {
    let line = summary(args);
    let mut activity = json!({ "input": args });
    if !line.is_empty() {
        activity["detail"] = json!(line);
    }
    send_to(
        run_id,
        json!({ "type": "tool.detail", "toolCallId": id, "toolName": name, "activity": activity }),
    );
}

fn close_tool(
    run_id: &str,
    wire: Option<&str>,
    name: &str,
    failed: Option<String>,
    result: Option<&Value>,
) {
    let closed = {
        let mut held = runs();
        let Some(view) = held.get_mut(run_id) else {
            return;
        };
        find_tool(view, wire, name).map(|index| view.tools.remove(index))
    };
    let Some(tool) = closed else {
        return;
    };
    let took = tool.started.elapsed().as_millis() as u64;
    match failed {
        Some(error) => send_to(
            run_id,
            json!({
                "type": "tool.failed",
                "toolCallId": tool.id,
                "toolName": tool.name,
                "durationMs": took,
                "error": error,
                "result": result.map(clip_value),
            }),
        ),
        None => send_to(
            run_id,
            json!({
                "type": "tool.completed",
                "toolCallId": tool.id,
                "toolName": tool.name,
                "durationMs": took,
                "result": result.map(clip_value),
            }),
        ),
    }
    if let Some(result) = result {
        let text = output_text(result);
        if !text.is_empty() {
            send_to(
                run_id,
                json!({
                    "type": "tool.detail",
                    "toolCallId": tool.id,
                    "toolName": tool.name,
                    "activity": { "output": text },
                }),
            );
        }
    }
}

/// Settles the run in the chat, once: open tool rows end, the reply is set, and the run ends as
/// finished, failed or stopped.
fn finish(run_id: &str, outcome: Result<(), String>, stopped: bool) {
    let (open, answer, sent, took, model, pending) = {
        let mut held = runs();
        let Some(view) = held.get_mut(run_id) else {
            return;
        };
        if view.ended {
            return;
        }
        view.ended = true;
        (
            std::mem::take(&mut view.tools),
            view.answer.trim().to_string(),
            view.sent,
            view.began.map(|began| began.elapsed().as_millis() as u64),
            view.model.clone(),
            view.pending,
        )
    };
    let engine_run = engine_run_of(run_id);
    // The engine layer keeps the process for the background task's follow-up turn.
    let parked =
        !stopped && outcome.is_ok() && pending > 0 && held(&PARKABLE).contains(&engine_run);
    let mut sent = sent;
    let mut next = |event: Value| {
        sent += 1;
        publish(run_id, sent, event);
    };
    for tool in open {
        next(json!({
            "type": if stopped || outcome.is_err() { "tool.failed" } else { "tool.completed" },
            "toolCallId": tool.id,
            "toolName": tool.name,
            "durationMs": tool.started.elapsed().as_millis() as u64,
        }));
    }
    if stopped {
        next(json!({ "type": "invocation.canceled", "state": "canceled" }));
    } else {
        match &outcome {
            Ok(()) => {
                next(
                    json!({ "type": "assistant.message", "text": answer, "summary": clip(&answer, 200) }),
                );
                next(json!({
                    "type": "invocation.completed",
                    "state": "completed",
                    "durationMs": took,
                    "model": model,
                }));
            }
            Err(error) => next(json!({
                "type": "invocation.failed",
                "state": "failed",
                "error": clip(error, 1200),
            })),
        }
    }
    runs().remove(run_id);
    if parked {
        held(&PARKED).insert(engine_run, (run_id.to_string(), sent, pending));
        notify(run_id, RunNote::Parked);
    } else {
        notify(run_id, RunNote::Ended);
        release(&engine_run);
    }
}

#[cfg(test)]
#[path = "bridge_tests.rs"]
mod tests;
