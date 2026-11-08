//! Approvals the person remembered, kept like `requests`: rows the renderer's chat commands can't
//! write. Unlike the server's they aren't per agent, because a tool call doesn't say which agent made it.
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::AccountStore as Store;
use super::{
    policy::{Amount, GrantNeed},
    requests::{now_ms, storage, Remember},
};

const GRANT_KIND: &str = "app_grant";
const LOCAL_GRANT_PREFIX: &str = "localgrant_";

/// An approval the person remembered: agents on this computer may take this action on this one
/// resource while a chat is in Auto.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Grant {
    pub id: String,
    pub action: String,
    pub scope_kind: String,
    pub scope_id: String,
    pub cap: Option<Amount>,
    pub label: String,
    pub created_at: i64,
    pub last_used_at: Option<i64>,
    pub use_count: i64,
}

fn grant_id(action: &str, scope_kind: &str, scope_id: &str) -> String {
    let digest = Sha256::digest(format!("{action}\n{scope_kind}\n{scope_id}").as_bytes());
    format!("{LOCAL_GRANT_PREFIX}{}", hex::encode(digest))
}

fn put_grant(account: &str, connection: &Connection, grant: &Grant) -> rusqlite::Result<()> {
    let document = serde_json::to_string(grant).map_err(|_| rusqlite::Error::InvalidQuery)?;
    connection.execute(
        "INSERT INTO agent_chats (account, kind, id, document, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (account, kind, id)
         DO UPDATE SET document = excluded.document, updated_at = excluded.updated_at",
        params![account, GRANT_KIND, grant.id, document, now_ms()],
    )?;
    Ok(())
}

fn read_grant(account: &str, connection: &Connection, id: &str) -> rusqlite::Result<Option<Grant>> {
    let document: Option<String> = connection
        .query_row(
            "SELECT document FROM agent_chats WHERE account = ?1 AND kind = ?2 AND id = ?3",
            params![account, GRANT_KIND, id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(document.and_then(|text| serde_json::from_str(&text).ok()))
}

pub(super) fn write_grant(
    account: &str,
    connection: &Connection,
    remember: &Remember,
    now: i64,
) -> rusqlite::Result<()> {
    let id = grant_id(&remember.action, &remember.scope_kind, &remember.scope_id);
    let previous = read_grant(account, connection, &id)?;
    put_grant(
        account,
        connection,
        &Grant {
            id,
            action: remember.action.clone(),
            scope_kind: remember.scope_kind.clone(),
            scope_id: remember.scope_id.clone(),
            cap: remember.cap.clone(),
            label: remember.label.clone(),
            created_at: previous.as_ref().map_or(now, |grant| grant.created_at),
            last_used_at: previous.as_ref().and_then(|grant| grant.last_used_at),
            use_count: previous.as_ref().map_or(0, |grant| grant.use_count),
        },
    )
}

/// Read fresh on every call, so a revoke applies to the next action.
pub fn covering_grant(store: &Store, need: &GrantNeed) -> Result<bool, String> {
    let account = store.account();
    if !need.rememberable() {
        return Ok(false);
    }
    let connection = store.connect().map_err(storage)?;
    let id = grant_id(need.action, need.scope_kind, &need.scope_id);
    let Some(mut grant) = read_grant(account, &connection, &id).map_err(storage)? else {
        return Ok(false);
    };
    if !need.covered_by(grant.cap.as_ref()) {
        return Ok(false);
    }
    grant.last_used_at = Some(now_ms());
    grant.use_count += 1;
    put_grant(account, &connection, &grant).map_err(storage)?;
    Ok(true)
}

pub fn grants(store: &Store) -> Result<Vec<Grant>, String> {
    let account = store.account();
    let connection = store.connect().map_err(storage)?;
    let mut statement = connection
        .prepare(
            "SELECT document FROM agent_chats WHERE account = ?1 AND kind = ?2
             ORDER BY updated_at DESC",
        )
        .map_err(storage)?;
    let rows = statement
        .query_map(params![account, GRANT_KIND], |row| row.get::<_, String>(0))
        .map_err(storage)?;
    let documents = rows.collect::<Result<Vec<_>, _>>().map_err(storage)?;
    Ok(documents
        .iter()
        .filter_map(|text| serde_json::from_str(text).ok())
        .collect())
}

/// Forgets one grant, or every one when `id` is `None`.
pub fn revoke_grants(store: &Store, id: Option<&str>) -> Result<(), String> {
    let account = store.account();
    let connection = store.connect().map_err(storage)?;
    match id {
        Some(id) => connection.execute(
            "DELETE FROM agent_chats WHERE account = ?1 AND kind = ?2 AND id = ?3",
            params![account, GRANT_KIND, id],
        ),
        None => connection.execute(
            "DELETE FROM agent_chats WHERE account = ?1 AND kind = ?2",
            params![account, GRANT_KIND],
        ),
    }
    .map(|_| ())
    .map_err(storage)
}
