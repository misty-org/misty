//! The downloads list as Space data: a finished download is recorded in the
//! `downloads` collection of the Space it was downloaded in. The file stays on
//! the device that downloaded it; other devices list it as "On <device>".
use super::{BrowserDownloadEntry, MAX_DOWNLOADS};
use crate::infra::browser_sync::{device_name, hashed_id, space_vault, store_vault, SpaceVault};
use misty_browser_sync::{
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
    misty_browser_sync::document::entities::validate(Kind::Download, &fields).ok()?;
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

/// Records a finished download into the Space whose pages use `store_key`.
/// A private tab or a store of no open Space records nothing.
pub(crate) fn publish(connection: &Connection, store_key: String, download_id: &str) {
    let Some((url, path, total, finished_at)) = finished_row(connection, download_id) else {
        return;
    };
    let download_id = download_id.to_owned();
    tauri::async_runtime::spawn(async move {
        let Some(vault) = store_vault(&store_key).await else {
            return;
        };
        let size = (total >= 0).then_some(total);
        let finished_at = finished_at.unwrap_or_else(super::now_ms);
        let Some(record) = record(
            &download_id,
            &url,
            &path,
            size,
            finished_at,
            &vault.device_id,
        ) else {
            return;
        };
        let id = record.id.clone();
        if vault
            .handle
            .records_write(DOWNLOADS.into(), vec![(id, Some(record))])
            .await
            .is_ok()
        {
            cap(&vault).await;
        }
    });
}

/// Keeps the newest downloads, like the local list and history.
async fn cap(vault: &SpaceVault) {
    let Ok((_, records)) = vault.handle.records_list(DOWNLOADS.into()).await else {
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
    let _ = vault.handle.records_write(DOWNLOADS.into(), removed).await;
}

/// The Space's downloads that another device holds.
pub(super) async fn remote_entries(space_id: Option<&str>) -> Vec<BrowserDownloadEntry> {
    let Some(vault) = space_vault(space_id).await else {
        return Vec::new();
    };
    let Ok((_, records)) = vault.handle.records_list(DOWNLOADS.into()).await else {
        return Vec::new();
    };
    records
        .iter()
        .filter_map(|record| Some((record.id.clone(), parse(record)?)))
        .filter(|(_, download)| download.device_id != vault.device_id)
        .map(|(id, download)| BrowserDownloadEntry {
            id: format!("{REMOTE}{id}"),
            url: download.url,
            path: String::new(),
            file_name: download.file_name,
            state: "finished".into(),
            error: None,
            received: download.size.map_or(0, |size| size as i64),
            total: download.size.map_or(-1, |size| size as i64),
            started_at: download.finished_at,
            finished_at: Some(download.finished_at),
            exists: false,
            device: Some(
                device_name(&vault, &download.device_id).unwrap_or_else(|| "another device".into()),
            ),
        })
        .collect()
}

/// Removes entries from the Space's list: remote ones by their record, local
/// ones by the record their download wrote. With no ids, every entry that
/// finished at or after `since`.
pub(super) async fn remove(space_id: Option<&str>, ids: &[String], since: Option<i64>) {
    let Some(vault) = space_vault(space_id).await else {
        return;
    };
    let Ok((_, records)) = vault.handle.records_list(DOWNLOADS.into()).await else {
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
        let _ = vault.handle.records_write(DOWNLOADS.into(), removed).await;
    }
}

/// This device's finished downloads, for the personal Space's first seed.
pub(crate) fn seed_records(connection: &Connection, device_id: &str) -> Vec<ViewRecord> {
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
                device_id,
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
