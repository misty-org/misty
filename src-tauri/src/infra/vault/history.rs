//! Browsing history in the vault. Each computer writes its visits as hourly batches (split into
//! parts) in each profile's `history` collection, and merges everyone's batches into its local
//! history. A visit deleted anywhere is removed from its batch, so it goes everywhere.
use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;

use misty_browser_sync::{
    collections::HISTORY,
    document::{entities::Kind, ViewRecord},
};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use tokio::time::{sleep_until, Instant};

use super::*;
use crate::infra::browser_library::{self, history::profile_key};

mod batches;
use batches::{batch_of, parts, visits_of, Visit};

const PASS: Duration = Duration::from_secs(60);
/// Incoming batches come in runs; merge once they've settled.
const SETTLE: Duration = Duration::from_secs(3);
const HOUR_MS: i64 = 3_600_000;
/// Batches kept on the server. Local history may be older.
const RETENTION_HOURS: i64 = 90 * 24;
/// Serialized visits per batch part, well inside the server's record limit.
const PART_BYTES: usize = 40 << 10;
/// Names this computer's own batches, for as long as it keeps its history.
const META_WRITER: &str = "history.writer";
/// Set once this vault holds this computer's history. Gone with the vault link, so everything goes
/// up again to a new vault, and a merge never reads the empty new vault as "all deleted".
const META_SENT: &str = "vault.history_sent";

/// Batches to write, and the local `(origin, hour)`s they cover.
type Uploads = (Vec<(String, Option<ViewRecord>)>, Vec<(String, i64)>);

/// Keeps history moving while the link runs.
pub(super) fn spawn(app: AppHandle) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut changes = profile_data::subscribe();
        // Whatever arrived while this computer wasn't looking still needs merging.
        let mut merge_all = true;
        let mut incoming = BTreeSet::new();
        let mut due = Instant::now();
        loop {
            tokio::select! {
                _ = sleep_until(due) => {}
                change = changes.recv() => {
                    match change {
                        Ok(change) if change.remote && change.collection == HISTORY => {
                            incoming.insert(change.profile);
                            due = due.min(Instant::now() + SETTLE);
                        }
                        Err(broadcast::error::RecvError::Lagged(_)) => {
                            merge_all = true;
                            due = due.min(Instant::now() + SETTLE);
                        }
                        Err(broadcast::error::RecvError::Closed) => break,
                        Ok(_) => {}
                    }
                    continue;
                }
            }
            due = Instant::now() + PASS;
            let Ok(writer) = prepare(&app).await else {
                continue;
            };
            for entry in profile_windows::listed_profiles() {
                let merging = merge_all || incoming.contains(&entry.id);
                // A failed pass leaves everything marked and is retried next pass.
                if pass(&app, &entry.id, &writer, merging).await.is_ok() {
                    incoming.remove(&entry.id);
                }
            }
            merge_all = merge_all && !incoming.is_empty();
        }
    })
}

/// This computer's writer name, starting over when the vault is new to it.
async fn prepare(app: &AppHandle) -> Result<String, String> {
    let (writer, sent) = with_store(|store| {
        let writer = match store.meta(META_WRITER)? {
            Some(writer) => writer,
            None => {
                let writer = uuid::Uuid::new_v4().to_string();
                store.set_meta(META_WRITER, &writer)?;
                writer
            }
        };
        Ok((writer, store.meta(META_SENT)?.is_some()))
    })?;
    if !sent {
        on_library(app, |connection| start_over(connection)).await?;
        with_store(|store| store.set_meta(META_SENT, "1"))?;
    }
    Ok(writer)
}

async fn on_library<T: Send + 'static>(
    app: &AppHandle,
    work: impl FnOnce(&Connection) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let app = app.clone();
    tokio::task::spawn_blocking(move || work(&*browser_library::library(&app)?))
        .await
        .map_err(|_| "The browser library is unavailable.".to_owned())?
}

/// The library names a profile by the store its pages use.
fn library_key(profile: &str) -> Result<String, String> {
    profile_windows::store_for_profile(profile).map(profile_key)
}

