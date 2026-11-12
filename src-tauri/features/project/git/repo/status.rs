// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//
// A folder's Git status through libgit2: staged, unstaged and untracked files with their line
// counts, ahead and behind its upstream, and why a repository couldn't be opened.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use git2::{Repository, StatusOptions};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileEntry {
    pub path: String,
    /// `modified`, `added`, `deleted`, `renamed` or `typechange`.
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub additions: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deletions: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub branch: String,
    pub staged: Vec<GitFileEntry>,
    pub unstaged: Vec<GitFileEntry>,
    pub untracked: Vec<GitFileEntry>,
    /// Commits the branch is ahead of and behind its upstream; absent when it has none (or HEAD
    /// is detached or unborn).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ahead: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub behind: Option<usize>,
}

pub(crate) fn open_repo(path: &Path) -> Result<Repository, String> {
    Repository::discover(path).map_err(map_open_repo_error)
}

/// Why a repository couldn't be opened. Only "there is none" is `NOT_A_REPO` (the panel offers
/// to initialize one); an untrusted owner, a damaged repository or a missing permission keep
/// their own message, so a person isn't told a repository isn't there when it is.
pub(crate) fn map_open_repo_error(error: git2::Error) -> String {
    if error.code() == git2::ErrorCode::NotFound {
        return "NOT_A_REPO".to_string();
    }
    let message = error.message().trim().to_string();
    // libgit2's ownership check fails with GIT_EOWNER; the wording is only a fallback.
    if error.code() == git2::ErrorCode::Owner
        || message.to_lowercase().contains("not owned by current user")
    {
        return format!("GIT_UNSAFE_REPO:{message}");
    }
    format!("GIT_OPEN_FAILED:{message}")
}

/// The folder Git works in for the repository that holds `path`.
pub(crate) fn work_folder(path: &Path) -> Result<PathBuf, String> {
    let repo = open_repo(path)?;
    repo.workdir()
        .map(Path::to_path_buf)
        .ok_or_else(|| "This is a bare repository, with no files to change.".to_string())
}

fn status_label(status: git2::Status) -> &'static str {
    if status.contains(git2::Status::WT_DELETED) || status.contains(git2::Status::INDEX_DELETED) {
        "deleted"
    } else if status.contains(git2::Status::WT_RENAMED)
        || status.contains(git2::Status::INDEX_RENAMED)
    {
        "renamed"
    } else if status.contains(git2::Status::WT_NEW) || status.contains(git2::Status::INDEX_NEW) {
        "added"
    } else if status.contains(git2::Status::WT_TYPECHANGE)
        || status.contains(git2::Status::INDEX_TYPECHANGE)
    {
        "typechange"
    } else {
        "modified"
    }
}

/// Each file's added and removed lines in one diff. A binary file has no lines, so it stays at
/// the (0, 0) its delta starts it at.
fn diff_line_counts(diff: &mut git2::Diff) -> HashMap<String, (usize, usize)> {
    use std::cell::RefCell;
    let counts = RefCell::new(HashMap::<String, (usize, usize)>::new());
    let file = RefCell::new(String::new());
    let _ = diff.foreach(
        &mut |delta, _| {
            let path = delta
                .new_file()
                .path()
                .map(|path| path.to_string_lossy().into_owned())
                .unwrap_or_default();
            counts.borrow_mut().entry(path.clone()).or_insert((0, 0));
            *file.borrow_mut() = path;
            true
        },
        None,
        None,
        Some(&mut |_, _, line| {
            let mut counts = counts.borrow_mut();
            let Some(entry) = counts.get_mut(file.borrow().as_str()) else {
                return true;
            };
            match line.origin() {
                '+' => entry.0 += 1,
                '-' => entry.1 += 1,
                _ => {}
            }
            true
        }),
    );
    counts.into_inner()
}

const MAX_UNTRACKED_BYTES: usize = 1024 * 1024;
const MAX_UNTRACKED_LINES: usize = 100_000;

