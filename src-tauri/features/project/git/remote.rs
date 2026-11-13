// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//
// Commit, push and pull, through the person's own `git`: their identity, hooks, signing and
// credential helpers apply. Only a pull's fast-forward is libgit2's, so it can be done safely.

use std::path::Path;

use super::repo;
use super::{blocking, repository_of, run};

/// Commits what is staged, as the person, with their own Git identity, hooks and signing.
/// Returns the new commit's id.
#[tauri::command]
pub async fn project_git_commit(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
    message: String,
) -> Result<String, String> {
    let top = repository_of(&app, &webview, &account, &folder).await?;
    commit(&top, &message).await
}

pub(crate) async fn commit(top: &Path, message: &str) -> Result<String, String> {
    let message = message.trim();
    if message.is_empty() {
        return Err("Write a message for the commit.".into());
    }
    let gate = repo::repo_write_gate(top);
    let _queued = gate.lock().await;
    run(top, None, &["commit", "-m", message])
        .await
        .map_err(|error| commit_error(&error))?;
    Ok(run(top, None, &["rev-parse", "HEAD"])
        .await?
        .trim()
        .to_string())
}

fn commit_error(error: &str) -> String {
    let lower = error.to_lowercase();
    if lower.contains("please tell me who you are") || lower.contains("user.email") {
        return "Git doesn't know who you are yet. Set user.name and user.email in your Git \
                config, then commit again."
            .into();
    }
    if lower.contains("nothing to commit") || lower.contains("no changes added") {
        return "Nothing is staged to commit.".into();
    }
    error.to_string()
}

/// Network failures as something a person can act on, not Git's raw words.
fn remote_error(error: &str) -> String {
    let lower = error.to_lowercase();
    if lower.contains("authentication")
        || lower.contains("permission denied")
        || lower.contains("publickey")
        || lower.contains("could not read username")
        || lower.contains("credentials")
    {
        return format!(
            "Git couldn't sign in to the remote. Check your credential helper or SSH key. ({})",
            error.lines().last().unwrap_or(error).trim()
        );
    }
    if lower.contains("does not appear to be a git repository") && lower.contains("'origin'") {
        return "This repository has no remote named origin.".into();
    }
    error.to_string()
}

/// Pushes the current branch to the same branch on `origin`, and makes `origin` its upstream
/// when it has none yet.
#[tauri::command]
pub async fn project_git_push(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
) -> Result<(), String> {
    let top = repository_of(&app, &webview, &account, &folder).await?;
    push(&top).await
}

pub(crate) async fn push(top: &Path) -> Result<(), String> {
    let at = top.to_path_buf();
    let (branch, tracked) = blocking(move || {
        let repo = repo::open_repo(&at)?;
        let branch = repo::current_branch_name(&repo)?;
        let tracked = repo
            .branch_upstream_name(&format!("refs/heads/{branch}"))
            .is_ok();
        Ok((branch, tracked))
    })
    .await?;
    let refspec = format!("refs/heads/{branch}:refs/heads/{branch}");
    let mut arguments = vec!["push"];
    if !tracked {
        arguments.push("--set-upstream");
    }
    arguments.extend(["origin", refspec.as_str()]);
    run(top, None, &arguments)
        .await
        .map(|_| ())
        .map_err(|error| remote_error(&error))
}

/// Pulls the current branch from `origin`, fast-forward only. Git fetches (with the person's
/// credentials); the fast-forward itself never touches a file that is changed in the folder,
/// and names those files instead when they're in the way.
#[tauri::command]
pub async fn project_git_pull(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
) -> Result<(), String> {
    let top = repository_of(&app, &webview, &account, &folder).await?;
    pull(&top).await
}

pub(crate) async fn pull(top: &Path) -> Result<(), String> {
    let at = top.to_path_buf();
    let branch = blocking(move || repo::current_branch_name(&repo::open_repo(&at)?)).await?;
    run(top, None, &["fetch", "--quiet", "origin", &branch])
        .await
        .map_err(|error| remote_error(&error))?;
    let at = top.to_path_buf();
    blocking(move || fast_forward(&at, &branch)).await
}

/// Moves the branch to FETCH_HEAD when that is a fast-forward, with a safe checkout.
fn fast_forward(top: &Path, branch: &str) -> Result<(), String> {
    let gate = repo::repo_write_gate(top);
    let _queued = gate.blocking_lock();
    let repo = repo::open_repo(top)?;
    let fetch_head = repo
        .find_reference("FETCH_HEAD")
        .map_err(|error| error.to_string())?;
    let fetched = repo
        .reference_to_annotated_commit(&fetch_head)
        .map_err(|error| error.to_string())?;
    let (analysis, _) = repo
        .merge_analysis(&[&fetched])
        .map_err(|error| error.to_string())?;
    if analysis.is_up_to_date() {
        return Ok(());
    }
    if !analysis.is_fast_forward() {
        return Err(
            "This branch and origin have both moved on, so pulling needs a merge. Merge in a \
             terminal, then refresh."
                .into(),
        );
    }
    let mut reference = repo
        .find_reference(&format!("refs/heads/{branch}"))
        .map_err(|error| error.to_string())?;
    let target = repo
        .find_commit(fetched.id())
        .map_err(|error| error.to_string())?;
    // A safe checkout, never forced: uncommitted work is never overwritten. HEAD stays on the
    // old commit until the checkout succeeds, so nothing is left half moved.
    let mut checkout = git2::build::CheckoutBuilder::new();
    checkout.safe();
    if let Err(error) = repo.checkout_tree(target.as_object(), Some(&mut checkout)) {
        let conflicts = repo::ff_conflicting_files(&repo, fetched.id());
        return Err(if conflicts.is_empty() {
            format!("The pull couldn't update the files: {error}")
        } else {
            format!(
                "Pulling would overwrite uncommitted changes in {}. Commit or stash them first.",
                conflicts.join(", ")
            )
        });
    }
    reference
        .set_target(fetched.id(), "pull: fast-forward")
        .map(|_| ())
        .map_err(|error| error.to_string())
}
