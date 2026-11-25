use std::collections::{HashMap, HashSet};
use std::sync::{Arc, LazyLock, Mutex, OnceLock};
use std::time::Instant;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::agents::run_control::local_runs::publish_native;

use super::support::event_sink::{Emit, ENGINE_EVENT_NAME};

#[path = "bridge_values.rs"]
mod values;

#[path = "bridge_tools.rs"]
mod tools;

#[path = "bridge_pictures.rs"]
mod pictures;

pub(crate) use tools::note_mcp_call;
use tools::{close_tool, detail, find_tool, start_tool, OpenTool};
pub(crate) use values::context_usage;
use values::{clip, question_cards, result_failed};

#[derive(Default)]
struct RunView {
    sent: u64,
    answer: String,
    thinking: bool,
    tools: Vec<OpenTool>,
    rows: u64,
    parent: Option<String>,
    session: Option<String>,
    began: Option<Instant>,
    model: Option<String>,
    sized: bool,
    ended: bool,
    pending: u64,
    warm: bool,
}

pub(crate) enum RunNote {
    Session(String),
    Ended,
    Parked,
    Warm,
    Resumed,
}

type Listener = Arc<dyn Fn(&str, RunNote) + Send + Sync>;

static RUNS: LazyLock<Mutex<HashMap<String, RunView>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static APP: OnceLock<AppHandle> = OnceLock::new();
static LISTENER: OnceLock<Listener> = OnceLock::new();

static ALIAS: LazyLock<Mutex<HashMap<String, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static PARKABLE: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));
type ParkedRuns = HashMap<String, (String, u64, u64)>;

static PARKED: LazyLock<Mutex<ParkedRuns>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn runs() -> std::sync::MutexGuard<'static, HashMap<String, RunView>> {
    RUNS.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn held<T>(lock: &'static LazyLock<Mutex<T>>) -> std::sync::MutexGuard<'static, T> {
    lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub(crate) fn chat_run_of(engine_run: &str) -> String {
    held(&ALIAS)
        .get(engine_run)
        .cloned()
        .unwrap_or_else(|| engine_run.to_string())
}

pub(crate) fn engine_run_of(chat_run: &str) -> String {
    held(&ALIAS)
        .iter()
        .find(|(_, chat)| chat.as_str() == chat_run)
        .map(|(engine, _)| engine.clone())
        .unwrap_or_else(|| chat_run.to_string())
}

pub(crate) fn redirect(engine_run: &str, chat_run: &str) {
    held(&ALIAS).insert(engine_run.to_string(), chat_run.to_string());
    let parked = held(&PARKED).remove(engine_run);
    if let Some((before, _, _)) = parked.as_ref() {
        if before != engine_run && before != chat_run {
            notify(before, RunNote::Ended);
        }
    }
    if let (Some((_, _, pending)), Some(view)) = (parked, runs().get_mut(chat_run)) {
        view.pending = pending;
    }
}

pub(crate) fn unredirect(engine_run: &str) {
    held(&ALIAS).remove(engine_run);
}

fn release(engine_run: &str) {
    let chat = held(&ALIAS).remove(engine_run);
    held(&PARKED).remove(engine_run);
    held(&PARKABLE).remove(engine_run);
    notify(engine_run, RunNote::Ended);
    if let Some(chat) = chat {
        notify(&chat, RunNote::Ended);
    }
}

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

pub(crate) struct Bridge;

impl Bridge {
    pub(crate) fn install(
        app: &AppHandle,
        listener: impl Fn(&str, RunNote) + Send + Sync + 'static,
    ) -> Arc<Self> {
        let _ = APP.set(app.clone());
        pictures::allow_pictures(app);
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

pub(crate) fn fail(run_id: &str, error: &str) {
    finish(run_id, Err(error.to_string()), false);
}

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
            let (mut used, window) = context_usage(data);
            if let Some(view) = runs().get_mut(run_id) {
                if data["used"].as_u64().is_some_and(|tokens| tokens > 0) {
                    view.sized = true;
                } else if view.sized && values::only_turn_total(data) {
                    used = None;
                }
            }
            let mut event = json!({ "type": "usage.updated", "used": used, "window": window });
            let number = |names: &[&str]| {
                names
                    .iter()
                    .find_map(|name| data.get(*name).and_then(Value::as_u64))
            };
            for (field, names) in values::USAGE_BUCKETS {
                if let Some(value) = number(names) {
                    event[field] = json!(value);
                }
            }
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
            if let Some(path) = data["path"]
                .as_str()
                .or_else(|| data["input"]["file_path"].as_str())
            {
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
        "session_title" => send_to(
            run_id,
            json!({ "type": "engine.title", "title": clip(data.as_str().unwrap_or(""), 200) }),
        ),
        "session_mode" => send_to(
            run_id,
            json!({ "type": "engine.mode", "mode": data, "engine": payload["engine"] }),
        ),
        "session_choice" => send_to(
            run_id,
            json!({ "type": "engine.choice", "model": data["model"], "effort": data["effort"] }),
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
        "process_closed" => finish(
            run_id,
            Err("The engine stopped before it answered.".to_string()),
            false,
        ),
        "turn_resumed" => send_to(
            run_id,
            json!({ "type": "assistant.status", "phase": "working" }),
        ),
        "done" => {
            if let Some(view) = runs().get_mut(run_id) {
                view.warm = data["warm"].as_bool() == Some(true);
            }
            finish(run_id, Ok(()), false)
        }
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

fn finish(run_id: &str, outcome: Result<(), String>, stopped: bool) {
    let (open, answer, sent, took, model, pending, warm) = {
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
            view.warm,
        )
    };
    let engine_run = engine_run_of(run_id);
    let parked = !stopped
        && outcome.is_ok()
        && (pending > 0 || warm)
        && held(&PARKABLE).contains(&engine_run);
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
        notify(
            run_id,
            if pending > 0 {
                RunNote::Parked
            } else {
                RunNote::Warm
            },
        );
    } else {
        notify(run_id, RunNote::Ended);
        release(&engine_run);
    }
}

#[cfg(test)]
#[path = "bridge_tests.rs"]
mod tests;
