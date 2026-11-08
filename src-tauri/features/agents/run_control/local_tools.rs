//! Runs an agent's tools on this computer.
//!
//! The run asks here, and the window that runs the device's agent jobs does the work: most tools drive
//! its browser. What keeps a run honest stays here, out of the model's reach and out of the page: the
//! journal, which keeps a restart from repeating a write and tells it apart from one that never ran.
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

/// Long enough for the slowest tool: a screen goal waits on its own 10-minute limit, and a person may
/// be answering a question.
const CALL_LIMIT: Duration = Duration::from_secs(20 * 60);
/// How often a waiting call checks that the window running it is still open.
const WINDOW_CHECK: Duration = Duration::from_secs(2);
/// A run picked up as Misty opens gets here before any window can answer, and so does a call while the
/// window that ran tools hands over to the next one. Both have this long to come up.
const HOST_WAIT: Duration = Duration::from_secs(90);
const HOST_CHECK: Duration = Duration::from_millis(100);

/// The tools this computer runs: every one a run can be offered (`local_prompt/catalog.json`), apart
/// from what the crate answers itself. `src/features/agents/localTools/index.ts` registers the same list.
const LOCAL_TOOLS: &[&str] = &[
    "agent.configure",
    "agent.delegate",
    "agent.list",
    "agent.wait",
    "bookmark.add",
    "bookmark.list",
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
    "browser.tab.open",
    "browser.upload",
    "browser.visual",
    "browser.wait_for",
    "browser.workspace.visual",
    "conversation.ask_user",
    "device.list",
    "drawing.apply",
    "drawing.create",
    "drawing.list",
    "drawing.read",
    "file.promote_attachment",
    "file.read",
    "file.search",
    "file.update",
    "folder.list",
    "folder.read",
    "folder.send",
    "goal.update",
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
    "memory.history.forget",
    "memory.history.search",
    "memory.history.timeline",
    "memory.pref.forget",
    "memory.pref.list",
    "memory.pref.remember",
    "memory.pref.update",
    "memory.tree.read",
    "memory.workflow.find",
    "memory.workflow.learn",
    "memory.workflow.list",
    "memory.workflow.save",
    "memory.workflow.schedule",
    "memory.workflow.unschedule",
    "memory.workflow.use",
    "message.search",
    "message.send",
    "note.create",
    "note.read",
    "note.search",
    "note.tag",
    "note.update",
    "plan.propose",
    "plan.update",
    "screen.close",
    "screen.look",
    "screen.open",
    "search.all",
    "shell.run",
    "space.list",
    "space.manage",
    "space.member.list",
    "space.member.resolve",
    "thread.create",
    "thread.list",
    "thread.post",
    "thread.read",
];

/// Tools that change nothing, so an interrupted one is simply run again. A wait for the person counts:
/// the person's answer is what matters, and asking again is safe.
pub(super) const READ_ONLY: &[&str] = &[
    "browser.snapshot",
    "browser.find",
    "browser.extract",
    "browser.wait_for",
    "browser.inspect",
    "browser.visual",
    "browser.downloads.list",
    "browser.workspace.visual",
    "browser.tab.list",
    "bookmark.list",
    "folder.list",
    "folder.read",
    "device.list",
    "log.work.read",
    "integration.search",
    "integration.schemas",
    "integration.connected",
    "integration.connect",
    "memory.pref.list",
    "memory.history.search",
    "memory.history.timeline",
    "memory.tree.read",
    "memory.workflow.list",
    "memory.workflow.find",
    "memory.workflow.use",
    "browser.request_user_action",
    "screen.look",
    "agent.list",
    "agent.wait",
    "space.list",
    "space.member.list",
    "space.member.resolve",
    "note.read",
    "note.search",
    "drawing.list",
    "drawing.read",
    "file.read",
    "file.search",
    "message.search",
    "search.all",
    "thread.list",
    "thread.read",
];

/// What the window answers. `Failed` means nothing happened, so the model may correct the call;
/// `Uncertain` means it may have.
#[derive(Debug, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum Answer {
    Done { result: Value },
    Failed { code: String, message: String },
    Uncertain { message: String },
}

#[derive(Clone, Debug, Serialize)]
struct Asked<'a> {
    id: &'a str,
    run_id: &'a str,
    call_id: &'a str,
    name: &'a str,
    input: &'a Value,
}

/// A call the window is working on. `replay` is what to ask again if its page reloads, for a call
/// that's safe to repeat.
struct PendingCall {
    send: oneshot::Sender<Answer>,
    replay: Option<Value>,
}

fn pending() -> &'static Mutex<HashMap<String, PendingCall>> {
    static PENDING: OnceLock<Mutex<HashMap<String, PendingCall>>> = OnceLock::new();
    PENDING.get_or_init(Default::default)
}

