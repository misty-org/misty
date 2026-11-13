//! Each run's steps on this computer, whatever engine ran it, for the person's own activity view:
//! one row per tool call with the tool, the file or page it worked on, and how it ended. The
//! window turns them into plain sentences. A row holds no argument, result, prompt or answer, lives
//! in `misty.db` and never syncs or reaches the server. A sub-agent's run files its steps under the
//! run that started it.
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, Webview};

use super::windows::account_of_window;
use database::store::Store;

/// Steps older than this go when a run starts, the same as the ledger's rows.
const KEPT_DAYS: i64 = 90;
/// Past this a run's further steps aren't kept.
const MAX_STEPS: i64 = 2000;
/// The longest address, path or title kept.
const MAX_TEXT: usize = 400;
/// How many runs up a sub-agent's steps are followed to find the run they belong to.
const MAX_DEPTH: usize = 8;

fn clip(text: &str) -> String {
    text.trim().chars().take(MAX_TEXT).collect()
}

/// A tool result that came back as text is often JSON.
fn as_object(value: &Value) -> Option<Value> {
    match value {
        Value::Object(_) => Some(value.clone()),
        Value::String(text) if text.trim_start().starts_with('{') => {
            serde_json::from_str(text).ok()
        }
        _ => None,
    }
}

/// A tool's name as it is kept. Some engines name a shell call by its command line (Codex does),
/// which is an argument and may hold anything: what doesn't look like a tool's name is kept as
/// `shell`.
fn tool_name(raw: &str) -> String {
    let name = raw.trim();
    let plain = !name.is_empty()
        && name.len() <= 80
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-' | ':'));
    if plain {
        name.to_owned()
    } else {
        "shell".to_owned()
    }
}

/// The file or address a call's arguments name.
fn target_of(args: &Value) -> String {
    let args = as_object(args).unwrap_or(Value::Null);
    ["file_path", "path", "notebook_path", "url", "href"]
        .iter()
        .find_map(|key| args[*key].as_str().filter(|text| !text.trim().is_empty()))
        .map(clip)
        .unwrap_or_default()
}

/// The page a result says the call ended on: its address and title.
fn page_of(result: &Value) -> (String, String) {
    let Some(mut result) = as_object(result) else {
        return Default::default();
    };
    // An MCP result carries the tool's own result as text in its content.
    if let Some(inner) = result["content"]
        .as_array()
        .and_then(|parts| parts.iter().find_map(|part| as_object(&part["text"])))
    {
        result = inner;
    }
    let page = if result["page"].is_object() {
        &result["page"]
    } else {
        &result
    };
    let text = |key: &str| page[key].as_str().map(clip).unwrap_or_default();
    let url = text("url");
    // Only a web address is a page; a result's `url` can name anything.
    if url.starts_with("http://") || url.starts_with("https://") {
        (url, text("title"))
    } else {
        Default::default()
    }
}

/// The run a run's steps are filed under: the first one up its chain with no parent.
fn root_of(connection: &Connection, run_id: &str) -> rusqlite::Result<(String, bool)> {
    let mut current = run_id.to_owned();
    for _ in 0..MAX_DEPTH {
        let parent: Option<String> = connection
            .query_row(
                "SELECT parent_run_id FROM agent_run_parents WHERE run_id = ?1",
                params![current],
                |row| row.get(0),
            )
            .optional()?;
        match parent {
            Some(parent) => current = parent,
            None => break,
        }
    }
    let nested = current != run_id;
    Ok((current, nested))
}

pub(super) fn record_start(
    connection: &Connection,
    run_id: &str,
    parent_run_id: &str,
    now: i64,
) -> rusqlite::Result<()> {
    if !parent_run_id.is_empty() {
        connection.execute(
            "INSERT OR IGNORE INTO agent_run_parents (run_id, parent_run_id, at) VALUES (?1, ?2, ?3)",
            params![run_id, parent_run_id, now],
        )?;
        return Ok(());
    }
    let oldest = now - KEPT_DAYS * 24 * 60 * 60 * 1000;
    connection.execute("DELETE FROM agent_run_steps WHERE at < ?1", params![oldest])?;
    connection.execute(
        "DELETE FROM agent_run_parents WHERE at < ?1",
        params![oldest],
    )?;
    Ok(())
}

