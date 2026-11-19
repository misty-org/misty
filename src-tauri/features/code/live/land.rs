//! After the commits: landing the session branch on main in the person's own checkout (only when
//! it is clean and on main), pushing it, and opening a pull request for it.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;

use super::files::live_worktree;
use super::finish::{branch_of, words};
use super::git::{checkout_top, git, open_repo};
use super::{blocking, session_branch};
use crate::project::{linked_path, person_window};

/// The person's own checkout at a linked folder, as its top and repository.
async fn own_checkout(
    app: &tauri::AppHandle,
    webview: &tauri::Webview,
    account: &str,
    folder: &str,
) -> Result<PathBuf, String> {
    person_window(webview)?;
    let folder = linked_path(app, account, folder).await?;
    let top = blocking(move || checkout_top(&folder)).await?;
    linked_path(app, account, &top.to_string_lossy())
        .await
        .map_err(|_| "This repository reaches outside the linked folder.".to_string())
}

/// Why the session can't land on main in this checkout, or none when it can: the checkout has
/// to be on the default branch with nothing uncommitted.
fn land_blocker(top: &Path, default: &str) -> Result<Option<String>, String> {
    let repo = open_repo(top)?;
    let branch = repo
        .head()
        .ok()
        .filter(|head| head.is_branch())
        .and_then(|head| head.shorthand().map(str::to_string));
    if branch.as_deref() != Some(default) {
        return Ok(Some(format!(
            "Your checkout isn't on {default}. Switch it to {default} to merge."
        )));
    }
    let mut options = git2::StatusOptions::new();
    options.include_untracked(false).include_ignored(false);
    let dirty = repo
        .statuses(Some(&mut options))
        .map(|statuses| !statuses.is_empty())
        .unwrap_or(true);
    Ok(dirty.then(|| {
        format!(
            "Your checkout of {default} has uncommitted changes. Commit or stash them to merge."
        )
    }))
}

/// Whether the session can land on main in the person's checkout at a linked folder: none when
/// it can, otherwise why not.
#[tauri::command]
pub async fn code_live_land_check(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
    default_branch: String,
) -> Result<Option<String>, String> {
    let top = own_checkout(&app, &webview, &account, &folder).await?;
    blocking(move || land_blocker(&top, default_branch.trim())).await
}

/// Lands the session branch on main in the person's checkout: a fast-forward when main hasn't
/// moved on its own, otherwise a merge by their own `git`, undone if it conflicts.
#[tauri::command]
pub async fn code_live_land(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
    branch: String,
    default_branch: String,
) -> Result<(), String> {
    let top = own_checkout(&app, &webview, &account, &folder).await?;
    let branch = session_branch(&branch)?.to_string();
    let default = default_branch.trim().to_string();
    let fast = {
        let (top, branch, default) = (top.clone(), branch.clone(), default.clone());
        blocking(move || {
            if let Some(reason) = land_blocker(&top, &default)? {
                return Err(reason);
            }
            let repo = open_repo(&top)?;
            let head = repo
                .head()
                .and_then(|head| head.peel_to_commit())
                .map_err(words)?;
            let tip = repo
                .find_reference(&format!("refs/heads/{branch}"))
                .and_then(|reference| reference.peel_to_commit())
                .map_err(words)?;
            if tip.id() == head.id() {
                return Ok(true);
            }
            if !repo
                .graph_descendant_of(tip.id(), head.id())
                .map_err(words)?
            {
                return Ok(false);
            }
            // A safe checkout, never forced; HEAD moves only once the files have.
            let mut checkout = git2::build::CheckoutBuilder::new();
            checkout.safe();
            repo.checkout_tree(tip.as_object(), Some(&mut checkout))
                .map_err(|error| format!("Main couldn't be updated: {}", words(error)))?;
            repo.find_reference(&format!("refs/heads/{default}"))
                .and_then(|mut reference| {
                    reference.set_target(tip.id(), "live session: fast-forward")
                })
                .map_err(words)?;
            Ok(true)
        })
        .await?
    };
    if fast {
        return Ok(());
    }
    let out = git(&top, &["merge", "--no-edit", &branch], 120).await?;
    if !out.success {
        let _ = git(&top, &["merge", "--abort"], 30).await;
        return Err(format!(
            "{default} has commits of its own that conflict with the session. Merge {branch} into {default} in a terminal."
        ));
    }
    Ok(())
}

/// Pushes the session branch to origin from the worktree, with the person's own credentials.
#[tauri::command]
pub async fn code_live_push(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
) -> Result<(), String> {
    let top = live_worktree(&app, &webview, &account, &folder).await?;
    crate::project::git::push(&top).await
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestLink {
    pub url: String,
    /// The pull request was opened; otherwise `url` is GitHub's page for opening it.
    pub created: bool,
}

/// Opens a pull request for the pushed session branch with the person's GitHub CLI. Without a
/// working `gh`, it returns GitHub's page for opening one instead.
#[tauri::command]
pub async fn code_live_open_pr(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
    base: String,
    title: String,
    body: String,
) -> Result<PullRequestLink, String> {
    let top = live_worktree(&app, &webview, &account, &folder).await?;
    let base = base.trim().to_string();
    if base.is_empty() || base.starts_with('-') {
        return Err("That isn't a branch name.".into());
    }
    let (branch, slug) = {
        let top = top.clone();
        blocking(move || {
            let repo = git2::Repository::open(&top).map_err(words)?;
            let branch = branch_of(&repo)?;
            let slug = repo
                .find_remote("origin")
                .ok()
                .and_then(|remote| remote.url().map(str::to_string))
                .and_then(|url| crate::project::worktrees::github_owner_repo(&url));
            Ok((branch, slug))
        })
        .await?
    };
    let Some(slug) = slug else {
        return Err(format!(
            "Pull requests open only on GitHub from Misty. {branch} is pushed to origin."
        ));
    };
    if let Some(program) = crate::engines::resolve::find_program("gh") {
        let mut command = crate::engines::resolve::command_for(&program);
        command
            .args([
                "pr",
                "create",
                "--head",
                branch.as_str(),
                "--base",
                base.as_str(),
            ])
            .args(["--title", title.trim(), "--body", body.trim()])
            .current_dir(&top)
            .env("PATH", crate::engines::resolve::search_path())
            .env("GH_PROMPT_DISABLED", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        crate::engines::turn::own_group(&mut command);
        if let Ok(Ok(output)) =
            tokio::time::timeout(Duration::from_secs(60), command.output()).await
        {
            let text = String::from_utf8_lossy(&output.stdout);
            if let Some(url) = text
                .lines()
                .rev()
                .map(str::trim)
                .find(|line| line.starts_with("https://"))
            {
                return Ok(PullRequestLink {
                    url: url.to_string(),
                    created: true,
                });
            }
        }
    }
    Ok(PullRequestLink {
        url: format!("https://github.com/{slug}/compare/{base}...{branch}?expand=1"),
        created: false,
    })
}
