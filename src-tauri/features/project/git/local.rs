// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//
// The changes panel's commands that read a repository or change its index and folder through
// libgit2: status, diffs, staging, discarding, branches, init, and the file tree's colors.

use super::repo::{self, BranchInfo, GitImageDiff, GitStatus};
use super::tree::{self, GitTreeLevel, GitTreeStatus, TreeSnapshots};
use super::{blocking, branch_name, folder_of, inside, inside_all, repository_of};
use crate::project::{linked_path, person_window};

#[tauri::command]
pub async fn project_git_status(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
) -> Result<GitStatus, String> {
    let folder = folder_of(&app, &webview, &account, &folder).await?;
    blocking(move || repo::git_status_blocking(&folder)).await
}

#[tauri::command]
pub async fn project_git_diff(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
    file: String,
    staged: bool,
) -> Result<String, String> {
    let folder = folder_of(&app, &webview, &account, &folder).await?;
    inside(&file)?;
    blocking(move || repo::git_diff_blocking(&folder, &file, staged)).await
}

#[tauri::command]
pub async fn project_git_diff_images(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
    file: String,
    staged: bool,
) -> Result<GitImageDiff, String> {
    let folder = folder_of(&app, &webview, &account, &folder).await?;
    inside(&file)?;
    blocking(move || repo::git_diff_images_blocking(&folder, &file, staged)).await
}

#[tauri::command]
pub async fn project_git_stage(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
    files: Vec<String>,
) -> Result<(), String> {
    let top = repository_of(&app, &webview, &account, &folder).await?;
    inside_all(&files)?;
    blocking(move || repo::git_stage_blocking(&top, &files)).await
}

#[tauri::command]
pub async fn project_git_unstage(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
    files: Vec<String>,
) -> Result<(), String> {
    let top = repository_of(&app, &webview, &account, &folder).await?;
    inside_all(&files)?;
    blocking(move || repo::git_unstage_blocking(&top, &files)).await
}

#[tauri::command]
pub async fn project_git_discard(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
    files: Vec<String>,
) -> Result<(), String> {
    let top = repository_of(&app, &webview, &account, &folder).await?;
    inside_all(&files)?;
    blocking(move || repo::git_discard_blocking(&top, &files)).await
}

#[tauri::command]
pub async fn project_git_branches(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
) -> Result<Vec<BranchInfo>, String> {
    let folder = folder_of(&app, &webview, &account, &folder).await?;
    blocking(move || repo::git_branches_blocking(&folder)).await
}

#[tauri::command]
pub async fn project_git_checkout(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
    branch: String,
) -> Result<(), String> {
    let top = repository_of(&app, &webview, &account, &folder).await?;
    let branch = branch_name(&branch)?.to_string();
    blocking(move || repo::git_checkout_blocking(&top, &branch)).await
}

#[tauri::command]
pub async fn project_git_create_branch(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
    name: String,
) -> Result<(), String> {
    let top = repository_of(&app, &webview, &account, &folder).await?;
    let name = branch_name(&name)?.to_string();
    blocking(move || repo::git_create_branch_blocking(&top, &name)).await
}

#[tauri::command]
pub async fn project_git_init(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
) -> Result<(), String> {
    let folder = folder_of(&app, &webview, &account, &folder).await?;
    blocking(move || repo::init_repository(&folder)).await
}

#[tauri::command]
pub async fn project_git_tree_status(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    levels: Vec<GitTreeLevel>,
) -> Result<GitTreeStatus, String> {
    person_window(&webview)?;
    for level in &levels {
        linked_path(&app, &account, &level.path).await?;
        let named = level.files.iter().chain(&level.directories).all(|name| {
            !name.is_empty() && name != ".." && !name.contains('/') && !name.contains('\\')
        });
        if !named {
            return Err("That file isn't in this folder.".into());
        }
    }
    blocking(move || {
        Ok(tree::tree_status_blocking(
            levels,
            &mut TreeSnapshots::new(true),
        ))
    })
    .await
}

#[derive(Debug, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FolderOwner {
    pub path: String,
    pub login: String,
}

#[tauri::command]
pub async fn project_git_owners(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folders: Vec<String>,
) -> Result<Vec<FolderOwner>, String> {
    person_window(&webview)?;
    let mut checked = Vec::new();
    for folder in folders.into_iter().take(64) {
        if let Ok(path) = linked_path(&app, &account, &folder).await {
            checked.push((folder, path));
        }
    }
    blocking(move || Ok(folder_owners_blocking(checked))).await
}

fn folder_owners_blocking(folders: Vec<(String, std::path::PathBuf)>) -> Vec<FolderOwner> {
    folders
        .into_iter()
        .filter_map(|(folder, path)| {
            let repo = git2::Repository::discover(&path).ok()?;
            let url = repo.find_remote("origin").ok()?.url()?.to_string();
            let slug = crate::project::worktrees::github_owner_repo(&url)?;
            let login = slug.split('/').next()?.to_string();
            Some(FolderOwner {
                path: folder,
                login,
            })
        })
        .collect()
}