/// Notes what an event says about a run's steps. Events of other kinds change nothing.
pub(super) fn record_event(
    connection: &Connection,
    run_id: &str,
    event: &Value,
    now: i64,
) -> rusqlite::Result<()> {
    let kind = event["type"].as_str().unwrap_or("");
    if !matters(kind) {
        return Ok(());
    }
    let (root, nested_run) = root_of(connection, run_id)?;
    // Only a run the ledger knows is someone's.
    let account: Option<String> = connection
        .query_row(
            "SELECT account FROM agent_run_ledger WHERE run_id = ?1",
            params![root],
            |row| row.get(0),
        )
        .optional()?;
    let Some(account) = account else {
        return Ok(());
    };
    let call = event["toolCallId"].as_str().unwrap_or("");
    // Calls are keyed by run as well, so two sub-agents' ids never meet.
    let call_id = format!("{run_id}:{call}");
    match kind {
        "tool.started" => {
            let tool = event["toolName"].as_str().unwrap_or("").trim();
            if tool.is_empty() {
                return Ok(());
            }
            let known: Option<i64> = connection
                .query_row(
                    "SELECT seq FROM agent_run_steps WHERE run_id = ?1 AND call_id = ?2",
                    params![root, call_id],
                    |row| row.get(0),
                )
                .optional()?;
            let target = match event["path"].as_str().filter(|path| !path.is_empty()) {
                Some(path) => clip(path),
                None => target_of(&event["args"]),
            };
            if let Some(seq) = known {
                // A call whose arguments arrive after its name names its target then.
                if !target.is_empty() {
                    connection.execute(
                        "UPDATE agent_run_steps SET target = ?3 WHERE run_id = ?1 AND seq = ?2 AND target = ''",
                        params![root, seq, target],
                    )?;
                }
                return Ok(());
            }
            let next: i64 = connection.query_row(
                "SELECT COALESCE(MAX(seq), 0) + 1 FROM agent_run_steps WHERE run_id = ?1",
                params![root],
                |row| row.get(0),
            )?;
            if next > MAX_STEPS {
                return Ok(());
            }
            let nested = nested_run
                || event["parentToolCallId"]
                    .as_str()
                    .is_some_and(|id| !id.is_empty());
            connection.execute(
                "INSERT INTO agent_run_steps
                     (run_id, seq, account, call_id, at, tool, target, state, nested)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'running', ?8)",
                params![
                    root,
                    next,
                    account,
                    call_id,
                    now,
                    tool_name(tool),
                    target,
                    nested
                ],
            )?;
        }
        "tool.completed" | "tool.failed" => {
            let state = if kind == "tool.failed" {
                "failed"
            } else {
                "completed"
            };
            let (url, title) = page_of(&event["result"]);
            let target = target_of(&event["args"]);
            let duration = event["durationMs"].as_i64().unwrap_or(0).max(0);
            // A page the call ended on is where it was, over the address it set out for.
            connection.execute(
                "UPDATE agent_run_steps SET state = ?3,
                     duration_ms = CASE WHEN ?4 > 0 THEN ?4 ELSE MAX(?5 - at, 0) END,
                     target = CASE WHEN ?6 <> '' THEN ?6 WHEN target = '' THEN ?7 ELSE target END,
                     title = CASE WHEN ?8 <> '' THEN ?8 ELSE title END
                 WHERE run_id = ?1 AND call_id = ?2",
                params![root, call_id, state, duration, now, url, target, title],
            )?;
        }
        _ => {
            // The run ended: a call nobody saw finish ended with it.
            let state = if kind == "invocation.completed" {
                "completed"
            } else {
                "failed"
            };
            connection.execute(
                "UPDATE agent_run_steps SET state = ?2, duration_ms = MAX(?3 - at, 0)
                 WHERE run_id = ?1 AND state = 'running' AND call_id LIKE ?4",
                params![root, state, now, format!("{run_id}:%")],
            )?;
        }
    }
    Ok(())
}

/// Whether an event changes a run's steps.
pub(super) fn matters(kind: &str) -> bool {
    matches!(
        kind,
        "tool.started"
            | "tool.completed"
            | "tool.failed"
            | "invocation.completed"
            | "invocation.failed"
            | "invocation.canceled"
    )
}

