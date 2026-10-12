//! Undo for a run's changes.
//!
//! Before a run first changes a project (a write, an edit, or any command),
//! Misty copies the project's files to its own data folder. Undo puts every
//! copied file back and removes files the run added. Files Git ignores and
//! dependency folders (`node_modules`) are neither copied nor touched, so a
//! build folder a run created may stay behind.
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{Read, Write},
    os::unix::fs::MetadataExt,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{beneath, walk::SKIPPED_DIRS, CodeError};

const MAX_FILES: usize = 20_000;
const MAX_BYTES: u64 = 1024 * 1024 * 1024;
const KEEP_DAYS: u64 = 14;
const KEEP_PER_PROJECT: usize = 20;

#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct FileRecord {
    pub(crate) path: PathBuf,
    mode: u32,
    pub(crate) size: u64,
    pub(crate) modified_ns: i128,
    pub(crate) inode: u64,
}

#[derive(Serialize, Deserialize, Clone)]
struct LinkRecord {
    path: PathBuf,
    target: PathBuf,
}

#[derive(Serialize, Deserialize)]
pub(crate) struct Manifest {
    version: u32,
    pub(crate) run_id: String,
    pub(crate) created_at: u64,
    pub(crate) complete: bool,
    #[serde(default)]
    reason: Option<String>,
    pub(crate) files: Vec<FileRecord>,
    links: Vec<LinkRecord>,
    /// The branch and commit when the run started, in a Git project.
    #[serde(default)]
    git: Option<crate::git::Head>,
}

pub(crate) enum Item {
    File(PathBuf, fs::Metadata),
    Link(PathBuf),
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

pub(crate) fn modified_ns(metadata: &fs::Metadata) -> i128 {
    metadata.mtime() as i128 * 1_000_000_000 + metadata.mtime_nsec() as i128
}

/// The project's tracked files and symlinks, as undo sees them.
pub(crate) fn items(root: &Path) -> Vec<Item> {
    let walker = WalkBuilder::new(root)
        .hidden(false)
        .follow_links(false)
        .git_ignore(true)
        .git_global(false)
        .git_exclude(true)
        .require_git(false)
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            !(entry.file_type().is_some_and(|kind| kind.is_dir())
                && SKIPPED_DIRS.contains(&name.as_ref()))
        })
        .build();
    let mut out = Vec::new();
    for entry in walker.flatten() {
        let Ok(relative) = entry.path().strip_prefix(root) else {
            continue;
        };
        if relative.as_os_str().is_empty() || beneath::protected(relative).is_some() {
            continue;
        }
        let Some(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_symlink() {
            out.push(Item::Link(relative.to_path_buf()));
        } else if kind.is_file() {
            if let Ok(metadata) = fs::symlink_metadata(entry.path()) {
                out.push(Item::File(relative.to_path_buf(), metadata));
            }
        }
    }
    out
}

