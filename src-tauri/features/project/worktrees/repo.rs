// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//! Git for worktrees: the person's own `git`, cancellable, and libgit2 for reading.

use super::*;

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

pub(super) struct GitOutput {
    pub(super) stdout: String,
    pub(super) stderr: String,
    pub(super) success: bool,
}

/// Runs `git -C <repo> <args>` to the end, reading both pipes so a chatty fetch can't fill one
/// and stall. With `cancel`, the process and its helpers (ssh) are killed when the person
/// cancels, and the second value says so.
pub(super) async fn run_git(
    repo: &Path,
    args: &[&str],
    cancel: Option<&Arc<CreationCancel>>,
) -> Result<(GitOutput, bool), String> {
    let program = crate::engines::resolve::find_program("git")
        .ok_or("Git isn't installed on this computer.")?;
    let mut command = crate::engines::resolve::command_for(&program);
    command
        .arg("-C")
        .arg(repo)
        .args(args)
        .env("PATH", crate::engines::resolve::search_path())
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    crate::engines::turn::own_group(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("Git could not be run: {error}"))?;
    let pid = child.id();

    async fn drain(pipe: Option<impl tokio::io::AsyncRead + Unpin>) -> Vec<u8> {
        let mut buf = Vec::new();
        if let Some(mut s) = pipe {
            let _ = s.read_to_end(&mut buf).await;
        }
        buf
    }
    let out_task = tokio::spawn(drain(child.stdout.take()));
    let err_task = tokio::spawn(drain(child.stderr.take()));

    let mut cancelled = false;
    let status = if let Some(cancel) = cancel {
        tokio::select! {
            status = child.wait() => status,
            _ = cancel.notify.notified() => {
                cancelled = true;
                if let Some(pid) = pid.filter(|pid| *pid != 0) {
                    crate::engines::kill_process_group(pid);
                }
                let _ = child.start_kill();
                child.wait().await
            }
        }
    } else {
        child.wait().await
    }
    .map_err(|error| format!("Git could not be run: {error}"))?;
    let stdout = String::from_utf8_lossy(&out_task.await.map_err(|e| e.to_string())?).into_owned();
    let stderr = String::from_utf8_lossy(&err_task.await.map_err(|e| e.to_string())?).into_owned();
    Ok((
        GitOutput {
            stdout,
            stderr,
            success: status.success(),
        },
        cancelled,
    ))
}

pub(super) async fn list_worktrees_cli(repo: &Path) -> Result<Vec<WorktreeInfo>, String> {
    let (out, _) = run_git(repo, &["worktree", "list", "--porcelain"], None).await?;
    if !out.success {
        return Err(summarize_stderr(&out.stderr));
    }
    Ok(parse_worktree_porcelain(&out.stdout))
}

pub(super) const NOT_A_REPO: &str = "This folder isn't a Git repository.";

pub(super) fn open_repo(path: &Path) -> Result<git2::Repository, String> {
    git2::Repository::discover(path).map_err(|error| {
        if error.code() == git2::ErrorCode::NotFound {
            NOT_A_REPO.to_string()
        } else {
            error.message().trim().to_string()
        }
    })
}

/// The main checkout of the repository `folder` is in. A linked worktree's main checkout is the
/// folder its common Git directory belongs to.
pub(super) fn main_checkout(folder: &Path) -> Result<PathBuf, String> {
    let repo = open_repo(folder)?;
    let common = repo.commondir().to_path_buf();
    let main = if common.file_name().is_some_and(|name| name == ".git") {
        common.parent().map(Path::to_path_buf)
    } else {
        repo.workdir().map(Path::to_path_buf)
    }
    .ok_or("This repository has no working folder.")?;
    file_access::fs::canonicalize(&main).map_err(|error| error.to_string())
}

/// Locals first, then remote-tracking branches; `origin/HEAD` is an alias, not a branch.
pub(super) fn list_branches(repo: &git2::Repository) -> Vec<BranchInfo> {
    let mut out = Vec::new();
    for kind in [git2::BranchType::Local, git2::BranchType::Remote] {
        let Ok(branches) = repo.branches(Some(kind)) else {
            continue;
        };
        for (branch, _) in branches.flatten() {
            if branch.get().target().is_none() {
                continue;
            }
            if let Ok(Some(name)) = branch.name() {
                out.push(BranchInfo {
                    name: name.to_string(),
                    is_remote: kind == git2::BranchType::Remote,
                });
            }
        }
    }
    out
}

