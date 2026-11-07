//! What the app's windows and an agent's tools ask of remembered facts, and the worker that makes vectors
//! on this computer's own embedding model. See `commands` for who may call these.
use serde::Deserialize;
use tauri::State;

use super::commands::on_database;
use super::index::{self, ChunkKey, ClaimedChunk, EmbeddedChunk};
use super::now_ms;
use super::prefs::{self, MemoryFact, Remember};
use crate::app::runtime::MistyRuntime;

#[derive(Deserialize)]
pub struct PrefScope {
    #[serde(default)]
    space_id: String,
    #[serde(default)]
    agent_id: String,
    #[serde(default)]
    limit: i64,
}

#[tauri::command]
pub async fn memory_prefs_list(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    scope: PrefScope,
) -> std::result::Result<Vec<MemoryFact>, String> {
    on_database(&webview, &state, move |connection, account| {
        prefs::list(connection, account, &scope.space_id, &scope.agent_id, scope.limit)
    })
    .await
}

/// What a run's prompt reads, which also says when each memory was last used.
#[tauri::command]
pub async fn memory_context(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    scope: PrefScope,
) -> std::result::Result<Vec<MemoryFact>, String> {
    on_database(&webview, &state, move |connection, account| {
        prefs::context(connection, account, &scope.space_id, &scope.agent_id, scope.limit, now_ms())
    })
    .await
}

#[tauri::command]
pub async fn memory_pref_remember(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    input: Remember,
) -> std::result::Result<MemoryFact, String> {
    on_database(&webview, &state, move |connection, account| {
        prefs::remember(connection, account, input, now_ms())
    })
    .await
}

#[derive(Deserialize)]
pub struct PrefEdit {
    #[serde(default)]
    space_id: String,
    #[serde(default)]
    agent_id: String,
    id: String,
    #[serde(default)]
    content: String,
}

#[tauri::command]
pub async fn memory_pref_update(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    edit: PrefEdit,
) -> std::result::Result<(), String> {
    on_database(&webview, &state, move |connection, account| {
        prefs::update(connection, account, &edit.space_id, &edit.agent_id, &edit.id, &edit.content, now_ms())
    })
    .await
}

#[tauri::command]
pub async fn memory_pref_forget(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    edit: PrefEdit,
) -> std::result::Result<(), String> {
    on_database(&webview, &state, move |connection, account| {
        prefs::forget(connection, account, &edit.space_id, Some(&edit.agent_id), &edit.id, now_ms())
    })
    .await
}

#[tauri::command]
pub async fn memory_embed_claim(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    limit: i64,
) -> std::result::Result<Vec<ClaimedChunk>, String> {
    on_database(&webview, &state, move |connection, account| {
        Ok(index::claim(connection, account, limit, now_ms())?)
    })
    .await
}

#[derive(Deserialize)]
pub struct EmbedResult {
    #[serde(default)]
    model: String,
    #[serde(default)]
    chunks: Vec<EmbeddedChunk>,
    #[serde(default)]
    failed: Vec<ChunkKey>,
}

#[tauri::command]
pub async fn memory_embed_complete(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    result: EmbedResult,
) -> std::result::Result<(), String> {
    on_database(&webview, &state, move |connection, account| {
        index::complete(connection, account, &result.model, &result.chunks)?;
        index::retry(connection, account, &result.failed, now_ms())?;
        Ok(())
    })
    .await
}
