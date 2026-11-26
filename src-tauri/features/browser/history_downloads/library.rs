use database::store::Store;
use file_access::fs;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    sync::{Mutex, MutexGuard, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

static LIBRARY: OnceLock<Mutex<Connection>> = OnceLock::new();
const MAX_HISTORY: i64 = 20_000;
const MAX_DOWNLOADS: i64 = 500;
const MAX_TEXT: usize = 2_000;

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or_default()
}

fn library() -> Result<MutexGuard<'static, Connection>, String> {
    if LIBRARY.get().is_none() {
        let home =
            file_access::paths::misty_home_dir().ok_or("Misty's data folder is unavailable.")?;
        let connection = Store::in_home(&home)
            .connect()
            .map_err(|error| error.to_string())?;
        connection
            .execute(
                "UPDATE browser_downloads SET state = 'interrupted', finished_at = ?1
                 WHERE state = 'in_progress'",
                params![now_ms()],
            )
            .map_err(|error| error.to_string())?;
        let _ = LIBRARY.set(Mutex::new(connection));
    }
    LIBRARY
        .get()
        .ok_or_else(|| "Browsing history is unavailable.".to_owned())?
        .lock()
        .map_err(|_| "Browsing history is unavailable.".to_owned())
}

fn web_address(url: &str) -> bool {
    url.len() <= MAX_TEXT && (url.starts_with("https://") || url.starts_with("http://"))
}

