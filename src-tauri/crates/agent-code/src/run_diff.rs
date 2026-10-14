//! What one answer changed in a project, for the diff under that answer.
//!
//! A run's undo copy is the project just before the run. The next run's undo
//! copy (or, for the latest run, the project now) is the project after it, so
//! the difference between the two is the run's work, Git or not.
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};

use crate::{
    beneath,
    checkpoint::{self, Checkpoints, FileRecord, Item},
    diff::{Builder, DiffSet},
    CodeError,
};

const MAX_COMPARED_BYTES: u64 = 8 * 1024 * 1024;

fn read_capped(path: &Path) -> Option<Vec<u8>> {
    let size = fs::metadata(path).ok()?.len();
    if size > MAX_COMPARED_BYTES {
        // Too large to show; a marker that differs only when sizes differ.
        return Some(format!("\0{size}").into_bytes());
    }
    fs::read(path).ok()
}

/// One side of the comparison: where each file's bytes come from.
enum Side {
    Copy { dir: PathBuf, files: BTreeMap<PathBuf, FileRecord> },
    Project { root: PathBuf, files: BTreeMap<PathBuf, fs::Metadata> },
}

impl Side {
    fn paths(&self) -> BTreeSet<PathBuf> {
        match self {
            Side::Copy { files, .. } => files.keys().cloned().collect(),
            Side::Project { files, .. } => files.keys().cloned().collect(),
        }
    }

    fn read(&self, path: &Path) -> Option<Vec<u8>> {
        match self {
            Side::Copy { dir, files } => files.contains_key(path).then(|| read_capped(&dir.join(path))).flatten(),
            Side::Project { root, files } => {
                if !files.contains_key(path) {
                    return None;
                }
                let root_dir = beneath::open_root(root).ok()?;
                let file = beneath::open_file(&root_dir, path).ok()?;
                if file.metadata().ok()?.len() > MAX_COMPARED_BYTES {
                    return Some(format!("\0{}", file.metadata().ok()?.len()).into_bytes());
                }
                use std::io::Read;
                let mut bytes = Vec::new();
                (&file).read_to_end(&mut bytes).ok()?;
                Some(bytes)
            }
        }
    }

    /// Size, modification time and inode, to skip files that didn't change.
    fn stamp(&self, path: &Path) -> Option<(u64, i128, u64)> {
        match self {
            Side::Copy { files, .. } => files.get(path).map(|record| (record.size, record.modified_ns, record.inode)),
            Side::Project { files, .. } => files
                .get(path)
                .map(|meta| (meta.len(), checkpoint::modified_ns(meta), beneath::file_identity(meta))),
        }
    }
}

/// The diff of one run: its undo copy against the next run's, or the project.
pub fn run_diff(checkpoints: &Checkpoints, scope_id: &str, run_id: &str, root: &Path) -> Result<DiffSet, CodeError> {
    let (dir, manifest) = checkpoints
        .manifest(scope_id, run_id)
        .ok_or_else(|| CodeError::fix("That answer's changes are no longer kept (after 14 days or an undo)."))?;
    let before = Side::Copy {
        dir,
        files: manifest.files.iter().map(|file| (file.path.clone(), file.clone())).collect(),
    };
    let after = match checkpoints.next_after(scope_id, run_id, manifest.created_at) {
        Some((next_dir, next)) => Side::Copy {
            dir: next_dir,
            files: next.files.iter().map(|file| (file.path.clone(), file.clone())).collect(),
        },
        None => Side::Project {
            root: root.to_path_buf(),
            files: checkpoint::items(root)
                .into_iter()
                .filter_map(|item| match item {
                    Item::File(path, meta) => Some((path, meta)),
                    Item::Link(_) => None,
                })
                .collect(),
        },
    };
    let mut builder = Builder::default();
    let paths: BTreeSet<PathBuf> = before.paths().union(&after.paths()).cloned().collect();
    for path in paths {
        if beneath::protected(&path).is_some() {
            continue;
        }
        // Same size, time and inode on both sides: the run didn't touch it.
        if before.stamp(&path).is_some() && before.stamp(&path) == after.stamp(&path) {
            continue;
        }
        let old = before.read(&path);
        let new = after.read(&path);
        if old == new {
            continue;
        }
        builder.file(&path.to_string_lossy(), None, old.as_deref(), new.as_deref());
    }
    Ok(builder.finish())
}
