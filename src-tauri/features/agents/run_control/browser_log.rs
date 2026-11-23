use base64::Engine;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Webview};

use super::windows::account_of_window;

const MAX_ENTRIES: i64 = 4000;
const MAX_TEXT: usize = 400;
const MAX_PICTURE_BYTES: usize = 400_000;
const JPEG: &str = "data:image/jpeg;base64,";

fn clip(text: &str) -> String {
    text.trim().chars().take(MAX_TEXT).collect()
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct LogEntryIn {
    pub run_id: String,
    pub call_id: String,
    pub scope_id: String,
    pub operation: String,
    pub target: String,
    pub url: String,
    pub title: String,
    pub verdict: String,
    pub state: String,
    pub error: String,
    pub note: String,
    pub duration_ms: i64,
    pub picture: Option<String>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LogRow {
    pub seq: i64,
    pub at: i64,
    pub call_id: String,
    pub scope_id: String,
    pub operation: String,
    pub target: String,
    pub url: String,
    pub title: String,
    pub verdict: String,
    pub state: String,
    pub error: String,
    pub note: String,
    pub duration_ms: i64,
    pub nested: bool,
    pub picture: String,
}

pub(super) fn record(
    connection: &Connection,
    account: &str,
    entry: &LogEntryIn,
    now: i64,
) -> rusqlite::Result<Option<(String, i64)>> {
    let (root, nested) = super::run_steps::root_of(connection, &entry.run_id)?;
    let owner: Option<String> = connection
        .query_row(
            "SELECT account FROM agent_run_ledger WHERE run_id = ?1",
            params![root],
            |row| row.get(0),
        )
        .optional()?;
    if owner.as_deref() != Some(account) {
        return Ok(None);
    }
    let next: i64 = connection.query_row(
        "SELECT COALESCE(MAX(seq), 0) + 1 FROM agent_browser_log WHERE run_id = ?1",
        params![root],
        |row| row.get(0),
    )?;
    if next > MAX_ENTRIES {
        return Ok(None);
    }
    let state = if entry.state == "failed" {
        "failed"
    } else {
        "completed"
    };
    connection.execute(
        "INSERT INTO agent_browser_log
             (run_id, seq, account, call_id, at, scope_id, operation, target, url, title, verdict,
              state, error, note, duration_ms, nested)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
        params![
            root,
            next,
            account,
            format!("{}:{}", entry.run_id, clip(&entry.call_id)),
            now,
            clip(&entry.scope_id),
            clip(&entry.operation),
            clip(&entry.target),
            clip(&entry.url),
            clip(&entry.title),
            clip(&entry.verdict),
            state,
            clip(&entry.error),
            clip(&entry.note),
            entry.duration_ms.max(0),
            nested,
        ],
    )?;
    Ok(Some((root, next)))
}

fn set_picture(
    connection: &Connection,
    run_id: &str,
    seq: i64,
    picture: &str,
) -> rusqlite::Result<()> {
    connection.execute(
        "UPDATE agent_browser_log SET picture = ?3 WHERE run_id = ?1 AND seq = ?2",
        params![run_id, seq, picture],
    )?;
    Ok(())
}

pub(super) fn rows(
    connection: &Connection,
    account: &str,
    run_id: &str,
) -> rusqlite::Result<Vec<LogRow>> {
    let mut statement = connection.prepare(
        "SELECT seq, at, call_id, scope_id, operation, target, url, title, verdict, state, error,
                note, duration_ms, nested, picture
         FROM agent_browser_log WHERE run_id = ?1 AND account = ?2 ORDER BY seq",
    )?;
    let rows = statement.query_map(params![run_id, account], |row| {
        Ok(LogRow {
            seq: row.get(0)?,
            at: row.get(1)?,
            call_id: row.get(2)?,
            scope_id: row.get(3)?,
            operation: row.get(4)?,
            target: row.get(5)?,
            url: row.get(6)?,
            title: row.get(7)?,
            verdict: row.get(8)?,
            state: row.get(9)?,
            error: row.get(10)?,
            note: row.get(11)?,
            duration_ms: row.get(12)?,
            nested: row.get(13)?,
            picture: row.get(14)?,
        })
    })?;
    rows.collect()
}

pub(super) fn clear(connection: &Connection, account: &str) -> rusqlite::Result<()> {
    connection.execute(
        "DELETE FROM agent_browser_log WHERE account = ?1",
        params![account],
    )?;
    Ok(())
}

pub(super) fn prune(connection: &Connection, oldest: i64) -> rusqlite::Result<()> {
    connection.execute(
        "DELETE FROM agent_browser_log WHERE at < ?1",
        params![oldest],
    )?;
    Ok(())
}

fn person_account(webview: &Webview) -> Result<String, String> {
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Err("Only a profile's window can use a run's browser log.".into());
    }
    Ok(account_of_window(webview.label()).unwrap_or_default())
}

#[tauri::command]
pub async fn agent_browser_log_record(
    app: AppHandle,
    webview: Webview,
    entry: LogEntryIn,
) -> Result<(), String> {
    let account = person_account(&webview)?;
    let (Some(store), Some(base)) = (
        super::step_pictures::store_of(&app),
        super::step_pictures::folder(&app),
    ) else {
        return Ok(());
    };
    let picture = entry
        .picture
        .as_deref()
        .and_then(|data| data.strip_prefix(JPEG))
        .and_then(|data| base64::engine::general_purpose::STANDARD.decode(data).ok())
        .filter(|bytes| bytes.len() <= MAX_PICTURE_BYTES);
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let connection = store.connect().map_err(|error| error.to_string())?;
        let now = chrono::Utc::now().timestamp_millis();
        let Some((root, seq)) =
            record(&connection, &account, &entry, now).map_err(|error| error.to_string())?
        else {
            return Ok(());
        };
        if let Some(bytes) = picture {
            let directory = base.join(super::step_pictures::safe(&root));
            let name = format!("{}.jpg", uuid::Uuid::new_v4().simple());
            let saved = file_access::fs::create_dir_all(&directory)
                .and_then(|()| file_access::fs::write(directory.join(&name), &bytes));
            if saved.is_ok() {
                set_picture(&connection, &root, seq, &name).map_err(|error| error.to_string())?;
            }
        }
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn agent_browser_log(
    app: AppHandle,
    webview: Webview,
    run_id: String,
) -> Result<Vec<LogRow>, String> {
    let account = person_account(&webview)?;
    let Some(store) = super::step_pictures::store_of(&app) else {
        return Ok(Vec::new());
    };
    tokio::task::spawn_blocking(move || {
        let connection = store.connect().map_err(|error| error.to_string())?;
        let (root, _) =
            super::run_steps::root_of(&connection, &run_id).map_err(|error| error.to_string())?;
        rows(&connection, &account, &root).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn agent_browser_log_picture(
    app: AppHandle,
    webview: Webview,
    run_id: String,
    picture: String,
) -> Result<String, String> {
    let account = person_account(&webview)?;
    let named = picture.len() <= 64
        && picture.ends_with(".jpg")
        && picture
            .trim_end_matches(".jpg")
            .chars()
            .all(|c| c.is_ascii_alphanumeric());
    if !named {
        return Err("That isn't a browser log picture.".into());
    }
    let (Some(store), Some(base)) = (
        super::step_pictures::store_of(&app),
        super::step_pictures::folder(&app),
    ) else {
        return Err("Misty is still starting.".into());
    };
    tokio::task::spawn_blocking(move || {
        let connection = store.connect().map_err(|error| error.to_string())?;
        let (root, _) = super::run_steps::root_of(&connection, &run_id)
            .map_err(|error| error.to_string())?;
        let owned: bool = connection
            .query_row(
                "SELECT COUNT(*) > 0 FROM agent_browser_log WHERE run_id = ?1 AND account = ?2 AND picture = ?3",
                params![root, account, picture],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        let path = base.join(super::step_pictures::safe(&root)).join(&picture);
        if !owned {
            return Err("That picture is gone.".into());
        }
        let bytes = file_access::fs::read(&path).map_err(|_| "That picture is gone.".to_owned())?;
        Ok(format!(
            "{JPEG}{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
#[path = "browser_log_tests.rs"]
mod tests;
