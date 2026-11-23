use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::Duration,
};
use tauri::{AppHandle, Webview};
use tokio::sync::oneshot;

use crate::agents::run_control::windows::emit_to_account;
use crate::browser::BrowserAgentExecuteRequest;

pub(in crate::browser) const KINDS: [&str; 4] = ["payment", "send", "delete", "publish"];

pub(in crate::browser) fn asks(request: &BrowserAgentExecuteRequest, kind: &str) -> bool {
    kinds_ask(request.policy.confirm_kinds.as_deref(), kind)
}

fn kinds_ask(chosen: Option<&[String]>, kind: &str) -> bool {
    if !KINDS.contains(&kind) {
        return false;
    }
    match chosen {
        Some(kinds) if !kinds.is_empty() && kind != "payment" => {
            kinds.iter().any(|asked| asked == kind)
        }
        _ => true,
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrantSet {
    #[serde(default)]
    pub mode: String,
    #[serde(default)]
    pub grants: Vec<SiteGrant>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct SiteGrant {
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub origin: String,
}

pub(in crate::browser) fn covered(
    request: &BrowserAgentExecuteRequest,
    origin: &str,
    kind: &str,
) -> bool {
    granted(request.policy.grant_set.as_ref(), origin, kind)
}

fn granted(set: Option<&GrantSet>, origin: &str, kind: &str) -> bool {
    let Some(set) = set else { return false };
    set.mode == "auto"
        && kind != "payment"
        && KINDS.contains(&kind)
        && origin.starts_with("https://")
        && set
            .grants
            .iter()
            .any(|grant| grant.kind == kind && grant.origin == origin)
}

pub(in crate::browser) fn page_origin(view: &Webview) -> String {
    view.url().map(|url| origin_of(&url)).unwrap_or_default()
}

fn origin_of(url: &url::Url) -> String {
    match url.origin() {
        url::Origin::Tuple(..) => url.origin().ascii_serialization(),
        url::Origin::Opaque(_) => String::new(),
    }
}

const WAIT: Duration = Duration::from_secs(180);

pub(crate) enum Answer {
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
    origin: &'a str,
    rememberable: bool,
    agent_id: &'a str,
    task_id: &'a str,
}

struct Open<'a> {
    id: &'a str,
    app: &'a AppHandle,
    account: &'a str,
}

impl Drop for Open<'_> {
    fn drop(&mut self) {
        if let Ok(mut map) = pending().lock() {
            map.remove(self.id);
        }
        emit_to_account(
            self.app,
            self.account,
            "misty://agent-action-confirm-closed",
            serde_json::json!({ "id": self.id }),
        );
    }
}

pub(crate) fn question_open() -> bool {
    pending().lock().map_or(true, |map| !map.is_empty())
}

fn pending() -> &'static Mutex<HashMap<String, oneshot::Sender<bool>>> {
    static PENDING: OnceLock<Mutex<HashMap<String, oneshot::Sender<bool>>>> = OnceLock::new();
    PENDING.get_or_init(Default::default)
}

pub(in crate::browser) async fn ask(
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
    let origin = page_origin(view);
    let account = request
        .policy
        .call
        .as_ref()
        .map_or("", |call| call.facts.account.as_str());
    wait_for_answer(
        app,
        account,
        Question {
            id: &id,
            kind,
            control,
            reason,
            site: &site,
            origin: &origin,
            rememberable: kind != "payment" && origin.starts_with("https://"),
            agent_id: &request.agent_id,
            task_id: request.input["__mistyTaskId"].as_str().unwrap_or(""),
        },
    )
    .await
}

async fn wait_for_answer(app: &AppHandle, account: &str, question: Question<'_>) -> Answer {
    let id = question.id.to_owned();
    let (send, receive) = oneshot::channel();
    if let Ok(mut map) = pending().lock() {
        map.insert(id.clone(), send);
    }
    let _open = Open {
        id: &id,
        app,
        account,
    };
    emit_to_account(app, account, "misty://agent-action-confirm", question);
    match tokio::time::timeout(WAIT, receive).await {
        Ok(Ok(true)) => Answer::Allowed,
        Ok(Ok(false)) => Answer::Refused,
        _ => Answer::Unanswered,
    }
}

pub(crate) struct ToolAsk<'a> {
    pub(crate) account: &'a str,
    pub(crate) kind: &'a str,
    pub(crate) control: &'a str,
    pub(crate) reason: &'a str,
    pub(crate) site: &'a str,
    pub(crate) agent_id: &'a str,
    pub(crate) task_id: &'a str,
}

