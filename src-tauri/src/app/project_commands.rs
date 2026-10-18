//! Projects for coding: choosing, creating or cloning a project folder,
//! publishing one to GitHub, forgetting one, what changed in it, and carrying
//! old project switches over. The
//! coding itself runs in the person's own coding tool (runner_commands).
//! Every command answers only Misty's main window.
#![cfg(desktop)]

use std::{path::PathBuf, process::Command};

use serde_json::Value;
use tauri::State;

use crate::{
    agents::{
        project_diff::{project_diff, DiffSet},
        project_git,
    },
    app::runtime::MistyRuntime,
    error::{ApiError, ApiResult},
    infra::agent_projects::LegacyProjectFlags,
};

fn require_main(webview: &tauri::Webview) -> ApiResult<()> {
    if crate::infra::space_windows::is_space_window(webview.label()) {
        Ok(())
    } else {
        Err(ApiError::Message(
            "Only Misty's main window can use projects.".into(),
        ))
    }
}

/// Folders that hold Misty's own data and can never be projects.
fn protected(state: &MistyRuntime) -> Vec<PathBuf> {
    vec![state.environment.misty_dir()]
}

async fn pick_folder(app: &tauri::AppHandle, title: String) -> ApiResult<Option<PathBuf>> {
    use tauri_plugin_dialog::DialogExt;
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title(title)
        .pick_folder(move |folder| {
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

/// Shares a folder the person picks as a project.
#[tauri::command]
pub async fn project_choose(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
) -> ApiResult<Option<Value>> {
    require_main(&webview)?;
    let Some(path) = pick_folder(&app, "Choose a project folder for coding".into()).await? else {
        return Ok(None);
    };
    state
        .agents
        .register_project_scope(path, &protected(&state))
        .await
        .map(Some)
}

/// Creates a new empty project folder (a Git repository when Git is installed).
#[tauri::command]
pub async fn project_new(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    name: String,
) -> ApiResult<Option<Value>> {
    require_main(&webview)?;
    let Some(parent) = pick_folder(&app, format!("Choose where to create {}", name.trim())).await?
    else {
        return Ok(None);
    };
    let (project, folder) = state
        .agents
        .create_project_folder(parent, &name, &protected(&state))
        .await?;
    let _ = Command::new("git")
        .args(["init", "-q"])
        .current_dir(&folder)
        .output();
    Ok(Some(project))
}

/// Pushes a project to the empty GitHub repository just made for it, and
/// makes that repository its `origin`.
#[tauri::command]
pub async fn project_publish(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    scope_id: String,
    clone_url: String,
) -> ApiResult<()> {
    require_main(&webview)?;
    let remote = project_git::github_https(&clone_url)
        .ok_or_else(|| ApiError::Message("That isn't a GitHub repository address.".into()))?;
    let project = state.agents.project(scope_id).await?;
    tokio::task::spawn_blocking(move || project_git::publish(&project.root, &remote))
        .await
        .map_err(|_| ApiError::Message("Publishing stopped unexpectedly.".into()))?
        .map_err(ApiError::Message)
}

/// Clones a GitHub repository into a new project folder where the person
/// picks. Nothing is left behind when the clone fails.
#[tauri::command]
pub async fn project_clone(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    clone_url: String,
    name: String,
) -> ApiResult<Option<Value>> {
    require_main(&webview)?;
    let remote = project_git::github_https(&clone_url)
        .ok_or_else(|| ApiError::Message("That isn't a GitHub repository address.".into()))?;
    let Some(parent) = pick_folder(&app, format!("Choose where to clone {}", name.trim())).await?
    else {
        return Ok(None);
    };
    let (project, folder) = state
        .agents
        .create_project_folder(parent, &name, &protected(&state))
        .await?;
    let target = folder.clone();
    let cloned = tokio::task::spawn_blocking(move || project_git::clone_into(&remote, &target))
        .await
        .unwrap_or_else(|_| Err("The clone stopped unexpectedly.".into()));
    if let Err(message) = cloned {
        if let Some(id) = project.get("id").and_then(Value::as_str) {
            let _ = state.agents.revoke_folder_scope(id.to_owned()).await;
        }
        let _ = std::fs::remove_dir_all(&folder);
        return Err(ApiError::Message(message));
    }
    Ok(Some(project))
}

/// Stops sharing a project and forgets its undo copies. Its files stay
/// where they are.
#[tauri::command]
pub async fn project_remove(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    scope_id: String,
) -> ApiResult<()> {
    require_main(&webview)?;
    crate::app::checkpoint_commands::checkpoints(&state).forget(&scope_id);
    state.agents.revoke_folder_scope(scope_id).await
}

/// What changed in a project since its last commit.
#[tauri::command]
pub async fn project_git_diff(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    scope_id: String,
) -> ApiResult<DiffSet> {
    require_main(&webview)?;
    let project = state.agents.project(scope_id).await?;
    tokio::task::spawn_blocking(move || project_diff(&project.root))
        .await
        .map_err(|_| ApiError::Message("Reading the changes stopped unexpectedly.".into()))?
        .map_err(ApiError::Message)
}

/// Projects whose old switches still need carrying over, with each one's
/// GitHub remote for a remembered push.
#[tauri::command]
pub async fn project_legacy_flags(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
) -> ApiResult<Vec<(LegacyProjectFlags, Option<String>)>> {
    require_main(&webview)?;
    let mut out = Vec::new();
    for flags in state.agents.legacy_project_flags().await? {
        let remote = state
            .agents
            .project(flags.scope_id.clone())
            .await
            .ok()
            .and_then(|p| crate::agents::runners::tauri_host::github_remote(&p.root));
        out.push((flags, remote));
    }
    Ok(out)
}

/// Records that a project's old switches were carried over.
#[tauri::command]
pub async fn project_legacy_flags_done(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    scope_id: String,
) -> ApiResult<()> {
    require_main(&webview)?;
    state.agents.mark_project_flags_migrated(scope_id).await
}
