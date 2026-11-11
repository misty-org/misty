// The changes panel: what Git says changed in a linked folder, one file's diff, and staging and
// committing. It runs the person's own `git`, so their config, hooks and signing all apply.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;

use super::{linked_path, person_window};

const DIFF_LIMIT: usize = 400_000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    path: String,
    /// `modified`, `added`, `deleted`, `renamed` or `untracked`.
    status: &'static str,
    staged: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// False for a folder that isn't a Git repository.
    repository: bool,
    branch: String,
    changes: Vec<Change>,
}

async fn git(folder: &Path, arguments: &[&str]) -> Result<String, String> {
    let program = crate::engines::resolve::find_program("git")
        .ok_or("Git isn't installed on this computer.")?;
    let mut command = crate::engines::resolve::command_for(&program);
    command
        .args(arguments)
        .current_dir(folder)
        .env("PATH", crate::engines::resolve::search_path())
        // Git must never stop to ask for something in a terminal that isn't there.
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    crate::engines::turn::own_group(&mut command);
    let output = tokio::time::timeout(Duration::from_secs(60), command.output())
        .await
        .map_err(|_| "Git took too long.".to_string())?
        .map_err(|error| format!("Git could not be run: {error}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

fn status_word(code: char) -> &'static str {
    match code {
        'A' => "added",
        'D' => "deleted",
        'R' | 'C' => "renamed",
        '?' => "untracked",
        _ => "modified",
    }
}

/// Reads `git status --porcelain=v1 -z`: each entry is `XY path`, and a rename is followed by
/// the path it came from.
fn read_status(text: &str) -> Vec<Change> {
    let mut changes = Vec::new();
    let mut parts = text.split('\0');
    while let Some(entry) = parts.next() {
        if entry.len() < 4 {
            continue;
        }
        let mut codes = entry.chars();
        let (index, tree) = (codes.next().unwrap_or(' '), codes.next().unwrap_or(' '));
        let path = entry[3..].to_string();
        if index == 'R' || index == 'C' {
            parts.next();
        }
        if index == '?' {
            changes.push(Change {
                path,
                status: "untracked",
                staged: false,
            });
            continue;
        }
        if index != ' ' {
            changes.push(Change {
                path: path.clone(),
                status: status_word(index),
                staged: true,
            });
        }
        if tree != ' ' {
            changes.push(Change {
                path,
                status: status_word(tree),
                staged: false,
            });
        }
    }
    changes
}

async fn folder_of(
    app: &tauri::AppHandle,
    webview: &tauri::Webview,
    account: &str,
    folder: &str,
) -> Result<PathBuf, String> {
    person_window(webview)?;
    linked_path(app, account, folder).await
}

/// A file named by the panel, which must stay inside the folder.
fn inside(file: &str) -> Result<&str, String> {
    let path = Path::new(file);
    let escapes = path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir));
    if escapes || file.starts_with('-') {
        return Err("That file isn't in this folder.".into());
    }
    Ok(file)
}

#[tauri::command]
pub async fn project_git_status(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
) -> Result<Status, String> {
    let folder = folder_of(&app, &webview, &account, &folder).await?;
    if git(&folder, &["rev-parse", "--is-inside-work-tree"])
        .await
        .is_err()
    {
        return Ok(Status {
            repository: false,
            branch: String::new(),
            changes: Vec::new(),
        });
    }
    let branch = git(&folder, &["branch", "--show-current"])
        .await
        .unwrap_or_default()
        .trim()
        .to_string();
    let listed = git(
        &folder,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )
    .await?;
    Ok(Status {
        repository: true,
        branch,
        changes: read_status(&listed),
    })
}

/// One file's changes as a unified diff. An untracked file is shown as all added.
#[tauri::command]
pub async fn project_git_diff(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
    file: String,
    staged: bool,
    untracked: bool,
) -> Result<String, String> {
    let folder = folder_of(&app, &webview, &account, &folder).await?;
    let file = inside(&file)?;
    let mut text = if untracked {
        // `--no-index` reports a difference by failing, so its output is taken either way.
        let program = crate::engines::resolve::find_program("git")
            .ok_or("Git isn't installed on this computer.")?;
        let empty = if cfg!(windows) { "NUL" } else { "/dev/null" };
        let mut command = crate::engines::resolve::command_for(&program);
        command
            .args(["diff", "--no-index", "--no-color", "--", empty, file])
            .current_dir(&folder)
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        let output = command.output().await.map_err(|error| error.to_string())?;
        String::from_utf8_lossy(&output.stdout).to_string()
    } else if staged {
        git(&folder, &["diff", "--no-color", "--cached", "--", file]).await?
    } else {
        git(&folder, &["diff", "--no-color", "--", file]).await?
    };
    if text.len() > DIFF_LIMIT {
        let mut end = DIFF_LIMIT;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        text.truncate(end);
        text.push_str("\n… the rest of this diff is too long to show\n");
    }
    Ok(text)
}

