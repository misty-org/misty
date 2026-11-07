//! What the app's windows and an agent's tools ask of Memory. Only a person's window may call these, so
//! neither incognito nor a page can reach them, and the account is always the one signed in here: a
//! window never names it.
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

use super::events::{MemoryEvent, MemoryQuery};
use super::forget::{self, Forget};
use super::index;
use super::prefs::{self, Remember};
use super::search::{self, MemoryHit};
use super::summaries::{self, RecapOutline};
use super::tree::{self, MemoryNode, TreeQuery};
use super::{
    check_space, clip, events, export, now_ms, optional_time, MemoryError, Result, BACKLOG_CAP, FACTS,
    MOMENTS, SUMMARIES,
};
use crate::app::runtime::MistyRuntime;
use crate::infra::profile_windows;

const BACKLOG_MESSAGE: &str = "Memory is catching up, so new pages aren't being kept for now. It continues on its own once it has caught up.";

pub(super) async fn on_database<T: Send + 'static>(
    webview: &tauri::Webview,
    state: &State<'_, MistyRuntime>,
    work: impl FnOnce(&mut Connection, &str) -> Result<T> + Send + 'static,
) -> std::result::Result<T, String> {
    if !profile_windows::is_person_window(webview.label()) {
        return Err("Only a profile's window can use Memory.".into());
    }
    let store = state.environment.store();
    let account = profile_windows::current_scope();
    tokio::task::spawn_blocking(move || {
        let mut connection = store.connect().map_err(MemoryError::from)?;
        work(&mut connection, &account)
    })
    .await
    .map_err(|_| "memory_unavailable".to_owned())?
    .map_err(|error| error.code())
}

#[derive(Serialize)]
pub struct Recorded {
    id: String,
    same_as: String,
}

#[tauri::command]
pub async fn memory_record(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    event: MemoryEvent,
) -> std::result::Result<Recorded, String> {
    on_database(&webview, &state, move |connection, account| {
        let saved = events::record(connection, account, event, BACKLOG_CAP, now_ms())?;
        Ok(Recorded { id: saved.id, same_as: saved.same_as })
    })
    .await
}

#[tauri::command]
pub async fn memory_events(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    query: MemoryQuery,
) -> std::result::Result<Vec<MemoryEvent>, String> {
    on_database(&webview, &state, move |connection, account| {
        events::list(connection, account, &query, now_ms())
    })
    .await
}

#[derive(Deserialize)]
pub struct SearchQuery {
    #[serde(default)]
    space_id: String,
    branches: Vec<String>,
    vector: Vec<f32>,
    model: String,
    #[serde(default)]
    limit: i64,
}

#[tauri::command]
pub async fn memory_search(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    query: SearchQuery,
) -> std::result::Result<Vec<MemoryHit>, String> {
    on_database(&webview, &state, move |connection, account| {
        check_space(&query.space_id)?;
        let branches: Vec<&str> = query.branches.iter().map(String::as_str).collect();
        Ok(search::search(
            connection,
            account,
            &query.space_id,
            &branches,
            &query.vector,
            &query.model,
            query.limit,
        )?)
    })
    .await
}

#[derive(Deserialize)]
pub struct ForgetRequest {
    #[serde(default)]
    space_id: String,
    #[serde(default)]
    all: bool,
    #[serde(default)]
    site: String,
    from: Option<String>,
    to: Option<String>,
    #[serde(default)]
    node_id: String,
    #[serde(default)]
    dry_run: bool,
}

