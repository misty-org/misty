use std::{
    collections::{HashMap, VecDeque},
    sync::{Mutex, MutexGuard, OnceLock, PoisonError},
};

use agent_runs::local_run::LocalRunHost;
use futures_util::future::BoxFuture;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Webview};

use super::windows::{account_of_window, emit_to_account, note_window};
use database::store::Store;

const KEPT_RUNS: usize = 64;
const KEPT_EVENTS: usize = 20_000;

const TERMINAL: [&str; 3] = [
    "invocation.completed",
    "invocation.failed",
    "invocation.canceled",
];

#[derive(Default)]
struct Log {
    events: HashMap<String, Vec<Value>>,
    accounts: HashMap<String, String>,
    order: VecDeque<String>,
}

fn log() -> MutexGuard<'static, Log> {
    static LOG: OnceLock<Mutex<Log>> = OnceLock::new();
    LOG.get_or_init(Default::default)
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
}

fn keep(run_id: &str, event: &Value) {
    let mut log = log();
    if !log.events.contains_key(run_id) {
        log.order.push_back(run_id.to_owned());
        while log.order.len() > KEPT_RUNS {
            if let Some(oldest) = log.order.pop_front() {
                log.events.remove(&oldest);
                log.accounts.remove(&oldest);
            }
        }
    }
    let events = log.events.entry(run_id.to_owned()).or_default();
    events.push(event.clone());
    if events.len() > KEPT_EVENTS {
        events.drain(..events.len() - KEPT_EVENTS);
    }
}

fn ended_state(events: &[Value]) -> Option<&str> {
    events.iter().rev().find_map(|event| {
        let kind = event.get("type")?.as_str()?;
        TERMINAL
            .contains(&kind)
            .then(|| event.get("state")?.as_str())?
    })
}

fn follow_state(events: &[Value], live: bool) -> String {
    let proposing = || {
        events
            .iter()
            .any(|event| event["type"] == "local.artifact_answer")
    };
    match ended_state(events) {
        Some(state) => state.to_owned(),
        None if live || proposing() => "running".to_owned(),
        None => "missing".to_owned(),
    }
}

pub(super) fn is_going(run_id: &str) -> bool {
    crate::engines::runs::is_live(run_id)
        || super::current().is_some_and(|running| running.runtime.local_run_live(run_id))
}

