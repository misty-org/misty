//! How memory travels between computers: one sealed vault record per moment, fact and summary, in the
//! account's `memory` collection, with its Space inside the sealed body. The server sees opaque records.
//!
//! Vectors don't travel. Each computer makes its own on its own model, which may not be the other's, and
//! 3 KB per record of storage nobody can read is the bigger running cost.
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use super::events::{self, MemoryEvent};
use super::prefs::MemoryFact;
use super::{parse_time, rfc3339, Result};

/// How much of a page's text syncs, in bytes. Undecided, so for now it is all of it: a moment holds at
/// most this much, and that fits a vault record even if every character needs escaping (256 KiB). Lower
/// this to sync less; text past the limit stays on the computer that read it, cut at a character.
pub(crate) const SYNC_PAGE_TEXT_BYTES: usize = events::MAX_BODY_BYTES;

pub(crate) const MOMENT_RECORD: &str = "moment:";
pub(crate) const FACT_RECORD: &str = "fact:";
pub(crate) const SUMMARY_RECORD: &str = "summary:";

pub(crate) fn moment_record_id(id: &str) -> String {
    format!("{MOMENT_RECORD}{id}")
}

pub(crate) fn fact_record_id(id: &str) -> String {
    format!("{FACT_RECORD}{id}")
}

pub(crate) fn summary_record_id(space: &str, surface: &str) -> String {
    format!("{SUMMARY_RECORD}{space}:{surface}")
}

/// What a record holds, once opened.
#[derive(Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "record", rename_all = "snake_case")]
pub(crate) enum SyncBody {
    Moment {
        event: MemoryEvent,
    },
    Fact {
        fact: MemoryFact,
        agent_id: String,
        memory_key: String,
    },
    Summary {
        space_id: String,
        surface_id: String,
        title: String,
        text: String,
        outline: Option<String>,
        updated_at: String,
    },
}

