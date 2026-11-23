use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, Webview};

use super::tool_policy::RunFacts;
use super::windows::account_of_window;
use database::store::Store;

const KEPT_DAYS: i64 = 90;
const KEPT_FILES: usize = 50;
const MAX_ROWS: usize = 200;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or_default()
}

fn store(app: &AppHandle) -> Store {
    app.state::<crate::app::runtime::MistyRuntime>()
        .environment
        .store()
}

fn session_started() -> i64 {
    static AT: std::sync::OnceLock<i64> = std::sync::OnceLock::new();
    *AT.get_or_init(now_ms)
}

fn settle_cut_off(rows: &mut [LedgerRow], session_started: i64, going: impl Fn(&str) -> bool) {
    for row in rows {
        let open = matches!(row.state.as_str(), "running" | "needs-you");
        if open && row.started_at < session_started && !going(&row.run_id) {
            row.state = "canceled".to_owned();
        }
    }
}

fn store_if_ready(app: &AppHandle) -> Option<Store> {
    Some(
        app.try_state::<crate::app::runtime::MistyRuntime>()?
            .environment
            .store(),
    )
}

fn engine_of(body: &Value) -> String {
    body["engine"]["id"]
        .as_str()
        .filter(|id| !id.is_empty())
        .unwrap_or("misty")
        .to_owned()
}

pub(super) fn record_start(
    connection: &Connection,
    run_id: &str,
    body: &Value,
    now: i64,
) -> rusqlite::Result<()> {
    let facts = RunFacts::of_request(run_id, body);
    if !facts.parent_run_id.is_empty() {
        return Ok(());
    }
    let chat = body["conversation_id"].as_str().unwrap_or("");
    connection.execute(
        "INSERT INTO agent_run_ledger
             (run_id, account, conversation_id, engine, mode, started_at, updated_at, state)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, 'running')
         ON CONFLICT(run_id) DO NOTHING",
        params![
            run_id,
            facts.account,
            chat,
            engine_of(body),
            facts.mode_id,
            now
        ],
    )?;
    connection.execute(
        "DELETE FROM agent_run_ledger WHERE started_at < ?1",
        params![now - KEPT_DAYS * 24 * 60 * 60 * 1000],
    )?;
    Ok(())
}

fn writes_file(tool: &str) -> bool {
    let name = tool
        .rsplit("__")
        .next()
        .unwrap_or(tool)
        .to_ascii_lowercase();
    [
        "edit",
        "write",
        "multiedit",
        "notebookedit",
        "apply_patch",
        "patch",
        "str_replace",
        "create_file",
        "file.write",
        "file.edit",
        "file.create",
        "file.move",
        "file.rename",
        "file.delete",
        "fs_write",
        "replace",
    ]
    .iter()
    .any(|prefix| name.starts_with(prefix))
}

pub(super) fn record_event(
    connection: &Connection,
    run_id: &str,
    event: &Value,
    now: i64,
) -> rusqlite::Result<()> {
    let kind = event["type"].as_str().unwrap_or("");
    match kind {
        "tool.started" => {
            let files: Option<String> = connection
                .query_row(
                    "SELECT files FROM agent_run_ledger WHERE run_id = ?1",
                    params![run_id],
                    |row| row.get(0),
                )
                .optional()?;
            let Some(files) = files else { return Ok(()) };
            let mut files: Vec<String> = serde_json::from_str(&files).unwrap_or_default();
            let tool = event["toolName"].as_str().unwrap_or("");
            if let Some(path) = event["path"].as_str().filter(|path| !path.is_empty()) {
                if writes_file(tool)
                    && !files.iter().any(|known| known == path)
                    && files.len() < KEPT_FILES
                {
                    files.push(path.to_owned());
                }
            }
            connection.execute(
                "UPDATE agent_run_ledger SET tools = tools + 1, files = ?2, updated_at = ?3,
                     state = CASE state WHEN 'needs-you' THEN 'running' ELSE state END
                 WHERE run_id = ?1",
                params![
                    run_id,
                    serde_json::to_string(&files).unwrap_or_default(),
                    now
                ],
            )?;
        }
        "invocation.completed" | "invocation.failed" | "invocation.canceled" => {
            let state = kind.trim_start_matches("invocation.");
            connection.execute(
                "UPDATE agent_run_ledger SET state = ?2, updated_at = ?3 WHERE run_id = ?1",
                params![run_id, state, now],
            )?;
        }
        "approval.required" => {
            connection.execute(
                "UPDATE agent_run_ledger SET state = 'needs-you', updated_at = ?2
                 WHERE run_id = ?1 AND state = 'running'",
                params![run_id, now],
            )?;
        }
        _ => {}
    }
    Ok(())
}

