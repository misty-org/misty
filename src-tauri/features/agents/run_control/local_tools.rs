use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock, PoisonError},
    time::Duration,
};

use agent_runs::local_tools::{LocalToolCall, LocalToolHost, LocalToolOutcome};
use futures_util::future::BoxFuture;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;

use super::{
    tool_gate::{self, Admission},
    tool_journal::{Begun, ToolJournal},
    tool_policy::RunFacts,
    untrusted::marked,
};
use database::store::Store;

const CALL_LIMIT: Duration = Duration::from_secs(20 * 60);
const HOST_WAIT: Duration = Duration::from_secs(90);
const HOST_CHECK: Duration = Duration::from_millis(100);
const RECEIPT_LIMIT: Duration = Duration::from_secs(5);

const LOCAL_TOOLS: &[&str] = &[
    "agent.configure",
    "agent.delegate",
    "agent.list",
    "agent.wait",
    "browser.act",
    "browser.downloads.list",
    "browser.extract",
    "browser.fill_form",
    "browser.find",
    "browser.inspect",
    "browser.navigate",
    "browser.request_user_action",
    "browser.run",
    "browser.skill",
    "browser.snapshot",
    "browser.steps",
    "browser.tab.list",
    "browser.tab.use",
    "browser.upload",
    "browser.visual",
    "browser.wait_for",
    "browser.workspace.visual",
    "conversation.ask_user",
    "file.create",
    "file.promote_attachment",
    "file.read",
    "file.search",
    "file.update",
    "file.upload",
    "files.copy",
    "files.create_folder",
    "files.delete",
    "files.extract",
    "files.info",
    "files.list",
    "files.move",
    "files.read",
    "files.rename",
    "files.reveal",
    "files.search",
    "files.tag",
    "files.trash",
    "files.zip",
    "folder.list",
    "folder.read",
    "folder.send",
    "integration.connect",
    "integration.connected",
    "integration.execute",
    "integration.schemas",
    "integration.search",
    "item.delete",
    "item.rename",
    "log.work.checklist",
    "log.work.read",
    "log.work.write",
    "memory.edit",
    "memory.forget",
    "memory.read",
    "memory.write",
    "message.search",
    "message.send",
    "plan.propose",
    "plan.update",
    "screen.close",
    "screen.look",
    "screen.open",
    "search.all",
    "shell.run",
    "space.claims",
    "space.list",
    "space.manage",
    "space.member.list",
    "space.member.resolve",
    "thread.create",
    "thread.list",
    "thread.post",
    "thread.read",
    "media.fetch",
];

pub(super) const READ_ONLY: &[&str] = &[
    "browser.snapshot",
    "browser.find",
    "browser.extract",
    "browser.wait_for",
    "browser.inspect",
    "browser.visual",
    "browser.downloads.list",
    "browser.tab.list",
    "browser.workspace.visual",
    "folder.list",
    "folder.read",
    "log.work.read",
    "integration.search",
    "integration.schemas",
    "integration.connected",
    "integration.connect",
    "browser.request_user_action",
    "screen.look",
    "agent.list",
    "agent.wait",
    "memory.read",
    "space.claims",
    "space.list",
    "space.member.list",
    "space.member.resolve",
    "file.read",
    "file.search",
    "files.info",
    "files.list",
    "files.read",
    "files.reveal",
    "files.search",
    "message.search",
    "search.all",
    "thread.list",
    "thread.read",
];

#[derive(Debug, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum Answer {
    Done { result: Value },
    Failed { code: String, message: String },
    Uncertain { message: String },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum Receipt {
    Received,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum Reply {
    Received(Receipt),
    Answer(Answer),
}

#[derive(Clone, Debug, Serialize)]
struct Asked<'a> {
    id: &'a str,
    run_id: &'a str,
    call_id: &'a str,
    name: &'a str,
    input: &'a Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    instance: Option<&'a str>,
}

