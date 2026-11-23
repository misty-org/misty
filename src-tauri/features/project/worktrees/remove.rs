// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//! Removing a worktree, a lost one too, and the branch-merged check.

use super::*;

pub(super) async fn remove_worktree(
    repo: &Path,
    worktree: &str,
    branch: Option<&str>,
    delete_branch: bool,
) -> Result<WorktreeRemoveResult, String> {
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
        let dir = Path::new(worktree);
        if is_orphan_worktree_dir(repo, &common_dir, dir).await {
            file_access::fs::remove_dir_all(dir)
                .map_err(|error| format!("{worktree} couldn't be removed: {error}"))?;
        } else if is_plain_dir(dir) && !file_access::fs::exists(dir.join(".git")) {
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

pub(super) fn is_plain_dir(dir: &Path) -> bool {
    file_access::fs::symlink_metadata(dir).is_ok_and(|m| m.is_dir())
}

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
    Ok(branch_tip.id() == base_tip.id()
        || repo
            .graph_descendant_of(base_tip.id(), branch_tip.id())
            .map_err(|e| e.message().to_string())?)
}