pub struct Checkpoints {
    dir: PathBuf,
    lock: std::sync::Mutex<()>,
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 120
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

impl Checkpoints {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            lock: std::sync::Mutex::new(()),
        }
    }

    fn run_dir(&self, scope_id: &str, run_id: &str) -> Result<PathBuf, CodeError> {
        if !valid_id(scope_id) || !valid_id(run_id) {
            return Err(CodeError::Scope("invalid checkpoint identity".into()));
        }
        Ok(self.dir.join(scope_id).join(run_id))
    }

    /// Copies the project once per run, before the run's first change.
    pub fn ensure(&self, scope_id: &str, run_id: &str, root_path: &Path) -> Result<(), CodeError> {
        let _guard = self.lock.lock().map_err(|_| CodeError::fix("busy"))?;
        let run_dir = self.run_dir(scope_id, run_id)?;
        if run_dir.join("manifest.json").exists() {
            return Ok(());
        }
        self.prune(scope_id);
        let staging = run_dir.with_extension("partial");
        let _ = fs::remove_dir_all(&staging);
        fs::create_dir_all(staging.join("files"))
            .map_err(|error| CodeError::Unavailable(format!("Could not prepare undo: {error}")))?;
        let root = beneath::open_root(root_path)
            .map_err(|error| CodeError::Scope(format!("project unavailable: {error}")))?;
        let mut manifest = Manifest {
            version: 1,
            run_id: run_id.to_owned(),
            created_at: now(),
            complete: true,
            reason: None,
            files: Vec::new(),
            links: Vec::new(),
            git: crate::git::record_head(root_path),
        };
        let mut bytes = 0u64;
        for item in items(root_path) {
            match item {
                Item::Link(path) => {
                    if let Ok(target) = beneath::read_link(&root, &path) {
                        manifest.links.push(LinkRecord { path, target });
                    }
                }
                Item::File(path, metadata) => {
                    if manifest.files.len() >= MAX_FILES || bytes + metadata.len() > MAX_BYTES {
                        manifest.complete = false;
                        manifest.reason = Some(format!(
                            "The project is larger than undo covers ({MAX_FILES} files or 1 GB)."
                        ));
                        break;
                    }
                    if copy_out(&root, &path, &staging.join("files").join(&path)).is_err() {
                        continue;
                    }
                    bytes += metadata.len();
                    manifest.files.push(FileRecord {
                        path,
                        mode: metadata.mode() & 0o7777,
                        size: metadata.len(),
                        modified_ns: modified_ns(&metadata),
                        inode: metadata.ino(),
                    });
                }
            }
        }
        let text = serde_json::to_vec(&manifest).map_err(|_| CodeError::fix("manifest"))?;
        fs::write(staging.join("manifest.json"), text)
            .and_then(|_| fs::rename(&staging, &run_dir))
            .map_err(|error| CodeError::Unavailable(format!("Could not save undo: {error}")))?;
        Ok(())
    }

    /// Restores the project to how it was before the run, then forgets the
    /// checkpoint. Returns what changed.
    pub fn undo(&self, scope_id: &str, run_id: &str, root_path: &Path) -> Result<Value, CodeError> {
        let _guard = self.lock.lock().map_err(|_| CodeError::fix("busy"))?;
        let run_dir = self.run_dir(scope_id, run_id)?;
        let manifest: Manifest = fs::read(run_dir.join("manifest.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .ok_or_else(|| CodeError::fix("There is nothing to undo for that run."))?;
        if !manifest.complete {
            return Err(CodeError::fix(
                manifest
                    .reason
                    .unwrap_or_else(|| "That run's undo copy is incomplete.".into()),
            ));
        }
        let root = beneath::open_root(root_path)
            .map_err(|error| CodeError::Scope(format!("project unavailable: {error}")))?;
        let kept: HashMap<&Path, &FileRecord> =
            manifest.files.iter().map(|file| (file.path.as_path(), file)).collect();
        let links: HashSet<&Path> = manifest.links.iter().map(|link| link.path.as_path()).collect();
        let (mut removed, mut restored) = (0usize, 0usize);
        let mut touched_dirs = HashSet::new();
        for item in items(root_path) {
            match item {
                Item::File(path, metadata) => match kept.get(path.as_path()) {
                    Some(record)
                        if record.size == metadata.len()
                            && record.modified_ns == modified_ns(&metadata)
                            && record.inode == metadata.ino()
                            && record.mode == metadata.mode() & 0o7777 => {}
                    Some(_) => {}
                    None => {
                        if beneath::remove(&root, &path, false).is_ok() {
                            removed += 1;
                            touched_dirs.extend(path.parent().map(Path::to_path_buf));
                        }
                    }
                },
                Item::Link(path) => {
                    if !links.contains(path.as_path()) && beneath::remove(&root, &path, false).is_ok() {
                        removed += 1;
                        touched_dirs.extend(path.parent().map(Path::to_path_buf));
                    }
                }
            }
        }
        for record in &manifest.files {
            let unchanged = beneath::open_parent(&root, &record.path, false)
                .ok()
                .and_then(|(dir, name)| beneath::entry(&dir, name).ok())
                .is_some_and(|entry| matches!(entry, beneath::Entry::File { .. }))
                && fs::symlink_metadata(root_path.join(&record.path)).is_ok_and(|metadata| {
                    record.size == metadata.len()
                        && record.modified_ns == modified_ns(&metadata)
                        && record.inode == metadata.ino()
                        && record.mode == metadata.mode() & 0o7777
                });
            if unchanged {
                continue;
            }
            let mut bytes = Vec::new();
            File::open(run_dir.join("files").join(&record.path))
                .and_then(|mut file| file.read_to_end(&mut bytes))
                .map_err(|error| CodeError::Unavailable(format!("Undo copy unreadable: {error}")))?;
            // A symlink or folder now in the file's place goes first.
            if let Ok((dir, name)) = beneath::open_parent(&root, &record.path, false) {
                match beneath::entry(&dir, name) {
                    Ok(beneath::Entry::Symlink) => {
                        let _ = beneath::remove(&root, &record.path, false);
                    }
                    Ok(beneath::Entry::Directory) => {
                        // Through handles: a process could swap a parent
                        // folder for a symlink between the check and here.
                        let _ = beneath::remove_tree(&root, &record.path);
                    }
                    _ => {}
                }
            }
            beneath::write_file_mode(&root, &record.path, &bytes, Some(record.mode))
                .map_err(|error| CodeError::fix(format!("Could not restore {}: {error}", record.path.display())))?;
            restored += 1;
        }
        for link in &manifest.links {
            let same = beneath::read_link(&root, &link.path).is_ok_and(|target| target == link.target);
            if !same {
                let _ = beneath::remove(&root, &link.path, false);
                if beneath::symlink(&root, &link.path, &link.target).is_ok() {
                    restored += 1;
                }
            }
        }
        // Folders the run created and that are empty now.
        let mut dirs: Vec<PathBuf> = touched_dirs.into_iter().collect();
        dirs.sort_by_key(|dir| std::cmp::Reverse(dir.components().count()));
        for dir in dirs {
            let mut current = Some(dir.as_path());
            while let Some(path) = current.filter(|path| !path.as_os_str().is_empty()) {
                if beneath::remove(&root, path, true).is_err() {
                    break;
                }
                current = path.parent();
            }
        }
        // Commits the run made go too, unless they already reached GitHub.
        let (commits_removed, commits_on_github) = manifest
            .git
            .as_ref()
            .map(|head| crate::git::rewind(root_path, head).unwrap_or((0, 0)))
            .unwrap_or((0, 0));
        let _ = fs::remove_dir_all(&run_dir);
        Ok(json!({
            "restored": restored,
            "removed": removed,
            "commitsRemoved": commits_removed,
            "commitsOnGitHub": commits_on_github,
        }))
    }

    /// A run's manifest and its copied files folder.
    pub(crate) fn manifest(&self, scope_id: &str, run_id: &str) -> Option<(PathBuf, Manifest)> {
        let run_dir = self.run_dir(scope_id, run_id).ok()?;
        let manifest = serde_json::from_slice(&fs::read(run_dir.join("manifest.json")).ok()?).ok()?;
        Some((run_dir.join("files"), manifest))
    }

    /// The first run in a project that started after `created_at`.
    pub(crate) fn next_after(&self, scope_id: &str, run_id: &str, created_at: u64) -> Option<(PathBuf, Manifest)> {
        let entries = fs::read_dir(self.dir.join(scope_id)).ok()?;
        entries
            .flatten()
            .filter_map(|entry| self.manifest(scope_id, &entry.file_name().to_string_lossy()))
            .filter(|(_, manifest)| manifest.run_id != run_id && manifest.created_at >= created_at)
            .min_by_key(|(_, manifest)| manifest.created_at)
    }

    /// Runs that can be undone in a project, newest first.
    pub fn list(&self, scope_id: &str) -> Value {
        if !valid_id(scope_id) {
            return json!({ "checkpoints": [] });
        }
        let mut found: Vec<(u64, Value)> = fs::read_dir(self.dir.join(scope_id))
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|entry| {
                let manifest: Manifest =
                    serde_json::from_slice(&fs::read(entry.path().join("manifest.json")).ok()?).ok()?;
                Some((
                    manifest.created_at,
                    json!({
                        "runId": manifest.run_id,
                        "createdAt": manifest.created_at,
                        "complete": manifest.complete,
                        "files": manifest.files.len(),
                    }),
                ))
            })
            .collect();
        found.sort_by_key(|(created, _)| std::cmp::Reverse(*created));
        json!({ "checkpoints": found.into_iter().map(|(_, value)| value).collect::<Vec<_>>() })
    }

    /// Forgets every checkpoint of a project (when it's removed).
    pub fn forget(&self, scope_id: &str) {
        if valid_id(scope_id) {
            let _ = fs::remove_dir_all(self.dir.join(scope_id));
        }
    }

    fn prune(&self, scope_id: &str) {
        let Ok(entries) = fs::read_dir(self.dir.join(scope_id)) else {
            return;
        };
        let cutoff = SystemTime::now() - Duration::from_secs(KEEP_DAYS * 86_400);
        let mut runs: Vec<(SystemTime, PathBuf)> = entries
            .flatten()
            .filter_map(|entry| Some((entry.metadata().ok()?.modified().ok()?, entry.path())))
            .collect();
        runs.sort_by_key(|(modified, _)| std::cmp::Reverse(*modified));
        for (index, (modified, path)) in runs.into_iter().enumerate() {
            if modified < cutoff || index >= KEEP_PER_PROJECT {
                let _ = fs::remove_dir_all(path);
            }
        }
    }
}

/// Copies one project file out, cloning it on APFS when possible.
fn copy_out(root: &File, relative: &Path, destination: &Path) -> std::io::Result<()> {
    let source = beneath::open_file(root, relative)?;
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    #[cfg(target_os = "macos")]
    {
        use std::os::{fd::AsRawFd, unix::ffi::OsStrExt};
        if let (Some(parent), Some(name)) = (destination.parent(), destination.file_name()) {
            let dir = beneath::open_root(parent)?;
            let name = std::ffi::CString::new(name.as_bytes())
                .map_err(|_| std::io::Error::from(std::io::ErrorKind::InvalidInput))?;
            let cloned = unsafe {
                libc::fclonefileat(source.as_raw_fd(), dir.as_raw_fd(), name.as_ptr(), 0)
            };
            if cloned == 0 {
                return Ok(());
            }
        }
    }
    let mut target = File::create(destination)?;
    std::io::copy(&mut (&source).take(MAX_BYTES), &mut target)?;
    target.flush()
}
