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

const PASS: std::time::Duration = std::time::Duration::from_secs(60);
const HOUR_MS: i64 = 3_600_000;
/// Batches kept on the server. Local history may be older.
const RETENTION_HOURS: i64 = 90 * 24;
/// Serialized visits per batch part, well inside the server's record limit.
const PART_BYTES: usize = 40 << 10;

type Visit = (String, String, i64, bool);

fn batch_id(origin: &str, hour: i64, part: usize) -> String {
    format!("history:{origin}:{hour}:{part}")
}

/// `(origin, hour)` of a batch record, if it is one.
fn batch_of(record: &ViewRecord) -> Option<(String, i64)> {
    if record.kind != Kind::HistoryBatch {
        return None;
    }
    Some((
        record.fields.get("origin")?.as_str()?.to_owned(),
        record.fields.get("hour")?.as_i64()?,
    ))
}

/// Batches to write, and the local `(origin, hour)`s they cover.
type Uploads = (Vec<(String, Option<ViewRecord>)>, Vec<(String, i64)>);

fn visits_of(record: &ViewRecord) -> Vec<Visit> {
    record
        .fields
        .get("visits")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|v| {
            Some((
                v.get("url")?.as_str()?.to_owned(),
                v.get("title")?.as_str()?.to_owned(),
                v.get("visited_at")?.as_i64()?,
                v.get("typed")?.as_bool()?,
            ))
        })
        .collect()
}

/// One hour's visits as batch parts of bounded size.
fn parts(origin: &str, hour: i64, visits: &[Visit]) -> Vec<ViewRecord> {
    let mut out = Vec::new();
    let mut chunk: Vec<Value> = Vec::new();
    let mut bytes = 0;
    let flush = |chunk: &mut Vec<Value>, out: &mut Vec<ViewRecord>| {
        if chunk.is_empty() {
            return;
        }
        let part = out.len();
        let fields = serde_json::from_value(json!({
            "origin": origin, "hour": hour, "part": part, "visits": std::mem::take(chunk),
        }))
        .unwrap_or_default();
        out.push(ViewRecord {
            kind: Kind::HistoryBatch,
            id: batch_id(origin, hour, part),
            fields,
        });
    };
    for (url, title, visited_at, typed) in visits {
        let visit = json!({"url": url, "title": title, "visited_at": visited_at, "typed": typed});
        let size = visit.to_string().len();
        if bytes + size > PART_BYTES || chunk.len() >= 2000 {
            flush(&mut chunk, &mut out);
            bytes = 0;
        }
        bytes += size;
        chunk.push(visit);
    }
    flush(&mut chunk, &mut out);
    out
}

pub(super) fn spawn(app: tauri::AppHandle, expected: String) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(PASS);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut merged_cursor = None;
        loop {
            tick.tick().await;
            let (handle, device, profile) = {
                let current = session().lock().await;
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
mod tests {
    use super::*;

    fn library() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE visits (id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id TEXT NOT NULL,
                   url TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', visited_at INTEGER NOT NULL,
                   typed INTEGER NOT NULL DEFAULT 0, origin TEXT NOT NULL DEFAULT '', changed INTEGER NOT NULL DEFAULT 1);
                 CREATE TABLE history_dirty (origin TEXT NOT NULL, hour INTEGER NOT NULL, PRIMARY KEY (origin, hour));",
            )
            .unwrap();
        connection
    }

    fn visit(connection: &Connection, url: &str, at: i64) {
        connection
            .execute(
                "INSERT INTO visits (profile_id, url, title, visited_at) VALUES ('p', ?1, 'T', ?2)",
                params![url, at],
            )
            .unwrap();
    }

    fn urls(connection: &Connection) -> Vec<(String, String)> {
        let mut s = connection
            .prepare("SELECT origin, url FROM visits ORDER BY origin, url")
            .unwrap();
        s.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    #[test]
    fn visits_travel_as_hourly_batches_and_merge_on_other_devices() {
        let now = super::super::super::browser_library::now_ms();
        let a = library();
        visit(&a, "https://one.test/", now);
        visit(&a, "https://two.test/", now);
        let (writes, hours) = uploads(&a, "device-a", "p", &[]).unwrap();
        assert_eq!(writes.len(), 1);
        uploaded(&a, "p", &writes, &hours).unwrap();
        // Nothing left to send until something changes.
        assert!(uploads(&a, "device-a", "p", &[]).unwrap().0.is_empty());

        let batches: Vec<ViewRecord> = writes.into_iter().filter_map(|(_, r)| r).collect();
        let b = library();
        merge(&b, "device-b", "p", &batches).unwrap();
        assert_eq!(
            urls(&b),
            [
                ("device-a".to_string(), "https://one.test/".to_string()),
                ("device-a".to_string(), "https://two.test/".to_string()),
            ]
        );
        // Merging again changes nothing.
        merge(&b, "device-b", "p", &batches).unwrap();
        assert_eq!(urls(&b).len(), 2);
    }

    #[test]
    fn a_visit_deleted_on_another_device_leaves_every_device() {
        let now = super::super::super::browser_library::now_ms();
        let a = library();
        visit(&a, "https://one.test/", now);
        visit(&a, "https://two.test/", now);
        let (writes, hours) = uploads(&a, "device-a", "p", &[]).unwrap();
        uploaded(&a, "p", &writes, &hours).unwrap();
        let batches: Vec<ViewRecord> = writes.into_iter().filter_map(|(_, r)| r).collect();

        // Device B deletes one of A's visits: it rewrites A's batch.
        let b = library();
        merge(&b, "device-b", "p", &batches).unwrap();
        b.execute(
            "INSERT INTO history_dirty SELECT origin, visited_at / 3600000 FROM visits WHERE url = 'https://one.test/'",
            [],
        )
        .unwrap();
        b.execute("DELETE FROM visits WHERE url = 'https://one.test/'", [])
            .unwrap();
        let (rewrite, _) = uploads(&b, "device-b", "p", &batches).unwrap();
        let rewritten: Vec<ViewRecord> = rewrite.into_iter().filter_map(|(_, r)| r).collect();
        assert_eq!(rewritten.len(), 1);
        assert_eq!(batch_of(&rewritten[0]).unwrap().0, "device-a");

        // A merges its own rewritten batch: the deleted visit goes there too.
        merge(&a, "device-a", "p", &rewritten).unwrap();
        assert_eq!(urls(&a), [(String::new(), "https://two.test/".to_string())]);
    }

    #[test]
    fn an_unsynced_visit_survives_a_merge() {
        let now = super::super::super::browser_library::now_ms();
        let a = library();
        visit(&a, "https://new.test/", now);
        merge(&a, "device-a", "p", &[]).unwrap();
        assert_eq!(urls(&a).len(), 1);
    }

    #[test]
    fn a_busy_hour_splits_into_parts() {
        let visits: Vec<Visit> = (0..3000)
            .map(|i| {
                (
                    format!("https://site.test/{i}"),
                    "Title".into(),
                    7 * HOUR_MS + i,
                    false,
                )
            })
            .collect();
        let written = parts("device-a", 7, &visits);
        assert!(written.len() > 1);
        let total: usize = written.iter().map(|r| visits_of(r).len()).sum();
        assert_eq!(total, 3000);
        for record in &written {
            misty_browser_sync::document::entities::validate(Kind::HistoryBatch, &record.fields)
                .unwrap();
        }
    }
}
