// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//! A linked folder's Git worktrees: list, create (with progress and cancel), remove, the
//! branch-merged check, and a GitHub pull request preview.
//!
//! Changing anything runs the person's own `git`: a fetch or `worktree add` can be killed when
//! the person cancels, and its errors are the ones they know from a terminal. Reading branches,
//! the merged check and a worktree's state use libgit2, like `git.rs`.
//!
//! A worktree's place is never taken from a window: it is `<repo>-worktrees/<branch>` beside the
//! linked repository, worked out here. Once made, it is linked to the chat's Space like any
//! folder the person picked, so the panels and engines can work in it; removing it unlinks it.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use tokio::io::AsyncReadExt;
use tokio::sync::Notify;

use super::{linked_path, person_window};
use crate::app::runtime::MistyRuntime;

pub const PROGRESS_EVENT: &str = "misty://worktree-progress";

mod create;
mod helpers;
mod pr;
mod remove;
mod repo;
#[cfg(test)]
#[allow(clippy::disallowed_methods)]
mod tests;
mod types;

use create::*;
pub use helpers::*;
use pr::*;
use remove::*;
use repo::*;
pub use types::*;

pub struct CreationCancel {
    cancelled: AtomicBool,
    notify: Notify,
}

impl CreationCancel {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            cancelled: AtomicBool::new(false),
            notify: Notify::new(),
        })
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        self.notify.notify_waiters();
    }
}

type Creations = HashMap<String, (String, Arc<CreationCancel>)>;

static CREATIONS: LazyLock<Mutex<Creations>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn creations() -> std::sync::MutexGuard<'static, Creations> {
    CREATIONS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[tauri::command]
pub async fn project_worktree_list(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
) -> Result<WorktreeListing, String> {
    person_window(&webview)?;
    let linked = linked_path(&app, &account, &folder).await?;
    let repo = {
        let linked = linked.clone();
        tokio::task::spawn_blocking(move || main_checkout(&linked))
            .await
            .map_err(|error| error.to_string())??
    };
    reach_worktrees(&repo);
    let mut worktrees = list_worktrees_cli(&repo).await?;
    let (worktrees, branches, current) = tokio::task::spawn_blocking(move || {
        for worktree in worktrees.iter_mut().filter(|w| !w.is_main && !w.prunable) {
            let (changed, samples, ahead) = worktree_changes(Path::new(&worktree.path));
            worktree.changed = changed;
            worktree.samples = samples;
            worktree.ahead = ahead;
        }
        let repo = open_repo(&linked)?;
        Ok::<_, String>((worktrees, list_branches(&repo), current_branch(&repo)))
    })
    .await
    .map_err(|error| error.to_string())??;
    Ok(WorktreeListing {
        repository: repo.to_string_lossy().into_owned(),
        worktrees,
        branches,
        current,
    })
}

#[tauri::command]
pub async fn project_worktree_create(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
    creation_id: String,
    args: WorktreeCreateArgs,
) -> Result<(), String> {
    let id = creation_id.trim().to_string();
    if id.is_empty() || id.len() > 100 {
        return Err("A creation needs an id.".into());
    }
    let repo = linked_repository(&app, &webview, &account, &folder).await?;
    let space = space_key(&args.space)?;
    let window = webview.label().to_string();
    let cancel = CreationCancel::new();
    creations().insert(id.clone(), (window.clone(), Arc::clone(&cancel)));
    let emitter = app.clone();
    let target_window = window.clone();
    let report = move |event: CreateProgress| {
        let _ = emitter.emit_to(target_window.as_str(), PROGRESS_EVENT, event);
    };
    let mut result = run_create(&report, &id, &repo, &args, &cancel).await;
    if let Ok(target) = &result {
        progress(&report, &id, "register", None);
        let linked = link_worktree(&app, &account, &space, target).await;
        result = linked.map_err(|error| fail("register_failed", error));
    }
    creations().remove(&id);
    match result {
        Ok(path) => {
            report(CreateProgress {
                creation_id: id,
                stage: "done",
                message: None,
                error_kind: None,
                error: None,
                path: Some(path.to_string_lossy().into_owned()),
            });
            Ok(())
        }
        Err(failure) if failure.kind == "canceled" => {
            progress(&report, &id, "canceled", None);
            Ok(())
        }
        Err(failure) => {
            report(CreateProgress {
                creation_id: id,
                stage: "failed",
                message: None,
                error_kind: Some(failure.kind),
                error: Some(failure.message.clone()),
                path: None,
            });
            Err(failure.message)
        }
    }
}