fn matters(kind: &str) -> bool {
    matches!(
        kind,
        "tool.started"
            | "invocation.completed"
            | "invocation.failed"
            | "invocation.canceled"
            | "approval.required"
    )
}

fn in_order(job: impl FnOnce() + Send + 'static) {
    type Job = Box<dyn FnOnce() + Send>;
    static QUEUE: std::sync::OnceLock<std::sync::Mutex<std::sync::mpsc::Sender<Job>>> =
        std::sync::OnceLock::new();
    let queue = QUEUE.get_or_init(|| {
        let (sender, receiver) = std::sync::mpsc::channel::<Job>();
        let _ = std::thread::Builder::new()
            .name("misty-run-ledger".into())
            .spawn(move || {
                for job in receiver {
                    job();
                }
            });
        std::sync::Mutex::new(sender)
    });
    let _ = queue
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .send(Box::new(job));
}

pub(super) fn note_start(app: &AppHandle, run_id: &str, body: &Value) {
    session_started();
    let Some(store) = store_if_ready(app) else {
        return;
    };
    let (run_id, body) = (run_id.to_owned(), body.clone());
    let parent = RunFacts::of_request(&run_id, &body).parent_run_id;
    let app = app.clone();
    in_order(move || {
        if let Ok(connection) = store.connect() {
            let _ = record_start(&connection, &run_id, &body, now_ms());
            let _ = super::run_steps::record_start(&connection, &run_id, &parent, now_ms());
        }
        if parent.is_empty() {
            super::step_pictures::prune(&app);
        }
    });
}

pub(super) fn note_event(app: &AppHandle, run_id: &str, event: &Value) {
    let kind = event["type"].as_str().unwrap_or("");
    let (ledger, steps) = (matters(kind), super::run_steps::matters(kind));
    if !ledger && !steps {
        return;
    }
    let Some(store) = store_if_ready(app) else {
        return;
    };
    let (run_id, event) = (run_id.to_owned(), event.clone());
    let app = app.clone();
    in_order(move || {
        let Ok(connection) = store.connect() else {
            return;
        };
        if ledger {
            let _ = record_event(&connection, &run_id, &event, now_ms());
        }
        if steps && super::run_steps::record_event(&connection, &run_id, &event, now_ms()).is_ok() {
            super::step_pictures::after_step(&app, &run_id, &event);
        }
    });
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LedgerRow {
    pub run_id: String,
    pub conversation_id: String,
    pub engine: String,
    pub mode: String,
    pub state: String,
    pub started_at: i64,
    pub updated_at: i64,
    pub tools: i64,
    pub files: Vec<String>,
}

pub(super) fn rows(
    connection: &Connection,
    account: &str,
    chats: &[String],
    limit: usize,
) -> rusqlite::Result<Vec<LedgerRow>> {
    if chats.is_empty() {
        return Ok(Vec::new());
    }
    let marks = vec!["?"; chats.len()].join(",");
    let sql = format!(
        "SELECT run_id, conversation_id, engine, mode, state, started_at, updated_at, tools, files
         FROM agent_run_ledger WHERE account = ? AND conversation_id IN ({marks})
         ORDER BY started_at DESC LIMIT ?"
    );
    let mut statement = connection.prepare(&sql)?;
    let mut values: Vec<rusqlite::types::Value> = vec![account.to_owned().into()];
    values.extend(chats.iter().map(|chat| chat.clone().into()));
    values.push((limit.min(MAX_ROWS) as i64).into());
    let rows = statement.query_map(rusqlite::params_from_iter(values), |row| {
        let files: String = row.get(8)?;
        Ok(LedgerRow {
            run_id: row.get(0)?,
            conversation_id: row.get(1)?,
            engine: row.get(2)?,
            mode: row.get(3)?,
            state: row.get(4)?,
            started_at: row.get(5)?,
            updated_at: row.get(6)?,
            tools: row.get(7)?,
            files: serde_json::from_str(&files).unwrap_or_default(),
        })
    })?;
    rows.collect()
}

#[tauri::command]
pub async fn agent_run_timeline(
    app: AppHandle,
    webview: Webview,
    conversation_ids: Vec<String>,
    limit: Option<usize>,
) -> Result<Vec<LedgerRow>, String> {
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Err("Only a profile's window can read the timeline.".into());
    }
    let account = account_of_window(webview.label()).unwrap_or_default();
    let store = store(&app);
    let started = session_started();
    let mut found = tokio::task::spawn_blocking(move || {
        let connection = store.connect().map_err(|error| error.to_string())?;
        rows(
            &connection,
            &account,
            &conversation_ids,
            limit.unwrap_or(30),
        )
        .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    settle_cut_off(&mut found, started, super::local_runs::is_going);
    Ok(found)
}

#[cfg(test)]
#[path = "run_ledger_tests.rs"]
mod tests;
