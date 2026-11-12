//! What a chat's turns did to the person's files, so a rewind can put them back.
//!
//! Before each turn, the folder it works in is saved as a Git tree in a store of Misty's own
//! (`~/.misty/turn-snapshots`, one bare repository per folder), never in the folder's own `.git`,
//! and again when the turn ends. The folder's ignore rules apply, so build output stays out.
//!
//! A rewind reads those trees in order: what changed between a turn's start and its end is the
//! agent's, what changed between turns or since the last one is the person's. The agent's files go
//! back to how they were before the first removed turn; one the person changed too is listed for
//! them to decide, never put back silently. The idea follows OpenCode's snapshots; this is written
//! from scratch over libgit2.
use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, Instant};

use git2::{IndexAddOption, ObjectType, Oid, Repository, Tree};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// A file bigger than this isn't saved, and so is never put back.
const MAX_FILE_BYTES: u64 = 20 * 1024 * 1024;
/// How long one snapshot may take before the turn goes ahead without it.
const SNAPSHOT_TIME: Duration = Duration::from_secs(20);
/// Turns older than this can no longer be rewound with their files.
pub(super) const KEPT_DAYS: i64 = 30;
/// Folders nobody wants in a snapshot even without an ignore file.
const ALWAYS_IGNORED: &str = "node_modules/\n.DS_Store\n";

fn hex_key(text: &str, length: usize) -> String {
    let digest = Sha256::digest(text.as_bytes());
    digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
        .chars()
        .take(length)
        .collect()
}

/// The store a folder's trees live in.
fn store_dir(root: &Path, folder: &Path) -> PathBuf {
    let canonical = file_access::fs::canonicalize(folder).unwrap_or_else(|_| folder.to_path_buf());
    root.join("stores")
        .join(hex_key(&canonical.to_string_lossy(), 32))
}

fn git_text(error: git2::Error) -> String {
    error.message().to_string()
}

/// Opens (or makes) the folder's store with the folder as its working tree. The folder gets no
/// `.git` file of ours: the link lives only in this handle.
fn open(root: &Path, folder: &Path) -> Result<Repository, String> {
    let dir = store_dir(root, folder);
    let repository = match Repository::open_bare(&dir) {
        Ok(repository) => repository,
        Err(_) => {
            file_access::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
            let repository = Repository::init_bare(&dir).map_err(git_text)?;
            let mut config = repository.config().map_err(git_text)?;
            // The saved bytes are the file's own bytes, whatever the person's Git settings say.
            config.set_bool("core.autocrlf", false).map_err(git_text)?;
            config.set_str("core.safecrlf", "false").map_err(git_text)?;
            let info = dir.join("info");
            file_access::fs::create_dir_all(&info).map_err(|error| error.to_string())?;
            file_access::fs::write(info.join("exclude"), ALWAYS_IGNORED)
                .map_err(|error| error.to_string())?;
            repository
        }
    };
    repository.set_workdir(folder, false).map_err(git_text)?;
    Ok(repository)
}

fn too_big(folder: &Path, path: &Path) -> bool {
    file_access::fs::symlink_metadata(folder.join(path))
        .map(|meta| meta.is_file() && meta.len() > MAX_FILE_BYTES)
        .unwrap_or(false)
}

/// Saves the folder as it is now and returns its tree.
pub(super) fn snapshot(root: &Path, folder: &Path) -> Result<Oid, String> {
    // libgit2 reads the folder itself, so the file gate is asked first.
    file_access::check(folder, file_access::Access::Read).map_err(|error| error.to_string())?;
    let repository = open(root, folder)?;
    let mut index = repository.index().map_err(git_text)?;
    let started = Instant::now();
    let mut skipped: Vec<PathBuf> = Vec::new();
    {
        let mut check = |path: &Path, _spec: &[u8]| -> i32 {
            if started.elapsed() > SNAPSHOT_TIME {
                return -1;
            }
            // A folder inside the folder that is a repository of its own comes as `dir/`; its
            // files aren't the agent's to put back from here.
            if path.to_string_lossy().ends_with('/') {
                return 1;
            }
            if too_big(folder, path) {
                skipped.push(path.to_path_buf());
                return 1;
            }
            0
        };
        let failed = |error: git2::Error| {
            if started.elapsed() > SNAPSHOT_TIME {
                "The folder took too long to save.".to_string()
            } else {
                git_text(error)
            }
        };
        index
            .add_all(["*"], IndexAddOption::DEFAULT, Some(&mut check))
            .map_err(failed)?;
        index.update_all(["*"], Some(&mut check)).map_err(failed)?;
    }
    for path in skipped {
        let _ = index.remove_path(&path);
    }
    // Any link to such a repository a store already held goes too.
    let links: Vec<PathBuf> = index
        .iter()
        .filter(|entry| entry.mode == 0o160000)
        .map(|entry| PathBuf::from(String::from_utf8_lossy(&entry.path).into_owned()))
        .collect();
    for path in links {
        let _ = index.remove_path(&path);
    }
    index.write().map_err(git_text)?;
    index.write_tree().map_err(git_text)
}

