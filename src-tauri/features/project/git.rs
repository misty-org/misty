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
}