/// The exact line count of an untracked regular text file of at most 1 MiB and 100,000 lines.
/// Anything else leaves the count unknown rather than guessed.
pub(crate) fn count_untracked_lines(repo: &Repository, file: &str) -> Option<(usize, usize)> {
    let full = repo.workdir()?.join(file);
    let metadata = file_access::fs::symlink_metadata(&full).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_UNTRACKED_BYTES as u64 {
        return None;
    }
    let mut options = file_access::fs::OpenOptions::new();
    options.read(true);
    // A FIFO must never block the read, and a link swapped in meanwhile isn't followed.
    #[cfg(unix)]
    options.custom_flags(libc::O_NONBLOCK | libc::O_NOFOLLOW);
    let reader = options.open(full).ok()?;
    let metadata = reader.metadata().ok()?;
    if !metadata.is_file() || metadata.len() > MAX_UNTRACKED_BYTES as u64 {
        return None;
    }
    count_untracked_reader(reader)
}

pub(crate) fn count_untracked_reader(mut reader: impl std::io::Read) -> Option<(usize, usize)> {
    let mut bytes_read = 0usize;
    let mut lines = 0usize;
    let mut last_byte: Option<u8> = None;
    let mut chunk = [0u8; 16 * 1024];
    loop {
        let read_limit = chunk.len().min(MAX_UNTRACKED_BYTES + 1 - bytes_read);
        match reader.read(&mut chunk[..read_limit]) {
            Ok(0) => break,
            Ok(count) => {
                bytes_read += count;
                if bytes_read > MAX_UNTRACKED_BYTES || chunk[..count].contains(&0) {
                    return None;
                }
                lines += chunk[..count].iter().filter(|byte| **byte == b'\n').count();
                last_byte = Some(chunk[count - 1]);
                if lines > MAX_UNTRACKED_LINES {
                    return None;
                }
            }
            Err(_) => return None,
        }
    }
    if last_byte.is_some_and(|byte| byte != b'\n') {
        lines += 1;
    }
    (lines <= MAX_UNTRACKED_LINES).then_some((lines, 0))
}

/// libgit2's `GIT_INDEX_ENTRY_SKIP_WORKTREE`: tracked but deliberately absent from the folder
/// (a sparse checkout). The bindings don't name it.
pub(crate) const INDEX_ENTRY_SKIP_WORKTREE: u16 = 1 << 14;

pub(crate) fn is_skip_worktree(index: Option<&git2::Index>, path: &str) -> bool {
    index
        .and_then(|index| index.get_path(Path::new(path), 0))
        .is_some_and(|entry| entry.flags_extended & INDEX_ENTRY_SKIP_WORKTREE != 0)
}

type Buckets = (Vec<GitFileEntry>, Vec<GitFileEntry>, Vec<GitFileEntry>);

/// Sorts status entries into staged, unstaged and untracked files.
fn collect_status_entries(index: &git2::Index, statuses: &git2::Statuses) -> Buckets {
    let worktree_side = git2::Status::WT_MODIFIED
        | git2::Status::WT_DELETED
        | git2::Status::WT_TYPECHANGE
        | git2::Status::WT_RENAMED;
    let index_side = git2::Status::INDEX_NEW
        | git2::Status::INDEX_MODIFIED
        | git2::Status::INDEX_DELETED
        | git2::Status::INDEX_RENAMED
        | git2::Status::INDEX_TYPECHANGE;
    let entry = |path: String, status: &str| GitFileEntry {
        path,
        status: status.to_string(),
        additions: None,
        deletions: None,
    };
    let (mut staged, mut unstaged, mut untracked) = (Vec::new(), Vec::new(), Vec::new());
    for item in statuses.iter() {
        let path = item.path().unwrap_or("").to_string();
        if path.is_empty() {
            continue;
        }
        let status = item.status();
        // libgit2 reports a sparse checkout's absent paths as deleted from the folder; they
        // aren't the person's edits, so the folder-side lists leave them out.
        let skip_worktree =
            status.intersects(worktree_side) && is_skip_worktree(Some(index), &path);
        if status.contains(git2::Status::WT_NEW) && !status.intersects(git2::Status::INDEX_NEW) {
            untracked.push(entry(path, "added"));
            continue;
        }
        if status.intersects(index_side) {
            staged.push(entry(path.clone(), status_label(status)));
        }
        if !skip_worktree && status.intersects(worktree_side) {
            unstaged.push(entry(path, status_label(status)));
        }
    }
    (staged, unstaged, untracked)
}

