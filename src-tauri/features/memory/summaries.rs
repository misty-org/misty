//! Summaries: a recap of one day, which the computer's own model writes, or a summary the person wrote
//! by hand. A day has one recap, and writing it again replaces it.
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use super::sync::summary_record_id;
use super::{check_space, index, MemoryError, Result, SUMMARIES};

pub(super) const MANUAL_PREFIX: &str = "manual-";
pub(super) const RECAP_PREFIX: &str = "recap-";

/// One thing a person did that day, with when it started and stopped ("15:04").
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub(crate) struct RecapThread {
    pub title: String,
    pub from: String,
    pub to: String,
}

/// What a day's recap names beside its text.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub(crate) struct RecapOutline {
    #[serde(default)]
    pub threads: Vec<RecapThread>,
    #[serde(default)]
    pub next: Vec<String>,
}

fn clock(text: &str) -> bool {
    let bytes = text.as_bytes();
    bytes.len() == 5 && bytes[2] == b':' && chrono::NaiveTime::parse_from_str(text, "%H:%M").is_ok()
}

fn valid_outline(outline: &RecapOutline) -> bool {
    outline.threads.len() <= 8
        && outline.next.len() <= 5
        && outline.threads.iter().all(|thread| {
            !thread.title.trim().is_empty()
                && thread.title.len() <= 200
                && clock(&thread.from)
                && clock(&thread.to)
        })
        && outline
            .next
            .iter()
            .all(|item| !item.trim().is_empty() && item.len() <= 300)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn put(
    connection: &Connection,
    account: &str,
    space: &str,
    surface: &str,
    title: &str,
    text: &str,
    outline: Option<&str>,
    now: i64,
    synced: bool,
) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO memory_summaries (account, space_id, surface_id, title, text, outline, updated_at,
             sent, changed)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT (account, space_id, surface_id) DO UPDATE SET title = excluded.title,
             text = excluded.text, outline = excluded.outline, updated_at = excluded.updated_at,
             sent = max(sent, excluded.sent), changed = excluded.changed",
        params![account, space, surface, title, text, outline, now, synced, !synced],
    )?;
    if !synced {
        // Written again after it was forgotten: the new copy replaces the deletion.
        connection.execute(
            "DELETE FROM memory_deleted WHERE account = ?1 AND record_id = ?2",
            params![account, summary_record_id(space, surface)],
        )?;
    }
    index::put(
        connection, account, space, SUMMARIES, surface, text, now, synced,
    )
}

/// Keeps the recap this computer wrote for one day ("2026-10-14"). Answers with the tree's id for it.
pub(crate) fn save_recap(
    connection: &mut Connection,
    account: &str,
    space: &str,
    date: &str,
    text: &str,
    outline: &RecapOutline,
    now: i64,
) -> Result<String> {
    check_space(space)?;
    let text = text.trim();
    let day = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|_| MemoryError::Invalid("invalid_day"))?;
    if text.is_empty() || text.len() > 20_000 || !valid_outline(outline) {
        return Err(MemoryError::Invalid("invalid_day"));
    }
    let stored = serde_json::to_string(outline).map_err(|_| MemoryError::Invalid("invalid_day"))?;
    let surface = format!("{RECAP_PREFIX}{}", day.format("%Y-%m-%d"));
    let title = day.format("%A, %B %-d").to_string();
    let transaction = connection.transaction()?;
    put(
        &transaction,
        account,
        space,
        &surface,
        &title,
        text,
        Some(&stored),
        now,
        false,
    )?;
    transaction.commit()?;
    Ok(format!("summary:{surface}"))
}

/// Keeps a summary the person wrote. Answers with the tree's id for it.
pub(crate) fn add_manual(
    connection: &mut Connection,
    account: &str,
    space: &str,
    title: &str,
    text: &str,
    now: i64,
) -> Result<String> {
    check_space(space)?;
    let (title, text) = (title.trim(), text.trim());
    if text.is_empty() || text.len() > 20_000 || title.len() > 200 {
        return Err(MemoryError::Invalid("invalid_memory_node"));
    }
    let surface = format!("{MANUAL_PREFIX}{}", uuid::Uuid::new_v4());
    let transaction = connection.transaction()?;
    put(
        &transaction,
        account,
        space,
        &surface,
        title,
        text,
        None,
        now,
        false,
    )?;
    transaction.commit()?;
    Ok(format!("summary:{surface}"))
}
