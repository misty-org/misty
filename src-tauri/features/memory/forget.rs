//! Forgetting: everything, one site, a time range, or one node of the tree. A forgotten record is gone
//! from this computer, its vector with it, and a sealed deletion takes it off the others.
use rusqlite::{params, Connection};
use serde::Serialize;

use super::events::{index_text, MemoryEvent};
use super::sync::{fact_record_id, summary_record_id, MOMENT_RECORD};
use super::{
    check_space, index, mark_deleted, MemoryError, Result, FACTS, MOMENTS, SUMMARIES, WORKFLOWS,
};

/// What to forget in one Space: everything, one site, or a time range. Ids, a kind or a capture session
/// narrow it further.
#[derive(Debug, Default, Clone)]
pub(crate) struct Forget {
    pub space_id: String,
    pub all: bool,
    pub site: String,
    pub from: Option<i64>,
    pub to: Option<i64>,
    pub ids: Vec<String>,
    pub kind: String,
    pub session_id: String,
}

const MATCH: &str = "account = ?1 AND space_id = ?2 AND (?3 OR (
         (?4 = '' OR site = ?4 OR (length(site) > length(?4) AND substr(site, -length(?4) - 1) = '.' || ?4))
         AND (?5 IS NULL OR occurred_at >= ?5) AND (?6 IS NULL OR occurred_at < ?6)))
     AND (?7 = '[]' OR id IN (SELECT value FROM json_each(?7)))
     AND (?8 = '' OR kind = ?8) AND (?9 = '' OR session_id = ?9)";

fn check(forget: &Forget) -> Result<()> {
    check_space(&forget.space_id)?;
    let narrowed =
        !forget.ids.is_empty() || !forget.kind.is_empty() || !forget.session_id.is_empty();
    let ranged = matches!((forget.from, forget.to), (Some(from), Some(to)) if to > from);
    if forget.all || narrowed || !forget.site.trim().is_empty() || ranged {
        Ok(())
    } else {
        Err(MemoryError::Invalid("invalid_forget"))
    }
}

/// Puts the matching moments in `memory_forgetting`, a table this connection alone sees.
fn select(connection: &Connection, account: &str, forget: &Forget) -> rusqlite::Result<()> {
    connection.execute_batch(
        "CREATE TEMP TABLE IF NOT EXISTS memory_forgetting (id TEXT PRIMARY KEY);
         DELETE FROM temp.memory_forgetting;",
    )?;
    let site = forget.site.trim().to_lowercase();
    let ids = serde_json::to_string(&forget.ids).unwrap_or_else(|_| "[]".to_owned());
    connection.execute(
        &format!("INSERT INTO temp.memory_forgetting SELECT id FROM memory_events WHERE {MATCH}"),
        params![
            account,
            forget.space_id,
            forget.all,
            site,
            forget.from,
            forget.to,
            ids,
            forget.kind,
            forget.session_id
        ],
    )?;
    Ok(())
}

/// How many moments `moments` would delete.
pub(crate) fn count_moments(
    connection: &Connection,
    account: &str,
    forget: &Forget,
) -> Result<i64> {
    check(forget)?;
    select(connection, account, forget)?;
    Ok(
        connection.query_row("SELECT count(*) FROM temp.memory_forgetting", [], |row| {
            row.get(0)
        })?,
    )
}