/// Keeps the picture taken for a step, a file name in the run's picture folder.
pub(crate) fn record_picture(
    connection: &Connection,
    run_id: &str,
    call: &str,
    picture: &str,
) -> rusqlite::Result<()> {
    let (root, _) = root_of(connection, run_id)?;
    connection.execute(
        "UPDATE agent_run_steps SET picture = ?3 WHERE run_id = ?1 AND call_id = ?2",
        params![root, format!("{run_id}:{call}"), clip(picture)],
    )?;
    Ok(())
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StepRow {
    pub seq: i64,
    pub at: i64,
    pub tool: String,
    pub target: String,
    pub title: String,
    pub state: String,
    pub duration_ms: i64,
    pub nested: bool,
    pub picture: String,
}

pub(super) fn rows(
    connection: &Connection,
    account: &str,
    run_id: &str,
) -> rusqlite::Result<Vec<StepRow>> {
    let mut statement = connection.prepare(
        "SELECT seq, at, tool, target, title, state, duration_ms, nested, picture
         FROM agent_run_steps WHERE run_id = ?1 AND account = ?2 ORDER BY seq",
    )?;
    let rows = statement.query_map(params![run_id, account], |row| {
        Ok(StepRow {
            seq: row.get(0)?,
            at: row.get(1)?,
            tool: row.get(2)?,
            target: row.get(3)?,
            title: row.get(4)?,
            state: row.get(5)?,
            duration_ms: row.get(6)?,
            nested: row.get(7)?,
            picture: row.get(8)?,
        })
    })?;
    rows.collect()
}

/// The latest step of each of these runs, for the lines that say what a run is doing now.
pub(super) fn latest(
    connection: &Connection,
    account: &str,
    run_ids: &[String],
) -> rusqlite::Result<Vec<(String, StepRow)>> {
    let mut statement = connection.prepare(
        "SELECT seq, at, tool, target, title, state, duration_ms, nested, picture
         FROM agent_run_steps WHERE run_id = ?1 AND account = ?2 ORDER BY seq DESC LIMIT 1",
    )?;
    let mut found = Vec::new();
    for run_id in run_ids {
        let row = statement
            .query_row(params![run_id, account], |row| {
                Ok(StepRow {
                    seq: row.get(0)?,
                    at: row.get(1)?,
                    tool: row.get(2)?,
                    target: row.get(3)?,
                    title: row.get(4)?,
                    state: row.get(5)?,
                    duration_ms: row.get(6)?,
                    nested: row.get(7)?,
                    picture: row.get(8)?,
                })
            })
            .optional()?;
        if let Some(row) = row {
            found.push((run_id.clone(), row));
        }
    }
    Ok(found)
}

/// Forgets every step of an account's runs. The ledger's rows stay. Returns the pictures that
/// went with them, by run, for the caller to delete.
pub(super) fn clear(connection: &Connection, account: &str) -> rusqlite::Result<Vec<String>> {
    let mut statement = connection.prepare(
        "SELECT DISTINCT run_id FROM agent_run_steps WHERE account = ?1 AND picture <> ''",
    )?;
    let runs = statement
        .query_map(params![account], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    connection.execute(
        "DELETE FROM agent_run_steps WHERE account = ?1",
        params![account],
    )?;
    Ok(runs)
}

fn store(app: &AppHandle) -> Store {
    app.state::<crate::app::runtime::MistyRuntime>()
        .environment
        .store()
}

fn person_account(webview: &Webview) -> Result<String, String> {
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Err("Only a profile's window can read a run's steps.".into());
    }
    Ok(account_of_window(webview.label()).unwrap_or_default())
}

/// A run's steps, oldest first. Steps of another account's run never come back.
#[tauri::command]
pub async fn agent_run_steps(
    app: AppHandle,
    webview: Webview,
    run_id: String,
) -> Result<Vec<StepRow>, String> {
    let account = person_account(&webview)?;
    let store = store(&app);
    tokio::task::spawn_blocking(move || {
        let connection = store.connect().map_err(|error| error.to_string())?;
        rows(&connection, &account, &run_id).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatestStep {
    pub run_id: String,
    pub step: StepRow,
}

/// The latest step of each of these runs.
#[tauri::command]
pub async fn agent_run_latest_steps(
    app: AppHandle,
    webview: Webview,
    run_ids: Vec<String>,
) -> Result<Vec<LatestStep>, String> {
    let account = person_account(&webview)?;
    let store = store(&app);
    tokio::task::spawn_blocking(move || {
        let connection = store.connect().map_err(|error| error.to_string())?;
        let run_ids: Vec<String> = run_ids.into_iter().take(64).collect();
        latest(&connection, &account, &run_ids)
            .map(|found| {
                found
                    .into_iter()
                    .map(|(run_id, step)| LatestStep { run_id, step })
                    .collect()
            })
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Forgets every step this person's runs took, and their pictures.
#[tauri::command]
pub async fn agent_run_steps_clear(app: AppHandle, webview: Webview) -> Result<(), String> {
    let account = person_account(&webview)?;
    let store = store(&app);
    let runs = tokio::task::spawn_blocking(move || {
        let connection = store.connect().map_err(|error| error.to_string())?;
        clear(&connection, &account).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    for run_id in runs {
        super::step_pictures::forget_run(&app, &run_id);
    }
    Ok(())
}

#[cfg(test)]
#[path = "run_steps_tests.rs"]
mod tests;
