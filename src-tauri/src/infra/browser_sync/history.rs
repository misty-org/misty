//! Browsing history sync, in the pulled record tier. Each device writes its
//! visits as encrypted hourly batches (split into parts) in the `history`
//! collection; every device merges all batches into its local history. A
//! visit deleted anywhere is removed from its batch, so it goes everywhere.
//! Only history under the account's synced browser profile takes part.
use std::collections::{BTreeMap, BTreeSet};

use misty_browser_sync::{
    collections::HISTORY,
    document::{entities::Kind, ViewRecord},
};
use rusqlite::{params, Connection};
use serde_json::{json, Value};

use super::*;

mod batches;
use batches::{batch_of, parts, visits_of, Visit};

const PASS: std::time::Duration = std::time::Duration::from_secs(60);
const HOUR_MS: i64 = 3_600_000;
/// Batches kept on the server. Local history may be older.
const RETENTION_HOURS: i64 = 90 * 24;
/// Serialized visits per batch part, well inside the server's record limit.
const PART_BYTES: usize = 40 << 10;

/// Batches to write, and the local `(origin, hour)`s they cover.
type Uploads = (Vec<(String, Option<ViewRecord>)>, Vec<(String, i64)>);

pub(super) fn spawn(app: tauri::AppHandle, slot: Slot, expected: String) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(PASS);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut merged_cursor = None;
        loop {
            tick.tick().await;
            let (handle, device, profile) = {
                let current = slot.lock().await;
                let Some(active) = current.as_ref().filter(|active| active.id == expected) else {
                    break;
                };
                if !full_sync_enabled(active) {
                    continue;
                }
                let Ok(profile) = default_profile_id(&active.scope) else {
                    continue;
                };
                (active.handle.clone(), active.device_id.clone(), profile)
            };
            // A failed pass leaves everything marked and is retried next pass.
            let _ = pass(&app, &handle, &device, &profile, &mut merged_cursor).await;
        }
    })
}

async fn pass(
    app: &tauri::AppHandle,
    handle: &WorkerHandle,
    device: &str,
    profile: &str,
    merged_cursor: &mut Option<u64>,
) -> Result<(), String> {
    let (_, existing) = handle.records_list(HISTORY.into()).await.map_err(issue)?;
    let (writes, hours) = {
        let connection = super::super::browser_library::library(app)?;
        uploads(&connection, device, profile, &existing)?
    };
    if !writes.is_empty() {
        handle
            .records_write(HISTORY.into(), writes.clone())
            .await
            .map_err(issue)?;
    }
    if !hours.is_empty() {
        let connection = super::super::browser_library::library(app)?;
        uploaded(&connection, profile, &writes, &hours)?;
    }
    let (cursor, batches) = handle.records_list(HISTORY.into()).await.map_err(issue)?;
    if *merged_cursor != Some(cursor) || !writes.is_empty() {
        let connection = super::super::browser_library::library(app)?;
        merge(&connection, device, profile, &batches)?;
        *merged_cursor = Some(cursor);
    }
    Ok(())
}

/// Batches to write: every hour with visits not yet synced or with deletions,
/// rebuilt from local history; and this device's batches past retention.
fn uploads(
    connection: &Connection,
    device: &str,
    profile: &str,
    existing: &[ViewRecord],
) -> Result<Uploads, String> {
    let error = |e: rusqlite::Error| e.to_string();
    let now_hour = super::super::browser_library::now_ms() / HOUR_MS;
    let oldest = now_hour - RETENTION_HOURS;
    let mut hours: BTreeSet<(String, i64)> = BTreeSet::new();
    let mut statement = connection
        .prepare(
            "SELECT DISTINCT origin, visited_at / 3600000 FROM visits
             WHERE profile_id = ?1 AND changed = 1 AND visited_at >= ?2 * 3600000
             UNION SELECT origin, hour FROM history_dirty WHERE hour >= ?2",
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
            .prepare(
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
            device
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
        if origin == device && *hour < oldest {
            writes.extend(ids.iter().map(|id| (id.clone(), None)));
        }
    }
    Ok((writes, hours.into_iter().collect()))
}

/// The batches are queued durably: their visits are synced from here on,
/// and the hours they rewrote are no longer dirty. A deletion made while
/// the pass ran keeps its hour marked for the next one.
fn uploaded(
    connection: &Connection,
    profile: &str,
    writes: &[(String, Option<ViewRecord>)],
    hours: &[(String, i64)],
) -> Result<(), String> {
    let error = |e: rusqlite::Error| e.to_string();
    for record in writes.iter().filter_map(|(_, r)| r.as_ref()) {
        for (url, _, visited_at, _) in visits_of(record) {
            connection
                .execute(
                    "UPDATE visits SET changed = 0 WHERE profile_id = ?1 AND url = ?2 AND visited_at = ?3",
                    params![profile, url, visited_at],
                )
                .map_err(error)?;
        }
    }
    for (origin, hour) in hours {
        connection
            .execute(
                "DELETE FROM history_dirty WHERE origin = ?1 AND hour = ?2",
                params![origin, hour],
            )
            .map_err(error)?;
    }
    Ok(())
}

/// Makes local history match the batches, hour by hour. A visit not yet
/// synced from here is never removed; it is written with its hour next pass.
fn merge(
    connection: &Connection,
    device: &str,
    profile: &str,
    batches: &[ViewRecord],
) -> Result<(), String> {
    let error = |e: rusqlite::Error| e.to_string();
    let oldest = super::super::browser_library::now_ms() / HOUR_MS - RETENTION_HOURS;
    let mut hours: BTreeMap<(String, i64), Vec<Visit>> = BTreeMap::new();
    for record in batches {
        if let Some(batch) = batch_of(record) {
            hours.entry(batch).or_default().extend(visits_of(record));
        }
    }
    // Hours this machine holds synced visits for but that no batch covers
    // any longer were deleted elsewhere.
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
            device.to_owned()
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
            // This device's own visits are stored with an empty origin.
            let local_origin = if origin == device {
                ""
            } else {
                origin.as_str()
            };
            let keep: BTreeSet<(&str, i64)> = visits
                .iter()
                .map(|(url, _, at, _)| (url.as_str(), *at))
                .collect();
            let mut statement = connection.prepare(
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
            for (url, title, at, typed) in visits {
                connection.execute(
                    "INSERT INTO visits (profile_id, url, title, visited_at, typed, origin, changed)
                     SELECT ?1, ?2, ?3, ?4, ?5, ?6, 0
                     WHERE NOT EXISTS (SELECT 1 FROM visits WHERE profile_id = ?1 AND origin = ?6 AND url = ?2 AND visited_at = ?4)",
                    params![profile, url, title, at, typed, local_origin],
                )?;
            }
        }
        Ok::<_, rusqlite::Error>(())
    })();
    match result {
        Ok(()) => connection.execute_batch("COMMIT").map_err(error),
        Err(e) => {
            let _ = connection.execute_batch("ROLLBACK");
            Err(e.to_string())
        }
    }
}

#[cfg(test)]
mod tests;