async fn pass(app: &AppHandle, profile: &str, writer: &str, merging: bool) -> Result<(), String> {
    let records = profile_data::profile_records(profile).ok_or("Local storage is unavailable.")?;
    let key = library_key(profile)?;
    let (key_now, writer_now) = (key.clone(), writer.to_owned());
    let dirty = on_library(app, move |connection| has_changes(connection, &key_now)).await?;
    if !dirty && !merging {
        return Ok(());
    }
    let existing = records.records_list(HISTORY).await?;
    let read_at = browser_library::now_ms();
    let (key_now, listed) = (key.clone(), existing.clone());
    let (writes, hours) = on_library(app, move |connection| {
        uploads(connection, &writer_now, &key_now, &listed)
    })
    .await?;
    if !writes.is_empty() {
        records.records_write(HISTORY, writes.clone()).await?;
    }
    let wrote = !writes.is_empty();
    if wrote || !hours.is_empty() {
        let key_now = key.clone();
        on_library(app, move |connection| {
            uploaded(connection, &key_now, &writes, &hours, read_at)
        })
        .await?;
    }
    if merging {
        let batches = if wrote {
            records.records_list(HISTORY).await?
        } else {
            existing
        };
        let writer = writer.to_owned();
        on_library(app, move |connection| {
            merge(connection, &writer, &key, &batches)
        })
        .await?;
    }
    Ok(())
}

/// Every visit counts as not yet sent.
fn start_over(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch("UPDATE visits SET changed = 1; DELETE FROM history_dirty;")
        .map_err(|error| error.to_string())
}

fn has_changes(connection: &Connection, profile: &str) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT EXISTS (SELECT 1 FROM visits WHERE profile_id = ?1 AND changed = 1 AND visited_at >= ?2)
                 OR EXISTS (SELECT 1 FROM history_dirty WHERE profile_id = ?1)",
            params![profile, (browser_library::now_ms() / HOUR_MS - RETENTION_HOURS) * HOUR_MS],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())
}

/// Batches to write: every hour with visits not yet synced or with deletions, rebuilt from local
/// history; and this computer's batches past retention.
fn uploads(
    connection: &Connection,
    writer: &str,
    profile: &str,
    existing: &[ViewRecord],
) -> Result<Uploads, String> {
    let error = |e: rusqlite::Error| e.to_string();
    let now_hour = browser_library::now_ms() / HOUR_MS;
    let oldest = now_hour - RETENTION_HOURS;
    let mut hours: BTreeSet<(String, i64)> = BTreeSet::new();
    let mut statement = connection
        .prepare(
            "SELECT DISTINCT origin, visited_at / 3600000 FROM visits
             WHERE profile_id = ?1 AND changed = 1 AND visited_at >= ?2 * 3600000
             UNION SELECT origin, hour FROM history_dirty WHERE profile_id = ?1 AND hour >= ?2",
        )
        .map_err(error)?;
    let rows = statement
        .query_map(params![profile, oldest], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(error)?;
    for row in rows {
        hours.insert(row.map_err(error)?);
    }
    let mut parts_held: BTreeMap<(String, i64), BTreeSet<String>> = BTreeMap::new();
    for record in existing {
        if let Some(batch) = batch_of(record) {
            parts_held
                .entry(batch)
                .or_default()
                .insert(record.id.clone());
        }
    }
    let mut writes = Vec::new();
    for (origin, hour) in hours.iter().cloned() {
        let mut statement = connection
            .prepare_cached(
                "SELECT url, title, visited_at, typed FROM visits
                 WHERE profile_id = ?1 AND origin = ?2 AND visited_at / 3600000 = ?3
                 ORDER BY visited_at, url",
            )
            .map_err(error)?;
        let visits: Vec<Visit> = statement
            .query_map(params![profile, origin, hour], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get::<_, i64>(3)? != 0))
            })
            .map_err(error)?
            .collect::<Result<_, _>>()
            .map_err(error)?;
        let batch_origin = if origin.is_empty() {
            writer
        } else {
            origin.as_str()
        };
        let written = parts(batch_origin, hour, &visits);
        let kept: BTreeSet<String> = written.iter().map(|r| r.id.clone()).collect();
        // Parts the hour no longer needs (it shrank, or was emptied) go.
        for stale in parts_held
            .get(&(batch_origin.to_owned(), hour))
            .into_iter()
            .flatten()
            .filter(|id| !kept.contains(*id))
        {
            writes.push((stale.clone(), None));
        }
        writes.extend(written.into_iter().map(|r| (r.id.clone(), Some(r))));
    }
    for ((origin, hour), ids) in &parts_held {
        if origin == writer && *hour < oldest {
            writes.extend(ids.iter().map(|id| (id.clone(), None)));
        }
    }
    Ok((writes, hours.into_iter().collect()))
}

