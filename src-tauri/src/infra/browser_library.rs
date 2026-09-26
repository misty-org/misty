//! The browser's durable library: the downloads list and browsing history.
//! Both live in one SQLite file in the app's data directory, so they survive
//! restarts and stay with the local device (they are not synchronized).

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

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
        let directory = app.path().app_data_dir().map_err(|error| error.to_string())?;
        let connection = open(&directory.join("browser-library.sqlite"))?;
        let _ = LIBRARY.set(Mutex::new(connection));
    }
    LIBRARY
        .get()
        .ok_or_else(|| "The browser library is unavailable.".to_owned())?
        .lock()
        .map_err(|_| "The browser library is unavailable.".to_owned())
}

fn open(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let connection = Connection::open(path).map_err(|error| error.to_string())?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| error.to_string())?;
    connection
        .execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS downloads (
                 id TEXT PRIMARY KEY,
                 url TEXT NOT NULL,
                 path TEXT NOT NULL,
                 state TEXT NOT NULL,
                 error TEXT,
                 received INTEGER NOT NULL DEFAULT 0,
                 total INTEGER NOT NULL DEFAULT -1,
                 started_at INTEGER NOT NULL,
                 finished_at INTEGER
             );
             CREATE INDEX IF NOT EXISTS downloads_started ON downloads(started_at);
             CREATE TABLE IF NOT EXISTS visits (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 profile_id TEXT NOT NULL,
                 url TEXT NOT NULL,
                 title TEXT NOT NULL DEFAULT '',
                 visited_at INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS visits_profile_time ON visits(profile_id, visited_at);
             CREATE INDEX IF NOT EXISTS visits_profile_url ON visits(profile_id, url);",
        )
        .map_err(|error| error.to_string())?;
    migrate(&connection)?;
    // Anything still running when Misty quit can no longer finish.
    connection
        .execute(
            "UPDATE downloads SET state = 'interrupted', finished_at = ?1 WHERE state = 'in_progress'",
            params![now_ms()],
        )
        .map_err(|error| error.to_string())?;
    Ok(connection)
}

/// Schema changes after the original tables, applied once in order and
/// tracked with SQLite's `user_version`.
fn migrate(connection: &Connection) -> Result<(), String> {
    const MIGRATIONS: &[&str] = &[
        // 1: whether the person typed the address, which the address bar ranks highest.
        "ALTER TABLE visits ADD COLUMN typed INTEGER NOT NULL DEFAULT 0;",
    ];
    let version: usize = connection
        .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
        .map_err(|error| error.to_string())?
        .max(0) as usize;
    for (index, migration) in MIGRATIONS.iter().enumerate().skip(version) {
        connection
            .execute_batch(&format!("BEGIN; {migration} PRAGMA user_version = {}; COMMIT;", index + 1))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
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
        .query_row("SELECT path FROM downloads WHERE id = ?1", params![id], |row| row.get::<_, String>(0))
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
    })
}

const DOWNLOAD_COLUMNS: &str =
    "id, url, path, state, error, received, total, started_at, finished_at";

#[tauri::command]
pub fn browser_downloads_list(app: AppHandle) -> Result<Vec<BrowserDownloadEntry>, String> {
    let connection = library(&app)?;
    let mut statement = connection
        .prepare(&format!("SELECT {DOWNLOAD_COLUMNS} FROM downloads ORDER BY started_at DESC"))
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], entry)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

fn download_path(app: &AppHandle, id: &str) -> Result<(PathBuf, String), String> {
    let connection = library(app)?;
    connection
        .query_row("SELECT path, state FROM downloads WHERE id = ?1", params![id], |row| {
            Ok((PathBuf::from(row.get::<_, String>(0)?), row.get::<_, String>(1)?))
        })
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "That download is no longer in the list.".to_owned())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserDownloadProgress {
    id: String,
    received: i64,
    total: i64,
}

