//! Facts: what the person asked Misty to remember, one list per agent in each Space. The empty agent id
//! is the person's own Misty agent.
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::sync::fact_record_id;
use super::{check_space, index, mark_deleted, rfc3339, MemoryError, Result, FACTS};

const MAX_LIST: i64 = 100;
const MAX_CONTEXT: i64 = 30;

fn empty(text: &str) -> bool {
    text.is_empty()
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct MemoryFact {
    pub id: String,
    #[serde(default, skip_serializing_if = "empty")]
    pub space_id: String,
    pub kind: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "empty")]
    pub reason: String,
    #[serde(default, skip_serializing_if = "empty")]
    pub source_conversation_id: String,
    #[serde(default, skip_serializing_if = "empty")]
    pub source_invocation_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_used_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct Remember {
    #[serde(default)]
    pub space_id: String,
    #[serde(default)]
    pub agent_id: String,
    #[serde(default)]
    pub kind: String,
    pub content: String,
    #[serde(default)]
    pub reason: String,
    #[serde(default)]
    pub source_conversation_id: String,
    #[serde(default)]
    pub source_invocation_id: String,
}

/// The same words in any spacing or case are the same memory.
pub(super) fn memory_key(content: &str) -> String {
    let normalized = content
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();
    hex::encode(Sha256::digest(normalized))
}

const COLUMNS: &str = "id, space_id, kind, content, reason, source_conversation_id,
     source_invocation_id, last_used_at, created_at, updated_at";

fn from_row(row: &Row) -> rusqlite::Result<MemoryFact> {
    Ok(MemoryFact {
        id: row.get(0)?,
        space_id: row.get(1)?,
        kind: row.get(2)?,
        content: row.get(3)?,
        reason: row.get(4)?,
        source_conversation_id: row.get(5)?,
        source_invocation_id: row.get(6)?,
        last_used_at: row.get::<_, Option<i64>>(7)?.map(rfc3339),
        created_at: rfc3339(row.get(8)?),
        updated_at: rfc3339(row.get(9)?),
    })
}

pub(crate) fn remember(
    connection: &mut Connection,
    account: &str,
    input: Remember,
    now: i64,
) -> Result<MemoryFact> {
    check_space(&input.space_id)?;
    let kind = match input.kind.trim().to_lowercase() {
        kind if kind.is_empty() => "fact".to_owned(),
        kind => kind,
    };
    let content = input.content.trim();
    let reason = input.reason.trim();
    if !matches!(kind.as_str(), "fact" | "preference" | "instruction")
        || content.is_empty()
        || content.chars().count() > 1000
        || reason.chars().count() > 500
        || input.agent_id.len() > 200
    {
        return Err(MemoryError::Invalid("invalid_memory_node"));
    }
    let transaction = connection.transaction()?;
    let id: String = transaction.query_row(
        "INSERT INTO memory_facts (account, id, space_id, agent_id, memory_key, kind, content, reason,
             source_conversation_id, source_invocation_id, created_at, updated_at, changed)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11, 1)
         ON CONFLICT (account, space_id, agent_id, memory_key) DO UPDATE SET
             kind = excluded.kind, content = excluded.content, reason = excluded.reason,
             source_conversation_id = CASE WHEN excluded.source_conversation_id = ''
                 THEN source_conversation_id ELSE excluded.source_conversation_id END,
             source_invocation_id = CASE WHEN excluded.source_invocation_id = ''
                 THEN source_invocation_id ELSE excluded.source_invocation_id END,
             updated_at = excluded.updated_at, changed = 1
         RETURNING id",
        params![
            account,
            format!("memory_{}", uuid::Uuid::new_v4()),
            input.space_id,
            input.agent_id,
            memory_key(content),
            kind,
            content,
            reason,
            input.source_conversation_id,
            input.source_invocation_id,
            now,
        ],
        |row| row.get(0),
    )?;
    index::put(&transaction, account, &input.space_id, FACTS, &id, content, now, false)?;
    let fact = transaction.query_row(
        &format!("SELECT {COLUMNS} FROM memory_facts WHERE account = ?1 AND id = ?2"),
        params![account, id],
        from_row,
    )?;
    transaction.commit()?;
    Ok(fact)
}

