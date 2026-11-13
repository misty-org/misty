// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//
// Branches: listing, switching (a remote one becomes a local tracking branch), making one,
// `git init`, and the files a fast-forward would collide with.

use std::path::Path;

use git2::{Repository, StatusOptions};
use serde::Serialize;

use super::index::repo_write_gate;
use super::status::open_repo;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    /// A remote-tracking branch (`origin/<name>`). Switching to it makes the local tracking
    /// branch instead of detaching HEAD.
    pub is_remote: bool,
}

pub(crate) fn current_branch_name(repo: &Repository) -> Result<String, String> {
    repo.head()
        .ok()
        .filter(|head| head.is_branch())
        .and_then(|head| head.shorthand().map(str::to_string))
        .ok_or_else(|| "You're not on a branch (HEAD is detached).".to_string())
}

pub(crate) fn git_branches_blocking(path: &Path) -> Result<Vec<BranchInfo>, String> {
    let repo = open_repo(path)?;
    // Local branches first, then remote-tracking ones: a branch only on the remote (right after
    // a fetch) must still be listed. Which is current comes from the status, never from here,
    // so a checkout in a terminal can't leave it stale.
    let mut out = Vec::new();
    for kind in [git2::BranchType::Local, git2::BranchType::Remote] {
        let branches = repo
            .branches(Some(kind))
            .map_err(|error| error.to_string())?;
        for (branch, _) in branches.flatten() {
            // `refs/remotes/origin/HEAD` points at the remote's default branch; it isn't one.
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
    Ok(out)
}

/// The local branch Git makes for `origin/release/1.0`: the longest remote name that matches is
/// taken off (remote names may hold slashes).
fn local_name_for_remote_branch(repo: &Repository, remote_shorthand: &str) -> Option<String> {
    let remotes = repo.remotes().ok()?;
    let remote = remotes
        .iter()
        .flatten()
        .filter(|name| {
            remote_shorthand.starts_with(*name)
                && remote_shorthand.as_bytes().get(name.len()) == Some(&b'/')
        })
        .max_by_key(|name| name.len())?;
    Some(remote_shorthand[remote.len() + 1..].to_string())
}

/// `git checkout <remote>/<branch>`: switch to the local branch of the same name, making it
/// (tracking the remote) when there isn't one. An existing local branch is used as it is; it may
/// hold commits of its own, so the remote's tip is never forced onto it.
fn checkout_remote_branch(
    repo: &Repository,
    remote_shorthand: &str,
    remote: &git2::Branch<'_>,
) -> Result<(), String> {
    if remote.get().target().is_none() {
        return Err(format!("{remote_shorthand} isn't a branch."));
    }
    let target = remote
        .get()
        .peel_to_commit()
        .map_err(|error| error.to_string())?;
    let local_name = local_name_for_remote_branch(repo, remote_shorthand)
        .ok_or_else(|| format!("No remote matches {remote_shorthand}."))?;
    let (mut local, created) = match repo.find_branch(&local_name, git2::BranchType::Local) {
        Ok(existing) => (existing, false),
        Err(_) => (
            repo.branch(&local_name, &target, false)
                .map_err(|error| error.to_string())?,
            true,
        ),
    };
    // Check out the branch being switched to: an existing local branch's own tip.
    let checkout_commit = local
        .get()
        .peel_to_commit()
        .map_err(|error| error.to_string())?;
    if let Err(error) = repo.checkout_tree(checkout_commit.as_object(), None) {
        // HEAD stays where it was; don't leave the branch just made behind.
        if created {
            let _ = local.delete();
        }
        return Err(error.to_string());
    }
    if created {
        local
            .set_upstream(Some(remote_shorthand))
            .map_err(|error| error.to_string())?;
    }
    repo.set_head(&format!("refs/heads/{local_name}"))
        .map_err(|error| error.to_string())
}

pub(crate) fn git_checkout_blocking(path: &Path, branch: &str) -> Result<(), String> {
    let gate = repo_write_gate(path);
    let _queued = gate.blocking_lock();
    let repo = open_repo(path)?;
    // A remote-tracking branch never gets HEAD itself (that would detach it). A local branch
    // of the same name wins, as with `git checkout`.
    if repo.find_branch(branch, git2::BranchType::Local).is_err() {
        if let Ok(remote) = repo.find_branch(branch, git2::BranchType::Remote) {
            return checkout_remote_branch(&repo, branch, &remote);
        }
    }
    let (object, reference) = repo
        .revparse_ext(branch)
        .map_err(|error| format!("There's no branch {branch}: {error}"))?;
    repo.checkout_tree(&object, None)
        .map_err(|error| error.to_string())?;
    match reference {
        Some(reference) => repo
            .set_head(
                reference
                    .name()
                    .ok_or("That branch's name can't be read.")?,
            )
            .map_err(|error| error.to_string()),
        None => repo
            .set_head_detached(object.id())
            .map_err(|error| error.to_string()),
    }
}

pub(crate) fn git_create_branch_blocking(path: &Path, name: &str) -> Result<(), String> {
    let gate = repo_write_gate(path);
    let _queued = gate.blocking_lock();
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Name the branch.".to_string());
    }
    let repo = open_repo(path)?;
    let head = repo
        .head()
        .and_then(|head| head.peel_to_commit())
        .map_err(|error| error.to_string())?;
    let branch = repo
        .branch(trimmed, &head, false)
        .map_err(|error| error.to_string())?;
    let refname = format!(
        "refs/heads/{}",
        branch
            .name()
            .map_err(|error| error.to_string())?
            .unwrap_or(trimmed)
    );
    repo.checkout_tree(head.as_object(), None)
        .map_err(|error| error.to_string())?;
    repo.set_head(&refname).map_err(|error| error.to_string())
}

/// `git init` for a folder the panel found isn't a repository. The first branch follows the
/// person's `init.defaultBranch`, as the CLI does.
pub(crate) fn init_repository(path: &Path) -> Result<(), String> {
    if !file_access::fs::is_dir(path) {
        return Err("That folder is gone.".to_string());
    }
    match Repository::discover(path) {
        // The panel's answer may be stale (`git init` ran in a terminal meanwhile), and a
        // repository inside another would hide the outer one's changes.
        Ok(_) => return Ok(()),
        // Anything but "none found" may hide a repository above this folder.
        Err(error) if error.code() != git2::ErrorCode::NotFound => {
            return Err(error.message().to_string())
        }
        Err(_) => {}
    }
    let mut options = git2::RepositoryInitOptions::new();
    options.mkdir(false).mkpath(false).no_reinit(true);
    Repository::init_opts(path, &options)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

/// The files a fast-forward to `target` would touch that are also changed in the folder.
pub(crate) fn ff_conflicting_files(repo: &Repository, target: git2::Oid) -> Vec<String> {
    let Ok(head_tree) = repo.head().and_then(|head| head.peel_to_tree()) else {
        return Vec::new();
    };
    let Ok(target_tree) = repo.find_commit(target).and_then(|commit| commit.tree()) else {
        return Vec::new();
    };
    let Ok(touched) = repo.diff_tree_to_tree(Some(&head_tree), Some(&target_tree), None) else {
        return Vec::new();
    };
    let mut touched_paths = std::collections::HashSet::new();
    let _ = touched.foreach(
        &mut |delta, _| {
            for path in [delta.old_file().path(), delta.new_file().path()]
                .into_iter()
                .flatten()
            {
                touched_paths.insert(path.to_string_lossy().into_owned());
            }
            true
        },
        None,
        None,
        None,
    );
    let mut options = StatusOptions::new();
    options.include_untracked(true).recurse_untracked_dirs(true);
    let Ok(statuses) = repo.statuses(Some(&mut options)) else {
        return Vec::new();
    };
    statuses
        .iter()
        .filter_map(|status| status.path().map(str::to_string))
        .filter(|path| touched_paths.contains(path))
        .collect()
}