fn clipped(text: &str) -> String {
    text.trim().chars().take(300).collect()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserHistoryRecordRequest {
    pub url: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub typed: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserHistoryEntry {
    url: String,
    title: String,
    last_visit: i64,
}

#[tauri::command]
pub fn browser_history_record(request: BrowserHistoryRecordRequest) -> Result<(), String> {
    if !web_address(&request.url) {
        return Ok(());
    }
    let connection = library()?;
    connection
        .execute(
            "INSERT INTO browser_history (url, title, visits, typed, last_visit)
             VALUES (?1, ?2, 1, ?3, ?4)
             ON CONFLICT(url) DO UPDATE SET
                 visits = visits + 1,
                 typed = typed + excluded.typed,
                 title = CASE WHEN excluded.title = '' THEN title ELSE excluded.title END,
                 last_visit = excluded.last_visit",
            params![
                request.url,
                clipped(&request.title),
                i64::from(request.typed),
                now_ms()
            ],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "DELETE FROM browser_history WHERE url IN
             (SELECT url FROM browser_history ORDER BY last_visit DESC LIMIT -1 OFFSET ?1)",
            params![MAX_HISTORY],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserHistoryTitleRequest {
    pub url: String,
    pub title: String,
}

#[tauri::command]
pub fn browser_history_set_title(request: BrowserHistoryTitleRequest) -> Result<(), String> {
    let title = clipped(&request.title);
    if !web_address(&request.url) || title.is_empty() {
        return Ok(());
    }
    library()?
        .execute(
            "UPDATE browser_history SET title = ?2 WHERE url = ?1",
            params![request.url, title],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn entries(
    connection: &Connection,
    sql: &str,
    values: &[&dyn rusqlite::ToSql],
) -> Result<Vec<BrowserHistoryEntry>, String> {
    let mut statement = connection.prepare(sql).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(values, |row| {
            Ok(BrowserHistoryEntry {
                url: row.get(0)?,
                title: row.get(1)?,
                last_visit: row.get(2)?,
            })
        })
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserHistorySuggestRequest {
    pub query: String,
    #[serde(default)]
    pub limit: Option<u32>,
}

#[tauri::command]
pub fn browser_history_suggest(
    request: BrowserHistorySuggestRequest,
) -> Result<Vec<BrowserHistoryEntry>, String> {
    let query: String = request.query.trim().chars().take(200).collect();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let pattern = format!(
        "%{}%",
        query
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_")
    );
    let limit = i64::from(request.limit.unwrap_or(6).clamp(1, 20));
    let connection = library()?;
    entries(
        &connection,
        "SELECT url, title, last_visit FROM browser_history
         WHERE url LIKE ?1 ESCAPE '\\' OR title LIKE ?1 ESCAPE '\\'
         ORDER BY (typed * 4 + visits) DESC, last_visit DESC LIMIT ?2",
        &[&pattern, &limit],
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserHistoryRecentRequest {
    #[serde(default)]
    pub limit: Option<u32>,
}

#[tauri::command]
pub fn browser_history_recent(
    request: BrowserHistoryRecentRequest,
) -> Result<Vec<BrowserHistoryEntry>, String> {
    let limit = i64::from(request.limit.unwrap_or(10).clamp(1, 50));
    let connection = library()?;
    entries(
        &connection,
        "SELECT url, title, last_visit FROM browser_history ORDER BY last_visit DESC LIMIT ?1",
        &[&limit],
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserHistoryForgetRequest {
    pub url: String,
}

#[tauri::command]
pub fn browser_history_forget(request: BrowserHistoryForgetRequest) -> Result<(), String> {
    library()?
        .execute(
            "DELETE FROM browser_history WHERE url = ?1",
            params![request.url],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserHistoryListRequest {
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub before: Option<i64>,
    #[serde(default)]
    pub limit: Option<u32>,
}

#[tauri::command]
pub fn browser_history_list(
    request: BrowserHistoryListRequest,
) -> Result<Vec<BrowserHistoryEntry>, String> {
    let query: String = request.query.trim().chars().take(200).collect();
    let pattern = format!(
        "%{}%",
        query
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_")
    );
    let before = request.before.unwrap_or(i64::MAX);
    let limit = i64::from(request.limit.unwrap_or(100).clamp(1, 200));
    let connection = library()?;
    entries(
        &connection,
        "SELECT url, title, last_visit FROM browser_history
         WHERE last_visit < ?1 AND (url LIKE ?2 ESCAPE '\\' OR title LIKE ?2 ESCAPE '\\')
         ORDER BY last_visit DESC LIMIT ?3",
        &[&before, &pattern, &limit],
    )
}

#[tauri::command]
pub fn browser_history_clear() -> Result<(), String> {
    library()?
        .execute("DELETE FROM browser_history", [])
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn download_started(id: &str, url: &str, path: &Path, space_id: &str) {
    let Ok(connection) = library() else { return };
    let _ = connection.execute(
        "INSERT OR REPLACE INTO browser_downloads (id, url, path, space_id, state, started_at)
         VALUES (?1, ?2, ?3, ?4, 'in_progress', ?5)",
        params![id, url, path.to_string_lossy(), space_id, now_ms()],
    );
    let _ = connection.execute(
        "DELETE FROM browser_downloads WHERE id IN
         (SELECT id FROM browser_downloads ORDER BY started_at DESC LIMIT -1 OFFSET ?1)",
        params![MAX_DOWNLOADS],
    );
}

pub(crate) fn download_finished(id: &str, path: &str, success: bool, error: Option<&str>) {
    let Ok(connection) = library() else { return };
    let _ = connection.execute(
        "UPDATE browser_downloads
         SET state = ?2, error = ?3, finished_at = ?4,
             path = CASE WHEN ?5 = '' THEN path ELSE ?5 END
         WHERE id = ?1",
        params![
            id,
            if success { "finished" } else { "failed" },
            error,
            now_ms(),
            path
        ],
    );
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserDownloadEntry {
    id: String,
    url: String,
    path: String,
    file_name: String,
    space_id: String,
    state: String,
    error: Option<String>,
    started_at: i64,
    finished_at: Option<i64>,
    exists: bool,
}

#[tauri::command]
pub fn browser_downloads_list() -> Result<Vec<BrowserDownloadEntry>, String> {
    let connection = library()?;
    let mut statement = connection
        .prepare(
            "SELECT id, url, path, space_id, state, error, started_at, finished_at
             FROM browser_downloads ORDER BY started_at DESC LIMIT 50",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            let path: String = row.get(2)?;
            let state: String = row.get(4)?;
            Ok(BrowserDownloadEntry {
                id: row.get(0)?,
                url: row.get(1)?,
                file_name: Path::new(&path)
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                exists: state == "finished" && fs::is_file(&path),
                path,
                space_id: row.get(3)?,
                state,
                error: row.get(5)?,
                started_at: row.get(6)?,
                finished_at: row.get(7)?,
            })
        })
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserDownloadRequest {
    pub id: String,
}

#[tauri::command]
pub fn browser_download_open(
    app: AppHandle,
    request: BrowserDownloadRequest,
) -> Result<(), String> {
    let path = library()?
        .query_row(
            "SELECT path FROM browser_downloads WHERE id = ?1 AND state = 'finished'",
            params![request.id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "This download is no longer available.".to_owned())?;
    if !fs::is_file(&path) {
        return Err("The file was moved or deleted.".to_owned());
    }
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn browser_downloads_clear() -> Result<(), String> {
    library()?
        .execute(
            "DELETE FROM browser_downloads WHERE state != 'in_progress'",
            [],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}
