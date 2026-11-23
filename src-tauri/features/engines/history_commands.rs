use std::sync::Arc;

use tauri::State;

use serde::Serialize;

use crate::app::runtime::MistyRuntime;

use super::commands::person_window;
use super::store;
use super::support::EngineState;

#[tauri::command]
pub async fn engine_history_list(
    webview: tauri::Webview,
    state: State<'_, EngineState>,
) -> Result<Vec<super::history::SessionMeta>, String> {
    person_window(&webview)?;
    let (db, sink) = (Arc::clone(&state.db), Arc::clone(&state.sink));
    let sessions = super::history::reader::list_sessions(state).await?;
    super::history::scanner::spawn_scan(db, sink);
    Ok(sessions)
}

#[tauri::command]
pub async fn engine_history_rescan(
    webview: tauri::Webview,
    state: State<'_, EngineState>,
) -> Result<Vec<super::history::SessionMeta>, String> {
    person_window(&webview)?;
    let (db, sink) = (Arc::clone(&state.db), Arc::clone(&state.sink));
    tauri::async_runtime::spawn_blocking(move || {
        super::history::scanner::scan_now(&db, &sink)?;
        super::history::reader::list_sessions_from(&db)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn engine_history_search(
    webview: tauri::Webview,
    state: State<'_, EngineState>,
    query: String,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<super::history::search::MessageSearchPage, String> {
    person_window(&webview)?;
    super::history::search::search_messages(state, query, limit, offset).await
}

#[tauri::command]
pub async fn engine_history_rename(
    webview: tauri::Webview,
    state: State<'_, EngineState>,
    engine: String,
    session_id: String,
    title: String,
) -> Result<(), String> {
    person_window(&webview)?;
    super::history::reader::rename_session(state, engine, session_id, title)
        .await
        .map(|_| ())
}

#[tauri::command]
pub async fn engine_history_messages(
    webview: tauri::Webview,
    state: State<'_, EngineState>,
    engine: String,
    session_id: String,
) -> Result<Vec<super::history::Message>, String> {
    person_window(&webview)?;
    super::history::reader::read_session(state, engine, session_id).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSession {
    engine: String,
    session_id: String,
}

#[tauri::command]
pub async fn engine_chat_session(
    webview: tauri::Webview,
    runtime: State<'_, MistyRuntime>,
    account: String,
    conversation: String,
) -> Result<Option<ChatSession>, String> {
    person_window(&webview)?;
    let kept = runtime.environment.store();
    tokio::task::spawn_blocking(move || {
        store::chat_session(&kept, &account, &conversation)
            .map(|(engine, session_id)| ChatSession { engine, session_id })
    })
    .await
    .map_err(|error| error.to_string())
}