pub(crate) async fn ask_tool(app: &AppHandle, ask: ToolAsk<'_>) -> Answer {
    let id = uuid::Uuid::new_v4().to_string();
    wait_for_answer(
        app,
        ask.account,
        Question {
            id: &id,
            kind: ask.kind,
            control: ask.control,
            reason: ask.reason,
            site: ask.site,
            origin: "",
            rememberable: false,
            agent_id: ask.agent_id,
            task_id: ask.task_id,
        },
    )
    .await
}

fn declined_adoption() -> &'static Mutex<std::collections::HashSet<String>> {
    static DECLINED: OnceLock<Mutex<std::collections::HashSet<String>>> = OnceLock::new();
    DECLINED.get_or_init(Default::default)
}

pub(crate) async fn ask_to_adopt(app: &AppHandle, window: &str, account: &str) -> bool {
    if declined_adoption()
        .lock()
        .is_ok_and(|declined| declined.contains(account))
    {
        return false;
    }
    crate::agents::run_control::windows::note_window(window, account);
    let id = uuid::Uuid::new_v4().to_string();
    let answer = wait_for_answer(
        app,
        account,
        Question {
            id: &id,
            kind: "action",
            control: "Move the chats kept signed out on this computer to this account.",
            reason: "",
            site: "",
            origin: "",
            rememberable: false,
            agent_id: "",
            task_id: "",
        },
    )
    .await;
    match answer {
        Answer::Allowed => true,
        Answer::Refused | Answer::Unanswered => {
            if let Ok(mut declined) = declined_adoption().lock() {
                declined.insert(account.to_owned());
            }
            false
        }
    }
}

#[tauri::command]
pub fn agent_action_confirm(webview: Webview, id: String, allow: bool) -> Result<(), String> {
    if !crate::browser::app_windows::is_person_window(webview.label()) {
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

pub(in crate::browser) fn label(kind: &str) -> &'static str {
    match kind {
        "payment" => "pay or buy",
        "send" => "send a message",
        "delete" => "delete something",
        _ => "post or publish",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(mode: &str) -> GrantSet {
        GrantSet {
            mode: mode.to_owned(),
            grants: vec![SiteGrant {
                kind: "send".to_owned(),
                origin: "https://mail.example.com".to_owned(),
            }],
        }
    }

    #[test]
    fn auto_continues_only_on_the_exact_remembered_origin_and_kind() {
        let auto = set("auto");
        assert!(granted(Some(&auto), "https://mail.example.com", "send"));
        assert!(!granted(Some(&auto), "https://mail.example.com", "delete"));
        assert!(!granted(Some(&auto), "https://evil.example.com", "send"));
        assert!(!granted(Some(&auto), "http://mail.example.com", "send"));
    }

    #[test]
    fn ask_and_missing_sets_always_ask() {
        assert!(!granted(
            Some(&set("ask")),
            "https://mail.example.com",
            "send"
        ));
        assert!(!granted(None, "https://mail.example.com", "send"));
        assert!(!granted(
            Some(&GrantSet::default()),
            "https://mail.example.com",
            "send"
        ));
    }

    #[test]
    fn payments_always_ask() {
        let mut auto = set("auto");
        auto.grants[0].kind = "payment".to_owned();
        assert!(!granted(Some(&auto), "https://mail.example.com", "payment"));
    }

    #[test]
    fn origins_are_scheme_host_and_port() {
        let url = url::Url::parse("https://mail.example.com:8443/inbox?x=1").unwrap();
        assert_eq!(origin_of(&url), "https://mail.example.com:8443");
        let url = url::Url::parse("https://mail.example.com/inbox").unwrap();
        assert_eq!(origin_of(&url), "https://mail.example.com");
    }

    #[test]
    fn an_empty_or_missing_list_cannot_turn_the_stop_off() {
        for kind in KINDS {
            assert!(kinds_ask(None, kind));
            assert!(kinds_ask(Some(&[]), kind));
        }
        let only_send = ["send".to_owned()];
        assert!(kinds_ask(Some(&only_send), "send"));
        assert!(!kinds_ask(Some(&only_send), "delete"));
        assert!(kinds_ask(Some(&only_send), "payment"));
        assert!(!kinds_ask(None, "anything"));
    }

    #[test]
    fn a_malformed_set_reads_as_no_grants() {
        let parsed: GrantSet =
            serde_json::from_value(serde_json::json!({"mode": 3})).unwrap_or_default();
        assert!(!granted(Some(&parsed), "https://mail.example.com", "send"));
    }
}
