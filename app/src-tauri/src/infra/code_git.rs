use std::{
    path::{Path, PathBuf},
    process::Command,
};

use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum GitFileStatus {
    Modified,
    Added,
    Deleted,
    Renamed,
    Untracked,
    Ignored,
    Conflicted,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileEntry {
    pub path: String,
    pub absolute_path: String,
    pub status: GitFileStatus,
    pub staged: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusSnapshot {
    pub is_repo: bool,
    pub branch: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub files: Vec<GitFileEntry>,
}

#[tauri::command]
pub async fn code_git_status(root: String) -> Result<GitStatusSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || git_status_blocking(root))
        .await
        .map_err(|error| error.to_string())?
}

fn git_status_blocking(root: String) -> Result<GitStatusSnapshot, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err("Root is not a folder.".to_owned());
    }
    if !is_git_repo(&root_path) {
        return Ok(GitStatusSnapshot {
            is_repo: false,
            branch: None,
            ahead: 0,
            behind: 0,
            files: Vec::new(),
        });
    }

    let branch = run_git(&root_path, &["rev-parse", "--abbrev-ref", "HEAD"])
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty() && value != "HEAD");

    let (ahead, behind) = ahead_behind(&root_path);

    let output = run_git(
        &root_path,
        &["status", "--porcelain=v1", "--untracked-files=normal"],
    )
    .unwrap_or_default();
    let files = parse_status_output(&output, &root_path);

    Ok(GitStatusSnapshot {
        is_repo: true,
        branch,
        ahead,
        behind,
        files,
    })
}

#[tauri::command]
pub async fn code_git_diff(root: String, path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || git_diff_blocking(root, path))
        .await
        .map_err(|error| error.to_string())?
}

fn git_diff_blocking(root: String, path: String) -> Result<String, String> {
    let root_path = PathBuf::from(&root);
    if !is_git_repo(&root_path) {
        return Err("Not a git repository.".to_owned());
    }
    let diff = run_git(
        &root_path,
        &["diff", "--no-color", "--unified=0", "--", &path],
    )
    .unwrap_or_default();
    if !diff.is_empty() {
        return Ok(diff);
    }
    // File may be new / untracked — diff against /dev/null
    run_git(
        &root_path,
        &[
            "diff",
            "--no-index",
            "--no-color",
            "--unified=0",
            "/dev/null",
            &path,
        ],
    )
    .or_else(|_| Ok(String::new()))
}

fn is_git_repo(root: &Path) -> bool {
    run_git(root, &["rev-parse", "--is-inside-work-tree"]).is_ok()
}

fn ahead_behind(root: &Path) -> (u32, u32) {
    let Ok(text) = run_git(
        root,
        &["rev-list", "--left-right", "--count", "HEAD...@{u}"],
    ) else {
        return (0, 0);
    };
    let mut parts = text.split_whitespace();
    let ahead = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    let behind = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    (ahead, behind)
}

fn parse_status_output(output: &str, root: &Path) -> Vec<GitFileEntry> {
    let mut files = Vec::new();
    for line in output.lines() {
        if line.len() < 3 {
            continue;
        }
        let index_flag = line.as_bytes()[0] as char;
        let worktree_flag = line.as_bytes()[1] as char;
        let path_segment = line[3..].to_owned();
        let (relative, _rename_source) = if let Some(idx) = path_segment.find(" -> ") {
            let (from, to) = path_segment.split_at(idx);
            (to[4..].to_owned(), Some(from.to_owned()))
        } else {
            (path_segment, None)
        };
        let absolute_path = root.join(&relative).to_string_lossy().into_owned();
        let (status, staged) = match (index_flag, worktree_flag) {
            ('?', '?') => (GitFileStatus::Untracked, false),
            ('!', '!') => (GitFileStatus::Ignored, false),
            ('U', _) | (_, 'U') | ('D', 'D') | ('A', 'A') => (GitFileStatus::Conflicted, false),
            (_, 'M') => (GitFileStatus::Modified, false),
            (_, 'D') => (GitFileStatus::Deleted, false),
            ('M', ' ') => (GitFileStatus::Modified, true),
            ('A', ' ') => (GitFileStatus::Added, true),
            ('D', ' ') => (GitFileStatus::Deleted, true),
            ('R', _) => (GitFileStatus::Renamed, true),
            (_, ' ') => (GitFileStatus::Modified, true),
            _ => (GitFileStatus::Modified, false),
        };
        files.push(GitFileEntry {
            path: relative,
            absolute_path,
            status,
            staged,
        });
    }
    files
}

fn run_git(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}
