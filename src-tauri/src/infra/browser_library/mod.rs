//! The browser's durable library: the downloads list and browsing history, in `misty.db`,
//! so they survive restarts. Finished downloads also join their Space's encrypted
//! downloads list (the files stay here); history syncs through the browser sync.

#[cfg(desktop)]
pub mod history;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

use super::store::Store;
mod legacy;
mod space;
pub(crate) use space::seed_records as seed_download_records;

mod downloads;
pub use downloads::*;

static LIBRARY: OnceLock<Mutex<Connection>> = OnceLock::new();
const MAX_DOWNLOADS: i64 = 1_000;

pub(crate) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or_default()
}

pub(crate) fn library(app: &AppHandle) -> Result<MutexGuard<'static, Connection>, String> {
    if LIBRARY.get().is_none() {
        let home = super::paths::misty_home_dir().ok_or("Misty's data folder is unavailable.")?;
        let store = Store::at(home.join(".local").join("data").join("misty.db"));
        // The library an earlier build kept beside the app's data comes along once.
        let legacy = app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?
            .join("browser-library.sqlite");
        let connection = open(&store, &legacy)?;
        let _ = LIBRARY.set(Mutex::new(connection));
    }
    LIBRARY
        .get()
        .ok_or_else(|| "The browser library is unavailable.".to_owned())?
        .lock()
        .map_err(|_| "The browser library is unavailable.".to_owned())
}

fn open(store: &Store, legacy: &Path) -> Result<Connection, String> {
    legacy::import(store, legacy).map_err(|error| error.to_string())?;
    let connection = store.connect().map_err(|error| error.to_string())?;
    // Anything still running when Misty quit can no longer finish.
    connection
        .execute(
            "UPDATE downloads SET state = 'interrupted', finished_at = ?1 WHERE state = 'in_progress'",
            params![now_ms()],
        )
        .map_err(|error| error.to_string())?;
    Ok(connection)
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BrowserDownloadEntry {
    id: String,
    url: String,
    path: String,
    file_name: String,
    /// in_progress, finished, failed, cancelled or interrupted.
    state: String,
    error: Option<String>,
    received: i64,
    total: i64,
    started_at: i64,
    finished_at: Option<i64>,
    /// Whether a finished file is still where it was saved.
    exists: bool,
    /// The device that holds the file, when it is not this one.
    device: Option<String>,
}

/// Records a download the user started. Agent downloads are task files and
/// never appear in the user's list.
pub(crate) fn download_started(app: &AppHandle, id: &str, url: &str, path: &Path) {
    let Ok(connection) = library(app) else { return };
    let _ = connection.execute(
        "INSERT OR REPLACE INTO downloads (id, url, path, state, started_at) VALUES (?1, ?2, ?3, 'in_progress', ?4)",
        params![id, url, path.to_string_lossy(), now_ms()],
    );
    let _ = connection.execute(
        "DELETE FROM downloads WHERE id IN (SELECT id FROM downloads ORDER BY started_at DESC LIMIT -1 OFFSET ?1)",
        params![MAX_DOWNLOADS],
    );
}

pub(crate) fn download_finished(app: &AppHandle, id: &str, success: bool, error: Option<&str>) {
    let Ok(connection) = library(app) else { return };
    let size = connection
        .query_row(
            "SELECT path FROM downloads WHERE id = ?1",
            params![id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .ok()
        .flatten()
        .and_then(|path| std::fs::metadata(path).ok())
        .map(|meta| meta.len() as i64);
    // A cancelled download also reports failure; keep it marked as cancelled.
    let _ = connection.execute(
        "UPDATE downloads SET state = ?2, error = ?3, finished_at = ?4,
             received = COALESCE(?5, received), total = CASE WHEN ?2 = 'finished' THEN COALESCE(?5, total) ELSE total END
         WHERE id = ?1 AND state = 'in_progress'",
        params![id, if success { "finished" } else { "failed" }, error, now_ms(), size],
    );
}

/// A finished download joins the downloads list of the Space whose pages use
/// `store_key`. The file stays where it was saved.
pub(crate) fn download_into_space(app: &AppHandle, store_key: String, id: &str) {
    let Ok(connection) = library(app) else { return };
    space::publish(&connection, store_key, id);
}

pub(crate) fn download_failed(app: &AppHandle, id: &str, url: &str, error: &str) {
    let Ok(connection) = library(app) else { return };
    let now = now_ms();
    let _ = connection.execute(
        "INSERT OR REPLACE INTO downloads (id, url, path, state, error, started_at, finished_at)
         VALUES (?1, ?2, '', 'failed', ?3, ?4, ?4)",
        params![id, url, error, now],
    );
}

fn entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<BrowserDownloadEntry> {
    let path: String = row.get(2)?;
    let state: String = row.get(3)?;
    let file_name = Path::new(&path)
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(BrowserDownloadEntry {
        id: row.get(0)?,
        url: row.get(1)?,
        exists: state == "finished" && Path::new(&path).is_file(),
        file_name,
        path,
        state,
        error: row.get(4)?,
        received: row.get(5)?,
        total: row.get(6)?,
        started_at: row.get(7)?,
        finished_at: row.get(8)?,
        device: None,
    })
}

const DOWNLOAD_COLUMNS: &str =
    "id, url, path, state, error, received, total, started_at, finished_at";

fn local_downloads(app: &AppHandle) -> Result<Vec<BrowserDownloadEntry>, String> {
    let connection = library(app)?;
    let mut statement = connection
        .prepare(&format!(
            "SELECT {DOWNLOAD_COLUMNS} FROM downloads ORDER BY started_at DESC"
        ))
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], entry)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

/// This device's downloads, then the window's Space's downloads that other
/// devices hold, newest first.
#[tauri::command]
pub async fn browser_downloads_list(
    webview: tauri::Webview,
    app: AppHandle,
) -> Result<Vec<BrowserDownloadEntry>, String> {
    let mut rows = local_downloads(&app)?;
    let space = crate::infra::browser_sync::window_space(webview.window().label());
    rows.extend(space::remote_entries(space.as_deref()).await);
    rows.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    Ok(rows)
}
