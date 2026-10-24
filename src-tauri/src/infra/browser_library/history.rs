//! Browsing history, kept per browser profile in the browser library.

use super::{library, now_ms};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use url::Url;

mod suggest;
pub use suggest::*;
mod removal;
pub use removal::*;

const MAX_QUERY_LIMIT: i64 = 500;
/// A reload or a redirect back to the same page is not a new visit.
const REPEAT_VISIT_WINDOW_MS: i64 = 30_000;

/// History keeps only ordinary web pages, without any credentials in them.
fn history_url(value: &str) -> Option<String> {
    let mut url = Url::parse(value).ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    let _ = url.set_username("");
    let _ = url.set_password(None);
    Some(url.to_string())
}

pub(crate) fn profile_key(profile_id: Option<String>) -> String {
    profile_id
        .filter(|value| !value.is_empty() && value.len() <= 128)
        .unwrap_or_else(|| "default".to_owned())
}

fn text(value: &str, limit: usize) -> String {
    value.trim().chars().take(limit).collect()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserHistoryRecordRequest {
    pub profile_id: Option<String>,
    pub url: String,
    #[serde(default)]
    pub title: String,
    /// The person typed this address rather than following a link.
    #[serde(default)]
    pub typed: bool,
}

fn browser_history_record_blocking(
    app: AppHandle,
    request: BrowserHistoryRecordRequest,
) -> Result<(), String> {
    let Some(url) = history_url(&request.url) else {
        return Ok(());
    };
    let profile = profile_key(request.profile_id);
    let title = text(&request.title, 500);
    let now = now_ms();
    let connection = library(&app)?;
    let repeated = connection
        .execute(
            "UPDATE visits SET visited_at = ?3, title = CASE WHEN ?4 = '' THEN title ELSE ?4 END,
                               typed = MAX(typed, ?6), changed = 1
             WHERE id = (SELECT id FROM visits WHERE profile_id = ?1 AND origin = '' ORDER BY visited_at DESC LIMIT 1)
               AND url = ?2 AND visited_at >= ?5",
            params![profile, url, now, title, now - REPEAT_VISIT_WINDOW_MS, request.typed],
        )
        .map_err(|error| error.to_string())?;
    if repeated == 0 {
        connection
            .execute(
                "INSERT INTO visits (profile_id, url, title, visited_at, typed) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![profile, url, title, now, request.typed],
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Titles often arrive after the page finishes loading.
fn browser_history_set_title_blocking(
    app: AppHandle,
    request: BrowserHistoryRecordRequest,
) -> Result<(), String> {
    let Some(url) = history_url(&request.url) else {
        return Ok(());
    };
    let title = text(&request.title, 500);
    if title.is_empty() {
        return Ok(());
    }
    library(&app)?
        .execute(
            "UPDATE visits SET title = ?3, changed = 1
             WHERE id = (SELECT id FROM visits WHERE profile_id = ?1 AND url = ?2 AND origin = '' ORDER BY visited_at DESC LIMIT 1)",
            params![profile_key(request.profile_id), url, title],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserHistoryQueryRequest {
    pub profile_id: Option<String>,
    #[serde(default)]
    pub text: String,
    /// Only visits before this time (ms), for paging.
    pub before: Option<i64>,
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserHistoryVisit {
    id: i64,
    url: String,
    title: String,
    visited_at: i64,
}

fn like_pattern(value: &str) -> String {
    let escaped = value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

fn browser_history_query_blocking(
    app: AppHandle,
    request: BrowserHistoryQueryRequest,
) -> Result<Vec<BrowserHistoryVisit>, String> {
    let connection = library(&app)?;
    let mut statement = connection
        .prepare(
            "SELECT id, url, title, visited_at FROM visits
             WHERE profile_id = ?1 AND visited_at < ?2
               AND (?3 = '' OR url LIKE ?4 ESCAPE '\\' OR title LIKE ?4 ESCAPE '\\')
             ORDER BY visited_at DESC LIMIT ?5",
        )
        .map_err(|error| error.to_string())?;
    let search = text(&request.text, 200);
    let rows = statement
        .query_map(
            params![
                profile_key(request.profile_id),
                request.before.unwrap_or(i64::MAX),
                search,
                like_pattern(&search),
                request.limit.unwrap_or(100).clamp(1, MAX_QUERY_LIMIT),
            ],
            |row| {
                Ok(BrowserHistoryVisit {
                    id: row.get(0)?,
                    url: row.get(1)?,
                    title: row.get(2)?,
                    visited_at: row.get(3)?,
                })
            },
        )
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

#[cfg(test)]
mod tests;

// Commands run on the main thread unless they are async, and the main thread
// also delivers keystrokes. A history query over a large imported library held
// typing in the address bar and search box until it finished, so every history
// command does its SQLite work on a blocking worker instead.
async fn off_main_thread<R: Send + 'static>(
    work: impl FnOnce() -> Result<R, String> + Send + 'static,
) -> Result<R, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn browser_history_record(
    app: AppHandle,
    request: BrowserHistoryRecordRequest,
) -> Result<(), String> {
    off_main_thread(move || browser_history_record_blocking(app, request)).await
}

#[tauri::command]
pub async fn browser_history_set_title(
    app: AppHandle,
    request: BrowserHistoryRecordRequest,
) -> Result<(), String> {
    off_main_thread(move || browser_history_set_title_blocking(app, request)).await
}

#[tauri::command]
pub async fn browser_history_query(
    app: AppHandle,
    request: BrowserHistoryQueryRequest,
) -> Result<Vec<BrowserHistoryVisit>, String> {
    off_main_thread(move || browser_history_query_blocking(app, request)).await
}

#[tauri::command]
pub async fn browser_history_suggest(
    app: AppHandle,
    request: BrowserHistoryQueryRequest,
) -> Result<Vec<BrowserHistorySuggestion>, String> {
    off_main_thread(move || browser_history_suggest_blocking(app, request)).await
}

#[tauri::command]
pub async fn browser_history_delete(
    app: AppHandle,
    request: BrowserHistoryDeleteRequest,
) -> Result<(), String> {
    off_main_thread(move || browser_history_delete_blocking(app, request)).await
}

#[tauri::command]
pub async fn browser_history_forget(
    app: AppHandle,
    request: BrowserHistoryForgetRequest,
) -> Result<(), String> {
    off_main_thread(move || browser_history_forget_blocking(app, request)).await
}

#[tauri::command]
pub async fn browser_history_clear(
    app: AppHandle,
    request: BrowserHistoryClearRequest,
) -> Result<(), String> {
    off_main_thread(move || browser_history_clear_blocking(app, request)).await
}
