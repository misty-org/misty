//! Each run's browser log on this computer: every action the agent took in its browser tabs, in
//! order, with the page it was on, what the action did to the page and a picture of the page after
//! it. A browser_run program's page calls are logged one by one. The activity log says what the
//! agent did (one row per tool call); this says what happened in the browser, and an activity row
//! points into it by the tool call both share. Typed text is never kept, only where it went. Rows
//! live in `misty.db`, pictures beside the activity's, and neither syncs or reaches the server.
use base64::Engine;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Webview};

use super::windows::account_of_window;

/// Past this a run's further actions aren't kept.
const MAX_ENTRIES: i64 = 4000;
/// The longest address, title, target or note kept.
const MAX_TEXT: usize = 400;
/// A picture larger than this isn't kept.
const MAX_PICTURE_BYTES: usize = 400_000;
const JPEG: &str = "data:image/jpeg;base64,";

fn clip(text: &str) -> String {
    text.trim().chars().take(MAX_TEXT).collect()
}

/// One browser action as the window reports it, after it ran.
#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct LogEntryIn {
    pub run_id: String,
    /// The tool call the action was part of (the engine's id for it).
    pub call_id: String,
    pub scope_id: String,
    /// The browser operation, such as `browser.click`.
    pub operation: String,
    /// What it acted on: an element's role and name, or the address it opened.
    pub target: String,
    pub url: String,
    pub title: String,
    /// What the action did to the page: `navigated`, `changed` or `unchanged`, when it said.
    pub verdict: String,
    /// `completed` or `failed`.
    pub state: String,
    pub error: String,
    /// Anything else the page said about the action, such as a dialog it opened.
    pub note: String,
    pub duration_ms: i64,
    /// The page after the action, as a JPEG data address.
    pub picture: Option<String>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LogRow {
    pub seq: i64,
    pub at: i64,
    /// The tool call the action was part of, as the activity log keys it (`<run>:<call>`).
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

/// Files one action under the run its steps go under. Returns the run it went under and the
/// action's number there, or nothing when the run isn't this account's or is full.
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

/// Forgets an account's whole browser log, as the activity's own clearing does.
pub(super) fn clear(connection: &Connection, account: &str) -> rusqlite::Result<()> {
    connection.execute(
        "DELETE FROM agent_browser_log WHERE account = ?1",
        params![account],
    )?;
    Ok(())
}

/// Forgets logs older than the oldest steps kept.
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

/// Logs one browser action of a run, with its picture when there is one.
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

/// A run's browser log, oldest first. Another account's run never comes back.
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
        // A sub-agent's tab belongs to its own run; its actions are under the run that started it.
        let (root, _) =
            super::run_steps::root_of(&connection, &run_id).map_err(|error| error.to_string())?;
        rows(&connection, &account, &root).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// One action's picture, as a data address the window can show. Only the run's own person gets it.
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