pub(super) fn current_branch(repo: &git2::Repository) -> Option<String> {
    if let Some(name) = repo
        .head()
        .ok()
        .and_then(|head| head.shorthand().map(str::to_string))
    {
        return Some(name);
    }
    repo.find_reference("HEAD").ok().and_then(|head| {
        head.symbolic_target()
            .and_then(|target| target.strip_prefix("refs/heads/"))
            .map(str::to_string)
    })
}

/// A worktree's uncommitted files (the first two named) and unpushed commits.
pub(super) fn worktree_changes(path: &Path) -> (Option<usize>, Vec<String>, Option<usize>) {
    let Ok(repo) = git2::Repository::open(path) else {
        return (None, Vec::new(), None);
    };
    let mut options = git2::StatusOptions::new();
    options.include_untracked(true).recurse_untracked_dirs(true);
    let (changed, samples) = match repo.statuses(Some(&mut options)) {
        Ok(statuses) => {
            let paths: Vec<String> = statuses
                .iter()
                .filter_map(|entry| entry.path().map(str::to_string))
                .collect();
            (Some(paths.len()), paths.into_iter().take(2).collect())
        }
        Err(_) => (None, Vec::new()),
    };
    let ahead = (|| {
        let head = repo.head().ok()?;
        let local = head.target()?;
        let upstream = repo.branch_upstream_name(head.name()?).ok()?;
        let upstream = repo.find_reference(upstream.as_str()?).ok()?.target()?;
        repo.graph_ahead_behind(local, upstream)
            .ok()
            .map(|(ahead, _)| ahead)
    })();
    (changed, samples, ahead)
}

/// The remote part of a ref like "origin/main", when "origin" is a real remote.
pub(super) fn split_remote<'a>(
    repo: &git2::Repository,
    base: &'a str,
) -> Option<(&'a str, &'a str)> {
    let remotes = repo.remotes().ok()?;
    for name in remotes.iter().flatten() {
        if let Some(rest) = base.strip_prefix(name).and_then(|r| r.strip_prefix('/')) {
            if !rest.is_empty() {
                return Some((&base[..name.len()], rest));
            }
        }
    }
    None
}

/// Tidies up after a failed or cancelled `worktree add`: the half-made checkout and its
/// registration go; branch refs stay, since they are harmless and may be wanted.
pub(super) async fn cleanup_partial_add(repo: &Path, target: &Path) {
    if file_access::fs::exists(target) {
        let target = target.to_string_lossy().into_owned();
        let _ = run_git(repo, &["worktree", "remove", "--force", &target], None).await;
    }
    let _ = run_git(repo, &["worktree", "prune"], None).await;
}

/// A new branch is made with `--no-track`, so its first push would need `-u`. Set the
/// repository's default once, only where the person configured nothing at any level.
pub(super) async fn ensure_push_auto_setup(repo: &Path) {
    let unset = match run_git(repo, &["config", "--get", "push.autoSetupRemote"], None).await {
        Ok((out, _)) => !out.success || out.stdout.trim().is_empty(),
        Err(_) => true,
    };
    if unset {
        let _ = run_git(repo, &["config", "push.autoSetupRemote", "true"], None).await;
    }
}

/// libgit2's `GIT_INDEX_ENTRY_SKIP_WORKTREE`: tracked, but left out of the working folder.
pub(super) const INDEX_ENTRY_SKIP_WORKTREE: u16 = 1 << 14;

/// Every indexed path is skip-worktree: sparse-checkout rules left the new worktree empty.
pub(super) fn worktree_is_empty_checkout(path: &Path) -> bool {
    let Ok(repo) = git2::Repository::open(path) else {
        return false;
    };
    let Ok(index) = repo.index() else {
        return false;
    };
    !index.is_empty()
        && index
            .iter()
            .all(|entry| entry.flags_extended & INDEX_ENTRY_SKIP_WORKTREE != 0)
}
