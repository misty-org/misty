//! Who a repository is, for a live session: the key every member's clone shares, its HEAD, the
//! remote's default branch, whether a commit is on the remote, and how far main has moved past
//! the session's base. The network (fetch) runs the person's own `git`, so their credentials
//! apply; everything else reads the repository with libgit2.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::LazyLock;
use std::time::Duration;

use serde::Serialize;

use super::{blocking, commit_id};
use crate::project::{linked_path, person_window};

pub(super) struct GitOutput {
    pub(super) stdout: String,
    pub(super) stderr: String,
    pub(super) success: bool,
}

/// Runs `git -C <folder> <args>` to the end, never stopping to ask in a terminal.
pub(super) async fn git(folder: &Path, args: &[&str], seconds: u64) -> Result<GitOutput, String> {
    let program = crate::engines::resolve::find_program("git")
        .ok_or("Git isn't installed on this computer.")?;
    let mut command = crate::engines::resolve::command_for(&program);
    command
        .arg("-C")
        .arg(folder)
        .args(args)
        .env("PATH", crate::engines::resolve::search_path())
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    crate::engines::turn::own_group(&mut command);
    let output = tokio::time::timeout(Duration::from_secs(seconds), command.output())
        .await
        .map_err(|_| "Git took too long.".to_string())?
        .map_err(|error| format!("Git could not be run: {error}"))?;
    Ok(GitOutput {
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        success: output.status.success(),
    })
}

/// Git's last words, short enough to show.
pub(super) fn git_words(stderr: &str) -> String {
    let line = stderr
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("Git couldn't do that.");
    line.trim()
        .trim_start_matches("fatal: ")
        .trim_start_matches("error: ")
        .chars()
        .take(300)
        .collect()
}

pub(super) fn open_repo(path: &Path) -> Result<git2::Repository, String> {
    git2::Repository::discover(path).map_err(|error| {
        if error.code() == git2::ErrorCode::NotFound {
            "This folder isn't a Git repository.".to_string()
        } else {
            error.message().trim().to_string()
        }
    })
}

/// The main checkout of the repository `folder` is in: a linked worktree's is the folder its
/// common Git directory belongs to.
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

/// The top of the checkout `folder` is in, where its own HEAD and index are.
pub(super) fn checkout_top(folder: &Path) -> Result<PathBuf, String> {
    let repo = open_repo(folder)?;
    let top = repo
        .workdir()
        .ok_or("This repository has no working folder.")?
        .to_path_buf();
    file_access::fs::canonicalize(&top).map_err(|error| error.to_string())
}

/// An origin URL as every clone of it reads: host and path, lowercased, with no user, port,
/// scheme or `.git`. `https://github.com/A/b.git` and `git@github.com:a/b` are the same.
pub fn normalize_origin(url: &str) -> Option<String> {
    let url = url.trim();
    let (host, path) = if let Some((_, rest)) = url.split_once("://") {
        let (authority, path) = rest.split_once('/')?;
        let host = authority.rsplit('@').next()?.split(':').next()?;
        (host, path)
    } else {
        // scp style, `[user@]host:path`; a local path has no host to share.
        let (left, path) = url.split_once(':')?;
        if left.contains('/') || left.contains('\\') || left.len() < 2 {
            return None;
        }
        (left.rsplit('@').next()?, path)
    };
    let path = path
        .trim_matches('/')
        .trim_end_matches(".git")
        .trim_end_matches('/');
    if host.is_empty() || path.is_empty() {
        return None;
    }
    Some(format!("{}/{}", host.to_lowercase(), path.to_lowercase()))
}

/// Root commits are found once per repository: walking the history is the slow part.
static ROOTS: LazyLock<parking_lot::Mutex<HashMap<PathBuf, String>>> =
    LazyLock::new(|| parking_lot::Mutex::new(HashMap::new()));

/// The repository's first commit: the earliest root, so a history that merged in another root
/// later still names the one every clone has.
async fn root_commit(top: &Path, common: &Path) -> Result<String, String> {
    if let Some(root) = ROOTS.lock().get(common) {
        return Ok(root.clone());
    }
    let out = git(
        top,
        &["log", "--max-parents=0", "--format=%ct %H", "HEAD"],
        60,
    )
    .await?;
    if !out.success {
        return Err("This repository has no commits yet.".into());
    }
    let root = out
        .stdout
        .lines()
        .filter_map(|line| {
            let (time, sha) = line.trim().split_once(' ')?;
            Some((time.parse::<i64>().ok()?, sha.to_string()))
        })
        .min()
        .map(|(_, sha)| sha)
        .ok_or("This repository has no commits yet.")?;
    ROOTS.lock().insert(common.to_path_buf(), root.clone());
    Ok(root)
}