fn tree<'r>(repository: &'r Repository, id: Oid) -> Result<Tree<'r>, String> {
    repository.find_tree(id).map_err(git_text)
}

/// The paths that differ between two trees.
fn changed(repository: &Repository, from: Oid, to: Oid) -> Result<BTreeSet<String>, String> {
    if from == to {
        return Ok(BTreeSet::new());
    }
    let (from, to) = (tree(repository, from)?, tree(repository, to)?);
    let diff = repository
        .diff_tree_to_tree(Some(&from), Some(&to), None)
        .map_err(git_text)?;
    let mut paths = BTreeSet::new();
    for delta in diff.deltas() {
        for file in [delta.old_file(), delta.new_file()] {
            if let Some(path) = file.path() {
                paths.insert(path.to_string_lossy().into_owned());
            }
        }
    }
    Ok(paths)
}

/// A file's blob and mode in a tree, or nothing when the tree hasn't it.
fn entry(tree: &Tree, path: &str) -> Option<(Oid, i32)> {
    let found = tree.get_path(Path::new(path)).ok()?;
    (found.kind() == Some(ObjectType::Blob)).then(|| (found.id(), found.filemode()))
}

/// One turn's two trees. `before` is missing when the folder couldn't be saved as it started,
/// `after` when the turn hasn't ended or Misty closed while it ran.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Turn {
    pub(super) before: Option<Oid>,
    pub(super) after: Option<Oid>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    /// `restore` writes the file back as it was; `remove` takes away one the turns made.
    pub change: &'static str,
    /// The person changed this file too (or nobody can tell who did), so it waits for their say.
    pub changed_by_you: bool,
}

/// What a rewind would do to one folder.
#[derive(Clone, Debug, Default, PartialEq)]
pub(super) struct Plan {
    /// The tree the folder goes back to.
    pub(super) target: Option<Oid>,
    pub(super) files: Vec<FileChange>,
    /// Some turn's start or end wasn't saved, so not every change could be placed.
    pub(super) incomplete: bool,
}

/// What a rewind of these turns (oldest first) would do, against the folder's tree `now`.
pub(super) fn plan(repository: &Repository, turns: &[Turn], now: Oid) -> Result<Plan, String> {
    let Some(target) = turns.first().and_then(|turn| turn.before) else {
        return Ok(Plan {
            incomplete: !turns.is_empty(),
            ..Plan::default()
        });
    };
    // The saved moments in order: each turn's start and end, then now. A span from a turn's
    // start to its own end is the agent's; one from an end to the next start (or now) is the
    // person's; one that skips a moment that wasn't saved could be either's.
    #[derive(Clone, Copy, PartialEq)]
    enum Moment {
        Start(usize),
        End(usize),
        Now,
    }
    let mut moments: Vec<(Moment, Oid)> = Vec::new();
    let mut incomplete = false;
    for (index, turn) in turns.iter().enumerate() {
        match turn.before {
            Some(id) => moments.push((Moment::Start(index), id)),
            None => incomplete = true,
        }
        match turn.after {
            Some(id) => moments.push((Moment::End(index), id)),
            None => incomplete = true,
        }
    }
    moments.push((Moment::Now, now));
    let (mut agent, mut person) = (BTreeSet::new(), BTreeSet::new());
    for pair in moments.windows(2) {
        let ((from, from_id), (to, to_id)) = (pair[0], pair[1]);
        let paths = changed(repository, from_id, to_id)?;
        match (from, to) {
            (Moment::Start(a), Moment::End(b)) if a == b => agent.extend(paths),
            (Moment::End(a), Moment::Start(b)) if b == a + 1 => person.extend(paths),
            (Moment::End(a), Moment::Now) if a + 1 == turns.len() => person.extend(paths),
            _ => {
                agent.extend(paths.iter().cloned());
                person.extend(paths);
            }
        }
    }
    let (target_tree, now_tree) = (tree(repository, target)?, tree(repository, now)?);
    let files = agent
        .into_iter()
        .filter_map(|path| {
            let (was, is) = (entry(&target_tree, &path), entry(&now_tree, &path));
            if was == is {
                return None;
            }
            Some(FileChange {
                change: if was.is_some() { "restore" } else { "remove" },
                changed_by_you: person.contains(&path),
                path,
            })
        })
        .collect();
    Ok(Plan {
        target: Some(target),
        files,
        incomplete,
    })
}

/// A path from a saved tree, which must stay inside the folder.
fn inside(path: &str) -> Option<&Path> {
    let path = Path::new(path);
    let plain = !path.as_os_str().is_empty()
        && path
            .components()
            .all(|part| matches!(part, Component::Normal(_)));
    plain.then_some(path)
}

/// The nearest folder above `path` that exists lies inside `folder`, so writing there can't follow
/// a link out of it.
fn stays_inside(folder: &Path, path: &Path) -> bool {
    let Ok(root) = file_access::fs::canonicalize(folder) else {
        return false;
    };
    let mut parent = folder.join(path);
    while parent.pop() {
        if let Ok(real) = file_access::fs::canonicalize(&parent) {
            return real.starts_with(&root);
        }
    }
    false
}