/// Text cut to what syncs, at a character.
pub(crate) fn synced_text(text: &str, limit: usize) -> &str {
    if text.len() <= limit {
        return text;
    }
    let mut end = limit;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

/// One change for the record store. `stamp` says which version of the row it was made from, so an edit
/// made while it was being written stays marked.
#[derive(Debug)]
pub(crate) struct Outgoing {
    pub id: String,
    pub body: Option<Vec<u8>>,
    stamp: i64,
}

/// Never `None`, which would be a deletion. These types always serialize, and the vault ignores a record
/// it can't read.
fn encoded(body: &SyncBody) -> Option<Vec<u8>> {
    Some(serde_json::to_vec(body).unwrap_or_default())
}

/// The next changes to give the vault: deletions first, so a record can't come back.
pub(crate) fn outgoing(connection: &Connection, account: &str, limit: i64) -> Result<Vec<Outgoing>> {
    let mut out = Vec::new();
    let mut statement = connection.prepare_cached(
        "SELECT record_id, deleted_at FROM memory_deleted WHERE account = ?1 LIMIT ?2",
    )?;
    let rows = statement.query_map(params![account, limit], |row| {
        Ok(Outgoing {
            id: row.get(0)?,
            body: None,
            stamp: row.get(1)?,
        })
    })?;
    for row in rows {
        out.push(row?);
    }
    let left = |out: &Vec<Outgoing>| limit - out.len() as i64;
    let mut statement = connection.prepare_cached(&format!(
        "{} WHERE e.account = ?1 AND e.changed = 1 LIMIT ?2",
        events::SELECTED
    ))?;
    let rows = statement.query_map(params![account, left(&out)], |row| {
        let mut event = events::from_row(row)?;
        // A revisit's text belongs to the visit it points at.
        if !event.same_as.is_empty() {
            event.body.clear();
        }
        event.body = synced_text(&event.body, SYNC_PAGE_TEXT_BYTES).to_owned();
        let stamp: i64 = row.get(16)?;
        Ok(Outgoing {
            id: moment_record_id(&event.id),
            body: encoded(&SyncBody::Moment { event }),
            stamp,
        })
    })?;
    for row in rows {
        out.push(row?);
    }
    let mut statement = connection.prepare_cached(
        "SELECT id, space_id, kind, content, reason, source_conversation_id, source_invocation_id,
             created_at, updated_at, agent_id, memory_key
         FROM memory_facts WHERE account = ?1 AND changed = 1 LIMIT ?2",
    )?;
    let rows = statement.query_map(params![account, left(&out)], |row| {
        let stamp: i64 = row.get(8)?;
        let id: String = row.get(0)?;
        let fact = MemoryFact {
            id: id.clone(),
            space_id: row.get(1)?,
            kind: row.get(2)?,
            content: row.get(3)?,
            reason: row.get(4)?,
            source_conversation_id: row.get(5)?,
            source_invocation_id: row.get(6)?,
            last_used_at: None,
            created_at: rfc3339(row.get(7)?),
            updated_at: rfc3339(stamp),
        };
        Ok(Outgoing {
            id: fact_record_id(&id),
            body: encoded(&SyncBody::Fact {
                fact,
                agent_id: row.get(9)?,
                memory_key: row.get(10)?,
            }),
            stamp,
        })
    })?;
    for row in rows {
        out.push(row?);
    }
    let mut statement = connection.prepare_cached(
        "SELECT space_id, surface_id, title, text, outline, updated_at
         FROM memory_summaries WHERE account = ?1 AND changed = 1 LIMIT ?2",
    )?;
    let rows = statement.query_map(params![account, left(&out)], |row| {
        let (space_id, surface_id): (String, String) = (row.get(0)?, row.get(1)?);
        let stamp: i64 = row.get(5)?;
        Ok(Outgoing {
            id: summary_record_id(&space_id, &surface_id),
            body: encoded(&SyncBody::Summary {
                space_id,
                surface_id,
                title: row.get(2)?,
                text: row.get(3)?,
                outline: row.get(4)?,
                updated_at: rfc3339(stamp),
            }),
            stamp,
        })
    })?;
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// The record store has these. A row edited since keeps its mark.
pub(crate) fn sent(connection: &mut Connection, account: &str, rows: &[Outgoing]) -> Result<()> {
    let transaction = connection.transaction()?;
    for row in rows {
        if row.body.is_none() {
            transaction.execute(
                "DELETE FROM memory_deleted WHERE account = ?1 AND record_id = ?2 AND deleted_at = ?3",
                params![account, row.id, row.stamp],
            )?;
        } else if let Some(id) = row.id.strip_prefix(MOMENT_RECORD) {
            transaction.execute(
                "UPDATE memory_events SET changed = 0, sent = 1
                 WHERE account = ?1 AND id = ?2 AND updated_at = ?3",
                params![account, id, row.stamp],
            )?;
        } else if let Some(id) = row.id.strip_prefix(FACT_RECORD) {
            transaction.execute(
                "UPDATE memory_facts SET changed = 0, sent = 1
                 WHERE account = ?1 AND id = ?2 AND updated_at = ?3",
                params![account, id, row.stamp],
            )?;
        } else if let Some((space, surface)) = row
            .id
            .strip_prefix(SUMMARY_RECORD)
            .and_then(|rest| rest.split_once(':'))
        {
            transaction.execute(
                "UPDATE memory_summaries SET changed = 0, sent = 1
                 WHERE account = ?1 AND space_id = ?2 AND surface_id = ?3 AND updated_at = ?4",
                params![account, space, surface, row.stamp],
            )?;
        }
    }
    transaction.commit()?;
    Ok(())
}

/// A vault new to this computer: everything here goes up. Deletions still go out, since the record
/// store keeps its copies from the last vault to upload to this one, and `sent` stays so a row forgotten
/// from here on takes its copy with it.
pub(crate) fn start_over(connection: &Connection, account: &str) -> Result<()> {
    for table in ["memory_events", "memory_facts", "memory_summaries"] {
        connection.execute(
            &format!("UPDATE {table} SET changed = 1 WHERE account = ?1"),
            params![account],
        )?;
    }
    Ok(())
}

pub(super) fn time_of(text: &str, fallback: i64) -> i64 {
    parse_time(text).unwrap_or(fallback)
}
