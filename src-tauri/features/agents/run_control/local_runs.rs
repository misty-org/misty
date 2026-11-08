//! Runs started on this computer, with no server behind them. The
//! app starts and follows them here. Their events reach the windows of the account they belong to, and
//! are kept while the app is open so a window that reloads can catch up on a run in progress.
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

/// Runs whose events are kept, oldest forgotten first.
const KEPT_RUNS: usize = 64;
/// A long run streams many small deltas. Past this its oldest events go, never its newest.
const KEPT_EVENTS: usize = 20_000;

const TERMINAL: [&str; 3] = [
    "invocation.completed",
    "invocation.failed",
    "invocation.canceled",
];

#[derive(Default)]
struct Log {
    events: HashMap<String, Vec<Value>>,
    /// Whose each run is, kept after its request is gone.
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

/// How the run's kept events say it ended, if they do.
fn ended_state(events: &[Value]) -> Option<&str> {
    events.iter().rev().find_map(|event| {
        let kind = event.get("type")?.as_str()?;
        TERMINAL
            .contains(&kind)
            .then(|| event.get("state")?.as_str())?
    })
}

/// A run whose answer is being turned into a proposal has stopped in the crate and not yet ended.
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

/// Whether a run began a write and nobody saw it end, or it ended uncertain.
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
    // A journal that can't be read says nothing is known, the safe reading.
    check().unwrap_or(true)
}

/// Whose this run is. A run nobody can place reads as nobody's, and reaches only windows that ask.
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

/// Keeps an event and tells the run's account's windows.
pub(crate) fn publish_native(app: &AppHandle, run_id: &str, event: &Value) {
    keep(run_id, event);
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

/// A window of the run's own account, or of a run nobody can place.
fn window_of_run(webview: &Webview, run_id: &str) -> Result<(), String> {
    person_window(webview)?;
    match (account_of_run(run_id), account_of_window(webview.label())) {
        (Some(run), Some(window)) if run != window => {
            Err("That run belongs to another account.".into())
        }
        _ => Ok(()),
    }
}

/// What a window may say about a run: never how it ended, and never a card, which native code raises
/// itself from what it holds.
fn publishable(kind: &str) -> bool {
    !kind.starts_with("invocation.") && !kind.starts_with("app.")
}

/// How a run whose answer became a proposal ends, once the app has built it. It says only what a run
/// stopped in the crate and waiting for its proposal may say.
fn may_end_proposal(events: &[Value], kind: &str) -> bool {
    matches!(kind, "invocation.completed" | "invocation.failed")
        && events
            .iter()
            .any(|event| event["type"] == "local.artifact_answer")
        && ended_state(events).is_none()
}

/// Starts a run. A repeat with the same `run_id` while it's going changes nothing.
#[tauri::command]
pub async fn agent_run_start(
    app: AppHandle,
    webview: Webview,
    run_id: String,
    body: Value,
) -> Result<(), String> {
    person_window(&webview)?;
    // A run that has spoken already started once: this launch never starts it again.
    if log().events.contains_key(&run_id) {
        return Ok(());
    }
    if let Some(account) = body["account"].as_str() {
        note_window(webview.label(), account);
        log().accounts.insert(run_id.clone(), account.to_owned());
    }
    let running = super::ensure(&app).await?;
    super::contained(async move { running.runtime.start_local(&run_id, body).await })
        .await?
        .map_err(|error| error.code().to_owned())
}

/// The person wrote to a run in progress: the id its message goes by, or nothing when it has stopped
/// listening.
#[tauri::command]
pub async fn agent_run_steer(
    app: AppHandle,
    webview: Webview,
    run_id: String,
    text: String,
) -> Result<Option<String>, String> {
    window_of_run(&webview, &run_id)?;
    Ok(super::ensure(&app)
        .await?
        .runtime
        .steer_local(&run_id, &text))
}

/// The person took the run's window, or gave it back.
#[tauri::command]
pub async fn agent_run_pause(
    app: AppHandle,
    webview: Webview,
    run_id: String,
    paused: bool,
) -> Result<bool, String> {
    window_of_run(&webview, &run_id)?;
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
    super::ensure(&app)
        .await?
        .runtime
        .cancel_local(&run_id)
        .map_err(|error| error.code().to_owned())
}

/// The tools a run with this request would be offered, for what the app checks before it starts one.
#[tauri::command]
pub async fn agent_run_tools(
    app: AppHandle,
    webview: Webview,
    body: Value,
) -> Result<Vec<String>, String> {
    person_window(&webview)?;
    Ok(super::ensure(&app).await?.runtime.local_tool_names(&body))
}

/// What these earlier runs wrote, newest first, so the next turn can check before repeating one.
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

/// A tab joined the run: its tools come from the request's contexts, so they're listed from now on.
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

/// An event a window raised for a run, such as a plan it proposed, kept with the run's own so a window
/// that reloads sees it too.
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

/// Ends a run whose answer became a proposal. It takes a run that's waiting for exactly this.
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
    let live = super::ensure(app).await?.runtime.local_run_live(run_id);
    let events = log().events.get(run_id).cloned().unwrap_or_default();
    let state = follow_state(&events, live);
    Ok(RunFollow { state, events })
}

