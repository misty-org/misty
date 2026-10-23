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

fn download_path(app: &AppHandle, id: &str) -> Result<(PathBuf, String), String> {
    let connection = library(app)?;
    connection
        .query_row(
            "SELECT path, state FROM downloads WHERE id = ?1",
            params![id],
            |row| {
                Ok((
                    PathBuf::from(row.get::<_, String>(0)?),
                    row.get::<_, String>(1)?,
                ))
            },
        )
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
pub async fn browser_downloads_progress(
    app: AppHandle,
) -> Result<Vec<BrowserDownloadProgress>, String> {
    let active = {
        let connection = library(&app)?;
        let mut statement = connection
            .prepare("SELECT id, path FROM downloads WHERE state = 'in_progress'")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
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

#[cfg(any(target_os = "macos", windows))]
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
                    (
                        std::fs::metadata(&path)
                            .map(|meta| meta.len() as i64)
                            .unwrap_or(0),
                        -1,
                    )
                });
                BrowserDownloadProgress {
                    id,
                    received,
                    total,
                }
            })
            .collect::<Vec<_>>();
        let _ = sender.send(progress);
    })
    .map_err(|error| error.to_string())?;
    receiver
        .await
        .map_err(|_| "Download progress is unavailable.".to_owned())
}

#[cfg(not(any(target_os = "macos", windows)))]
async fn native_progress(
    _app: &AppHandle,
    active: Vec<(String, String)>,
) -> Result<Vec<BrowserDownloadProgress>, String> {
    Ok(active
        .into_iter()
        .map(|(id, path)| BrowserDownloadProgress {
            id,
            received: std::fs::metadata(&path)
                .map(|meta| meta.len() as i64)
                .unwrap_or(0),
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
    #[cfg(any(target_os = "macos", windows))]
    {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let destination = path.to_string_lossy().into_owned();
        app.run_on_main_thread(move || {
            let _ = sender.send(wry::cancel_download(&destination));
        })
        .map_err(|error| error.to_string())?;
        let _ = receiver.await;
    }
    // The engine removes its partial file; clean up anything left behind.
    if path.is_file() {
        let _ = std::fs::remove_file(&path);
    }
    Ok(())
}

#[tauri::command]
pub fn browser_download_open(
    app: AppHandle,
    request: BrowserDownloadIdRequest,
) -> Result<(), String> {
    let (path, _) = download_path(&app, &request.id)?;
    if !path.is_file() {
        return Err("The file was moved or deleted.".to_owned());
    }
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn browser_download_reveal(
    app: AppHandle,
    request: BrowserDownloadIdRequest,
) -> Result<(), String> {
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

/// Removes entries from the list, here and in the window's Space. Files
/// already saved stay on disk.
#[tauri::command]
pub async fn browser_downloads_remove(
    webview: tauri::Webview,
    app: AppHandle,
    request: BrowserDownloadsRemoveRequest,
) -> Result<(), String> {
    remove_local(&app, &request)?;
    let space = crate::infra::browser_sync::window_space(webview.window().label());
    space::remove(space.as_deref(), &request.ids, request.since).await;
    Ok(())
}

fn remove_local(app: &AppHandle, request: &BrowserDownloadsRemoveRequest) -> Result<(), String> {
    let connection = library(app)?;
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
                .execute(
                    "DELETE FROM downloads WHERE id = ?1 AND state != 'in_progress'",
                    params![id],
                )
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}
