//! Undo for a delegated coding run. Before each turn of a run that may change
//! a project, Misty copies the project's files into its own data folder once
//! per run. Undo puts every copied file back, removes files the run added and,
//! in a Git project, moves the branch back when the run's commits never left
//! this computer. Ignored files and dependency folders are neither copied nor
//! touched, so a build folder a run created may stay behind.
pub mod diff;
pub mod files;
mod history;

use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use files::{identity, items, Head, Item};

const MAX_FILES: usize = 20_000;
const MAX_BYTES: u64 = 1024 * 1024 * 1024;
const KEEP_DAYS: u64 = 14;
const KEEP_PER_PROJECT: usize = 20;

/// One checkpoint at a time, whichever run asks.
static LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize, Deserialize, Clone)]
pub struct FileRecord {
    pub path: PathBuf,
    mode: u32,
    size: u64,
    modified_ns: i128,
    inode: u64,
}

impl FileRecord {
    fn matches(&self, metadata: &fs::Metadata) -> bool {
        (self.size, self.modified_ns, self.mode, self.inode) == identity(metadata)
    }
}

#[derive(Serialize, Deserialize, Clone)]
struct LinkRecord {
    path: PathBuf,
    target: PathBuf,
}

#[derive(Serialize, Deserialize)]
pub struct Manifest {
    pub run_id: String,
    pub created_at: u64,
    pub complete: bool,
    #[serde(default)]
    reason: Option<String>,
    pub files: Vec<FileRecord>,
    links: Vec<LinkRecord>,
    #[serde(default)]
    git: Option<Head>,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs())
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 120
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

pub struct Checkpoints {
    dir: PathBuf,
}

impl Checkpoints {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    fn run_dir(&self, scope_id: &str, run_id: &str) -> Result<PathBuf, String> {
        if !valid_id(scope_id) || !valid_id(run_id) {
            return Err("That run can't be undone.".into());
        }
        Ok(self.dir.join(scope_id).join(run_id))
    }

    /// A run's manifest and the folder holding its copied files.
    pub fn manifest(&self, scope_id: &str, run_id: &str) -> Option<(PathBuf, Manifest)> {
        let run_dir = self.run_dir(scope_id, run_id).ok()?;
        let manifest =
            serde_json::from_slice(&fs::read(run_dir.join("manifest.json")).ok()?).ok()?;
        Some((run_dir.join("files"), manifest))
    }

    /// Copies the project once per run, before the run's first turn.
    pub fn ensure(&self, scope_id: &str, run_id: &str, root: &Path) -> Result<(), String> {
        let _guard = LOCK.lock().map_err(|_| "Undo is busy.".to_owned())?;
        let run_dir = self.run_dir(scope_id, run_id)?;
        if run_dir.join("manifest.json").exists() {
            return Ok(());
        }
        self.prune(scope_id);
        let staging = run_dir.with_extension("partial");
        let _ = fs::remove_dir_all(&staging);
        fs::create_dir_all(staging.join("files"))
            .map_err(|_| "Couldn't prepare undo.".to_owned())?;
        let mut manifest = Manifest {
            run_id: run_id.to_owned(),
            created_at: now(),
            complete: true,
            reason: None,
            files: Vec::new(),
            links: Vec::new(),
            git: files::record_head(root),
        };
        let mut bytes = 0u64;
        for item in items(root) {
            match item {
                Item::Link(path) => {
                    if let Ok(target) = fs::read_link(root.join(&path)) {
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
                    let copy = staging.join("files").join(&path);
                    let copied = copy
                        .parent()
                        .is_some_and(|parent| fs::create_dir_all(parent).is_ok())
                        && fs::copy(root.join(&path), &copy).is_ok();
                    if !copied {
                        continue;
                    }
                    bytes += metadata.len();
                    let (size, modified_ns, mode, inode) = identity(&metadata);
                    manifest.files.push(FileRecord {
                        path,
                        mode,
                        size,
                        modified_ns,
                        inode,
                    });
                }
            }
        }
        let text = serde_json::to_vec(&manifest).map_err(|_| "Couldn't save undo.".to_owned())?;
        fs::write(staging.join("manifest.json"), text)
            .and_then(|_| fs::rename(&staging, &run_dir))
            .map_err(|_| "Couldn't save undo.".to_owned())
    }

    /// Restores the project to how it was before the run, then forgets the
    /// checkpoint. Returns what changed.
    pub fn undo(&self, scope_id: &str, run_id: &str, root: &Path) -> Result<Value, String> {
        let _guard = LOCK.lock().map_err(|_| "Undo is busy.".to_owned())?;
        let (copies, manifest) = self
            .manifest(scope_id, run_id)
            .ok_or_else(|| "There is nothing to undo for that run.".to_owned())?;
        if !manifest.complete {
            return Err(manifest
                .reason
                .unwrap_or_else(|| "That run's undo copy is incomplete.".into()));
        }
        let kept: HashMap<&Path, &FileRecord> = manifest
            .files
            .iter()
            .map(|file| (file.path.as_path(), file))
            .collect();
        let links: HashSet<&Path> = manifest
            .links
            .iter()
            .map(|link| link.path.as_path())
            .collect();
        let (mut removed, mut restored) = (0usize, 0usize);
        let mut touched = HashSet::new();
        for item in items(root) {
            let path = match &item {
                Item::File(path, _) if !kept.contains_key(path.as_path()) => path,
                Item::Link(path) if !links.contains(path.as_path()) => path,
                _ => continue,
            };
            if fs::remove_file(root.join(path)).is_ok() {
                removed += 1;
                touched.extend(path.parent().map(Path::to_path_buf));
            }
        }
        for record in &manifest.files {
            let unchanged = fs::symlink_metadata(root.join(&record.path))
                .is_ok_and(|metadata| metadata.is_file() && record.matches(&metadata));
            if unchanged {
                continue;
            }
            files::restore_file(root, &record.path, &copies.join(&record.path), record.mode)
                .map_err(|_| format!("Couldn't restore {}.", record.path.display()))?;
            restored += 1;
        }
        for link in &manifest.links {
            if fs::read_link(root.join(&link.path)).is_ok_and(|target| target == link.target) {
                continue;
            }
            let _ = fs::remove_file(root.join(&link.path));
            #[cfg(unix)]
            if files::prepare_parent(root, &link.path).is_ok()
                && std::os::unix::fs::symlink(&link.target, root.join(&link.path)).is_ok()
            {
                restored += 1;
            }
        }
        // Folders the run created and that are empty now.
        let mut dirs: Vec<PathBuf> = touched.into_iter().collect();
        dirs.sort_by_key(|dir| std::cmp::Reverse(dir.components().count()));
        for dir in dirs {
            let mut current = Some(dir.as_path());
            while let Some(path) = current.filter(|path| !path.as_os_str().is_empty()) {
                if fs::remove_dir(root.join(path)).is_err() {
                    break;
                }
                current = path.parent();
            }
        }
        let (commits_removed, commits_pushed) = manifest
            .git
            .as_ref()
            .map_or((0, 0), |head| files::rewind(root, head));
        let _ = fs::remove_dir_all(copies.parent().unwrap_or(&copies));
        Ok(
            json!({ "restored": restored, "removed": removed, "commitsRemoved": commits_removed, "commitsPushed": commits_pushed }),
        )
    }
}

#[cfg(test)]
mod tests;