struct PendingCall {
    send: oneshot::Sender<Answer>,
    replay: Option<Value>,
    label: String,
    routed: bool,
    received: bool,
}

fn pending() -> &'static Mutex<HashMap<String, PendingCall>> {
    static PENDING: OnceLock<Mutex<HashMap<String, PendingCall>>> = OnceLock::new();
    PENDING.get_or_init(Default::default)
}

fn repeats_safely(name: &str) -> bool {
    READ_ONLY.contains(&name) || name == "agent.delegate" || crate::apps::mcp::is_read_only(name)
}

fn after_page_load(calls: &mut HashMap<String, PendingCall>, label: &str) -> Vec<Value> {
    calls.retain(|_, call| call.routed || call.replay.is_some());
    calls
        .values_mut()
        .filter(|call| !call.routed)
        .filter_map(|call| {
            call.label = label.to_owned();
            call.replay.clone()
        })
        .collect()
}

fn take_routed(calls: &mut HashMap<String, PendingCall>, label: &str) -> Vec<PendingCall> {
    let ids: Vec<String> = calls
        .iter()
        .filter(|(_, call)| call.routed && call.label == label)
        .map(|(id, _)| id.clone())
        .collect();
    ids.iter().filter_map(|id| calls.remove(id)).collect()
}

fn reloaded(received: bool) -> Answer {
    if received {
        Answer::Uncertain {
            message: APP_RELOADED.to_owned(),
        }
    } else {
        Answer::Failed {
            code: "app_unavailable".to_owned(),
            message: APP_RELOADED_UNSENT.to_owned(),
        }
    }
}

pub(crate) fn window_reloaded(label: &str) {
    let ended = take_routed(
        &mut pending().lock().unwrap_or_else(PoisonError::into_inner),
        label,
    );
    for call in ended {
        let _ = call.send.send(reloaded(call.received));
    }
    crate::apps::mcp::close_window(label);
}

pub(crate) fn window_closed(label: &str) {
    crate::apps::mcp::close_window(label);
    pending()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .retain(|_, call| call.label != label);
}

fn still_waiting(id: &str) -> bool {
    pending()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .contains_key(id)
}

fn take_unreceived(calls: &mut HashMap<String, PendingCall>, id: &str) -> bool {
    if calls.get(id).is_some_and(|call| !call.received) {
        calls.remove(id);
        return true;
    }
    false
}

fn mark_received(calls: &mut HashMap<String, PendingCall>, id: &str) {
    if let Some(call) = calls.get_mut(id) {
        call.received = true;
    }
}

pub(crate) async fn space_of_run(app: &AppHandle, run_id: &str) -> Option<String> {
    let runtime = app.state::<crate::app::runtime::MistyRuntime>();
    let snapshot = runtime
        .settings
        .profile_state(RUN_CONTEXTS.to_owned(), None)
        .await
        .ok()?;
    let state = snapshot.state?;
    let space = state.get("runs")?.get(run_id)?.get("spaceId")?.as_str()?;
    Some(space.to_owned())
}

static HOST: Mutex<Option<String>> = Mutex::new(None);

fn host() -> Option<String> {
    HOST.lock().unwrap_or_else(PoisonError::into_inner).clone()
}

fn journal_key(call: &LocalToolCall) -> String {
    format!("{}:{}", call.turn, call.call_id)
}

fn uncertain(message: &str) -> LocalToolOutcome {
    LocalToolOutcome::Result(json!({ "status": "uncertain", "message": message }))
}

fn unavailable() -> LocalToolOutcome {
    LocalToolOutcome::Rejected {
        code: "device_unavailable".to_owned(),
        message: "Misty has no open window to do this in.".to_owned(),
    }
}

const INTERRUPTED: &str =
    "Misty closed while this was running, so it may or may not have happened. \
                           Check before doing it again.";

const APP_CLOSED: &str =
    "The app closed while this was running, so it may or may not have happened. \
                           Check before doing it again.";

