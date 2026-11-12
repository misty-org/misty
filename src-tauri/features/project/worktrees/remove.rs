// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//! Removing a worktree, a lost one too, and the branch-merged check.

use super::*;

pub(super) async fn remove_worktree(
    repo: &Path,
    worktree: &str,
    branch: Option<&str>,
    delete_branch: bool,
) -> Result<WorktreeRemoveResult, String> {
    // Git resolves a relative path against the repository, and the fallbacks below against
    // the process's own folder: refuse the ambiguity.
    if !Path::new(worktree).is_absolute() {
        return Err("A worktree's path must be absolute.".into());
    }
    let common_dir = {
        let repo = repo.to_path_buf();
        tokio::task::spawn_blocking(move || {
            open_repo(&repo).map(|opened| opened.commondir().to_path_buf())
        })
        .await
        .map_err(|error| error.to_string())??
    };
    let mut orphan_directory = false;
    let (out, _) = run_git(
        repo,
        &["worktree", "remove", "--force", "--", worktree],
        None,
    )
    .await?;
    if !out.success {
        // Git lost track of it (pruned by hand, moved). Remove the folder only when it was
        // surely a worktree of this repository; anything else keeps Git's refusal.
        let dir = Path::new(worktree);
        if is_orphan_worktree_dir(repo, &common_dir, dir).await {
            file_access::fs::remove_dir_all(dir)
                .map_err(|error| format!("{worktree} couldn't be removed: {error}"))?;
        } else if is_plain_dir(dir) && !file_access::fs::exists(dir.join(".git")) {
            // `--force` already dropped the registration but couldn't remove a busy folder
            // (a terminal's working folder on Windows); only an empty leftover goes now.
            file_access::fs::remove_dir(dir).map_err(|_| summarize_stderr(&out.stderr))?;
        } else {
            return Err(summarize_stderr(&out.stderr));
        }
        let _ = run_git(repo, &["worktree", "prune"], None).await;
        orphan_directory = true;
    }
    let mut branch_deleted = false;
    let mut branch_kept_reason = None;
    if delete_branch {
        if let Some(branch) = branch.filter(|b| !b.trim().is_empty() && !b.starts_with('-')) {
            // `-d` refuses an unmerged branch; the person saw the merged check and chose to
            // delete, so `-D` follows.
            let (soft, _) = run_git(repo, &["branch", "-d", "--", branch], None).await?;
            if soft.success {
                branch_deleted = true;
            } else {
                let (hard, _) = run_git(repo, &["branch", "-D", "--", branch], None).await?;
                if hard.success {
                    branch_deleted = true;
                } else {
                    branch_kept_reason = Some(if hard.stderr.contains("checked out") {
                        "checked_out_elsewhere"
                    } else {
                        "unknown"
                    });
                }
            }
        }
    }
    Ok(WorktreeRemoveResult {
        orphan_directory,
        branch_deleted,
        branch_kept_reason,
    })
}

/// The real form of a path that may not exist: the deepest existing ancestor made real, the
/// rest added back. Keeps `/var` and `/private/var` from defeating a prefix check.
pub(super) fn canonical_lossy(path: &Path) -> PathBuf {
    let mut existing = path.to_path_buf();
    let mut rest: Vec<std::ffi::OsString> = Vec::new();
    loop {
        if let Ok(real) = file_access::fs::canonicalize(&existing) {
            return rest.iter().rev().fold(real, |acc, part| acc.join(part));
        }
        match (
            existing.file_name().map(|n| n.to_os_string()),
            existing.parent(),
        ) {
            (Some(name), Some(parent)) => {
                rest.push(name);
                existing = parent.to_path_buf();
            }
            _ => return path.to_path_buf(),
        }
    }
}

/// Drops `.` and `..` by their names, so a gitdir can't climb out of the worktrees folder.
pub(super) fn normalize_lexically(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for part in path.components() {
        match part {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// The `gitdir:` a linked worktree's `.git` file points at. The main checkout has a `.git`
/// folder, which never counts.
pub(super) fn worktree_gitdir(dir: &Path) -> Option<PathBuf> {
    let dot_git = dir.join(".git");
    if !file_access::fs::symlink_metadata(&dot_git).ok()?.is_file() {
        return None;
    }
    let text = file_access::fs::read_to_string(&dot_git).ok()?;
    let target = text.lines().next()?.strip_prefix("gitdir:")?.trim();
    if target.is_empty() {
        return None;
    }
    let target = Path::new(target);
    Some(if target.is_absolute() {
        target.to_path_buf()
    } else {
        dir.join(target)
    })
}

/// A real folder, not a link to one.
pub(super) fn is_plain_dir(dir: &Path) -> bool {
    file_access::fs::symlink_metadata(dir).is_ok_and(|m| m.is_dir())
}

/// Whether `dir` may be deleted as a lost worktree: a folder Git no longer lists, not the
/// repository or a folder around it, whose `.git` file points at exactly
/// `<common>/worktrees/<name>` while that folder is gone.
pub(super) async fn is_orphan_worktree_dir(repo: &Path, common_dir: &Path, dir: &Path) -> bool {
    if !is_plain_dir(dir) {
        return false;
    }
    let dir_real = canonical_lossy(dir);
    if canonical_lossy(repo).starts_with(&dir_real)
        || canonical_lossy(common_dir).starts_with(&dir_real)
    {
        return false;
    }
    match list_worktrees_cli(repo).await {
        Ok(list)
            if list
                .iter()
                .any(|w| same_path(&w.path, &dir.to_string_lossy())) =>
        {
            return false
        }
        Ok(_) => {}
        Err(_) => return false,
    }
    let Some(gitdir) = worktree_gitdir(dir) else {
        return false;
    };
    let worktrees = canonical_lossy(&common_dir.join("worktrees"));
    let gitdir = normalize_lexically(&canonical_lossy(&gitdir));
    // Exactly one level below worktrees/: deeper is a submodule of a worktree.
    let Ok(rel) = gitdir.strip_prefix(&worktrees) else {
        return false;
    };
    let mut parts = rel.components();
    if !matches!(
        (parts.next(), parts.next()),
        (Some(std::path::Component::Normal(_)), None)
    ) {
        return false;
    }
    // A Git folder that still exists means Git tracks this tree elsewhere: not lost.
    !file_access::fs::exists(&gitdir)
}

pub(super) fn branch_merged(repo: &Path, branch: &str, base: &str) -> Result<bool, String> {
    let repo = open_repo(repo)?;
    let branch_tip = repo
        .revparse_single(&format!("refs/heads/{branch}"))
        .and_then(|o| o.peel_to_commit())
        .map_err(|e| format!("Branch {branch}: {}", e.message()))?;
    let base_tip = repo
        .revparse_single(base)
        .and_then(|o| o.peel_to_commit())
        .map_err(|e| format!("Branch {base}: {}", e.message()))?;
    // A commit isn't its own descendant to libgit2, but a fresh branch on the base is merged.
    Ok(branch_tip.id() == base_tip.id()
        || repo
            .graph_descendant_of(base_tip.id(), branch_tip.id())
            .map_err(|e| e.message().to_string())?)
}
