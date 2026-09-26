//! Browsing history, kept per browser profile in the browser library.

use super::browser_library::{library, now_ms};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use url::Url;

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

fn profile_key(profile_id: Option<String>) -> String {
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

#[tauri::command]
pub fn browser_history_record(
    app: AppHandle,
    request: BrowserHistoryRecordRequest,
) -> Result<(), String> {
    let Some(url) = history_url(&request.url) else { return Ok(()) };
    let profile = profile_key(request.profile_id);
    let title = text(&request.title, 500);
    let now = now_ms();
    let connection = library(&app)?;
    let repeated = connection
        .execute(
            "UPDATE visits SET visited_at = ?3, title = CASE WHEN ?4 = '' THEN title ELSE ?4 END,
                               typed = MAX(typed, ?6)
             WHERE id = (SELECT id FROM visits WHERE profile_id = ?1 ORDER BY visited_at DESC LIMIT 1)
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
#[tauri::command]
pub fn browser_history_set_title(
    app: AppHandle,
    request: BrowserHistoryRecordRequest,
) -> Result<(), String> {
    let Some(url) = history_url(&request.url) else { return Ok(()) };
    let title = text(&request.title, 500);
    if title.is_empty() {
        return Ok(());
    }
    library(&app)?
        .execute(
            "UPDATE visits SET title = ?3
             WHERE id = (SELECT id FROM visits WHERE profile_id = ?1 AND url = ?2 ORDER BY visited_at DESC LIMIT 1)",
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
    let escaped = value.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
    format!("%{escaped}%")
}

#[tauri::command]
pub fn browser_history_query(
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserHistorySuggestion {
    url: String,
    title: String,
    visits: i64,
    typed_visits: i64,
    last_visited_at: i64,
}

/// Empty text asks for the person's top pages; only recent visits count then.
const TOP_PAGES_WINDOW_MS: i64 = 90 * 86_400_000;

/// Address bar suggestions: pages matching the typed text, ranked by visits
/// (typed visits count triple) decayed by age. Empty text returns top pages.
#[tauri::command]
pub fn browser_history_suggest(
    app: AppHandle,
    request: BrowserHistoryQueryRequest,
) -> Result<Vec<BrowserHistorySuggestion>, String> {
    let search = text(&request.text, 200);
    let now = now_ms();
    let since = if search.is_empty() { now - TOP_PAGES_WINDOW_MS } else { 0 };
    let connection = library(&app)?;
    let mut statement = connection
        .prepare(
            "SELECT url, (SELECT title FROM visits latest WHERE latest.profile_id = ?1 AND latest.url = visits.url
                          ORDER BY visited_at DESC LIMIT 1),
                    COUNT(*) AS count, SUM(typed) AS typed_count, MAX(visited_at) AS last
             FROM visits
             WHERE profile_id = ?1 AND visited_at >= ?5
               AND (url LIKE ?2 ESCAPE '\\' OR title LIKE ?2 ESCAPE '\\')
             GROUP BY url
             ORDER BY ((COUNT(*) + 2.0 * SUM(typed)) * 1.0) / (1 + (?3 - MAX(visited_at)) / 86400000.0) DESC
             LIMIT ?4",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(
            params![
                profile_key(request.profile_id),
                like_pattern(&search),
                now,
                request.limit.unwrap_or(5).clamp(1, 20),
                since,
            ],
            |row| {
                Ok(BrowserHistorySuggestion {
                    url: row.get(0)?,
                    title: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    visits: row.get(2)?,
                    typed_visits: row.get(3)?,
                    last_visited_at: row.get(4)?,
                })
            },
        )
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserHistoryDeleteRequest {
    #[serde(default)]
    pub ids: Vec<i64>,
}

#[tauri::command]
pub fn browser_history_delete(
    app: AppHandle,
    request: BrowserHistoryDeleteRequest,
) -> Result<(), String> {
    let connection = library(&app)?;
    for id in request.ids {
        connection
            .execute("DELETE FROM visits WHERE id = ?1", params![id])
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserHistoryForgetRequest {
    pub profile_id: Option<String>,
    pub url: String,
}

/// Removes every visit to one page, as when a suggestion is deleted from the address bar.
#[tauri::command]
pub fn browser_history_forget(
    app: AppHandle,
    request: BrowserHistoryForgetRequest,
) -> Result<(), String> {
    let Some(url) = history_url(&request.url) else { return Ok(()) };
    library(&app)?
        .execute(
            "DELETE FROM visits WHERE profile_id = ?1 AND url = ?2",
            params![profile_key(request.profile_id), url],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserHistoryClearRequest {
    /// Every profile when absent.
    pub profile_id: Option<String>,
    /// Visits at or after this time (ms); everything when absent.
    pub since: Option<i64>,
}

#[tauri::command]
pub fn browser_history_clear(
    app: AppHandle,
    request: BrowserHistoryClearRequest,
) -> Result<(), String> {
    let since = request.since.unwrap_or(0);
    let connection = library(&app)?;
    match request.profile_id {
        Some(profile) => connection.execute(
            "DELETE FROM visits WHERE profile_id = ?1 AND visited_at >= ?2",
            params![profile_key(Some(profile)), since],
        ),
        None => connection.execute("DELETE FROM visits WHERE visited_at >= ?1", params![since]),
    }
    .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn history_url_keeps_only_web_pages_without_credentials() {
        assert_eq!(
            history_url("https://user:secret@example.com/path?q=1").as_deref(),
            Some("https://example.com/path?q=1")
        );
        assert_eq!(history_url("about:blank"), None);
        assert_eq!(history_url("misty://history"), None);
        assert_eq!(history_url("file:///etc/passwd"), None);
    }

    #[test]
    fn like_pattern_escapes_wildcards() {
        assert_eq!(like_pattern("50%_off"), "%50\\%\\_off%");
    }
}
