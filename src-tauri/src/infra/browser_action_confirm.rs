//! Stop before paying, sending, deleting or posting (roadmap C2). When an
//! agent's page step would do one of those, it waits here, natively, until the
//! person allows or refuses it in the control island. The model's flags and
//! the account's "Ask before acting" setting can't skip this, and nobody
//! answering means no.
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Webview};
use tokio::sync::oneshot;

use super::BrowserAgentExecuteRequest;

/// Kinds of page action that always ask the person.
pub(super) const KINDS: [&str; 4] = ["payment", "send", "delete", "publish"];

/// How long a step waits for an answer. A scheduled run with nobody at the
/// computer stops here and says so.
const WAIT: Duration = Duration::from_secs(180);

pub(super) enum Answer {
    Allowed,
    Refused,
    Unanswered,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Question<'a> {
    id: &'a str,
    kind: &'a str,
    control: &'a str,
    reason: &'a str,
    site: &'a str,
    agent_id: &'a str,
    task_id: &'a str,
}

fn pending() -> &'static Mutex<HashMap<String, oneshot::Sender<bool>>> {
    static PENDING: OnceLock<Mutex<HashMap<String, oneshot::Sender<bool>>>> = OnceLock::new();
    PENDING.get_or_init(Default::default)
}

/// Asks the person and waits for their answer.
pub(super) async fn ask(
    app: &AppHandle,
    view: &Webview,
    request: &BrowserAgentExecuteRequest,
    kind: &str,
    control: &str,
    reason: &str,
) -> Answer {
    let id = uuid::Uuid::new_v4().to_string();
    let site = view
        .url()
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned))
        .unwrap_or_default();
    let (send, receive) = oneshot::channel();
    if let Ok(mut map) = pending().lock() {
        map.insert(id.clone(), send);
    }
    let question = Question {
        id: &id,
        kind,
        control,
        reason,
        site: &site,
        agent_id: &request.agent_id,
        task_id: request.input["__mistyTaskId"].as_str().unwrap_or(""),
    };
    let _ = app.emit("misty://agent-action-confirm", question);
    let answer = match tokio::time::timeout(WAIT, receive).await {
        Ok(Ok(true)) => Answer::Allowed,
        Ok(Ok(false)) => Answer::Refused,
        _ => Answer::Unanswered,
    };
    if let Ok(mut map) = pending().lock() {
        map.remove(&id);
    }
    let _ = app.emit(
        "misty://agent-action-confirm-closed",
        serde_json::json!({ "id": id }),
    );
    answer
}

/// The person's answer from the control island. Only Misty's main window can
/// answer, so a page or a dock window can't approve for them.
#[tauri::command]
pub fn agent_action_confirm(webview: Webview, id: String, allow: bool) -> Result<(), String> {
    if webview.label() != "main" {
        return Err("Only Misty's main window can answer this.".into());
    }
    let sender = pending()
        .lock()
        .map_err(|_| "The question is no longer open.".to_owned())?
        .remove(&id);
    match sender {
        Some(sender) => {
            let _ = sender.send(allow);
            Ok(())
        }
        None => Err("The question is no longer open.".into()),
    }
}

/// Words for the model and the island, per kind.
pub(super) fn label(kind: &str) -> &'static str {
    match kind {
        "payment" => "pay or buy",
        "send" => "send a message",
        "delete" => "delete something",
        _ => "post or publish",
    }
}
