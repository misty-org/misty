//! What an agent needs from the person (connect an app, approve one exact action) and the approvals
//! they remembered. Rows in `agent_chats` under kinds the renderer's chat commands refuse, so a window
//! can't write an approval except by answering one through `decide`.
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};

pub use super::request_view::RequestView;
use super::AccountStore as Store;
use super::{
    grants::write_grant,
    policy::{Amount, GrantNeed},
};

const REQUEST_KIND: &str = "app_request";
const LOCAL_REQUEST_PREFIX: &str = "localapprq_";

const REQUEST_TTL_MS: i64 = 15 * 60 * 1000;
/// A recent decline of the same exact need is the answer, so the person isn't asked again.
const DECLINE_MEMORY_MS: i64 = 15 * 60 * 1000;
/// An answered card only matters while its chat is being read.
const REQUEST_KEPT_MS: i64 = 7 * 24 * 60 * 60 * 1000;

pub(super) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or_default()
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Request {
    pub id: String,
    pub run_id: String,
    pub kind: String,
    pub subject: String,
    pub arguments_hash: String,
    pub title: String,
    pub summary: String,
    pub state: String,
    pub expires_at: i64,
    pub created_at: i64,
    pub decided_at: Option<i64>,
    pub permission_mode: String,
    pub grant: Option<Remember>,
}

/// What remembering an approval would grant, recorded when the action paused.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Remember {
    pub action: String,
    pub scope_kind: String,
    pub scope_id: String,
    pub cap: Option<Amount>,
    pub label: String,
}

impl Remember {
    pub fn of(need: &GrantNeed) -> Option<Self> {
        need.rememberable().then(|| Self {
            action: need.action.to_owned(),
            scope_kind: need.scope_kind.to_owned(),
            scope_id: need.scope_id.clone(),
            cap: need.amount.clone(),
            label: need.label.clone(),
        })
    }
}

/// A new request's fields. The state and times are this file's to set.
pub struct Draft {
    pub run_id: String,
    pub kind: &'static str,
    pub subject: String,
    pub arguments_hash: String,
    pub title: String,
    pub summary: String,
    pub permission_mode: String,
    pub grant: Option<Remember>,
}

impl Request {
    fn live(&self, now: i64) -> bool {
        matches!(self.state.as_str(), "pending" | "approved")
            || (self.state == "declined"
                && self
                    .decided_at
                    .is_some_and(|at| at > now - DECLINE_MEMORY_MS))
    }
}

pub(super) fn storage(error: rusqlite::Error) -> String {
    format!("Misty couldn't read this computer's app requests. {error}")
}

fn save(account: &str, connection: &Connection, request: &Request) -> rusqlite::Result<()> {
    let document = serde_json::to_string(request).map_err(|_| rusqlite::Error::InvalidQuery)?;
    connection.execute(
        "INSERT INTO agent_chats (account, kind, id, document, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (account, kind, id)
         DO UPDATE SET document = excluded.document, updated_at = excluded.updated_at",
        params![account, REQUEST_KIND, request.id, document, now_ms()],
    )?;
    Ok(())
}