/// One agent's memories in one Space, newest first.
pub(crate) fn list(
    connection: &Connection,
    account: &str,
    space: &str,
    agent: &str,
    limit: i64,
) -> Result<Vec<MemoryFact>> {
    check_space(space)?;
    let limit = if (1..=MAX_LIST).contains(&limit) { limit } else { MAX_LIST };
    let mut statement = connection.prepare_cached(&format!(
        "SELECT {COLUMNS} FROM memory_facts
         WHERE account = ?1 AND space_id = ?2 AND agent_id = ?3
         ORDER BY updated_at DESC LIMIT ?4"
    ))?;
    let rows = statement
        .query_map(params![account, space, agent, limit], from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// What a run's prompt reads, and when it last did. Reading isn't an edit, so nothing syncs.
pub(crate) fn context(
    connection: &Connection,
    account: &str,
    space: &str,
    agent: &str,
    limit: i64,
    now: i64,
) -> Result<Vec<MemoryFact>> {
    let limit = if (1..=MAX_CONTEXT).contains(&limit) { limit } else { 20 };
    let items = list(connection, account, space, agent, limit)?;
    let mut touch = connection
        .prepare_cached("UPDATE memory_facts SET last_used_at = ?3 WHERE account = ?1 AND id = ?2")?;
    for item in &items {
        touch.execute(params![account, item.id, now])?;
    }
    Ok(items)
}

/// Editing keeps the memory's identity and scope: it can't move across agents or Spaces.
pub(crate) fn update(
    connection: &mut Connection,
    account: &str,
    space: &str,
    agent: &str,
    id: &str,
    content: &str,
    now: i64,
) -> Result<()> {
    check_space(space)?;
    let content = content.trim();
    if content.is_empty() || content.chars().count() > 1000 {
        return Err(MemoryError::Invalid("invalid_memory_node"));
    }
    let transaction = connection.transaction()?;
    let changed = transaction
        .execute(
            "UPDATE memory_facts SET content = ?5, memory_key = ?6, updated_at = ?7, changed = 1
             WHERE account = ?1 AND space_id = ?2 AND agent_id = ?3 AND id = ?4",
            params![account, space, agent, id, content, memory_key(content), now],
        )
        .map_err(|error| match error.sqlite_error_code() {
            // Another memory already says this.
            Some(rusqlite::ErrorCode::ConstraintViolation) => {
                MemoryError::Invalid("invalid_memory_node")
            }
            _ => error.into(),
        })?;
    if changed != 1 {
        return Err(MemoryError::NotFound);
    }
    index::put(&transaction, account, space, FACTS, id, content, now, false)?;
    transaction.commit()?;
    Ok(())
}

/// Forgets one memory in one Space. `None` for the agent is any of them, which is what the tree holds.
pub(crate) fn forget(
    connection: &mut Connection,
    account: &str,
    space: &str,
    agent: Option<&str>,
    id: &str,
    now: i64,
) -> Result<()> {
    check_space(space)?;
    let transaction = connection.transaction()?;
    let found: Option<(bool, String)> = transaction
        .query_row(
            "SELECT sent, agent_id FROM memory_facts WHERE account = ?1 AND space_id = ?2 AND id = ?3",
            params![account, space, id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((sent, _)) = found.filter(|(_, owner)| agent.is_none_or(|agent| agent == owner)) else {
        return Err(MemoryError::NotFound);
    };
    remove_row(&transaction, account, space, id, sent, now)?;
    transaction.commit()?;
    Ok(())
}

pub(super) fn remove_row(
    connection: &Connection,
    account: &str,
    space: &str,
    id: &str,
    sent: bool,
    now: i64,
) -> rusqlite::Result<()> {
    connection.execute(
        "DELETE FROM memory_facts WHERE account = ?1 AND id = ?2",
        params![account, id],
    )?;
    index::remove(connection, account, space, FACTS, id)?;
    if sent {
        mark_deleted(connection, account, &fact_record_id(id), now)?;
    }
    Ok(())
}