const APP_RELOADED: &str =
    "The app's window reloaded before this finished, so it may or may not have happened. \
                           Check before doing it again.";

const APP_RELOADED_UNSENT: &str =
    "The app's window reloaded before this finished, so nothing was done.";

const APP_UNHEARD: &str =
    "The app's window didn't pick this up, so nothing was done. Try again once the app is open.";

const APP_SLOW: &str = "The app didn't finish this in time, so it may or may not have happened. \
                           Check before doing it again.";

const RUN_CONTEXTS: &str = "device:agent-run-contexts";

struct Waiting<'a> {
    id: String,
    app: &'a AppHandle,
    answered: bool,
}

impl Drop for Waiting<'_> {
    fn drop(&mut self) {
        tool_gate::end_active(&self.id);
        pending()
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&self.id);
        if !self.answered {
            let _ = self
                .app
                .emit("misty://agent-tool-cancel", json!({ "id": self.id }));
        }
    }
}

pub(crate) struct AppToolHost {
    pub(crate) app: AppHandle,
}

impl AppToolHost {
    fn store(&self) -> Store {
        self.app
            .state::<crate::app::runtime::MistyRuntime>()
            .environment
            .store()
    }

    async fn open_host(&self) -> Option<String> {
        let deadline = tokio::time::Instant::now() + HOST_WAIT;
        loop {
            if let Some(label) = host().filter(|label| self.app.get_webview(label).is_some()) {
                return Some(label);
            }
            if tokio::time::Instant::now() >= deadline {
                return None;
            }
            tokio::time::sleep(HOST_CHECK).await;
        }
    }

    async fn saved_runs(&self) -> Vec<String> {
        super::ensure(&self.app)
            .await
            .map(|running| running.runtime.saved_local_runs())
            .unwrap_or_default()
    }

    async fn run_space(&self, run_id: &str) -> Option<String> {
        space_of_run(&self.app, run_id).await
    }

    async fn ask(&self, call: &LocalToolCall, facts: &RunFacts) -> Option<Answer> {
        let routed = if call.name.starts_with("app.") {
            let space = self.run_space(&call.run_id).await;
            match crate::apps::mcp::route_open(&call.name, space.as_deref(), |label| {
                self.app.get_webview(label).is_some()
            }) {
                Ok(route) => Some(route),
                Err(message) => {
                    return Some(Answer::Failed {
                        code: "app_unavailable".to_owned(),
                        message,
                    })
                }
            }
        } else {
            None
        };
        let label = match &routed {
            Some(route) => route.webview.clone(),
            None => self.open_host().await?,
        };
        let id = uuid::Uuid::new_v4().to_string();
        tool_gate::begin_active(&id, facts, &call.name);
        let (send, mut receive) = oneshot::channel();
        let asked = Asked {
            id: &id,
            run_id: &call.run_id,
            call_id: &call.call_id,
            name: &call.name,
            input: &call.input,
            instance: routed.as_ref().map(|route| route.instance.as_str()),
        };
        let replay = (routed.is_none() && repeats_safely(&call.name)).then(|| json!(asked));
        pending()
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(
                id.clone(),
                PendingCall {
                    send,
                    replay,
                    label: label.clone(),
                    routed: routed.is_some(),
                    received: false,
                },
            );
        let mut waiting = Waiting {
            id: id.clone(),
            app: &self.app,
            answered: false,
        };
        let event = if routed.is_some() {
            "misty://agent-app-tool-call"
        } else {
            "misty://agent-tool-call"
        };
        let reachable = routed.is_none() || self.app.get_webview(&label).is_some();
        if !reachable
            || (still_waiting(&id) && self.app.emit_to(label.as_str(), event, asked).is_err())
        {
            if routed.is_some() {
                crate::apps::mcp::close_window(&label);
            }
            return routed.map(|_| Answer::Failed {
                code: "app_unavailable".to_owned(),
                message: "The app isn't open in a window Misty can reach.".to_owned(),
            });
        }
        let gone = || Answer::Uncertain {
            message: APP_CLOSED.to_owned(),
        };
        let limit = tokio::time::sleep(CALL_LIMIT);
        tokio::pin!(limit);
        let receipt = tokio::time::sleep(RECEIPT_LIMIT);
        tokio::pin!(receipt);
        let mut awaiting_receipt = routed.is_some();
        loop {
            let withdrawn = crate::apps::mcp::withdrawn();
            if let Some(route) = &routed {
                if !crate::apps::mcp::has_instance(&route.instance) {
                    if let Ok(answer) = receive.try_recv() {
                        waiting.answered = true;
                        return Some(answer);
                    }
                    return Some(gone());
                }
            }
            tokio::select! {
                biased;
                answer = &mut receive => {
                    waiting.answered = true;
                    return match answer {
                        Ok(answer) => Some(answer),
                        Err(_) => routed.as_ref().map(|_| gone()),
                    };
                }
                () = &mut receipt, if awaiting_receipt => {
                    awaiting_receipt = false;
                    let unheard = take_unreceived(
                        &mut pending().lock().unwrap_or_else(PoisonError::into_inner),
                        &id,
                    );
                    if unheard {
                        return Some(Answer::Failed {
                            code: "app_unavailable".to_owned(),
                            message: APP_UNHEARD.to_owned(),
                        });
                    }
                }
                () = &mut limit => {
                    return routed.as_ref().map(|_| Answer::Uncertain {
                        message: APP_SLOW.to_owned(),
                    });
                }
                () = withdrawn => {}
            }
        }
    }
}

