// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//! The worktree commands' pure parts: pull request input, remote URLs, Git's worktree list,
//! and where a worktree goes.

use super::*;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/// Accepts "1842", "#1842", or a GitHub pull request link (anything after the number).
pub fn parse_pr_input(input: &str) -> Option<u64> {
    let t = input.trim();
    let bare = t.strip_prefix('#').unwrap_or(t);
    if let Ok(n) = bare.parse::<u64>() {
        return (n > 0).then_some(n);
    }
    let marker = "/pull/";
    let idx = t.find(marker)?;
    let digits: String = t[idx + marker.len()..]
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    digits.parse::<u64>().ok().filter(|n| *n > 0)
}

/// "owner/repo" from a GitHub remote URL (https, ssh:// or scp style).
pub fn github_owner_repo(url: &str) -> Option<String> {
    let path = if let Some(rest) = url.strip_prefix("git@github.com:") {
        rest
    } else {
        url.strip_prefix("https://github.com/")
            .or_else(|| url.strip_prefix("http://github.com/"))
            .or_else(|| url.strip_prefix("ssh://git@github.com/"))?
    };
    let path = path.trim_end_matches('/').trim_end_matches(".git");
    let mut parts = path.split('/');
    let owner = parts.next().filter(|s| !s.is_empty())?;
    let repo = parts.next().filter(|s| !s.is_empty())?;
    if parts.next().is_some() {
        return None;
    }
    Some(format!("{owner}/{repo}"))
}

/// Reads `git worktree list --porcelain`. The first block is the main checkout; `locked
/// [reason]` and `prunable` lines follow the block they belong to.
pub fn parse_worktree_porcelain(text: &str) -> Vec<WorktreeInfo> {
    let mut out: Vec<WorktreeInfo> = Vec::new();
    let mut cur: Option<WorktreeInfo> = None;
    for line in text.lines() {
        if let Some(path) = line.strip_prefix("worktree ") {
            if let Some(done) = cur.take() {
                out.push(done);
            }
            cur = Some(WorktreeInfo {
                path: path.to_string(),
                branch: None,
                head: String::new(),
                is_main: out.is_empty(),
                locked: false,
                lock_reason: None,
                prunable: false,
                changed: None,
                samples: Vec::new(),
                ahead: None,
            });
            continue;
        }
        let Some(w) = cur.as_mut() else { continue };
        if let Some(head) = line.strip_prefix("HEAD ") {
            w.head = head.to_string();
        } else if let Some(reference) = line.strip_prefix("branch ") {
            w.branch = Some(
                reference
                    .strip_prefix("refs/heads/")
                    .unwrap_or(reference)
                    .to_string(),
            );
        } else if line == "detached" {
            w.branch = None;
        } else if line == "locked" {
            w.locked = true;
        } else if let Some(reason) = line.strip_prefix("locked ") {
            w.locked = true;
            w.lock_reason = Some(reason.to_string());
        } else if line == "prunable" || line.starts_with("prunable ") {
            w.prunable = true;
        }
    }
    if let Some(done) = cur.take() {
        out.push(done);
    }
    out
}

/// A branch name made safe as one folder name: `feature/x` becomes `feature-x`.
pub fn sanitize_dir_name(name: &str) -> String {
    let mut flat = String::new();
    let mut last_dash = false;
    for c in name.chars() {
        if c == '/' || c == '\\' {
            if !last_dash {
                flat.push('-');
            }
            last_dash = true;
        } else {
            flat.push(c);
            last_dash = false;
        }
    }
    flat.trim_start_matches('.').trim().to_string()
}

/// Where a repository's worktree for `branch` goes: `<parent>/<repo>-worktrees/<branch>`.
pub fn worktree_path(repo: &Path, branch: &str) -> Result<PathBuf, String> {
    let name = sanitize_dir_name(branch);
    if name.is_empty() || name == "." || name == ".." || name.contains('\0') {
        return Err("That branch name can't be a folder name.".into());
    }
    Ok(worktrees_root(repo)?.join(name))
}

/// The folder that holds a repository's worktrees, beside it.
pub(super) fn worktrees_root(repo: &Path) -> Result<PathBuf, String> {
    let parent = repo
        .parent()
        .ok_or("This folder has no folder around it for worktrees.")?;
    let name = repo
        .file_name()
        .ok_or("This folder has no name.")?
        .to_string_lossy();
    Ok(parent.join(format!("{name}-worktrees")))
}

pub(super) fn same_path(a: &str, b: &str) -> bool {
    match (
        file_access::fs::canonicalize(a),
        file_access::fs::canonicalize(b),
    ) {
        (Ok(x), Ok(y)) => x == y,
        _ => a.trim_end_matches(['/', '\\']) == b.trim_end_matches(['/', '\\']),
    }
}

pub(super) fn summarize_stderr(stderr: &str) -> String {
    let text = stderr.trim();
    const CAP: usize = 300;
    if text.len() > CAP {
        let mut end = CAP;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}…", &text[..end])
    } else {
        text.to_string()
    }
}

/// The same rule as the Space folder commands: a Space key, or the personal one when empty.
pub(super) fn space_key(space: &str) -> Result<String, String> {
    let key = space.trim();
    if key.len() > 200 || key.chars().any(char::is_control) {
        return Err("That Space can't have folders.".into());
    }
    Ok(if key.is_empty() {
        "personal".into()
    } else {
        key.to_string()
    })
}