fn read_one(account: &str, connection: &Connection, id: &str) -> rusqlite::Result<Option<Request>> {
    let document: Option<String> = connection
        .query_row(
            "SELECT document FROM agent_chats WHERE account = ?1 AND kind = ?2 AND id = ?3",
            params![account, REQUEST_KIND, id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(document.and_then(|text| serde_json::from_str(&text).ok()))
}

/// A request past its time is expired. The caller's transaction saves that.
fn expire(
    account: &str,
    connection: &Connection,
    request: &mut Request,
    now: i64,
) -> rusqlite::Result<()> {
    if matches!(request.state.as_str(), "pending" | "approved") && request.expires_at <= now {
        request.state = "expired".to_owned();
        save(account, connection, request)?;
    }
    Ok(())
}

/// The live request for one exact need, or a new one.
pub fn open(store: &Store, draft: Draft) -> Result<Request, String> {
    let account = store.account();
    let mut connection = store.connect().map_err(storage)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(storage)?;
    let now = now_ms();
    transaction
        .execute(
            "DELETE FROM agent_chats WHERE account = ?1 AND kind = ?2 AND updated_at < ?3",
            params![account, REQUEST_KIND, now - REQUEST_KEPT_MS],
        )
        .map_err(storage)?;
    let mut found: Option<Request> = None;
    {
        let mut statement = transaction
            .prepare("SELECT document FROM agent_chats WHERE account = ?1 AND kind = ?2")
            .map_err(storage)?;
        let documents = statement
            .query_map(params![account, REQUEST_KIND], |row| {
                row.get::<_, String>(0)
            })
            .map_err(storage)?;
        for document in documents {
            let document = document.map_err(storage)?;
            let Ok(mut request) = serde_json::from_str::<Request>(&document) else {
                continue;
            };
            if request.kind != draft.kind
                || request.subject != draft.subject
                || request.arguments_hash != draft.arguments_hash
            {
                continue;
            }
            expire(account, &transaction, &mut request, now).map_err(storage)?;
            if request.live(now)
                && found
                    .as_ref()
                    .is_none_or(|newest| request.created_at > newest.created_at)
            {
                found = Some(request);
            }
        }
    }
    let request = match found {
        Some(request) => request,
        None => {
            let request = Request {
                id: format!("{LOCAL_REQUEST_PREFIX}{}", uuid::Uuid::new_v4()),
                run_id: draft.run_id,
                kind: draft.kind.to_owned(),
                subject: draft.subject,
                arguments_hash: draft.arguments_hash,
                title: draft.title,
                summary: draft.summary,
                state: "pending".to_owned(),
                expires_at: now + REQUEST_TTL_MS,
                created_at: now,
                decided_at: None,
                permission_mode: draft.permission_mode,
                grant: draft.grant,
            };
            save(account, &transaction, &request).map_err(storage)?;
            request
        }
    };
    transaction.commit().map_err(storage)?;
    Ok(request)
}

pub fn get(store: &Store, id: &str) -> Result<Option<Request>, String> {
    let account = store.account();
    let mut connection = store.connect().map_err(storage)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(storage)?;
    let mut request = read_one(account, &transaction, id).map_err(storage)?;
    if let Some(request) = request.as_mut() {
        expire(account, &transaction, request, now_ms()).map_err(storage)?;
    }
    transaction.commit().map_err(storage)?;
    Ok(request)
}

/// Records the person's answer: `continue` approves this one action, `remember` also stores the grant
/// the card named, and `deny` declines. A Connect card can only be dismissed.
pub fn decide(store: &Store, id: &str, decision: &str) -> Result<Request, String> {
    let account = store.account();
    const STALE: &str = "That request has already been answered or has expired.";
    let mut connection = store.connect().map_err(storage)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(storage)?;
    let now = now_ms();
    let mut request = read_one(account, &transaction, id)
        .map_err(storage)?
        .ok_or("That request does not exist.")?;
    expire(account, &transaction, &mut request, now).map_err(storage)?;
    if request.state != "pending" {
        transaction.commit().map_err(storage)?;
        return Err(STALE.to_owned());
    }
    let state = match decision {
        "continue" | "remember" if request.kind == "approve" => "approved",
        "deny" => "declined",
        _ => return Err(STALE.to_owned()),
    };
    if decision == "remember" {
        let grant = request.grant.clone().ok_or("This can't be remembered.")?;
        write_grant(account, &transaction, &grant, now).map_err(storage)?;
    }
    request.state = state.to_owned();
    request.decided_at = Some(now);
    save(account, &transaction, &request).map_err(storage)?;
    transaction.commit().map_err(storage)?;
    Ok(request)
}

/// Uses up an approval for this exact action, if one is waiting. A remembered approval runs the action
/// by itself, and its card mustn't stay behind to let the same action through once more in Ask.
pub fn use_matching(store: &Store, subject: &str, arguments_hash: &str) -> Result<(), String> {
    let account = store.account();
    let mut connection = store.connect().map_err(storage)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(storage)?;
    let approved: Vec<Request> = {
        let mut statement = transaction
            .prepare("SELECT document FROM agent_chats WHERE account = ?1 AND kind = ?2")
            .map_err(storage)?;
        let documents = statement
            .query_map(params![account, REQUEST_KIND], |row| {
                row.get::<_, String>(0)
            })
            .map_err(storage)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(storage)?;
        documents
            .iter()
            .filter_map(|text| serde_json::from_str::<Request>(text).ok())
            .filter(|request| {
                request.kind == "approve"
                    && request.state == "approved"
                    && request.subject == subject
                    && request.arguments_hash == arguments_hash
            })
            .collect()
    };
    for mut request in approved {
        request.state = "used".to_owned();
        save(account, &transaction, &request).map_err(storage)?;
    }
    transaction.commit().map_err(storage)
}

/// Moves a request on exactly once: a Connect card to connected, an approval to used.
pub fn resolve(store: &Store, id: &str, from: &str, to: &str) -> Result<Option<Request>, String> {
    let account = store.account();
    let mut connection = store.connect().map_err(storage)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(storage)?;
    let Some(mut request) = read_one(account, &transaction, id).map_err(storage)? else {
        return Ok(None);
    };
    if request.state != from {
        return Ok(None);
    }
    request.state = to.to_owned();
    request.decided_at.get_or_insert(now_ms());
    save(account, &transaction, &request).map_err(storage)?;
    transaction.commit().map_err(storage)?;
    Ok(Some(request))
}

/// Whether any card, for anyone on this computer, is waiting for its answer.
pub(crate) fn any_pending(store: &database::store::Store) -> bool {
    let read = || -> rusqlite::Result<bool> {
        let connection = store.connect()?;
        let mut statement =
            connection.prepare("SELECT document FROM agent_chats WHERE kind = ?1")?;
        let documents =
            statement.query_map(params![REQUEST_KIND], |row| row.get::<_, String>(0))?;
        let now = now_ms();
        let pending = documents
            .flatten()
            .filter_map(|text| serde_json::from_str::<Request>(&text).ok())
            .any(|request| request.state == "pending" && request.expires_at > now);
        Ok(pending)
    };
    read().unwrap_or(true)
}
