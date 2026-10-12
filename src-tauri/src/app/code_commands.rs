//! Code project commands (docs/plans/agent-code-projects.md): choosing a
//! project folder, running a code tool for a device job, and undo.
//!
//! Every command answers only Misty's main window. A device job's code tool
//! checks the job's signed run grant here, natively, before anything runs.
#![cfg(unix)]

use serde::Deserialize;
use serde_json::Value;
use tauri::State;

use crate::{
    app::runtime::MistyRuntime,
    error::{ApiError, ApiResult},
    infra::{device_records::SignedRecord, device_trust},
};

fn require_main(webview: &tauri::Webview) -> Result<(), String> {
    if webview.label() == "main" {
        Ok(())
    } else {
        Err("Only Misty's main window can use code projects.".into())
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeExecuteRequest {
    pub operation: String,
    pub scope_id: String,
    pub run_id: String,
    #[serde(default)]
    pub input: Value,
    pub config: Value,
}

/// Runs one code tool for a device job, after checking its run grant.
#[tauri::command]
pub async fn code_execute(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    request: CodeExecuteRequest,
) -> Result<Value, String> {
    require_main(&webview)?;
    if !misty_agent_code::OPERATIONS.contains(&request.operation.as_str()) {
        return Err(format!("unsupported_device_operation:{}", request.operation));
    }
    let grant: SignedRecord = serde_json::from_value(request.config["runGrant"].clone())
        .map_err(|_| "device_grant_invalid".to_owned())?;
    device_trust::verify_job_grant(&grant, &request.scope_id, &request.operation, "code")
        .map_err(|_| "device_grant_invalid".to_owned())?;
    let project = state
        .agents
        .project(request.scope_id.clone())
        .await
        .map_err(|_| "invalid_device_scope: the project is no longer shared".to_owned())?;
    misty_agent_code::outcome(
        state
            .code
            .execute(&project, &request.run_id, &request.operation, request.input)
            .await,
    )
}

/// Shows the native folder picker and shares the chosen folder as a project.
/// A page can never name a path itself.
#[tauri::command]
pub async fn code_choose_project(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
) -> ApiResult<Option<Value>> {
    use tauri_plugin_dialog::DialogExt;
    require_main(&webview).map_err(ApiError::Message)?;
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Choose a project folder agents can change")
        .pick_folder(move |folder| {
            let _ = send.send(folder);
        });
    let Some(folder) = receive
        .await
        .map_err(|_| ApiError::Message("Folder selection was canceled.".into()))?
    else {
        return Ok(None);
    };
    let path = folder
        .into_path()
        .map_err(|_| ApiError::Message("Choose a local folder.".into()))?;
    state
        .agents
        .register_project_scope(path, &state.code)
        .await
        .map(Some)
}

/// Turns a folder shared read-only into a project the agents can change.
#[tauri::command]
pub async fn code_allow_project_changes(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    scope_id: String,
) -> ApiResult<()> {
    require_main(&webview).map_err(ApiError::Message)?;
    state.agents.allow_project_changes(scope_id, &state.code).await
}

#[tauri::command]
pub async fn code_set_project_installs(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    scope_id: String,
    allow: bool,
) -> ApiResult<()> {
    require_main(&webview).map_err(ApiError::Message)?;
    state.agents.set_project_installs(scope_id, allow).await
}

/// Stops sharing a project: its processes and previews stop, and its undo
/// copies and scratch folders are deleted. The folder itself is untouched.
#[tauri::command]
pub async fn code_remove_project(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    scope_id: String,
) -> ApiResult<()> {
    require_main(&webview).map_err(ApiError::Message)?;
    state.code.forget(&scope_id);
    state.agents.revoke_folder_scope(scope_id).await
}

/// Runs in a project that can be undone, newest first.
#[tauri::command]
pub async fn code_checkpoints(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    scope_id: String,
) -> ApiResult<Value> {
    require_main(&webview).map_err(ApiError::Message)?;
    Ok(state.code.checkpoints(&scope_id))
}

/// Restores a project to how it was before one agent run.
#[tauri::command]
pub async fn code_undo(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    scope_id: String,
    run_id: String,
) -> ApiResult<Value> {
    require_main(&webview).map_err(ApiError::Message)?;
    let project = state.agents.project(scope_id).await?;
    let code = state.code.clone();
    tokio::task::spawn_blocking(move || code.undo(&project, &run_id))
        .await
        .map_err(|_| ApiError::Message("Undo stopped unexpectedly.".into()))?
        .map_err(|error| ApiError::Message(error.to_string()))
}
