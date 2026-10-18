//! What changed in a project, from `git diff` against its last commit, in the
//! diff viewer's shape (src/features/agents/components/changes/diffTypes.ts).
//! New files that git doesn't track yet appear as added. Nothing here changes
//! the repository: no index updates, no stashes.
use std::{path::Path, process::Command};

use serde::Serialize;

const MAX_FILES: usize = 200;
const MAX_LINES_PER_FILE: usize = 2_000;

#[derive(Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub kind: &'static str,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new: Option<u32>,
}

#[derive(Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    pub status: &'static str,
    pub additions: u32,
    pub deletions: u32,
    pub binary: bool,
    pub hunks: Vec<DiffHunk>,
    pub truncated: bool,
}

#[derive(Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiffSet {
    pub files: Vec<FileDiff>,
    pub additions: u32,
    pub deletions: u32,
    pub more_files: u32,
}

fn range(text: &str) -> (u32, u32) {
    let mut parts = text.trim_start_matches(['-', '+']).splitn(2, ',');
    let start = parts.next().and_then(|n| n.parse().ok()).unwrap_or(0);
    let count = parts
        .next()
        .map_or(Some(1), |n| n.parse().ok())
        .unwrap_or(0);
    (start, count)
}

/// Parses `git diff` output.
pub fn parse(text: &str) -> DiffSet {
    let mut set = DiffSet::default();
    let mut file: Option<FileDiff> = None;
    let (mut old, mut new) = (0u32, 0u32);
    let mut shown = 0usize;
    let finish = |file: Option<FileDiff>, set: &mut DiffSet| {
        if let Some(file) = file {
            set.additions += file.additions;
            set.deletions += file.deletions;
            if set.files.len() < MAX_FILES {
                set.files.push(file);
            } else {
                set.more_files += 1;
            }
        }
    };
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("diff --git ") {
            finish(file.take(), &mut set);
            let path = rest
                .rsplit_once(" b/")
                .map(|(_, b)| b)
                .unwrap_or(rest)
                .to_owned();
            shown = 0;
            file = Some(FileDiff {
                path,
                status: "modified",
                ..Default::default()
            });
            continue;
        }
        let Some(current) = file.as_mut() else {
            continue;
        };
        if line.starts_with("new file mode") {
            current.status = "added";
        } else if line.starts_with("deleted file mode") {
            current.status = "deleted";
        } else if let Some(from) = line.strip_prefix("rename from ") {
            current.status = "renamed";
            current.old_path = Some(from.to_owned());
        } else if line.starts_with("Binary files") {
            current.binary = true;
        } else if let Some(header) = line.strip_prefix("@@ ") {
            let mut parts = header.split_whitespace();
            let (old_start, old_lines) = range(parts.next().unwrap_or("-0"));
            let (new_start, new_lines) = range(parts.next().unwrap_or("+0"));
            (old, new) = (old_start, new_start);
            current.hunks.push(DiffHunk {
                old_start,
                old_lines,
                new_start,
                new_lines,
                lines: Vec::new(),
            });
        } else if let Some(hunk) = current.hunks.last_mut() {
            if shown >= MAX_LINES_PER_FILE {
                current.truncated = true;
                continue;
            }
            let (kind, text) = match line.chars().next() {
                Some('+') => ("add", &line[1..]),
                Some('-') => ("del", &line[1..]),
                Some(' ') => ("context", &line[1..]),
                _ => continue,
            };
            let entry = match kind {
                "add" => {
                    current.additions += 1;
                    new += 1;
                    DiffLine {
                        kind,
                        text: text.into(),
                        old: None,
                        new: Some(new - 1),
                    }
                }
                "del" => {
                    current.deletions += 1;
                    old += 1;
                    DiffLine {
                        kind,
                        text: text.into(),
                        old: Some(old - 1),
                        new: None,
                    }
                }
                _ => {
                    old += 1;
                    new += 1;
                    DiffLine {
                        kind,
                        text: text.into(),
                        old: Some(old - 1),
                        new: Some(new - 1),
                    }
                }
            };
            shown += 1;
            hunk.lines.push(entry);
        }
    }
    finish(file.take(), &mut set);
    set
}

fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(["-c", "core.quotepath=false"])
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|_| "Git isn't installed on this computer.".to_owned())?;
    if !output.status.success() {
        return Err("This project isn't a Git repository yet.".to_owned());
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// The project's changes since its last commit, plus files git doesn't track yet.
pub fn project_diff(root: &Path) -> Result<DiffSet, String> {
    let has_head = git(root, &["rev-parse", "--verify", "HEAD"]).is_ok();
    let base = if has_head {
        "HEAD"
    } else {
        "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
    };
    let mut set = parse(&git(
        root,
        &["diff", "--no-color", "--no-ext-diff", "-M", base, "--"],
    )?);
    for path in git(root, &["ls-files", "--others", "--exclude-standard", "-z"])?
        .split('\0')
        .filter(|p| !p.is_empty())
    {
        let Ok(text) = std::fs::read_to_string(root.join(path)) else {
            set.files.push(FileDiff {
                path: path.into(),
                status: "added",
                binary: true,
                ..Default::default()
            });
            continue;
        };
        let lines: Vec<&str> = text.lines().collect();
        let shown = lines.len().min(MAX_LINES_PER_FILE);
        let hunk = DiffHunk {
            old_start: 0,
            old_lines: 0,
            new_start: 1,
            new_lines: lines.len() as u32,
            lines: lines[..shown]
                .iter()
                .enumerate()
                .map(|(i, line)| DiffLine {
                    kind: "add",
                    text: (*line).into(),
                    old: None,
                    new: Some(i as u32 + 1),
                })
                .collect(),
        };
        set.additions += lines.len() as u32;
        if set.files.len() < MAX_FILES {
            set.files.push(FileDiff {
                path: path.into(),
                status: "added",
                additions: lines.len() as u32,
                hunks: vec![hunk],
                truncated: shown < lines.len(),
                ..Default::default()
            });
        } else {
            set.more_files += 1;
        }
    }
    Ok(set)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_modified_added_and_renamed_files() {
        let text = "diff --git a/src/a.rs b/src/a.rs\nindex 1..2 100644\n--- a/src/a.rs\n+++ b/src/a.rs\n@@ -1,3 +1,3 @@\n fn a() {\n-    old();\n+    new();\n }\ndiff --git a/new.txt b/new.txt\nnew file mode 100644\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+hello\ndiff --git a/old.md b/doc.md\nsimilarity index 100%\nrename from old.md\nrename to doc.md\n";
        let set = parse(text);
        assert_eq!(set.files.len(), 3);
        assert_eq!((set.additions, set.deletions), (2, 1));
        let first = &set.files[0];
        assert_eq!(
            (first.path.as_str(), first.status),
            ("src/a.rs", "modified")
        );
        assert_eq!(
            first.hunks[0].lines[1],
            DiffLine {
                kind: "del",
                text: "    old();".into(),
                old: Some(2),
                new: None
            }
        );
        assert_eq!(
            first.hunks[0].lines[2],
            DiffLine {
                kind: "add",
                text: "    new();".into(),
                old: None,
                new: Some(2)
            }
        );
        assert_eq!(set.files[1].status, "added");
        assert_eq!(
            (set.files[2].status, set.files[2].old_path.as_deref()),
            ("renamed", Some("old.md"))
        );
    }

    #[test]
    fn reads_a_real_repository_without_changing_it() {
        let dir = tempfile::tempdir().unwrap();
        let run = |args: &[&str]| {
            assert!(Command::new("git")
                .args(args)
                .current_dir(dir.path())
                .output()
                .unwrap()
                .status
                .success())
        };
        run(&["init", "-q"]);
        std::fs::write(dir.path().join("a.txt"), "one\n").unwrap();
        run(&["add", "a.txt"]);
        run(&[
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@example.test",
            "commit",
            "-qm",
            "init",
        ]);
        std::fs::write(dir.path().join("a.txt"), "two\n").unwrap();
        std::fs::write(dir.path().join("b.txt"), "new\n").unwrap();
        let set = project_diff(dir.path()).unwrap();
        assert_eq!(
            set.files
                .iter()
                .map(|f| (f.path.as_str(), f.status))
                .collect::<Vec<_>>(),
            [("a.txt", "modified"), ("b.txt", "added")]
        );
        assert_eq!((set.additions, set.deletions), (2, 1));
        let status = Command::new("git")
            .args(["status", "--porcelain"])
            .current_dir(dir.path())
            .output()
            .unwrap();
        assert_eq!(
            String::from_utf8_lossy(&status.stdout),
            " M a.txt\n?? b.txt\n",
            "the index is untouched"
        );
    }
}