/// The batches are saved: their visits are synced from here on, and the hours they rewrote are no
/// longer dirty. A deletion made after `read_at` keeps its hour marked for the next pass.
fn uploaded(
    connection: &Connection,
    profile: &str,
    writes: &[(String, Option<ViewRecord>)],
    hours: &[(String, i64)],
    read_at: i64,
) -> Result<(), String> {
    let error = |e: rusqlite::Error| e.to_string();
    connection.execute_batch("BEGIN").map_err(error)?;
    let result = (|| {
        let mut sent = connection.prepare_cached(
            "UPDATE visits SET changed = 0 WHERE profile_id = ?1 AND url = ?2 AND visited_at = ?3",
        )?;
        for record in writes.iter().filter_map(|(_, r)| r.as_ref()) {
            for (url, _, visited_at, _) in visits_of(record) {
                sent.execute(params![profile, url, visited_at])?;
            }
        }
        let mut clean = connection.prepare_cached(
            "DELETE FROM history_dirty
             WHERE profile_id = ?1 AND origin = ?2 AND hour = ?3 AND marked_at < ?4",
        )?;
        for (origin, hour) in hours {
            clean.execute(params![profile, origin, hour, read_at])?;
        }
        Ok::<_, rusqlite::Error>(())
    })();
    finish(connection, result)
}

fn finish(connection: &Connection, result: rusqlite::Result<()>) -> Result<(), String> {
    match result {
        Ok(()) => connection
            .execute_batch("COMMIT")
            .map_err(|error| error.to_string()),
        Err(error) => {
            let _ = connection.execute_batch("ROLLBACK");
            Err(error.to_string())
        }
    }
}

/// Makes local history match the batches, hour by hour. A visit not yet synced from here is never
/// removed; it is written with its hour next pass.
fn merge(
    connection: &Connection,
    writer: &str,
    profile: &str,
    batches: &[ViewRecord],
) -> Result<(), String> {
    let error = |e: rusqlite::Error| e.to_string();
    let oldest = browser_library::now_ms() / HOUR_MS - RETENTION_HOURS;
    let mut hours: BTreeMap<(String, i64), Vec<Visit>> = BTreeMap::new();
    for record in batches {
        if let Some(batch) = batch_of(record) {
            hours.entry(batch).or_default().extend(visits_of(record));
        }
    }
    // Hours this computer holds synced visits for but that no batch covers any longer were deleted
    // elsewhere.
    let mut statement = connection
        .prepare(
            "SELECT DISTINCT origin, visited_at / 3600000 FROM visits
             WHERE profile_id = ?1 AND changed = 0 AND visited_at >= ?2 * 3600000",
        )
        .map_err(error)?;
    let local: Vec<(String, i64)> = statement
        .query_map(params![profile, oldest], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(error)?
        .collect::<Result<_, _>>()
        .map_err(error)?;
    for (origin, hour) in local {
        let batch_origin = if origin.is_empty() {
            writer.to_owned()
        } else {
            origin
        };
        hours.entry((batch_origin, hour)).or_default();
    }
    connection.execute_batch("BEGIN").map_err(error)?;
    let result = (|| {
        for ((origin, hour), visits) in &hours {
            if *hour < oldest {
                continue;
            }
            // This computer's own visits are stored with an empty origin.
            let local_origin = if origin == writer {
                ""
            } else {
                origin.as_str()
            };
            let keep: BTreeSet<(&str, i64)> = visits
                .iter()
                .map(|(url, _, at, _)| (url.as_str(), *at))
                .collect();
            let mut statement = connection.prepare_cached(
                "SELECT id, url, visited_at FROM visits
                 WHERE profile_id = ?1 AND origin = ?2 AND visited_at / 3600000 = ?3 AND changed = 0",
            )?;
            let present: Vec<(i64, String, i64)> = statement
                .query_map(params![profile, local_origin, hour], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?))
                })?
                .collect::<Result<_, _>>()?;
            for (id, url, at) in &present {
                if !keep.contains(&(url.as_str(), *at)) {
                    connection.execute("DELETE FROM visits WHERE id = ?1", params![id])?;
                }
            }
            let mut insert = connection.prepare_cached(
                "INSERT INTO visits (profile_id, url, title, visited_at, typed, origin, changed)
                 SELECT ?1, ?2, ?3, ?4, ?5, ?6, 0
                 WHERE NOT EXISTS (SELECT 1 FROM visits WHERE profile_id = ?1 AND origin = ?6 AND url = ?2 AND visited_at = ?4)",
            )?;
            for (url, title, at, typed) in visits {
                insert.execute(params![profile, url, title, at, typed, local_origin])?;
            }
        }
        Ok::<_, rusqlite::Error>(())
    })();
    finish(connection, result)
}

/// A deleted profile's visits. Its batches go with its records.
pub(crate) fn forget_profile(connection: &Connection, key: &str) -> rusqlite::Result<()> {
    connection.execute("DELETE FROM visits WHERE profile_id = ?1", params![key])?;
    connection.execute(
        "DELETE FROM history_dirty WHERE profile_id = ?1",
        params![key],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests;