/// What a window needs to pick a run back up: its state and what it has said so far. `state_only`
/// leaves the events out, for a window that only checks whether a long run is still going.
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
mod tests {
    use super::*;

    fn journal() -> (tempfile::TempDir, Store) {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::at(directory.path().join("misty.db"));
        store.connect().unwrap();
        (directory, store)
    }

    fn write(store: &Store, call: &str, outcome: Option<&str>) {
        store
            .connect()
            .unwrap()
            .execute(
                "INSERT INTO agent_tool_journal (run_id, call_id, name, outcome, updated_at)
                 VALUES ('r', ?1, 'browser.run', ?2, 0)",
                rusqlite::params![call, outcome],
            )
            .unwrap();
    }

    #[test]
    fn a_run_with_only_settled_calls_is_confirmed() {
        let (_directory, store) = journal();
        assert!(!has_unconfirmed(&store, "r"));
        write(&store, "a", Some(r#"{"result":{"ok":true}}"#));
        write(&store, "b", Some(r#"{"code":"x","message":"m"}"#));
        assert!(!has_unconfirmed(&store, "r"));
    }

    #[test]
    fn a_write_nobody_saw_end_or_that_ended_uncertain_is_not() {
        let (_directory, store) = journal();
        write(&store, "a", None);
        assert!(has_unconfirmed(&store, "r"));
        let (_other, store) = journal();
        write(
            &store,
            "a",
            Some(r#"{"result":{"status":"uncertain","message":"m"}}"#),
        );
        assert!(has_unconfirmed(&store, "r"));
    }

    #[test]
    fn a_run_being_proposed_is_still_going_and_one_nobody_knows_is_missing() {
        let answer = [json!({ "type": "local.artifact_answer", "text": "{}" })];
        assert_eq!(follow_state(&answer, false), "running");
        assert_eq!(follow_state(&[], true), "running");
        assert_eq!(follow_state(&[], false), "missing");
        let ended = [
            answer[0].clone(),
            json!({ "type": "invocation.completed", "state": "completed" }),
        ];
        assert_eq!(follow_state(&ended, false), "completed");
    }

    #[test]
    fn a_window_cannot_end_a_run_or_raise_a_card() {
        for kind in [
            "invocation.completed",
            "invocation.failed",
            "invocation.canceled",
            "app.request",
        ] {
            assert!(!publishable(kind), "{kind}");
        }
        for kind in [
            "screen.request",
            "plan.proposed",
            "assistant.message",
            "artifact.proposed",
        ] {
            assert!(publishable(kind), "{kind}");
        }
    }

    #[test]
    fn only_a_run_waiting_for_its_proposal_can_be_ended_by_it() {
        let waiting = [json!({ "type": "local.artifact_answer", "text": "{}" })];
        assert!(may_end_proposal(&waiting, "invocation.completed"));
        assert!(may_end_proposal(&waiting, "invocation.failed"));
        assert!(!may_end_proposal(&waiting, "invocation.canceled"));
        assert!(!may_end_proposal(
            &[json!({ "type": "response.delta" })],
            "invocation.completed"
        ));
        let ended = [
            waiting[0].clone(),
            json!({ "type": "invocation.completed", "state": "completed" }),
        ];
        assert!(!may_end_proposal(&ended, "invocation.failed"));
    }

    #[test]
    fn events_say_how_a_run_ended_and_are_kept_per_run() {
        keep("kept", &json!({ "type": "response.delta", "delta": "Hi" }));
        assert_eq!(ended_state(log().events.get("kept").unwrap()), None);
        keep(
            "kept",
            &json!({ "type": "invocation.completed", "state": "completed" }),
        );
        assert_eq!(
            ended_state(log().events.get("kept").unwrap()),
            Some("completed")
        );
        assert!(!log().events.contains_key("other"));
    }
}