/// Whether a call can simply be asked again when the page running it reloads: it changes nothing, or,
/// for `agent.delegate`, a repeat waits for the children the first try started.
fn repeats_safely(name: &str) -> bool {
    READ_ONLY.contains(&name) || name == "agent.delegate"
}

/// A window that just loaded knows nothing of the calls its last page was running. Those that can't be
/// repeated end now, as ones that may have happened, and the rest are what to ask again.
fn after_page_load(calls: &mut HashMap<String, PendingCall>) -> Vec<Value> {
    calls.retain(|_, call| call.replay.is_some());
    calls
        .values()
        .filter_map(|call| call.replay.clone())
        .collect()
}

/// The window that runs agent jobs.
static HOST: Mutex<Option<String>> = Mutex::new(None);

fn host() -> Option<String> {
    HOST.lock().unwrap_or_else(PoisonError::into_inner).clone()
}

/// What the journal knows a call by: its id and its turn, since a provider may repeat an id in a later
/// turn, and only a repeat in the same saved turn is the same call.
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

/// Forgets a call's question however its wait ends, and tells the window when the run stopped waiting.
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

    /// The window that answers calls, once there is one.
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

    /// The runs that may still resume, whose journal rows are kept however old they are.
    async fn saved_runs(&self) -> Vec<String> {
        super::ensure(&self.app)
            .await
            .map(|running| running.runtime.saved_local_runs())
            .unwrap_or_default()
    }

    async fn ask(&self, call: &LocalToolCall, facts: &RunFacts) -> Option<Answer> {
        let label = self.open_host().await?;
        let id = uuid::Uuid::new_v4().to_string();
        tool_gate::begin_active(&id, facts, &call.name);
        let (send, mut receive) = oneshot::channel();
        let asked = Asked {
            id: &id,
            run_id: &call.run_id,
            call_id: &call.call_id,
            name: &call.name,
            input: &call.input,
        };
        let replay = repeats_safely(&call.name).then(|| json!(asked));
        pending()
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(id.clone(), PendingCall { send, replay });
        let mut waiting = Waiting {
            id: id.clone(),
            app: &self.app,
            answered: false,
        };
        self.app
            .emit_to(label.as_str(), "misty://agent-tool-call", asked)
            .ok()?;
        let limit = tokio::time::sleep(CALL_LIMIT);
        tokio::pin!(limit);
        loop {
            tokio::select! {
                answer = &mut receive => {
                    waiting.answered = true;
                    return answer.ok();
                }
                () = &mut limit => return None,
                () = tokio::time::sleep(WINDOW_CHECK) => {
                    if self.app.get_webview(&label).is_none() {
                        return None;
                    }
                }
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
        LOCAL_TOOLS.contains(&name)
    }

    fn call<'a>(&'a self, call: LocalToolCall) -> BoxFuture<'a, LocalToolOutcome> {
        Box::pin(async move {
            let read_only = READ_ONLY.contains(&call.name.as_str());
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
                // Nobody could account for a write after a restart, so it never starts.
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
            let answer = self.ask(&admitted, &facts).await;
            let outcome = match answer {
                Some(Answer::Done { result }) => {
                    tool_gate::note_result(&self.app, &store, &facts, &call).await;
                    LocalToolOutcome::Result(marked(&call.name, result))
                }
                Some(Answer::Failed { code, message }) => {
                    LocalToolOutcome::Rejected { code, message }
                }
                Some(Answer::Uncertain { message }) => uncertain(&message),
                // The window never answered. A read just didn't happen; a write may have.
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

/// This window runs the device's agent jobs from now on.
#[tauri::command]
pub fn agent_tool_host_ready(app: AppHandle, webview: tauri::Webview) -> Result<(), String> {
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Err("Only a profile's window can run agent tools.".into());
    }
    *HOST.lock().unwrap_or_else(PoisonError::into_inner) = Some(webview.label().to_owned());
    let again = after_page_load(&mut pending().lock().unwrap_or_else(PoisonError::into_inner));
    for asked in again {
        let _ = app.emit_to(webview.label(), "misty://agent-tool-call", asked);
    }
    Ok(())
}

/// The window's answer to one call. Only the window that was asked can answer.
#[tauri::command]
pub fn agent_tool_finish(
    webview: tauri::Webview,
    id: String,
    answer: Answer,
) -> Result<(), String> {
    if host().as_deref() != Some(webview.label()) {
        return Err("Only the window running agent tools can answer.".into());
    }
    let sender = pending()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .remove(&id);
    match sender {
        Some(call) => {
            let _ = call.send.send(answer);
            Ok(())
        }
        None => Err("That tool call is no longer waiting.".into()),
    }
}

#[cfg(test)]
#[path = "local_tools_tests.rs"]
mod tests;