/// Bytes received so far for every download still in progress.
#[tauri::command]
pub async fn browser_downloads_progress(app: AppHandle) -> Result<Vec<BrowserDownloadProgress>, String> {
    let active = {
        let connection = library(&app)?;
        let mut statement = connection
            .prepare("SELECT id, path FROM downloads WHERE state = 'in_progress'")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
            .map_err(|error| error.to_string())?
            .filter_map(Result::ok)
            .collect::<Vec<_>>();
        rows
    };
    if active.is_empty() {
        return Ok(Vec::new());
    }
    let progress = native_progress(&app, active).await?;
    if let Ok(connection) = library(&app) {
        for item in &progress {
            let _ = connection.execute(
                "UPDATE downloads SET received = ?2, total = ?3 WHERE id = ?1 AND state = 'in_progress'",
                params![item.id, item.received, item.total],
            );
        }
    }
    Ok(progress)
}

#[cfg(target_os = "macos")]
async fn native_progress(
    app: &AppHandle,
    active: Vec<(String, String)>,
) -> Result<Vec<BrowserDownloadProgress>, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let progress = active
            .into_iter()
            .map(|(id, path)| {
                let (received, total) = wry::download_progress(&path).unwrap_or_else(|| {
                    (std::fs::metadata(&path).map(|meta| meta.len() as i64).unwrap_or(0), -1)
                });
                BrowserDownloadProgress { id, received, total }
            })
            .collect::<Vec<_>>();
        let _ = sender.send(progress);
    })
    .map_err(|error| error.to_string())?;
    receiver.await.map_err(|_| "Download progress is unavailable.".to_owned())
}

#[cfg(not(target_os = "macos"))]
async fn native_progress(
    _app: &AppHandle,
    active: Vec<(String, String)>,
) -> Result<Vec<BrowserDownloadProgress>, String> {
    Ok(active
        .into_iter()
        .map(|(id, path)| BrowserDownloadProgress {
            id,
            received: std::fs::metadata(&path).map(|meta| meta.len() as i64).unwrap_or(0),
            total: -1,
        })
        .collect())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserDownloadIdRequest {
    pub id: String,
}

#[tauri::command]
pub async fn browser_download_cancel(
    app: AppHandle,
    request: BrowserDownloadIdRequest,
) -> Result<(), String> {
    let (path, state) = download_path(&app, &request.id)?;
    if state != "in_progress" {
        return Ok(());
    }
    library(&app)?
        .execute(
            "UPDATE downloads SET state = 'cancelled', finished_at = ?2 WHERE id = ?1",
            params![request.id, now_ms()],
        )
        .map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let destination = path.to_string_lossy().into_owned();
        app.run_on_main_thread(move || {
            let _ = sender.send(wry::cancel_download(&destination));
        })
        .map_err(|error| error.to_string())?;
        let _ = receiver.await;
    }
    // WebKit removes its partial file; clean up anything left behind.
    if path.is_file() {
        let _ = std::fs::remove_file(&path);
    }
    Ok(())
}

#[tauri::command]
pub fn browser_download_open(app: AppHandle, request: BrowserDownloadIdRequest) -> Result<(), String> {
    let (path, _) = download_path(&app, &request.id)?;
    if !path.is_file() {
        return Err("The file was moved or deleted.".to_owned());
    }
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn browser_download_reveal(app: AppHandle, request: BrowserDownloadIdRequest) -> Result<(), String> {
    let (path, _) = download_path(&app, &request.id)?;
    if !path.exists() {
        return Err("The file was moved or deleted.".to_owned());
    }
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|error| error.to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserDownloadsRemoveRequest {
    /// Specific entries, or every finished entry when empty.
    #[serde(default)]
    pub ids: Vec<String>,
    /// With no ids: only entries started at or after this time (ms).
    pub since: Option<i64>,
}

/// Removes entries from the list. Files already saved stay on disk.
#[tauri::command]
pub fn browser_downloads_remove(
    app: AppHandle,
    request: BrowserDownloadsRemoveRequest,
) -> Result<(), String> {
    let connection = library(&app)?;
    if request.ids.is_empty() {
        connection
            .execute(
                "DELETE FROM downloads WHERE state != 'in_progress' AND started_at >= ?1",
                params![request.since.unwrap_or(0)],
            )
            .map_err(|error| error.to_string())?;
    } else {
        for id in &request.ids {
            connection
                .execute("DELETE FROM downloads WHERE id = ?1 AND state != 'in_progress'", params![id])
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}