pub(super) fn has_unconfirmed(store: &Store, run_id: &str) -> bool {
    let check = || -> rusqlite::Result<bool> {
        let connection = store.connect()?;
        let mut statement =
            connection.prepare("SELECT outcome FROM agent_tool_journal WHERE run_id = ?1")?;
        let outcomes = statement
            .query_map([run_id], |row| row.get::<_, Option<String>>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(outcomes.iter().any(|outcome| match outcome {
            None => true,
            Some(text) => serde_json::from_str::<Value>(text)
                .ok()
                .is_some_and(|value| value["result"]["status"] == "uncertain"),
        }))
    };
    check().unwrap_or(true)
}

fn account_of_run(run_id: &str) -> Option<String> {
    if let Some(account) = log().accounts.get(run_id) {
        return Some(account.clone());
    }
    let account = super::current()?.runtime.local_request(run_id)?["account"]
        .as_str()?
        .to_owned();
    log().accounts.insert(run_id.to_owned(), account.clone());
    Some(account)
}

pub(crate) fn publish_native(app: &AppHandle, run_id: &str, event: &Value) {
    keep(run_id, event);
    super::run_ledger::note_event(app, run_id, event);
    super::turn_rewind::after_run(app, run_id, event);
    emit_to_account(
        app,
        &account_of_run(run_id).unwrap_or_default(),
        "misty://agent-run-event",
        json!({ "runId": run_id, "from": "native", "event": event }),
    );
}

pub(super) struct AppRunHost {
    pub(super) app: AppHandle,
}

impl LocalRunHost for AppRunHost {
    fn publish(&self, run_id: &str, event: Value) {
        publish_native(&self.app, run_id, &event);
    }

    fn has_unconfirmed_effects<'a>(&'a self, run_id: &'a str) -> BoxFuture<'a, bool> {
        Box::pin(async move {
            let store = self
                .app
                .state::<crate::app::runtime::MistyRuntime>()
                .environment
                .store();
            let run_id = run_id.to_owned();
            tokio::task::spawn_blocking(move || has_unconfirmed(&store, &run_id))
                .await
                .unwrap_or(true)
        })
    }
}

fn person_window(webview: &Webview) -> Result<(), String> {
    if crate::browser::app_windows::is_person_window(webview.label()) {
        Ok(())
    } else {
        Err("Only a profile's window can run agents.".into())
    }
}

pub(super) fn window_of_run(webview: &Webview, run_id: &str) -> Result<(), String> {
    person_window(webview)?;
    match (account_of_run(run_id), account_of_window(webview.label())) {
        (Some(run), Some(window)) if run != window => {
            Err("That run belongs to another account.".into())
        }
        _ => Ok(()),
    }
}

fn publishable(kind: &str) -> bool {
    !kind.starts_with("invocation.") && !kind.starts_with("app.")
}

fn may_end_proposal(events: &[Value], kind: &str) -> bool {
    matches!(kind, "invocation.completed" | "invocation.failed")
        && events
            .iter()
            .any(|event| event["type"] == "local.artifact_answer")
        && ended_state(events).is_none()
}

#[tauri::command]
pub async fn agent_run_start(
    app: AppHandle,
    webview: Webview,
    run_id: String,
    body: Value,
) -> Result<(), String> {
    person_window(&webview)?;
    if log().events.contains_key(&run_id) {
        return Ok(());
    }
    if let Some(account) = body["account"].as_str() {
        note_window(webview.label(), account);
        log().accounts.insert(run_id.clone(), account.to_owned());
    }
    super::run_ledger::note_start(&app, &run_id, &body);
    super::turn_rewind::before_run(&app, &run_id, &body).await;
    let started = if crate::engines::runs::wants(&body) {
        crate::engines::runs::start(&app, run_id.clone(), body).await
    } else {
        Err("Pick a default engine in Settings › Agents.".to_owned())
    };
    if started.is_err() {
        super::run_ledger::note_event(&app, &run_id, &json!({ "type": "invocation.failed" }));
    }
    started
}

#[tauri::command]
pub async fn agent_run_warm_up(
    app: AppHandle,
    webview: Webview,
    run_id: String,
    body: Value,
) -> Result<(), String> {
    person_window(&webview)?;
    if !crate::engines::runs::wants(&body) {
        return Ok(());
    }
    crate::engines::runs::warm_up(&app, run_id, body).await
}

#[allow(dead_code)]
async fn start_on_runtime(app: &AppHandle, run_id: String, body: Value) -> Result<(), String> {
    let running = super::ensure(app).await?;
    super::contained(async move { running.runtime.start_local(&run_id, body).await })
        .await?
        .map_err(|error| error.code().to_owned())
}

#[tauri::command]
pub async fn agent_run_steer(
    app: AppHandle,
    webview: Webview,
    run_id: String,
    text: String,
) -> Result<Option<String>, String> {
    window_of_run(&webview, &run_id)?;
    if crate::engines::runs::is_live(&run_id) {
        return Ok(None);
    }
    Ok(super::ensure(&app)
        .await?
        .runtime
        .steer_local(&run_id, &text))
}

#[tauri::command]
pub async fn agent_run_pause(
    app: AppHandle,
    webview: Webview,
    run_id: String,
    paused: bool,
) -> Result<bool, String> {
    window_of_run(&webview, &run_id)?;
    if !paused {
        super::take_over::release(&run_id);
    }
    if crate::engines::runs::is_live(&run_id) {
        super::take_over::hold(&run_id, paused);
        return Ok(true);
    }
    Ok(super::ensure(&app)
        .await?
        .runtime
        .pause_local(&run_id, paused))
}

#[tauri::command]
pub async fn agent_run_cancel(
    app: AppHandle,
    webview: Webview,
    run_id: String,
) -> Result<(), String> {
    window_of_run(&webview, &run_id)?;
    if crate::engines::runs::cancel(&run_id) {
        return Ok(());
    }
    super::ensure(&app)
        .await?
        .runtime
        .cancel_local(&run_id)
        .map_err(|error| error.code().to_owned())
}

#[tauri::command]
pub async fn agent_run_receipts(
    app: AppHandle,
    webview: Webview,
    run_ids: Vec<String>,
) -> Result<Vec<Value>, String> {
    person_window(&webview)?;
    let store = app
        .state::<crate::app::runtime::MistyRuntime>()
        .environment
        .store();
    let account = account_of_window(webview.label()).unwrap_or_default();
    tokio::task::spawn_blocking(move || {
        super::tool_journal::write_receipts(&store, &account, &run_ids)
    })
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn agent_run_contexts(
    app: AppHandle,
    webview: Webview,
    run_id: String,
    contexts: Value,
) -> Result<(), String> {
    window_of_run(&webview, &run_id)?;
    super::ensure(&app)
        .await?
        .runtime
        .update_local_contexts(&run_id, contexts)
        .map_err(|error| error.code().to_owned())
}

#[tauri::command]
pub fn agent_run_publish(
    app: AppHandle,
    webview: Webview,
    run_id: String,
    event: Value,
) -> Result<(), String> {
    window_of_run(&webview, &run_id)?;
    if !publishable(event["type"].as_str().unwrap_or("")) {
        return Err("A window can't say that about a run.".into());
    }
    keep(&run_id, &event);
    let account = account_of_run(&run_id)
        .or_else(|| account_of_window(webview.label()))
        .unwrap_or_default();
    emit_to_account(
        &app,
        &account,
        "misty://agent-run-event",
        json!({ "runId": run_id, "from": webview.label(), "event": event }),
    );
    Ok(())
}

#[tauri::command]
pub fn agent_run_end_proposal(
    app: AppHandle,
    webview: Webview,
    run_id: String,
    event: Value,
) -> Result<(), String> {
    window_of_run(&webview, &run_id)?;
    let known = log().events.get(&run_id).cloned().unwrap_or_default();
    if !may_end_proposal(&known, event["type"].as_str().unwrap_or("")) {
        return Err("That run isn't waiting for a proposal.".into());
    }
    publish_native(&app, &run_id, &event);
    Ok(())
}

#[derive(Serialize)]
pub struct RunFollow {
    state: String,
    events: Vec<Value>,
}

pub(crate) async fn read_follow(app: &AppHandle, run_id: &str) -> Result<RunFollow, String> {
    let live = crate::engines::runs::is_live(run_id)
        || super::ensure(app).await?.runtime.local_run_live(run_id);
    let events = log().events.get(run_id).cloned().unwrap_or_default();
    let state = follow_state(&events, live);
    Ok(RunFollow { state, events })
}

#[tauri::command]
pub async fn agent_run_follow(
    app: AppHandle,
    webview: Webview,
    run_id: String,
    state_only: Option<bool>,
) -> Result<RunFollow, String> {
    window_of_run(&webview, &run_id)?;
    let mut follow = read_follow(&app, &run_id).await?;
    if state_only == Some(true) {
        follow.events.clear();
    }
    Ok(follow)
}

#[cfg(debug_assertions)]
pub(crate) async fn cancel_run(app: &AppHandle, run_id: &str) -> Result<(), String> {
    super::ensure(app)
        .await?
        .runtime
        .cancel_local(run_id)
        .map_err(|error| error.code().to_owned())
}

#[cfg(test)]
#[path = "local_runs_tests.rs"]
mod tests;