#[tauri::command]
pub async fn memory_forget(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    request: ForgetRequest,
) -> std::result::Result<Value, String> {
    on_database(&webview, &state, move |connection, account| {
        let from = optional_time(request.from.as_deref(), "invalid_forget")?;
        let to = optional_time(request.to.as_deref(), "invalid_forget")?;
        let now = now_ms();
        if !request.node_id.is_empty() {
            let counts = forget::node(
                connection,
                account,
                &request.space_id,
                &request.node_id,
                from,
                to,
                request.dry_run,
                now,
            )?;
            let key = if request.dry_run { "would_forget" } else { "forgotten" };
            return Ok(json!({ key: counts.total(), "counts": counts }));
        }
        let selected = Forget {
            space_id: request.space_id,
            all: request.all,
            site: request.site,
            from,
            to,
            ..Forget::default()
        };
        let transaction = connection.transaction()?;
        let forgotten = forget::moments(&transaction, account, &selected, now, false)?;
        transaction.commit()?;
        Ok(json!({ "forgotten": forgotten }))
    })
    .await
}

#[tauri::command]
pub async fn memory_tree(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    query: TreeQuery,
) -> std::result::Result<Vec<MemoryNode>, String> {
    on_database(&webview, &state, move |connection, account| {
        tree::children(connection, account, &query, now_ms())
    })
    .await
}

#[derive(Deserialize)]
pub struct NewNode {
    #[serde(default)]
    space_id: String,
    branch: String,
    #[serde(default)]
    title: String,
    text: String,
    #[serde(default)]
    kind: String,
}

/// One memory the person writes by hand. Workflows are saved with their own tools.
#[tauri::command]
pub async fn memory_node_add(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    node: NewNode,
) -> std::result::Result<Value, String> {
    on_database(&webview, &state, move |connection, account| {
        let (title, text) = (node.title.trim(), node.text.trim());
        let now = now_ms();
        let id = match node.branch.as_str() {
            MOMENTS => {
                if text.is_empty() || text.len() > 20_000 || title.len() > 300 {
                    return Err(MemoryError::Invalid("invalid_memory_node"));
                }
                let first_line = text.lines().next().unwrap_or_default();
                let event = MemoryEvent {
                    space_id: node.space_id.clone(),
                    kind: "note".to_owned(),
                    title: if title.is_empty() { clip(first_line, 80) } else { title.to_owned() },
                    body: text.to_owned(),
                    ..MemoryEvent::default()
                };
                let saved = events::record(connection, account, event, BACKLOG_CAP, now)?;
                format!("moment:{}", saved.id)
            }
            FACTS => {
                let input = Remember {
                    space_id: node.space_id.clone(),
                    kind: node.kind.clone(),
                    content: text.to_owned(),
                    reason: "Added by you".to_owned(),
                    ..Remember::default()
                };
                format!("fact:{}", prefs::remember(connection, account, input, now)?.id)
            }
            SUMMARIES => summaries::add_manual(connection, account, &node.space_id, title, text, now)?,
            _ => return Err(MemoryError::Invalid("invalid_memory_node")),
        };
        Ok(json!({ "id": id, "branch": node.branch }))
    })
    .await
}

#[tauri::command]
pub async fn memory_status(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
) -> std::result::Result<Value, String> {
    on_database(&webview, &state, move |connection, account| {
        let waiting = index::waiting(connection, account)?;
        let full = waiting >= BACKLOG_CAP;
        let mut status = json!({ "waiting": waiting, "cap": BACKLOG_CAP, "full": full });
        if full {
            status["message"] = json!(BACKLOG_MESSAGE);
        }
        Ok(status)
    })
    .await
}

#[tauri::command]
pub async fn memory_export(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
) -> std::result::Result<tauri::ipc::Response, String> {
    let bytes = on_database(&webview, &state, move |connection, account| {
        export::zip_all(connection, account)
    })
    .await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[derive(Deserialize)]
pub struct RecapRequest {
    #[serde(default)]
    space_id: String,
    date: String,
    markdown: String,
    #[serde(default)]
    outline: RecapOutline,
}

#[tauri::command]
pub async fn memory_recap_save(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    recap: RecapRequest,
) -> std::result::Result<String, String> {
    on_database(&webview, &state, move |connection, account| {
        summaries::save_recap(
            connection,
            account,
            &recap.space_id,
            &recap.date,
            &recap.markdown,
            &recap.outline,
            now_ms(),
        )
    })
    .await
}