impl AppToolHost {
    fn open_host_now(&self) -> Option<String> {
        host().filter(|label| self.app.get_webview(label).is_some())
    }
}

impl LocalToolHost for AppToolHost {
    fn runs(&self, name: &str) -> bool {
        LOCAL_TOOLS.contains(&name) || crate::apps::mcp::is_registered(name)
    }

    fn call<'a>(&'a self, call: LocalToolCall) -> BoxFuture<'a, LocalToolOutcome> {
        Box::pin(async move {
            let read_only = READ_ONLY.contains(&call.name.as_str())
                || crate::apps::mcp::is_read_only(&call.name);
            let store = self.store();
            let facts = tool_gate::facts_of_run(&self.app, &call.run_id).await;
            let journal = ToolJournal::new(store.clone(), &facts.account, self.saved_runs().await);
            let key = journal_key(&call);
            match journal.begin(&call.run_id, &key, &call.name).await {
                Begun::Replay(outcome) => return outcome,
                Begun::Conflict => {
                    return LocalToolOutcome::Rejected {
                        code: "tool_call_conflict".to_owned(),
                        message: "This run used that call id for another tool, so nothing was done. Call the tool again.".to_owned(),
                    }
                }
                Begun::Unavailable if !read_only => {
                    return LocalToolOutcome::Rejected {
                        code: "journal_unavailable".to_owned(),
                        message: "Misty couldn't record this change, so it was not attempted. Try again.".to_owned(),
                    }
                }
                Begun::Interrupted if !read_only => return uncertain(INTERRUPTED),
                Begun::Unavailable | Begun::Interrupted | Begun::New => {}
            }
            let input = match tool_gate::admit(&self.app, &store, &facts, &call).await {
                Admission::Run(input) => input,
                Admission::Done(outcome) => {
                    journal.finish(&call.run_id, &key, &outcome).await;
                    return outcome;
                }
            };
            let admitted = LocalToolCall {
                input,
                ..call.clone()
            };
            let files = call.name.starts_with("files.");
            let memory = call.name.starts_with("memory.");
            let answer = match crate::apps::mcp::served_by_program(&call.name)
                .filter(|_| !files && !memory)
            {
                None if memory => Some(
                    match crate::engines::agent_memory::call(
                        &self.app,
                        &facts,
                        &call.name,
                        admitted.input.clone(),
                    )
                    .await
                    {
                        Ok(result) => Answer::Done { result },
                        Err((code, message)) => Answer::Failed { code, message },
                    },
                ),
                None if files => Some(
                    match crate::files::agent_paths::tools::call(
                        &self.app,
                        &facts.agent_id,
                        &facts.conversation_id,
                        &call.name,
                        admitted.input.clone(),
                    )
                    .await
                    {
                        Ok(result) => Answer::Done { result },
                        Err(refused) => Answer::Failed {
                            code: refused.code.to_owned(),
                            message: refused.message,
                        },
                    },
                ),
                Some((app_id, tool)) => Some(
                    match crate::apps::program::call(
                        &call.run_id,
                        &app_id,
                        &tool,
                        admitted.input.clone(),
                    )
                    .await
                    {
                        crate::apps::program::Outcome::Done(result) => Answer::Done { result },
                        crate::apps::program::Outcome::Failed { code, message } => {
                            Answer::Failed { code, message }
                        }
                        crate::apps::program::Outcome::Uncertain(message) => {
                            Answer::Uncertain { message }
                        }
                    },
                ),
                None => self.ask(&admitted, &facts).await,
            };
            let outcome = match answer {
                Some(Answer::Done { result }) => {
                    tool_gate::note_result(&self.app, &store, &facts, &call).await;
                    LocalToolOutcome::Result(marked(&call.name, result))
                }
                Some(Answer::Failed { code, message }) => {
                    LocalToolOutcome::Rejected { code, message }
                }
                Some(Answer::Uncertain { message }) => uncertain(&message),
                None if read_only => unavailable(),
                None if self.open_host_now().is_none() => unavailable(),
                None => uncertain(INTERRUPTED),
            };
            journal.finish(&call.run_id, &key, &outcome).await;
            outcome
        })
    }

    fn check<'a>(&'a self, call: LocalToolCall) -> BoxFuture<'a, Option<LocalToolOutcome>> {
        Box::pin(async move {
            let store = self.store();
            let facts = tool_gate::facts_of_run(&self.app, &call.run_id).await;
            match tool_gate::admit(&self.app, &store, &facts, &call).await {
                Admission::Done(outcome) => Some(outcome),
                Admission::Run(_) => {
                    tool_gate::note_result(&self.app, &store, &facts, &call).await;
                    None
                }
            }
        })
    }
}

