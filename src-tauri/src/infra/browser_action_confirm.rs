//! Stop before paying, sending, deleting or posting (roadmap C2). The agent's
//! page step waits here, natively, until the person allows or refuses it in
//! the control island. In Auto, a send, delete or publish on a site the person
//! remembered for this agent continues; payments always ask, since the device
//! cannot check a payment's cap. The model's flags can't skip this, a malformed
//! grant set counts as no grants, and nobody answering means no.
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Webview};
use tokio::sync::oneshot;

use super::BrowserAgentExecuteRequest;

/// Kinds of page action the person can be asked about.
pub(super) const KINDS: [&str; 4] = ["payment", "send", "delete", "publish"];

/// Whether this kind of step waits for the person. A job without the
/// account's choice asks about every kind.
pub(super) fn asks(request: &BrowserAgentExecuteRequest, kind: &str) -> bool {
    KINDS.contains(&kind)
        && request
            .confirm_kinds
            .as_ref()
            .is_none_or(|kinds| kinds.iter().any(|asked| asked == kind))
}

/// The run's mode and the person's remembered page grants for this agent.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrantSet {
    #[serde(default)]
    pub mode: String,
    #[serde(default)]
    pub grants: Vec<SiteGrant>,
    #[serde(default)]
    pub version: i64,
}

/// One remembered page grant: this kind of action on this exact origin.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct SiteGrant {
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub origin: String,
}

/// Whether a remembered grant lets this step continue without asking: only in
/// Auto, never for payments, and only for the exact origin the person named.
pub(super) fn covered(request: &BrowserAgentExecuteRequest, origin: &str, kind: &str) -> bool {
    granted(request.grant_set.as_ref(), origin, kind)
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

/// The page's origin as remembered grants name it: scheme, host and port.
pub(super) fn page_origin(view: &Webview) -> String {
    view.url().map(|url| origin_of(&url)).unwrap_or_default()
}

fn origin_of(url: &url::Url) -> String {
    match url.origin() {
        url::Origin::Tuple(..) => url.origin().ascii_serialization(),
        url::Origin::Opaque(_) => String::new(),
    }
}

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
    /// The page's origin, which "Accept and remember" would name.
    origin: &'a str,
    /// Sends, deletes and publishes on an https page can be remembered; payments can't.
    rememberable: bool,
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
    let origin = page_origin(view);
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
        origin: &origin,
        rememberable: kind != "payment" && origin.starts_with("https://"),
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
            version: 1,
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
    fn a_malformed_set_reads_as_no_grants() {
        let parsed: GrantSet =
            serde_json::from_value(serde_json::json!({"mode": 3})).unwrap_or_default();
        assert!(!granted(Some(&parsed), "https://mail.example.com", "send"));
    }
}