/// Deletes the matching moments. A later revisit outside them keeps the text it pointed at, and now
/// holds it, so it needs a vector and goes out to the other computers. `from_vault` is a deletion that
/// came from elsewhere, which has nobody left to tell.
pub(crate) fn moments(
    connection: &Connection,
    account: &str,
    forget: &Forget,
    now: i64,
    from_vault: bool,
) -> Result<i64> {
    check(forget)?;
    select(connection, account, forget)?;
    let promoted: Vec<MemoryEvent> = {
        let mut statement = connection.prepare_cached(
            "SELECT k.id, k.space_id, k.kind, k.title, h.body FROM memory_events k
             JOIN memory_events h ON h.account = k.account AND h.id = k.same_as
             WHERE k.account = ?1 AND k.same_as IN (SELECT id FROM temp.memory_forgetting)
               AND k.id NOT IN (SELECT id FROM temp.memory_forgetting)",
        )?;
        let rows = statement.query_map(params![account], |row| {
            Ok(MemoryEvent {
                id: row.get(0)?,
                space_id: row.get(1)?,
                kind: row.get(2)?,
                title: row.get(3)?,
                body: row.get(4)?,
                ..MemoryEvent::default()
            })
        })?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    for event in &promoted {
        connection.execute(
            "UPDATE memory_events SET body = ?3, same_as = NULL, updated_at = ?4, changed = 1
             WHERE account = ?1 AND id = ?2",
            params![account, event.id, event.body, now],
        )?;
        index::put(
            connection,
            account,
            &event.space_id,
            MOMENTS,
            &event.id,
            &index_text(event),
            now,
            false,
        )?;
    }
    if !from_vault {
        connection.execute(
            "INSERT OR REPLACE INTO memory_deleted (account, record_id, deleted_at)
             SELECT ?1, ?3 || id, ?2 FROM memory_events
             WHERE account = ?1 AND sent = 1 AND id IN (SELECT id FROM temp.memory_forgetting)",
            params![account, now, MOMENT_RECORD],
        )?;
    }
    connection.execute(
        "DELETE FROM memory_chunks WHERE account = ?1 AND branch = 'moments'
             AND record_id IN (SELECT id FROM temp.memory_forgetting)",
        params![account],
    )?;
    let deleted = connection.execute(
        "DELETE FROM memory_events
         WHERE account = ?1 AND id IN (SELECT id FROM temp.memory_forgetting)",
        params![account],
    )?;
    Ok(deleted as i64)
}

/// What forgetting a node removed, or would remove.
#[derive(Debug, Default, Clone, PartialEq, Serialize)]
pub(crate) struct ForgetCounts {
    pub moments: i64,
    pub summaries: i64,
    pub facts: i64,
    pub workflows: i64,
}

impl ForgetCounts {
    pub(crate) fn total(&self) -> i64 {
        self.moments + self.summaries + self.facts + self.workflows
    }
}

/// One node of the tree and everything under it in one Space: "space" (every branch), a branch, a
/// moments group or a single record. A time range limits moments only, matching what the page listed.
/// With `dry` nothing is deleted and the counts say what would be.
#[allow(clippy::too_many_arguments)]
pub(crate) fn node(
    connection: &mut Connection,
    account: &str,
    space: &str,
    node: &str,
    from: Option<i64>,
    to: Option<i64>,
    dry: bool,
    now: i64,
) -> Result<ForgetCounts> {
    check_space(space)?;
    let node = node.trim();
    let ranged = matches!((from, to), (Some(from), Some(to)) if to > from);
    let mut selected = Forget {
        space_id: space.to_owned(),
        all: !ranged,
        ..Forget::default()
    };
    if ranged {
        (selected.from, selected.to) = (from, to);
    }
    let invalid = || MemoryError::Invalid("invalid_forget");
    let (head, rest) = node.split_once(':').unwrap_or((node, ""));
    let (branch, record) = match head {
        "space" if rest.is_empty() => ("all", ""),
        MOMENTS | SUMMARIES | FACTS | WORKFLOWS if rest.is_empty() => (head, ""),
        MOMENTS => {
            let (name, value) = rest.split_once(':').unwrap_or((rest, ""));
            selected.all = false;
            if value.is_empty() {
                return Err(invalid());
            }
            match name {
                "site" => selected.site = value.to_owned(),
                "kind" => selected.kind = value.to_owned(),
                "session" => selected.session_id = value.to_owned(),
                _ => return Err(invalid()),
            }
            (MOMENTS, "")
        }
        "moment" if !rest.is_empty() => {
            selected.all = false;
            selected.ids = vec![rest.to_owned()];
            (MOMENTS, "")
        }
        "summary" if !rest.is_empty() => (SUMMARIES, rest),
        "fact" if !rest.is_empty() => (FACTS, rest),
        "workflow" if !rest.is_empty() => (WORKFLOWS, rest),
        _ => return Err(invalid()),
    };
    let all = branch == "all";
    let mut counts = ForgetCounts::default();
    let transaction = connection.transaction()?;
    if all || branch == MOMENTS {
        counts.moments = if dry {
            count_moments(&transaction, account, &selected)?
        } else {
            moments(&transaction, account, &selected, now, false)?
        };
    }
    if all || branch == SUMMARIES {
        counts.summaries = summaries(&transaction, account, space, record, dry, now)?;
    }
    if all || branch == FACTS {
        counts.facts = facts(&transaction, account, space, record, dry, now)?;
    }
    // Saved workflows live with their own tools, so forgetting one is theirs too.
    transaction.commit()?;
    Ok(counts)
}

fn summaries(
    connection: &Connection,
    account: &str,
    space: &str,
    surface: &str,
    dry: bool,
    now: i64,
) -> rusqlite::Result<i64> {
    let mut statement = connection.prepare_cached(
        "SELECT surface_id, sent FROM memory_summaries
         WHERE account = ?1 AND space_id = ?2 AND (?3 = '' OR surface_id = ?3)",
    )?;
    let rows: Vec<(String, bool)> = statement
        .query_map(params![account, space, surface], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?
        .collect::<rusqlite::Result<_>>()?;
    if dry {
        return Ok(rows.len() as i64);
    }
    for (surface, sent) in &rows {
        connection.execute(
            "DELETE FROM memory_summaries WHERE account = ?1 AND space_id = ?2 AND surface_id = ?3",
            params![account, space, surface],
        )?;
        index::remove(connection, account, space, SUMMARIES, surface)?;
        if *sent {
            mark_deleted(connection, account, &summary_record_id(space, surface), now)?;
        }
    }
    Ok(rows.len() as i64)
}

fn facts(
    connection: &Connection,
    account: &str,
    space: &str,
    id: &str,
    dry: bool,
    now: i64,
) -> rusqlite::Result<i64> {
    let mut statement = connection.prepare_cached(
        "SELECT id, sent FROM memory_facts
         WHERE account = ?1 AND space_id = ?2 AND (?3 = '' OR id = ?3)",
    )?;
    let rows: Vec<(String, bool)> = statement
        .query_map(params![account, space, id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?
        .collect::<rusqlite::Result<_>>()?;
    if dry {
        return Ok(rows.len() as i64);
    }
    for (id, sent) in &rows {
        connection.execute(
            "DELETE FROM memory_facts WHERE account = ?1 AND id = ?2",
            params![account, id],
        )?;
        index::remove(connection, account, space, FACTS, id)?;
        if *sent {
            mark_deleted(connection, account, &fact_record_id(id), now)?;
        }
    }
    Ok(rows.len() as i64)
}
