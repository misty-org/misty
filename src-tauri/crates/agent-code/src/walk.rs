//! Walking a project the way a developer would: .gitignore respected, Git's
//! folder and dependency folders skipped, symlinks never followed.
use std::path::{Path, PathBuf};

use ignore::WalkBuilder;

/// Folders no tool walks into, ignored or not.
pub const SKIPPED_DIRS: &[&str] = &[".git", ".misty", "node_modules", ".venv", "__pycache__"];

/// Every regular file under `start` (a folder inside `root`), as paths
/// relative to `root`, up to `limit`. Returns whether the walk was cut short.
pub fn files(root: &Path, start: &Path, limit: usize) -> (Vec<PathBuf>, bool) {
    let mut out = Vec::new();
    let walker = WalkBuilder::new(root.join(start))
        .hidden(false)
        .follow_links(false)
        .git_ignore(true)
        .git_global(false)
        .git_exclude(true)
        .ignore(true)
        .parents(true)
        .require_git(false)
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            !(entry.file_type().is_some_and(|kind| kind.is_dir())
                && SKIPPED_DIRS.contains(&name.as_ref()))
        })
        .build();
    for item in walker.flatten() {
        if !item.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }
        let Ok(relative) = item.path().strip_prefix(root) else {
            continue;
        };
        if out.len() >= limit {
            return (out, true);
        }
        out.push(relative.to_path_buf());
    }
    out.sort();
    (out, false)
}