/// The remote's default branch, from `origin/HEAD`, else `origin/main` or `origin/master`.
pub(super) fn default_branch(repo: &git2::Repository) -> Option<String> {
    if let Some(name) = repo
        .find_reference("refs/remotes/origin/HEAD")
        .ok()
        .and_then(|head| head.symbolic_target().map(str::to_string))
        .and_then(|target| {
            target
                .strip_prefix("refs/remotes/origin/")
                .map(str::to_string)
        })
    {
        return Some(name);
    }
    [
        crate::known_names::DEFAULT_BRANCH,
        crate::known_names::OLD_DEFAULT_BRANCH,
    ]
    .into_iter()
    .find(|name| {
        repo.find_reference(&format!("refs/remotes/origin/{name}"))
            .is_ok()
    })
    .map(str::to_string)
}

/// Whether a commit is on the remote, as last fetched: some branch of origin holds it.
fn on_remote(repo: &git2::Repository, commit: git2::Oid) -> bool {
    let Ok(references) = repo.references_glob("refs/remotes/origin/*") else {
        return false;
    };
    references.flatten().any(|reference| {
        reference.target().is_some_and(|tip| {
            tip == commit || repo.graph_descendant_of(tip, commit).unwrap_or(false)
        })
    })
}

/// What a live session needs to know about a repository.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveRepo {
    /// The normalized origin URL, then `:` and the root commit's sha.
    pub repo_key: String,
    /// The main checkout, which every worktree belongs to.
    pub root: String,
    /// HEAD of the folder's own checkout.
    pub head: String,
    /// The branch checked out there; none when detached.
    pub branch: Option<String>,
    /// The remote's default branch, without `origin/`.
    pub default_branch: Option<String>,
    /// Whether the base commit (HEAD when none is named) is on origin.
    pub base_on_remote: bool,
    /// Commits the remote's default branch has that the base doesn't.
    pub main_ahead: Option<usize>,
    /// Why the fetch failed, when one was asked for; the rest is then as last fetched.
    pub fetch_error: Option<String>,
    /// The person's own Git identity, which their commits are made with.
    pub git_name: Option<String>,
    pub git_email: Option<String>,
}

/// Who the repository at a linked folder is. With `fetch`, origin is fetched first, so whether
/// the base is on the remote and how far main moved are current.
#[tauri::command]
pub async fn code_live_repo(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
    base_commit: Option<String>,
    fetch: bool,
) -> Result<LiveRepo, String> {
    person_window(&webview)?;
    let folder = linked_path(&app, &account, &folder).await?;
    let base = base_commit.as_deref().map(commit_id).transpose()?;
    let (top, common, origin, root_text) = {
        let folder = folder.clone();
        blocking(move || {
            let repo = open_repo(&folder)?;
            let origin = repo
                .find_remote("origin")
                .ok()
                .and_then(|remote| remote.url().map(str::to_string))
                .ok_or("This repository has no remote named origin, so nobody else can join from their own copy.")?;
            let root = main_checkout(&folder)?.to_string_lossy().into_owned();
            Ok((checkout_top(&folder)?, repo.commondir().to_path_buf(), origin, root))
        })
        .await?
    };
    let host_path = normalize_origin(&origin)
        .ok_or("Origin isn't a hosted repository, so nobody else can join from their own copy.")?;
    let fetch_error = if fetch {
        let out = git(&top, &["fetch", "--quiet", "origin"], 120).await?;
        (!out.success).then(|| git_words(&out.stderr))
    } else {
        None
    };
    let root = root_commit(&top, &common).await?;
    blocking(move || {
        let repo = open_repo(&top)?;
        let head = repo
            .head()
            .ok()
            .and_then(|head| head.target())
            .ok_or("This repository has no commits yet.")?;
        let branch = repo
            .head()
            .ok()
            .filter(|head| head.is_branch())
            .and_then(|head| head.shorthand().map(str::to_string));
        let default = default_branch(&repo);
        let base = base.unwrap_or(head);
        let main_ahead = default.as_ref().and_then(|name| {
            let tip = repo
                .find_reference(&format!("refs/remotes/origin/{name}"))
                .ok()?
                .target()?;
            repo.graph_ahead_behind(tip, base)
                .ok()
                .map(|(ahead, _)| ahead)
        });
        let (git_name, git_email) = match repo.signature() {
            Ok(signature) => (
                signature.name().map(str::to_string),
                signature.email().map(str::to_string),
            ),
            Err(_) => (None, None),
        };
        Ok(LiveRepo {
            repo_key: format!("{host_path}:{root}"),
            root: root_text,
            head: head.to_string(),
            branch,
            default_branch: default,
            base_on_remote: on_remote(&repo, base),
            main_ahead,
            fetch_error,
            git_name,
            git_email,
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_clone_reads_the_same_origin() {
        let key = Some("github.com/misty-org/misty".to_string());
        assert_eq!(
            normalize_origin("https://github.com/misty-org/misty.git"),
            key
        );
        assert_eq!(normalize_origin("git@github.com:misty-org/misty.git"), key);
        assert_eq!(
            normalize_origin("ssh://git@github.com:22/Misty-Org/misty/"),
            key
        );
        assert_eq!(
            normalize_origin("https://token@github.com/misty-org/misty"),
            key
        );
        assert_eq!(normalize_origin("/srv/git/misty.git"), None);
        assert_eq!(normalize_origin("C:\\repos\\misty"), None);
    }
}
