//! The downloads list as profile data: a finished download is recorded in the `downloads`
//! collection of the profile whose pages downloaded it. The file stays on the computer that
//! downloaded it; other signed-in sessions list it as "On another computer".
use super::MAX_DOWNLOADS;
use crate::browser::profiles::{self, hashed_id, ProfileRecords};
use browser_data::{
    collections::{self, DOWNLOADS},
    document::{
        entities::{Download, Kind},
        ViewRecord,
    },
};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use std::path::Path;

/// Remote entries' ids carry this prefix, so removing one never touches a
/// local row.
pub(super) const REMOTE: &str = "remote:";

fn record_id(download_id: &str) -> String {
    hashed_id("download", download_id)
}

fn record(
    download_id: &str,
    url: &str,
    path: &str,
    size: Option<i64>,
    finished_at: i64,
    device_id: &str,
) -> Option<ViewRecord> {
    let file_name = Path::new(path).file_name()?.to_string_lossy().into_owned();
    let download = Download {
        url: url.to_owned(),
        file_name,
        size: size.and_then(|size| u64::try_from(size).ok()),
        finished_at,
        device_id: device_id.to_owned(),
    };
    let Ok(Value::Object(fields)) = serde_json::to_value(&download) else {
        return None;
    };
    let fields = fields.into_iter().collect();
    // Pages' own data (blob:, data:) and odd names stay local.
    browser_data::document::entities::validate(Kind::Download, &fields).ok()?;
    Some(ViewRecord {
        kind: Kind::Download,
        id: record_id(download_id),
        fields,
    })
}

fn parse(record: &ViewRecord) -> Option<Download> {
    if record.kind != Kind::Download {
        return None;
    }
    serde_json::from_value(Value::Object(record.fields.clone().into_iter().collect())).ok()
}

type Row = (String, String, i64, Option<i64>);

fn finished_row(connection: &Connection, id: &str) -> Option<Row> {
    connection
        .query_row(
            "SELECT url, path, total, finished_at FROM downloads WHERE id = ?1 AND state = 'finished'",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .ok()
        .flatten()
}

/// Records a finished download into the profile whose pages use `store_key`.
/// A private tab's store belongs to no profile, so it records nothing.
pub(crate) fn publish(connection: &Connection, store_key: String, download_id: &str) {
    let Some((url, path, total, finished_at)) = finished_row(connection, download_id) else {
        return;
    };
    let download_id = download_id.to_owned();
    tauri::async_runtime::spawn(async move {
        let Some(records) = profiles::store_records(&store_key) else {
            return;
        };
        let Some(session) = profiles::session_id() else {
            return;
        };
        let size = (total >= 0).then_some(total);
        let finished_at = finished_at.unwrap_or_else(super::now_ms);
        let Some(record) = record(&download_id, &url, &path, size, finished_at, &session) else {
            return;
        };
        let id = record.id.clone();
        if records
            .records_write(DOWNLOADS, vec![(id, Some(record))])
            .await
            .is_ok()
        {
            cap(&records).await;
        }
    });
}

/// Keeps the newest downloads, like the local list and history.
async fn cap(profile: &ProfileRecords) {
    let Ok(records) = profile.records_list(DOWNLOADS).await else {
        return;
    };
    if records.len() <= collections::MAX_DOWNLOADS {
        return;
    }
    let mut dated: Vec<(i64, String)> = records
        .iter()
        .filter_map(|record| Some((parse(record)?.finished_at, record.id.clone())))
        .collect();
    dated.sort_unstable_by(|a, b| b.cmp(a));
    let removed = dated
        .into_iter()
        .skip(collections::MAX_DOWNLOADS)
        .map(|(_, id)| (id, None))
        .collect();
    let _ = profile.records_write(DOWNLOADS, removed).await;
}

/// Removes entries from the profile's list: remote ones by their record, local
/// ones by the record their download wrote. With no ids, every entry that
/// finished at or after `since`.
pub(super) async fn remove(window_label: &str, ids: &[String], since: Option<i64>) {
    let Some(profile) = profiles::window_records(window_label) else {
        return;
    };
    let Ok(records) = profile.records_list(DOWNLOADS).await else {
        return;
    };
    let removed: Vec<(String, Option<ViewRecord>)> = records
        .iter()
        .filter(|record| {
            if ids.is_empty() {
                parse(record).is_some_and(|d| d.finished_at >= since.unwrap_or(0))
            } else {
                ids.iter().any(|id| match id.strip_prefix(REMOTE) {
                    Some(remote) => remote == record.id,
                    None => record_id(id) == record.id,
                })
            }
        })
        .map(|record| (record.id.clone(), None))
        .collect();
    if !removed.is_empty() {
        let _ = profile.records_write(DOWNLOADS, removed).await;
    }
}

/// This computer's finished downloads, for the first profile's seed.
pub(crate) fn seed_records(connection: &Connection, session_id: &str) -> Vec<ViewRecord> {
    let Ok(mut statement) = connection.prepare(
        "SELECT id, url, path, total, finished_at FROM downloads
         WHERE state = 'finished' AND finished_at IS NOT NULL
         ORDER BY finished_at DESC LIMIT ?1",
    ) else {
        return Vec::new();
    };
    let rows = statement.query_map(params![MAX_DOWNLOADS], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, i64>(4)?,
        ))
    });
    rows.into_iter()
        .flatten()
        .flatten()
        .filter_map(|(id, url, path, total, finished_at)| {
            record(
                &id,
                &url,
                &path,
                (total >= 0).then_some(total),
                finished_at,
                session_id,
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_web_downloads_with_a_file_name_become_records() {
        let written = record(
            "d1",
            "https://a.example/r.pdf",
            "/Users/x/Downloads/r.pdf",
            Some(10),
            5,
            "device-a",
        )
        .unwrap();
        let download = parse(&written).unwrap();
        assert_eq!(
            (download.file_name.as_str(), download.size),
            ("r.pdf", Some(10))
        );
        assert_eq!(written.id, record_id("d1"));
        assert!(record(
            "d2",
            "blob:https://a.example/1",
            "/tmp/f",
            None,
            5,
            "device-a"
        )
        .is_none());
        assert!(record("d3", "https://a.example/", "", None, 5, "device-a").is_none());
    }
}
