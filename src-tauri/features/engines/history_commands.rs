//! What a window may ask about the sessions in the engines' own history files: list, page,
//! search, rename and edit them. Only sessions in folders linked on this computer are listed.

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
        .filter(|session| linked.iter().any(|folder| std::path::Path::new(&session.workspace_path) == folder))
        .collect())
}

/// One page of a session's messages, read from the engine's own file.
#[tauri::command]
pub async fn engine_history_page(
    webview: tauri::Webview,
    state: State<'_, EngineState>,
    engine: String,
    session_id: String,
    limit: Option<usize>,
    before_seq: Option<i64>,
) -> Result<super::history::reader::SessionPage, String> {
    person_window(&webview)?;
    super::history::reader::load_session_page(state, engine, session_id, limit, before_seq, None).await
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

/// Scans the engines' session files again.
#[tauri::command]
pub fn engine_history_rescan(webview: tauri::Webview, state: State<'_, EngineState>) -> Result<(), String> {
    person_window(&webview)?;
    super::history::reader::rescan_sessions(state);
    Ok(())
}

/// A session's own file, as text, to read or edit in place.
#[tauri::command]
pub async fn engine_history_read_file(
    webview: tauri::Webview,
    state: State<'_, EngineState>,
    engine: String,
    session_id: String,
) -> Result<super::history::edit::SessionFileDocument, String> {
    person_window(&webview)?;
    super::history::edit::read_session_file(state, engine, session_id, None, None).await
}

/// Saves an edited session file. Refused while a turn runs on that session, or when the file
/// changed since it was read (`expected_version`).
#[tauri::command]
pub async fn engine_history_write_file(
    webview: tauri::Webview,
    state: State<'_, EngineState>,
    engine: String,
    session_id: String,
    content: String,
    expected_version: String,
) -> Result<super::history::edit::SessionFileDocument, String> {
    person_window(&webview)?;
    super::history::edit::write_session_file(state, engine, session_id, content, expected_version, None, None)
        .await
}

/// Opens a session's own file in the person's text editor.
#[tauri::command]
pub async fn engine_history_open_file(
    webview: tauri::Webview,
    state: State<'_, EngineState>,
    engine: String,
    session_id: String,
) -> Result<(), String> {
    person_window(&webview)?;
    super::history::edit::open_session_file_in_default_editor(state, engine, session_id).await
}
