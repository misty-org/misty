// Multi-run (engines/multirun.rs): Git with an index of its own, and a worktree's changes.

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;

const DIFF_LIMIT: usize = 400_000;

fn status_word(code: char) -> &'static str {
    match code {
        'A' => "added",
        'D' => "deleted",
        'R' | 'C' => "renamed",
        '?' => "untracked",
        _ => "modified",
    }
}

const FILE_PATCH_LIMIT: usize = 120_000;

/// Runs the person's `git` in `folder`, never stopping to ask in a terminal. With `index`, Git keeps its index in that file
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
