//! What a window may ask about the sessions in the engines' own history files: list, search and
//! rename them. Every folder the history shows a chat in is listed (`history/past_folders.rs`),
//! not only folders linked to a Space or owned by an agent. Listing a chat gives nothing access to
//! its folder: continuing one there goes through `agent_folder_history.rs`.

use std::sync::Arc;

use tauri::State;

use super::commands::person_window;
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