async fn link_worktree(
    app: &tauri::AppHandle,
    account: &str,
    space: &str,
    target: &Path,
) -> Result<PathBuf, String> {
    let real = file_access::fs::canonicalize(target).map_err(|error| error.to_string())?;
    file_access::allow_linked_folder(&real);
    let db = app.state::<MistyRuntime>().environment.store();
    let _ = space;
    let (account, text) = (account.to_string(), real.to_string_lossy().into_owned());
    tokio::task::spawn_blocking(move || crate::engines::store::add_project(&db, &account, &text))
        .await
        .map_err(|error| error.to_string())??;
    Ok(real)
}

#[tauri::command]
pub async fn project_worktree_create_cancel(
    webview: tauri::Webview,
    creation_id: String,
) -> Result<bool, String> {
    person_window(&webview)?;
    let found = creations()
        .get(&creation_id)
        .filter(|(window, _)| window == webview.label())
        .map(|(_, cancel)| Arc::clone(cancel));
    Ok(match found {
        Some(cancel) => {
            cancel.cancel();
            true
        }
        None => false,
    })
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn project_worktree_remove(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
    space: String,
    worktree: String,
    delete_branch: bool,
) -> Result<WorktreeRemoveResult, String> {
    let repo = linked_repository(&app, &webview, &account, &folder).await?;
    space_key(&space)?;
    let listed = list_worktrees_cli(&repo).await?;
    let entry = listed
        .iter()
        .find(|w| same_path(&w.path, &worktree))
        .cloned();
    let in_root = worktrees_root(&repo).is_ok_and(|root| Path::new(&worktree).starts_with(root));
    match &entry {
        Some(found) if found.is_main => {
            return Err("That's the repository itself, not a worktree.".into())
        }
        Some(found) if found.locked => {
            return Err("Git has locked this worktree, so it can't be removed.".into())
        }
        Some(_) => {}
        None if in_root => {}
        None => return Err("That isn't a worktree of this repository.".into()),
    }
    let branch = entry.as_ref().and_then(|found| found.branch.clone());
    let result = remove_worktree(&repo, &worktree, branch.as_deref(), delete_branch).await?;
    let db = app.state::<MistyRuntime>().environment.store();
    let gone = worktree.clone();
    let canonical = file_access::fs::canonicalize(&worktree)
        .map(|real| real.to_string_lossy().into_owned())
        .unwrap_or_else(|_| worktree.clone());
    let still = tokio::task::spawn_blocking(move || {
        let mut still = crate::engines::store::remove_project(&db, &account, &gone)?;
        if canonical != gone {
            still = crate::engines::store::remove_project(&db, &account, &canonical)?;
        }
        Ok::<_, String>(still)
    })
    .await
    .map_err(|error| error.to_string())??;
    if !still {
        file_access::revoke_linked_folder(Path::new(&worktree));
    }
    Ok(result)
}

#[tauri::command]
pub async fn project_worktree_branch_merged(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
    branch: String,
    base: String,
) -> Result<bool, String> {
    let repo = linked_repository(&app, &webview, &account, &folder).await?;
    tokio::task::spawn_blocking(move || branch_merged(&repo, &branch, &base))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn project_worktree_resolve_pr(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
    input: String,
    suggested_branch: String,
) -> Result<PrPreview, String> {
    let number = parse_pr_input(&input).ok_or_else(|| "invalid_pr_input".to_string())?;
    let repo = linked_repository(&app, &webview, &account, &folder).await?;
    let path = worktree_path(&repo, &suggested_branch)?;
    let (slug, branch_conflict) = {
        let repo = repo.clone();
        tokio::task::spawn_blocking(move || {
            let opened = open_repo(&repo)?;
            let url = opened
                .find_remote("origin")
                .ok()
                .and_then(|r| r.url().map(str::to_string))
                .ok_or_else(|| "no_origin".to_string())?;
            let slug = github_owner_repo(&url).ok_or_else(|| "not_github".to_string())?;
            let conflict = opened
                .find_branch(&suggested_branch, git2::BranchType::Local)
                .is_ok();
            Ok::<_, String>((slug, conflict))
        })
        .await
        .map_err(|error| error.to_string())??
    };
    let dir_conflict = file_access::fs::exists(&path);
    let gh = gh_pr_view(number, &slug).await;
    Ok(PrPreview {
        number,
        repo: slug,
        degraded: gh.is_none(),
        title: gh.as_ref().and_then(|g| g.title.clone()),
        author: gh.as_ref().and_then(|g| g.author.as_ref()?.login.clone()),
        additions: gh.as_ref().and_then(|g| g.additions),
        deletions: gh.as_ref().and_then(|g| g.deletions),
        state: gh.as_ref().and_then(|g| g.state.clone()),
        branch_conflict,
        dir_conflict,
        path: path.to_string_lossy().into_owned(),
    })
}
