//! What a window may ask about the sessions in the engines' own history files: list,
//! search and rename them. Only sessions in folders linked on this computer are listed.

use tauri::State;

use crate::app::runtime::MistyRuntime;

use super::commands::{blocking, person_window};
use super::store;
use super::support::EngineState;

/// The sessions each engine's own files hold for the folders linked on this computer.
#[tauri::command]
pub async fn engine_history_list(
    webview: tauri::Webview,
    state: State<'_, EngineState>,
    runtime: State<'_, MistyRuntime>,
) -> Result<Vec<super::history::SessionMeta>, String> {
    person_window(&webview)?;
    let linked = {
        let db = runtime.environment.store();
        blocking(move || store::all_folders(&db)).await?
    };
    let sessions = super::history::reader::list_sessions(state).await?;
    Ok(sessions
        .into_iter()
        .filter(|session| {
            linked
                .iter()
                .any(|folder| std::path::Path::new(&session.workspace_path) == folder)
        })
        .collect())
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