/// Takes away a file the turns made, then any folder that leaves empty (never the folder itself).
fn remove(folder: &Path, path: &Path) -> Result<(), String> {
    let full = folder.join(path);
    match file_access::fs::symlink_metadata(&full) {
        Ok(meta) if meta.is_dir() => return Err("A folder is there now.".into()),
        Ok(_) => file_access::fs::remove_file(&full).map_err(|error| error.to_string())?,
        Err(_) => return Ok(()),
    }
    let mut parent = full;
    while parent.pop() && parent != folder && parent.starts_with(folder) {
        if file_access::fs::remove_dir(&parent).is_err() {
            break;
        }
    }
    Ok(())
}

/// Puts these files of the folder back as `target` holds them. Returns the paths it couldn't.
pub(super) fn restore(
    root: &Path,
    folder: &Path,
    target: Oid,
    paths: &[String],
) -> Result<Vec<String>, String> {
    let repository = open(root, folder)?;
    let target_tree = tree(&repository, target)?;
    let mut failed = Vec::new();
    // Only where the file gate lets Misty write: a linked folder, never a shared folder only the
    // chat's sandboxed shell may change.
    let writable =
        |path: &Path| file_access::check(&folder.join(path), file_access::Access::Write).is_ok();
    let mut writes = Vec::new();
    for text in paths {
        let Some(path) = inside(text).filter(|path| stays_inside(folder, path) && writable(path))
        else {
            failed.push(text.clone());
            continue;
        };
        if entry(&target_tree, text).is_some() {
            writes.push(path.to_path_buf());
        } else if remove(folder, path).is_err() {
            failed.push(text.clone());
        }
    }
    if !writes.is_empty() {
        // Checkout writes each file with its mode, links as links, through the folder's own
        // attributes, the way the snapshot read it.
        let mut options = git2::build::CheckoutBuilder::new();
        options
            .force()
            .update_index(false)
            .disable_pathspec_match(true)
            .recreate_missing(true);
        for path in &writes {
            options.path(path);
        }
        if repository
            .checkout_tree(target_tree.as_object(), Some(&mut options))
            .is_err()
        {
            failed.extend(
                writes
                    .iter()
                    .map(|path| path.to_string_lossy().into_owned()),
            );
        }
    }
    Ok(failed)
}

/// Opens the folder's store for reading plans.
pub(super) fn repository(root: &Path, folder: &Path) -> Result<Repository, String> {
    open(root, folder)
}

/// One turn's record: whose it is, where it worked and its two trees.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub(super) struct Record {
    pub(super) run_id: String,
    pub(super) account: String,
    pub(super) conversation: String,
    pub(super) folder: String,
    pub(super) before: Option<String>,
    pub(super) after: Option<String>,
    pub(super) started_at: i64,
}

impl Record {
    pub(super) fn turn(&self) -> Turn {
        let id = |text: &Option<String>| text.as_deref().and_then(|text| Oid::from_str(text).ok());
        Turn {
            before: id(&self.before),
            after: id(&self.after),
        }
    }
}

fn record_path(root: &Path, run_id: &str) -> PathBuf {
    root.join("runs")
        .join(format!("{}.json", hex_key(run_id, 40)))
}

pub(super) fn read_record(root: &Path, run_id: &str) -> Option<Record> {
    let text = file_access::fs::read_to_string(record_path(root, run_id)).ok()?;
    serde_json::from_str(&text).ok()
}

pub(super) fn write_record(root: &Path, record: &Record) -> Result<(), String> {
    let path = record_path(root, &record.run_id);
    let text = serde_json::to_string(record).map_err(|error| error.to_string())?;
    file_access::fs::create_dir_all(root.join("runs")).map_err(|error| error.to_string())?;
    let partial = path.with_extension("json.partial");
    file_access::fs::write(&partial, text).map_err(|error| error.to_string())?;
    file_access::fs::rename(&partial, &path).map_err(|error| error.to_string())
}

/// Forgets turns older than `oldest`, and the stores of folders no remaining turn worked in.
pub(super) fn prune(root: &Path, oldest: i64) {
    let mut kept = BTreeSet::new();
    if let Ok(entries) = file_access::fs::read_dir(root.join("runs")) {
        for entry in entries.flatten() {
            let record = file_access::fs::read_to_string(entry.path())
                .ok()
                .and_then(|text| serde_json::from_str::<Record>(&text).ok());
            match record {
                Some(record) if record.started_at >= oldest => {
                    kept.insert(store_dir(root, Path::new(&record.folder)));
                }
                _ => {
                    let _ = file_access::fs::remove_file(entry.path());
                }
            }
        }
    }
    if let Ok(entries) = file_access::fs::read_dir(root.join("stores")) {
        for entry in entries.flatten() {
            if !kept.contains(&entry.path()) {
                let _ = file_access::fs::remove_dir_all(entry.path());
            }
        }
    }
}

#[cfg(test)]
#[path = "turn_snapshots_tests.rs"]
mod tests;
