//! The files a checkpoint covers, and the Git state around a run. Git projects
//! use Git's own view (tracked files plus untracked files it doesn't ignore);
//! other folders are walked, skipping dependency and build folders. Writes
//! never follow a symlink out of the project.
use std::{
    fs,
    path::{Component, Path, PathBuf},
    process::Command,
};

use serde::{Deserialize, Serialize};

/// Folders that are rebuilt or private, never copied and never touched.
pub const SKIPPED_DIRS: &[&str] = &[
    ".git",
    ".misty",
    "node_modules",
    ".venv",
    "venv",
    "__pycache__",
];

pub enum Item {
    File(PathBuf, fs::Metadata),
    Link(PathBuf),
}

fn skipped(relative: &Path) -> bool {
    relative.components().any(|part| match part {
        Component::Normal(name) => SKIPPED_DIRS.contains(&name.to_string_lossy().as_ref()),
        _ => true,
    })
}

pub(super) fn git(root: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

fn classify(root: &Path, relative: PathBuf) -> Option<Item> {
    if relative.as_os_str().is_empty() || skipped(&relative) {
        return None;
    }
    let metadata = fs::symlink_metadata(root.join(&relative)).ok()?;
    if metadata.file_type().is_symlink() {
        Some(Item::Link(relative))
    } else if metadata.is_file() {
        Some(Item::File(relative, metadata))
    } else {
        None
    }
}

/// The project's files and symlinks, as undo sees them.
pub fn items(root: &Path) -> Vec<Item> {
    if let Some(listing) = git(
        root,
        &[
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
        ],
    ) {
        let mut seen = std::collections::HashSet::new();
        return listing
            .split('\0')
            .filter(|path| !path.is_empty() && seen.insert(path.to_owned()))
            .filter_map(|path| classify(root, PathBuf::from(path)))
            .collect();
    }
    walkdir::WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            entry.depth() == 0
                || !SKIPPED_DIRS.contains(&entry.file_name().to_string_lossy().as_ref())
        })
        .flatten()
        .filter_map(|entry| classify(root, entry.path().strip_prefix(root).ok()?.to_path_buf()))
        .collect()
}

/// What tells two versions of a file apart without reading them.
pub fn identity(metadata: &fs::Metadata) -> (u64, i128, u32, u64) {
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |duration| duration.as_nanos() as i128);
    #[cfg(unix)]
    let (mode, inode) = {
        use std::os::unix::fs::MetadataExt;
        (metadata.mode(), metadata.ino())
    };
    #[cfg(not(unix))]
    let (mode, inode) = (u32::from(metadata.permissions().readonly()), 0);
    (metadata.len(), modified, mode, inode)
}

/// Makes `relative`'s folder a real folder inside the root: a symlink or file
/// in the way of any part of it is removed first.
pub fn prepare_parent(root: &Path, relative: &Path) -> std::io::Result<()> {
    let mut current = root.to_path_buf();
    let Some(parent) = relative.parent() else {
        return Ok(());
    };
    for part in parent.components() {
        let Component::Normal(name) = part else {
            return Err(std::io::Error::other("not a project path"));
        };
        current.push(name);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.is_dir() => continue,
            Ok(_) => fs::remove_file(&current)?,
            Err(_) => {}
        }
        fs::create_dir(&current)?;
    }
    Ok(())
}

/// Writes a restored file in place of whatever is at `relative` now.
pub fn restore_file(root: &Path, relative: &Path, source: &Path, mode: u32) -> std::io::Result<()> {
    prepare_parent(root, relative)?;
    let target = root.join(relative);
    match fs::symlink_metadata(&target) {
        Ok(metadata) if metadata.is_dir() => fs::remove_dir_all(&target)?,
        Ok(metadata) if metadata.file_type().is_symlink() => fs::remove_file(&target)?,
        _ => {}
    }
    fs::copy(source, &target)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&target, fs::Permissions::from_mode(mode & 0o7777))?;
    }
    #[cfg(not(unix))]
    let _ = mode;
    Ok(())
}

/// The branch and commit when a run started, in a Git project.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Head {
    pub branch: String,
    pub sha: String,
}

pub fn record_head(root: &Path) -> Option<Head> {
    let branch = git(root, &["symbolic-ref", "--short", "-q", "HEAD"])?
        .trim()
        .to_owned();
    let sha = git(root, &["rev-parse", "HEAD"])?.trim().to_owned();
    (!branch.is_empty() && !sha.is_empty()).then_some(Head { branch, sha })
}

/// After undo restored a run's files: moves the branch back to where the run
/// started when the run's commits never left this computer. Returns (commits
/// removed, commits already pushed).
pub fn rewind(root: &Path, start: &Head) -> (usize, usize) {
    let Some(head) = record_head(root) else {
        return (0, 0);
    };
    let ancestor = |older: &str, newer: &str| {
        git(root, &["merge-base", "--is-ancestor", older, newer]).is_some()
    };
    if head.branch != start.branch || head.sha == start.sha || !ancestor(&start.sha, &head.sha) {
        return (0, 0);
    }
    let made = git(
        root,
        &[
            "rev-list",
            "--count",
            &format!("{}..{}", start.sha, head.sha),
        ],
    )
    .and_then(|count| count.trim().parse().ok())
    .unwrap_or(0);
    let upstream =
        git(root, &["rev-parse", "-q", "--verify", "@{upstream}"]).map(|sha| sha.trim().to_owned());
    if upstream.is_some_and(|remote| remote != start.sha && ancestor(&start.sha, &remote)) {
        return (0, made);
    }
    // Mixed: the branch and index move back; the files undo restored stay.
    match git(root, &["reset", "-q", "--mixed", &start.sha]) {
        Some(_) => (made, 0),
        None => (0, 0),
    }
}
