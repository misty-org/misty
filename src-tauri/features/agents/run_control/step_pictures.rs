//! Pictures of the page after a run's browser steps, so the person can see what each step did and
//! play a run back. They live in `~/.misty/data/run-pictures/<run>/`, go with the run's steps, and
//! never sync or reach the server.
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Mutex, OnceLock, PoisonError},
    time::{Duration, Instant},
};

use base64::Engine;
use rusqlite::params;
use serde_json::Value;
use tauri::{AppHandle, Manager, Webview};

use super::windows::account_of_window;

/// A run's pages are pictured at most this often.
const EVERY: Duration = Duration::from_millis(1200);
/// A picture larger than this isn't kept.
const MAX_BYTES: usize = 400_000;

fn folder(app: &AppHandle) -> Option<PathBuf> {
    Some(
        app.try_state::<crate::app::runtime::MistyRuntime>()?
            .environment
            .misty_dir()
            .join("data")
            .join("run-pictures"),
    )
}

fn store_of(app: &AppHandle) -> Option<database::store::Store> {
    Some(
        app.try_state::<crate::app::runtime::MistyRuntime>()?
            .environment
            .store(),
    )
}

/// A run id as a folder name: anything but letters, digits, `-` and `_` becomes `_`.
fn safe(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .take(120)
        .collect()
}

/// Whether a tool works in the agent's browser.
fn is_browser_tool(tool: &str) -> bool {
    let name = tool.rsplit("__").next().unwrap_or(tool);
    name.starts_with("browser.") || name.starts_with("browser_")
}

fn due(run_id: &str) -> bool {
    static LAST: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
    let mut last = LAST
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    let now = Instant::now();
    if last.get(run_id).is_some_and(|at| now.duration_since(*at) < EVERY) {
        return false;
    }
    last.retain(|_, at| now.duration_since(*at) < Duration::from_secs(600));
    last.insert(run_id.to_owned(), now);
    true
}

/// After a browser step ends, pictures the run's page and files it with the step.
pub(super) fn after_step(app: &AppHandle, run_id: &str, event: &Value) {
    let kind = event["type"].as_str().unwrap_or("");
    if kind != "tool.completed" && kind != "tool.failed" {
        return;
    }
    if !is_browser_tool(event["toolName"].as_str().unwrap_or("")) || !due(run_id) {
        return;
    }
    let (app, run_id) = (app.clone(), run_id.to_owned());
    let call = event["toolCallId"].as_str().unwrap_or("").to_owned();
    tauri::async_runtime::spawn(async move {
        let Some(bytes) =
            crate::browser::agent_pages::run_picture::picture_of_run(&app, std::slice::from_ref(&run_id)).await
        else {
            return;
        };
        if bytes.len() > MAX_BYTES {
            return;
        }
        let (Some(store), Some(base)) = (store_of(&app), folder(&app)) else { return };
        let _ = tauri::async_runtime::spawn_blocking(move || -> Option<()> {
            let connection = store.connect().ok()?;
            // Filed under the run its steps are filed under.
            let root: String = connection
                .query_row(
                    "SELECT run_id FROM agent_run_steps WHERE call_id = ?1",
                    params![format!("{run_id}:{call}")],
                    |row| row.get(0),
                )
                .ok()?;
            let directory = base.join(safe(&root));
            file_access::fs::create_dir_all(&directory).ok()?;
            let name = format!("{}.jpg", uuid::Uuid::new_v4().simple());
            file_access::fs::write(directory.join(&name), &bytes).ok()?;
            super::run_steps::record_picture(&connection, &run_id, &call, &name).ok()
        })
        .await;
    });
}

/// Deletes a run's pictures.
pub(super) fn forget_run(app: &AppHandle, run_id: &str) {
    if let Some(base) = folder(app) {
        let _ = file_access::fs::remove_dir_all(base.join(safe(run_id)));
    }
}

/// Deletes the picture folders of runs that no longer have steps.
pub(super) fn prune(app: &AppHandle) {
    let (Some(base), Some(store)) = (folder(app), store_of(app)) else { return };
    let Ok(entries) = file_access::fs::read_dir(&base) else { return };
    let Ok(connection) = store.connect() else { return };
    let Ok(mut runs) = connection.prepare("SELECT DISTINCT run_id FROM agent_run_steps") else { return };
    let Ok(known) = runs
        .query_map([], |row| row.get::<_, String>(0))
        .map(|rows| rows.filter_map(Result::ok).map(|run| safe(&run)).collect::<Vec<_>>())
    else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !known.contains(&name) {
            let _ = file_access::fs::remove_dir_all(entry.path());
        }
    }
}

/// One step's picture, as a data address the window can show. Only the run's own person gets it.
#[tauri::command]
pub async fn agent_run_step_picture(
    app: AppHandle,
    webview: Webview,
    run_id: String,
    picture: String,
) -> Result<String, String> {
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Err("Only a profile's window can read a run's pictures.".into());
    }
    let account = account_of_window(webview.label()).unwrap_or_default();
    let named = picture.len() <= 64
        && picture.ends_with(".jpg")
        && picture.trim_end_matches(".jpg").chars().all(|c| c.is_ascii_alphanumeric());
    if !named {
        return Err("That isn't a step's picture.".into());
    }
    let (Some(store), Some(base)) = (store_of(&app), folder(&app)) else {
        return Err("Misty is still starting.".into());
    };
    let path = base.join(safe(&run_id)).join(&picture);
    tokio::task::spawn_blocking(move || {
        let connection = store.connect().map_err(|error| error.to_string())?;
        let owned: bool = connection
            .query_row(
                "SELECT COUNT(*) > 0 FROM agent_run_steps WHERE run_id = ?1 AND account = ?2 AND picture = ?3",
                params![run_id, account, picture],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if !owned {
            return Err("That picture is gone.".into());
        }
        let bytes = file_access::fs::read(&path).map_err(|_| "That picture is gone.".to_owned())?;
        Ok(format!(
            "data:image/jpeg;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ))
    })
    .await
    .map_err(|error| error.to_string())?
}
