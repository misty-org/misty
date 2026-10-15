//! Undo for delegated coding runs: what a run changed, the runs that can be
//! undone in a project, and undoing one. Every command answers only Misty's
//! main window, for a project shared from this device.
#![cfg(desktop)]

use serde_json::{json, Value};
use tauri::State;

use crate::{
    agents::{checkpoints::Checkpoints, project_diff::DiffSet},
    app::runtime::MistyRuntime,
    error::{ApiError, ApiResult},
};

fn require_main(webview: &tauri::Webview) -> ApiResult<()> {
    if webview.label() == "main" {
        Ok(())
    } else {
        Err(ApiError::Message(
            "Only Misty's main window can undo changes.".into(),
        ))
    }
}

pub fn checkpoints(state: &MistyRuntime) -> Checkpoints {
    Checkpoints::new(state.environment.checkpoints_dir())
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> ApiResult<T> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|_| ApiError::Message("That stopped unexpectedly.".into()))?
        .map_err(ApiError::Message)
}

/// The runs in a project that can be undone, newest first.
#[tauri::command]
pub async fn project_checkpoints(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    scope_id: String,
) -> ApiResult<Value> {
    require_main(&webview)?;
    let store = checkpoints(&state);
    Ok(json!({ "checkpoints": store.list(&scope_id) }))
}

/// What one run changed in its project.
#[tauri::command]
pub async fn project_run_diff(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    scope_id: String,
    run_id: String,
) -> ApiResult<DiffSet> {
    require_main(&webview)?;
    let project = state.agents.project(scope_id.clone()).await?;
    let store = checkpoints(&state);
    blocking(move || store.run_diff(&scope_id, &run_id, &project.root)).await
}

/// Puts a project back the way it was before a run.
#[tauri::command]
pub async fn project_undo(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    scope_id: String,
    run_id: String,
) -> ApiResult<Value> {
    require_main(&webview)?;
    let project = state.agents.project(scope_id.clone()).await?;
    let store = checkpoints(&state);
    blocking(move || store.undo(&scope_id, &run_id, &project.root)).await
}