#[tauri::command]
pub fn agent_tool_host_ready(app: AppHandle, webview: tauri::Webview) -> Result<(), String> {
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Err("Only a profile's window can run agent tools.".into());
    }
    let before = HOST
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .replace(webview.label().to_owned());
    let mut calls = pending().lock().unwrap_or_else(PoisonError::into_inner);
    let running = calls.values().filter(|call| !call.routed).count();
    let again = after_page_load(&mut calls, webview.label());
    drop(calls);
    if running > again.len() {
        eprintln!(
            "agent tool host: {} announced itself (was {}), ending {} running call(s) that can't be repeated",
            webview.label(),
            before.as_deref().unwrap_or("none"),
            running - again.len(),
        );
    }
    for asked in again {
        let _ = app.emit_to(webview.label(), "misty://agent-tool-call", asked);
    }
    Ok(())
}

#[tauri::command]
pub fn agent_tool_finish(webview: tauri::Webview, id: String, answer: Reply) -> Result<(), String> {
    let mut calls = pending().lock().unwrap_or_else(PoisonError::into_inner);
    match calls.get(&id) {
        None => return Err("That tool call is no longer waiting.".into()),
        Some(call) if call.label != webview.label() => {
            return Err("Only the window running agent tools can answer.".into())
        }
        Some(_) => {}
    }
    match answer {
        Reply::Received(Receipt::Received) => mark_received(&mut calls, &id),
        Reply::Answer(answer) => {
            if let Some(call) = calls.remove(&id) {
                let _ = call.send.send(answer);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "local_tools_tests.rs"]
mod tests;
