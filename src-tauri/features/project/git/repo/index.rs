// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//
// Writes to a repository's index and folder: staging, unstaging and discarding, one at a time.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use super::status::open_repo;

/// One lock per repository for everything that writes its index or refs. Two clicks in the panel
/// (stage while an unstage is still running) would otherwise overlap, and libgit2 fails the
/// second with "the index is locked". Worktrees have their own index, so their own lock.
pub(crate) fn repo_write_gate(path: &Path) -> Arc<tokio::sync::Mutex<()>> {
    type Gates = Mutex<HashMap<PathBuf, Arc<tokio::sync::Mutex<()>>>>;
    static GATES: OnceLock<Gates> = OnceLock::new();
    let key = file_access::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let mut gates = GATES
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    Arc::clone(gates.entry(key).or_default())
}

pub(crate) fn git_stage_blocking(path: &Path, files: &[String]) -> Result<(), String> {
    let gate = repo_write_gate(path);
    let _queued = gate.blocking_lock();
    let repo = open_repo(path)?;
    let mut index = repo.index().map_err(|error| error.to_string())?;
    for file in files {
        let file_path = Path::new(file);
        let present = repo
            .workdir()
            .is_some_and(|workdir| file_access::fs::exists(workdir.join(file_path)));
        if present {
            index.add_path(file_path)
        } else {
            index.remove_path(file_path)
        }
        .map_err(|error| error.to_string())?;
    }
    index.write().map_err(|error| error.to_string())
}

pub(crate) fn git_unstage_blocking(path: &Path, files: &[String]) -> Result<(), String> {
    let gate = repo_write_gate(path);
    let _queued = gate.blocking_lock();
    let repo = open_repo(path)?;
    let head = repo.head().and_then(|head| head.peel_to_commit());
    let mut index = repo.index().map_err(|error| error.to_string())?;
    match head {
        Ok(commit) => {
            let tree = commit.tree().map_err(|error| error.to_string())?;
            for file in files {
                let file_path = Path::new(file);
                match tree.get_path(file_path) {
                    Ok(entry) => index
                        .add(&git2::IndexEntry {
                            ctime: git2::IndexTime::new(0, 0),
                            mtime: git2::IndexTime::new(0, 0),
                            dev: 0,
                            ino: 0,
                            mode: entry.filemode() as u32,
                            uid: 0,
                            gid: 0,
                            file_size: 0,
                            id: entry.id(),
                            flags: 0,
                            flags_extended: 0,
                            path: file.as_bytes().to_vec(),
                        })
                        .map_err(|error| error.to_string())?,
                    // Not in HEAD: a newly staged file leaves the index.
                    Err(_) => {
                        let _ = index.remove_path(file_path);
                    }
                }
            }
        }
        // No commit yet: taking the files out of the index unstages them.
        Err(_) => {
            for file in files {
                let _ = index.remove_path(Path::new(file));
            }
        }
    }
    index.write().map_err(|error| error.to_string())
}

/// Throws away a file's changes in the folder, like `git restore --worktree` and `git clean -f`:
/// a file the index holds goes back to its staged content (so what was staged survives), and an
/// untracked file is deleted.
pub(crate) fn git_discard_blocking(path: &Path, files: &[String]) -> Result<(), String> {
    let gate = repo_write_gate(path);
    let _queued = gate.blocking_lock();
    let repo = open_repo(path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| "This is a bare repository, with no files to change.".to_string())?
        .to_path_buf();
    let mut index = repo.index().map_err(|error| error.to_string())?;
    for file in files {
        let file_path = Path::new(file);
        if index.get_path(file_path, 0).is_some() {
            let mut checkout = git2::build::CheckoutBuilder::new();
            checkout.path(file).force();
            repo.checkout_index(Some(&mut index), Some(&mut checkout))
                .map_err(|error| error.to_string())?;
        } else {
            let absolute = workdir.join(file_path);
            let link = file_access::fs::symlink_metadata(&absolute)
                .is_ok_and(|found| found.file_type().is_symlink());
            if !link && file_access::fs::is_dir(&absolute) {
                file_access::fs::remove_dir_all(&absolute).map_err(|error| error.to_string())?;
            } else if link || file_access::fs::exists(&absolute) {
                file_access::fs::remove_file(&absolute).map_err(|error| error.to_string())?;
            }
        }
    }
    Ok(())
}