/// Stages files, or takes them back out of the next commit.
#[tauri::command]
pub async fn project_git_stage(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
    files: Vec<String>,
    stage: bool,
) -> Result<(), String> {
    let folder = folder_of(&app, &webview, &account, &folder).await?;
    let mut arguments: Vec<&str> = if stage {
        vec!["add", "--"]
    } else {
        vec!["restore", "--staged", "--"]
    };
    for file in &files {
        arguments.push(inside(file)?);
    }
    if files.is_empty() {
        return Ok(());
    }
    git(&folder, &arguments).await.map(|_| ())
}

/// Commits what is staged, as the person, with their own Git identity.
#[tauri::command]
pub async fn project_git_commit(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
    message: String,
) -> Result<(), String> {
    let folder = folder_of(&app, &webview, &account, &folder).await?;
    let message = message.trim();
    if message.is_empty() {
        return Err("Write a message for the commit.".into());
    }
    git(&folder, &["commit", "-m", message]).await.map(|_| ())
}

// ---- Multi-run (engines/multirun.rs): Git with an index of its own, and a worktree's changes ----

const FILE_PATCH_LIMIT: usize = 120_000;

/// Runs Git in `folder` the way `git` above does. With `index`, Git keeps its index in that file
/// and leaves the folder's own alone, so a worktree an agent is still working in can be read.
pub(crate) async fn run(
    folder: &Path,
    index: Option<&Path>,
    arguments: &[&str],
) -> Result<String, String> {
    let program = crate::engines::resolve::find_program("git")
        .ok_or("Git isn't installed on this computer.")?;
    let mut command = crate::engines::resolve::command_for(&program);
    command
        .args(arguments)
        .current_dir(folder)
        .env("PATH", crate::engines::resolve::search_path())
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(index) = index {
        command.env("GIT_INDEX_FILE", index);
    }
    crate::engines::turn::own_group(&mut command);
    let output = tokio::time::timeout(Duration::from_secs(120), command.output())
        .await
        .map_err(|_| "Git took too long.".to_string())?
        .map_err(|error| format!("Git could not be run: {error}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

/// One file a worktree changed since the commit it started from, with its diff.
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    /// `modified`, `added` or `deleted`.
    pub status: &'static str,
    pub insertions: u32,
    pub deletions: u32,
    pub patch: String,
}

/// Reads `git diff --name-status -z --no-renames`: a status letter, then the path.
fn read_name_status(text: &str) -> Vec<(String, &'static str)> {
    let mut parts = text.split('\0');
    let mut files = Vec::new();
    while let (Some(code), Some(path)) = (parts.next(), parts.next()) {
        if let Some(letter) = code.chars().next() {
            files.push((path.to_string(), status_word(letter)));
        }
    }
    files
}

/// Reads `git diff --numstat -z --no-renames`: `added<TAB>removed<TAB>path`, with `-` for both
/// counts of a binary file.
fn read_numstat(text: &str) -> std::collections::HashMap<String, (u32, u32)> {
    text.split('\0')
        .filter_map(|entry| {
            let mut fields = entry.splitn(3, '\t');
            let (added, removed, path) = (fields.next()?, fields.next()?, fields.next()?);
            Some((
                path.to_string(),
                (added.parse().unwrap_or(0), removed.parse().unwrap_or(0)),
            ))
        })
        .collect()
}

/// Splits a diff of several files into one diff per file, in the order Git wrote them.
fn split_patch(patch: &str) -> Vec<String> {
    let mut files: Vec<String> = Vec::new();
    for line in patch.split_inclusive('\n') {
        if line.starts_with("diff --git ") || files.is_empty() {
            files.push(String::new());
        }
        if let Some(file) = files.last_mut() {
            file.push_str(line);
        }
    }
    files
}

fn clip_patch(mut text: String, limit: usize) -> String {
    if text.len() > limit {
        let mut end = limit;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        text.truncate(end);
        text.push_str("\n… the rest of this diff is too long to show\n");
    }
    text
}

fn changes_from(names: &str, counts: &str, patch: &str) -> Vec<FileChange> {
    let listed = read_name_status(names);
    let counts = read_numstat(counts);
    let mut patches = split_patch(patch);
    // Both lists come from the same comparison in the same order; if they ever disagree, the
    // files are still listed, without a diff that might belong to another file.
    if patches.len() != listed.len() {
        patches = vec![String::new(); listed.len()];
    }
    let mut room = DIFF_LIMIT;
    listed
        .into_iter()
        .zip(patches)
        .map(|((path, status), patch)| {
            let patch = clip_patch(patch, FILE_PATCH_LIMIT.min(room));
            room = room.saturating_sub(patch.len());
            let (insertions, deletions) = counts.get(&path).copied().unwrap_or((0, 0));
            FileChange {
                path,
                status,
                insertions,
                deletions,
                patch,
            }
        })
        .collect()
}

/// Everything `worktree` holds that `base` doesn't: what was committed there since, what is
/// changed but not committed, and new files. It is worked out in `index`, a file outside the
/// worktree, so the worktree's own index is never written while an agent may be using it.
pub(crate) async fn changes_since(
    worktree: &Path,
    index: &Path,
    base: &str,
) -> Result<Vec<FileChange>, String> {
    // Starting from the worktree's own index keeps what Git already knows about unchanged files.
    if let Ok(own) = run(worktree, None, &["rev-parse", "--git-path", "index"]).await {
        let _ = file_access::fs::copy(worktree.join(own.trim()), index);
    }
    run(worktree, Some(index), &["add", "-A"]).await?;
    let compare = |form: &'static str| async move {
        let mut arguments = vec![
            "-c",
            "core.quotepath=off",
            "diff",
            "--cached",
            "--no-renames",
            "--no-color",
        ];
        arguments.extend(form.split(' ').filter(|part| !part.is_empty()));
        arguments.push(base);
        run(worktree, Some(index), &arguments).await
    };
    let names = compare("--name-status -z").await?;
    let counts = compare("--numstat -z").await?;
    let patch = compare("").await?;
    Ok(changes_from(&names, &counts, &patch))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_staged_unstaged_untracked_and_renamed_entries() {
        let changes = read_status("M  a.rs\0 M b.rs\0MM c.rs\0?? new.txt\0R  to.rs\0from.rs\0");
        let seen: Vec<(String, &str, bool)> = changes
            .into_iter()
            .map(|change| (change.path, change.status, change.staged))
            .collect();
        assert_eq!(
            seen,
            vec![
                ("a.rs".to_string(), "modified", true),
                ("b.rs".to_string(), "modified", false),
                ("c.rs".to_string(), "modified", true),
                ("c.rs".to_string(), "modified", false),
                ("new.txt".to_string(), "untracked", false),
                ("to.rs".to_string(), "renamed", true),
            ]
        );
    }

    #[test]
    fn refuses_a_file_outside_the_folder() {
        assert!(inside("src/main.rs").is_ok());
        assert!(inside("../secrets").is_err());
        assert!(inside("/etc/passwd").is_err());
        assert!(inside("--output=x").is_err());
    }

    #[test]
    fn reads_a_worktrees_changes_file_by_file() {
        let patch = "diff --git a/a.rs b/a.rs\n--- a/a.rs\n+++ b/a.rs\n@@ -1 +1 @@\n-old\n+new\n\
                     diff --git a/img.png b/img.png\nBinary files differ\n\
                     diff --git a/gone.txt b/gone.txt\n--- a/gone.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-bye\n";
        let changes = changes_from(
            "M\0a.rs\0A\0img.png\0D\0gone.txt\0",
            "1\t1\ta.rs\0-\t-\timg.png\x000\t1\tgone.txt\0",
            patch,
        );
        let seen: Vec<(&str, &str, u32, u32)> = changes
            .iter()
            .map(|file| {
                (
                    file.path.as_str(),
                    file.status,
                    file.insertions,
                    file.deletions,
                )
            })
            .collect();
        assert_eq!(
            seen,
            vec![
                ("a.rs", "modified", 1, 1),
                ("img.png", "added", 0, 0),
                ("gone.txt", "deleted", 0, 1),
            ]
        );
        assert!(changes[0].patch.starts_with("diff --git a/a.rs"));
        assert!(changes[0].patch.ends_with("+new\n"));
        assert!(changes[1].patch.contains("Binary files differ"));
        assert!(changes[2].patch.ends_with("-bye\n"));
    }

    #[test]
    fn lists_files_without_diffs_when_the_diff_does_not_line_up() {
        let changes = changes_from("M\0a.rs\0M\0b.rs\0", "", "diff --git a/a.rs b/a.rs\n");
        assert_eq!(changes.len(), 2);
        assert!(changes.iter().all(|file| file.patch.is_empty()));
    }

    #[test]
    fn clips_a_long_diff_on_a_character_boundary() {
        let clipped = clip_patch("é".repeat(10), 5);
        assert!(clipped.starts_with("éé\n…"));
    }
}
