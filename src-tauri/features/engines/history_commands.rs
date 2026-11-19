//! What a window may ask about the sessions in the engines' own history files: list, search,
//! read and rename them. Every folder the history shows a chat in is listed (`history/past_folders.rs`),
//! not only the person's projects. Listing a chat gives nothing access to its folder: continuing
//! one works there only if it is one of their projects (`engine_chat_resume`).

use std::sync::Arc;

use tauri::State;

use serde::Serialize;

use crate::app::runtime::MistyRuntime;

use super::commands::person_window;
use super::store;
use super::support::EngineState;

/// The sessions each engine's own files hold, from every folder they ran in, each with its
/// folder. A background scan follows, so chats started outside Misty since show up next time.
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

/// The sessions each engine's own files hold right now: their files are read again first, so an
/// agent's sync finds chats started outside Misty since the last scan. Waits for a scan already
/// running.
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

/// Full-text search over every indexed session's messages.
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

/// Renames a session, written back where the engine keeps its own title.
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

/// One session's messages, read from the engine's own file, for a chat that resumes it.
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

/// The engine session a chat runs, so Sync can read what happened in it outside Misty.
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
