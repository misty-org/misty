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

/// Asks where to put a new folder, with the system folder picker.
async fn pick_parent(app: &tauri::AppHandle, title: String) -> ApiResult<Option<std::path::PathBuf>> {
    use tauri_plugin_dialog::DialogExt;
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog().file().set_title(title).pick_folder(move |folder| {
        let _ = send.send(folder);
    });
    let Some(folder) = receive
        .await
        .map_err(|_| ApiError::Message("Folder selection was canceled.".into()))?
    else {
        return Ok(None);
    };
    folder
        .into_path()
        .map(Some)
        .map_err(|_| ApiError::Message("Choose a local folder.".into()))
}

/// New project: a named folder where the person chooses, as a Git repository.
#[tauri::command]
pub async fn code_new_project(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    name: String,
) -> ApiResult<Option<Value>> {
    require_main(&webview).map_err(ApiError::Message)?;
    let Some(parent) = pick_parent(&app, format!("Choose where to create {}", name.trim())).await? else {
        return Ok(None);
    };
    let (project, folder) = state.agents.create_project_folder(parent, &name, &state.code).await?;
    misty_agent_code::git::init(&folder).map_err(|error| ApiError::Message(error.to_string()))?;
    Ok(Some(project))
}

/// From GitHub: an empty project folder ready to receive a clone. The files
/// arrive through GitHub's API afterwards (`code_git` steps).
#[tauri::command]
pub async fn code_clone_project(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    owner: String,
    name: String,
    branch: String,
) -> ApiResult<Option<Value>> {
    require_main(&webview).map_err(ApiError::Message)?;
    let Some(parent) = pick_parent(&app, format!("Choose where to put {owner}/{name}")).await? else {
        return Ok(None);
    };
    let (project, folder) = state.agents.create_project_folder(parent, &name, &state.code).await?;
    let github = misty_agent_code::git::GitHubRepo { owner, name };
    if let Err(error) = misty_agent_code::git::prepare_clone(&folder, &github, &branch)
        .and_then(|_| misty_agent_code::git::set_default_branch(&folder, &branch))
    {
        if let Some(id) = project["id"].as_str() {
            let _ = state.agents.revoke_folder_scope(id.to_owned()).await;
        }
        let _ = std::fs::remove_dir_all(&folder);
        return Err(ApiError::Message(error.to_string()));
    }
    Ok(Some(project))
}

#[tauri::command]
pub async fn code_set_project_push(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    scope_id: String,
    allow: bool,
    allow_default: bool,
) -> ApiResult<()> {
    require_main(&webview).map_err(ApiError::Message)?;
    state.agents.set_project_push(scope_id, allow, allow_default).await
}

/// What one answer changed in a project.
#[tauri::command]
pub async fn code_run_diff(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    scope_id: String,
    run_id: String,
) -> ApiResult<Value> {
    require_main(&webview).map_err(ApiError::Message)?;
    let project = state.agents.project(scope_id).await?;
    let code = state.code.clone();
    tokio::task::spawn_blocking(move || code.run_diff(&project, &run_id))
        .await
        .map_err(|_| ApiError::Message("The diff stopped unexpectedly.".into()))?
        .map_err(|error| ApiError::Message(error.to_string()))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeGitRequest {
    pub operation: String,
    pub scope_id: String,
    #[serde(default)]
    pub input: Value,
}

/// One Git step for Misty's own views and transfers with GitHub.
#[tauri::command]
pub async fn code_git(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    request: CodeGitRequest,
) -> Result<Value, String> {
    require_main(&webview)?;
    if !misty_agent_code::GIT_TRANSFER_OPERATIONS.contains(&request.operation.as_str()) {
        return Err(format!("unsupported Git operation {}", request.operation));
    }
    let project = state
        .agents
        .project(request.scope_id.clone())
        .await
        .map_err(|_| "invalid_device_scope: the project is no longer shared".to_owned())?;
    let code = state.code.clone();
    tokio::task::spawn_blocking(move || {
        misty_agent_code::outcome(code.git_transfer(&project, &request.operation, request.input))
    })
    .await
    .map_err(|_| "The Git step stopped unexpectedly.".to_owned())?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeGitJobRequest {
    pub operation: String,
    pub scope_id: String,
    pub config: Value,
}

/// Checks an agent's push, pull or pull request before the desktop starts
/// it: the job's run grant, and for anything that sends commits to GitHub the
/// project's switches, including the default-branch rule.
#[tauri::command]
pub async fn code_git_job(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    request: CodeGitJobRequest,
) -> Result<Value, String> {
    require_main(&webview)?;
    if !matches!(request.operation.as_str(), "git.push" | "git.pull" | "git.pull_request") {
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
    let status = misty_agent_code::git::status(&project.root).map_err(|error| error.to_string())?;
    let branch = status["branch"].as_str().unwrap_or_default().to_owned();
    let default_branch = status["defaultBranch"].as_str().unwrap_or("main").to_owned();
    if request.operation != "git.pull" {
        let (allow, allow_default) = state
            .agents
            .push_settings(request.scope_id.clone())
            .await
            .map_err(|error| error.to_string())?;
        if !allow {
            return Ok(serde_json::json!({ "allowed": false, "reason": "Agents can't push this project. The person can turn on \"Agents can push\" for it in Integrations › Projects." }));
        }
        if request.operation == "git.push" && branch == default_branch && !allow_default {
            return Ok(serde_json::json!({ "allowed": false, "reason": format!("Agents can't push {default_branch} in this project. Push a new branch with git_branch, then open a pull request.") }));
        }
    }
    Ok(serde_json::json!({ "allowed": true, "branch": branch, "defaultBranch": default_branch, "github": status["github"] }))
}
