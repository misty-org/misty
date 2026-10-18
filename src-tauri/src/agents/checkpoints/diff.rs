//! What one run changed: its checkpoint against the next run's checkpoint, or
//! against the project now when no run came after. Each changed file is
//! compared with `git diff --no-index`, so the result has the same shape as
//! the project's own diff.
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use super::{files::items, files::Item, Checkpoints};
use crate::agents::project_diff::{parse, DiffSet};

/// Files compared at most; past this the rest count as more files.
const MAX_COMPARED: usize = 400;

fn file_diff(relative: &str, before: Option<&Path>, after: Option<&Path>) -> String {
    let null = PathBuf::from("/dev/null");
    let output = Command::new("git")
        .args(["diff", "--no-index", "--no-color", "--no-ext-diff", "--"])
        .arg(before.unwrap_or(&null))
        .arg(after.unwrap_or(&null))
        .output();
    let Ok(output) = output else {
        return String::new();
    };
    let text = String::from_utf8_lossy(&output.stdout);
    let mut lines = text.lines();
    if lines.next().is_none() {
        return String::new();
    }
    // The header names the files' real places; the viewer wants project paths.
    let mut out = format!("diff --git a/{relative} b/{relative}\n");
    for line in lines {
        out.push_str(line);
        out.push('\n');
    }
    out
}

fn same(before: &Path, after: &Path) -> bool {
    match (fs::metadata(before), fs::metadata(after)) {
        (Ok(a), Ok(b)) if a.len() != b.len() => false,
        _ => fs::read(before).ok() == fs::read(after).ok(),
    }
}

impl Checkpoints {
    pub fn run_diff(&self, scope_id: &str, run_id: &str, root: &Path) -> Result<DiffSet, String> {
        let (copies, manifest) = self
            .manifest(scope_id, run_id)
            .ok_or_else(|| "Misty no longer has this run's changes.".to_owned())?;
        let before: BTreeMap<String, PathBuf> = manifest
            .files
            .iter()
            .map(|file| {
                (
                    file.path.to_string_lossy().replace('\\', "/"),
                    copies.join(&file.path),
                )
            })
            .collect();
        let after: BTreeMap<String, PathBuf> =
            match self.next_after(scope_id, run_id, manifest.created_at) {
                Some((next_copies, next)) => next
                    .files
                    .iter()
                    .map(|file| {
                        (
                            file.path.to_string_lossy().replace('\\', "/"),
                            next_copies.join(&file.path),
                        )
                    })
                    .collect(),
                None => items(root)
                    .into_iter()
                    .filter_map(|item| match item {
                        Item::File(path, _) => {
                            Some((path.to_string_lossy().replace('\\', "/"), root.join(path)))
                        }
                        Item::Link(_) => None,
                    })
                    .collect(),
            };
        let mut paths: Vec<&String> = before.keys().chain(after.keys()).collect();
        paths.sort();
        paths.dedup();
        let mut text = String::new();
        let mut compared = 0usize;
        let mut skipped = 0u32;
        for path in paths {
            let (old, new) = (before.get(path), after.get(path));
            if let (Some(old), Some(new)) = (old, new) {
                if same(old, new) {
                    continue;
                }
            }
            if compared >= MAX_COMPARED {
                skipped += 1;
                continue;
            }
            compared += 1;
            text.push_str(&file_diff(
                path,
                old.map(PathBuf::as_path),
                new.map(PathBuf::as_path),
            ));
        }
        let mut set = parse(&text);
        set.more_files += skipped;
        Ok(set)
    }
}
