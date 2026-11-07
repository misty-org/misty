//! Taking in what other computers put in the vault. The vault has already settled which edit won; this
//! makes the rows here match, without sending any of it back.
use rusqlite::{params, Connection, OptionalExtension};

use super::events::{self, MemoryEvent};
use super::forget::{self, Forget};
use super::prefs::{self, MemoryFact};
use super::sync::{time_of, SyncBody, FACT_RECORD, MOMENT_RECORD, SUMMARY_RECORD};
use super::{check_space, index, now_ms, summaries, Result, FACTS, MOMENTS};

/// Applies records from the vault: `None` is a deletion. A record this version can't read is left alone,
/// and a change made here that hasn't reached the record store yet is newer, so it stays.
pub(crate) fn apply(
    connection: &mut Connection,
    account: &str,
    records: &[(String, Option<Vec<u8>>)],
) -> Result<()> {
    let now = now_ms();
    let transaction = connection.transaction()?;
    for (id, body) in records {
        if deleted_here(&transaction, account, id)? {
            continue;
        }
        match body {
            None => delete(&transaction, account, id, now)?,
            Some(body) => {
                if let Ok(body) = serde_json::from_slice::<SyncBody>(body) {
                    apply_body(&transaction, account, id, body, now)?;
                }
            }
        }
    }
    transaction.commit()?;
    Ok(())
}

fn deleted_here(connection: &Connection, account: &str, id: &str) -> rusqlite::Result<bool> {
    connection.query_row(
        "SELECT EXISTS (SELECT 1 FROM memory_deleted WHERE account = ?1 AND record_id = ?2)",
        params![account, id],
        |row| row.get(0),
    )
}

fn delete(connection: &Connection, account: &str, record: &str, now: i64) -> Result<()> {
    if let Some(id) = record.strip_prefix(MOMENT_RECORD) {
        let space: Option<String> = connection
            .query_row(
                "SELECT space_id FROM memory_events WHERE account = ?1 AND id = ?2",
                params![account, id],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(space_id) = space {
            let selected = Forget {
                space_id,
                ids: vec![id.to_owned()],
                ..Forget::default()
            };
            forget::moments(connection, account, &selected, now, true)?;
        }
    } else if let Some(id) = record.strip_prefix(FACT_RECORD) {
        let space: Option<String> = connection
            .query_row(
                "SELECT space_id FROM memory_facts WHERE account = ?1 AND id = ?2",
                params![account, id],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(space) = space {
            prefs::remove_row(connection, account, &space, id, false, now)?;
        }
    } else if let Some((space, surface)) = record
        .strip_prefix(SUMMARY_RECORD)
        .and_then(|rest| rest.split_once(':'))
    {
        connection.execute(
            "DELETE FROM memory_summaries WHERE account = ?1 AND space_id = ?2 AND surface_id = ?3",
            params![account, space, surface],
        )?;
        index::remove(connection, account, space, super::SUMMARIES, surface)?;
    }
    Ok(())
}

fn apply_body(
    connection: &Connection,
    account: &str,
    record: &str,
    body: SyncBody,
    now: i64,
) -> Result<()> {
    match body {
        SyncBody::Moment { event } => {
            if record.strip_prefix(MOMENT_RECORD) == Some(event.id.as_str()) {
                apply_moment(connection, account, event, now)?;
            }
        }
        SyncBody::Fact { fact, agent_id, memory_key } => {
            if record.strip_prefix(FACT_RECORD) == Some(fact.id.as_str()) {
                apply_fact(connection, account, fact, &agent_id, &memory_key, now)?;
            }
        }
        SyncBody::Summary { space_id, surface_id, title, text, outline, updated_at } => {
            let expected = super::sync::summary_record_id(&space_id, &surface_id);
            if expected != record || check_space(&space_id).is_err() || text.len() > 20_000 {
                return Ok(());
            }
            let changed: bool = connection
                .query_row(
                    "SELECT changed FROM memory_summaries
                     WHERE account = ?1 AND space_id = ?2 AND surface_id = ?3",
                    params![account, space_id, surface_id],
                    |row| row.get(0),
                )
                .optional()?
                .unwrap_or(false);
            if !changed {
                summaries::put(
                    connection,
                    account,
                    &space_id,
                    &surface_id,
                    &title,
                    &text,
                    outline.as_deref(),
                    time_of(&updated_at, now),
                    true,
                )?;
            }
        }
    }
    Ok(())
}

fn apply_moment(connection: &Connection, account: &str, event: MemoryEvent, now: i64) -> Result<()> {
    if !events::valid(&event) || check_space(&event.space_id).is_err() {
        return Ok(());
    }
    let changed: bool = connection
        .query_row(
            "SELECT changed FROM memory_events WHERE account = ?1 AND id = ?2",
            params![account, event.id],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or(false);
    if changed {
        return Ok(());
    }
    events::insert(connection, account, &event, time_of(&event.occurred_at, now), now, true)?;
    index::put(
        connection,
        account,
        &event.space_id,
        MOMENTS,
        &event.id,
        &events::index_text(&event),
        now,
        true,
    )?;
    Ok(())
}

/// Two computers can remember the same words under two ids. The lower id wins on both, and the other is
/// deleted, so each ends up with the same one memory.
fn apply_fact(
    connection: &Connection,
    account: &str,
    fact: MemoryFact,
    agent: &str,
    key: &str,
    now: i64,
) -> Result<()> {
    if check_space(&fact.space_id).is_err() || fact.content.chars().count() > 1000 {
        return Ok(());
    }
    let changed: bool = connection
        .query_row(
            "SELECT changed FROM memory_facts WHERE account = ?1 AND id = ?2",
            params![account, fact.id],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or(false);
    if changed {
        return Ok(());
    }
    let same_words: Option<(String, bool)> = connection
        .query_row(
            "SELECT id, sent FROM memory_facts
             WHERE account = ?1 AND space_id = ?2 AND agent_id = ?3 AND memory_key = ?4 AND id <> ?5",
            params![account, fact.space_id, agent, key, fact.id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    if let Some((other, sent)) = same_words {
        if other < fact.id {
            super::mark_deleted(connection, account, &super::sync::fact_record_id(&fact.id), now)?;
            return Ok(());
        }
        prefs::remove_row(connection, account, &fact.space_id, &other, sent, now)?;
    }
    let updated = time_of(&fact.updated_at, now);
    connection.execute(
        "INSERT INTO memory_facts (account, id, space_id, agent_id, memory_key, kind, content, reason,
             source_conversation_id, source_invocation_id, created_at, updated_at, sent, changed)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 1, 0)
         ON CONFLICT (account, id) DO UPDATE SET space_id = excluded.space_id,
             agent_id = excluded.agent_id, memory_key = excluded.memory_key, kind = excluded.kind,
             content = excluded.content, reason = excluded.reason,
             source_conversation_id = excluded.source_conversation_id,
             source_invocation_id = excluded.source_invocation_id,
             updated_at = excluded.updated_at, sent = 1, changed = 0",
        params![
            account,
            fact.id,
            fact.space_id,
            agent,
            key,
            fact.kind,
            fact.content,
            fact.reason,
            fact.source_conversation_id,
            fact.source_invocation_id,
            time_of(&fact.created_at, now),
            updated,
        ],
    )?;
    index::put(connection, account, &fact.space_id, FACTS, &fact.id, &fact.content, now, true)?;
    Ok(())
}