/// Fills in each file's added and removed lines from one staged and one unstaged diff, and
/// counts untracked files' lines straight from the folder.
fn fill_line_stats(
    repo: &Repository,
    staged: &mut [GitFileEntry],
    unstaged: &mut [GitFileEntry],
    untracked: &mut [GitFileEntry],
) {
    let head_tree = repo.head().and_then(|head| head.peel_to_tree()).ok();
    let staged_counts = repo
        .diff_tree_to_index(head_tree.as_ref(), None, None)
        .map(|mut diff| diff_line_counts(&mut diff))
        .unwrap_or_default();
    let unstaged_counts = repo
        .diff_index_to_workdir(None, None)
        .map(|mut diff| diff_line_counts(&mut diff))
        .unwrap_or_default();
    for (entries, counts) in [(staged, &staged_counts), (unstaged, &unstaged_counts)] {
        for entry in entries.iter_mut() {
            if let Some(&(added, removed)) = counts.get(&entry.path) {
                entry.additions = Some(added);
                entry.deletions = Some(removed);
            }
        }
    }
    for entry in untracked.iter_mut() {
        if let Some((added, removed)) = count_untracked_lines(repo, &entry.path) {
            entry.additions = Some(added);
            entry.deletions = Some(removed);
        }
    }
}

/// How far the branch is ahead of and behind its upstream, or nothing without one, so the panel
/// hides the count rather than showing a misleading 0 and 0.
fn ahead_behind(repo: &Repository) -> Option<(usize, usize)> {
    let head = repo.head().ok()?;
    let local = head.target()?;
    let upstream_name = repo.branch_upstream_name(head.name()?).ok()?;
    let upstream = repo
        .find_reference(upstream_name.as_str()?)
        .ok()?
        .target()?;
    repo.graph_ahead_behind(local, upstream).ok()
}

/// The branch name for the header. A fresh repository with no commit has no HEAD commit yet but
/// still names its branch, which reads better than a bare "HEAD".
pub(crate) fn head_branch_label(repo: &Repository) -> String {
    if let Some(name) = repo
        .head()
        .ok()
        .and_then(|head| head.shorthand().map(str::to_string))
    {
        return name;
    }
    repo.find_reference("HEAD")
        .ok()
        .and_then(|head| {
            head.symbolic_target()
                .and_then(|target| target.strip_prefix("refs/heads/"))
                .map(str::to_string)
        })
        .unwrap_or_else(|| "HEAD".to_string())
}

pub(crate) fn git_status_blocking(path: &Path) -> Result<GitStatus, String> {
    let repo = open_repo(path)?;
    let branch = head_branch_label(&repo);
    let mut options = StatusOptions::new();
    options.include_untracked(true).recurse_untracked_dirs(true);
    let index = repo.index().map_err(|error| error.to_string())?;
    let statuses = repo
        .statuses(Some(&mut options))
        .map_err(|error| error.to_string())?;
    let (mut staged, mut unstaged, mut untracked) = collect_status_entries(&index, &statuses);
    fill_line_stats(&repo, &mut staged, &mut unstaged, &mut untracked);
    let (ahead, behind) = ahead_behind(&repo).unzip();
    Ok(GitStatus {
        branch,
        staged,
        unstaged,
        untracked,
        ahead,
        behind,
    })
}
