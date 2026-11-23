// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
//! Copy and Move into a folder, as Finder does them: first the names already there
//! (`files_conflicts`), which the person answers with Replace, Keep both or Skip, then the work
//! itself (`files_transfer`), on the ops queue, reporting its progress and stopping on Cancel. A
//! move on one drive is a rename that never replaces; across drives it is a checked copy, then the
//! original goes. A copy is a clone on APFS, and links are copied as links. Replace moves the item
//! that was there to the Trash first, so nothing is lost. Nothing goes into itself.
use std::{
    collections::HashMap,
    ffi::{OsStr, OsString},
    io,
    path::{Path, PathBuf},
};

use file_access::disk::{fs_disk, place, walk, CheckedDir};
use file_access::Access;
use serde::{Deserialize, Serialize};

use super::entry::{entry_for, FileEntry};
use super::listing::io_text;
use super::progress::Op;
use super::undo::{self, Change};
use super::{asked_path, asked_paths, blocking, display_name, failed, gated, person_window};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Failure {
    pub path: String,
    pub error: String,
}

impl Failure {
    pub fn new(path: &Path, error: impl std::fmt::Display) -> Self {
        Self {
            path: path.display().to_string(),
            error: failed(path, error),
        }
    }
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferResult {
    pub created: Vec<String>,
    pub failed: Vec<Failure>,
    pub cancelled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conflict {
    pub source: String,
    pub existing: FileEntry,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum Resolution {
    Replace,
    KeepBoth,
    Skip,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TransferOp {
    Copy,
    Move,
}

pub fn keep_both_name(dir: &Path, name: &str) -> PathBuf {
    let free = |candidate: &PathBuf| {
        matches!(
            fs_disk::symlink_metadata(candidate),
            Err(error) if error.kind() == io::ErrorKind::NotFound
        )
    };
    place::keep_both_names(name)
        .map(|candidate| dir.join(candidate))
        .find(free)
        .unwrap_or_else(|| dir.join(format!("{name} {}", uuid::Uuid::new_v4())))
}

#[cfg(unix)]
fn cross_device(error: &io::Error) -> bool {
    error.raw_os_error() == Some(libc::EXDEV)
}

#[cfg(windows)]
fn cross_device(error: &io::Error) -> bool {
    error.raw_os_error() == Some(17)
}

#[cfg(unix)]
fn same_volume(source: &Path, dir: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    match (gated::stat(source), fs_disk::metadata(dir)) {
        (Ok(source), Ok(dir)) => source.dev() == dir.dev(),
        _ => false,
    }
}

#[cfg(windows)]
fn same_volume(source: &Path, dir: &Path) -> bool {
    let drive = |path: &Path| {
        path.components()
            .next()
            .map(|first| first.as_os_str().to_string_lossy().to_lowercase())
    };
    drive(source).is_some() && drive(source) == drive(dir)
}

fn tree_size(path: &Path, op: &Op) -> u64 {
    walk::tree_size_checked(path, walk::WalkFor::Person, &|| op.cancelled())
        .map(|(bytes, _)| bytes)
        .unwrap_or(0)
}

fn same_folder(a: &CheckedDir, b: &CheckedDir) -> bool {
    let fold = |path: &Path| {
        if cfg!(target_os = "macos") {
            path.to_string_lossy().to_lowercase()
        } else {
            path.to_string_lossy().into_owned()
        }
    };
    fold(a.path()) == fold(b.path())
}

fn conflicts(sources: &[PathBuf], dir: &Path) -> Result<Vec<Conflict>, String> {
    let target = gated::dir(dir, Access::Read, walk::WalkFor::Person)
        .map_err(|error| failed(dir, io_text(&error)))?;
    let mut found = Vec::new();
    for source in sources {
        let Ok((parent, name)) = gated::parent(source, Access::Read) else {
            continue;
        };
        if same_folder(&parent, &target) {
            continue;
        }
        if gated::holds(&target, &name).unwrap_or(false) {
            if let Ok(existing) = entry_for(&target.path().join(&name)) {
                found.push(Conflict {
                    source: source.display().to_string(),
                    existing,
                });
            }
        }
    }
    Ok(found)
}

#[tauri::command]
pub async fn files_conflicts(
    webview: tauri::Webview,
    sources: Vec<String>,
    dir: String,
) -> Result<Vec<Conflict>, String> {
    person_window(&webview)?;
    let dir = asked_path(&dir)?;
    let sources = asked_paths(&sources)?;
    blocking(move || conflicts(&sources, &dir)).await
}

struct Job {
    op: TransferOp,
    target: CheckedDir,
    resolutions: HashMap<String, Resolution>,
}

struct Placed {
    path: PathBuf,
    skipped: Vec<(PathBuf, String)>,
}

fn copy_named(
    source: &Path,
    dir: &CheckedDir,
    names: &mut dyn Iterator<Item = OsString>,
    op: &mut Op,
) -> io::Result<Option<Placed>> {
    let item = display_name(source);
    for name in names {
        let copied = walk::copy_tree_checked(
            source,
            dir.path(),
            &name,
            walk::WalkFor::Person,
            &mut |bytes, _| {
                op.advance(bytes, &item);
                !op.cancelled()
            },
        );
        match copied {
            Ok(outcome) if outcome.cancelled => return Err(gated::cancelled()),
            Ok(outcome) => {
                return Ok(Some(Placed {
                    path: dir.path().join(&name),
                    skipped: outcome.skipped,
                }))
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "Every name like this one is taken.",
    ))
}

fn names_from(name: &OsStr, keep_both: bool) -> Box<dyn Iterator<Item = OsString>> {
    let text = name.to_string_lossy().into_owned();
    let first = std::iter::once(name.to_owned());
    let rest = place::keep_both_names(&text)
        .map(OsString::from)
        .collect::<Vec<_>>()
        .into_iter();
    if keep_both {
        Box::new(rest)
    } else {
        Box::new(first.chain(rest))
    }
}

fn move_one(
    source: &Path,
    parent: &CheckedDir,
    name: &OsStr,
    job: &Job,
    keep_both: bool,
    op: &mut Op,
) -> io::Result<Option<Placed>> {
    let moved = if keep_both {
        place::rename_keep_both(parent, name, &job.target, name)
    } else {
        match place::rename_new(parent, name, &job.target, name) {
            Ok(()) => Ok(name.to_owned()),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                place::rename_keep_both(parent, name, &job.target, name)
            }
            Err(error) => Err(error),
        }
    };
    match moved {
        Ok(landed) => {
            op.advance(0, &display_name(source));
            Ok(Some(Placed {
                path: job.target.path().join(landed),
                skipped: Vec::new(),
            }))
        }
        Err(error) if cross_device(&error) => {
            let placed = copy_named(source, &job.target, &mut names_from(name, keep_both), op)?;
            if let Some(placed) = &placed {
                if placed.skipped.is_empty() {
                    walk::remove_tree_checked(source, walk::WalkFor::Person, &mut |_| true)?;
                }
            }
            Ok(placed)
        }
        Err(error) => Err(error),
    }
}

fn replace_existing(job: &Job, source: &Path, name: &OsStr) -> io::Result<()> {
    let existing = job.target.path().join(name);
    if source.starts_with(&existing) || job.target.path().starts_with(source) {
        return Err(io::Error::other(
            "An item can't replace the folder it is in.",
        ));
    }
    let (_, failures) = super::trash::trash_paths(std::slice::from_ref(&existing));
    match failures.into_iter().next() {
        Some(failure) => Err(io::Error::other(failure.error)),
        None => Ok(()),
    }
}

fn transfer_one(job: &Job, source: &Path, op: &mut Op) -> io::Result<Option<Placed>> {
    let access = match job.op {
        TransferOp::Copy => Access::Read,
        TransferOp::Move => Access::Write,
    };
    let (parent, name) = gated::parent(source, access)?;
    if same_folder(&parent, &job.target) {
        return match job.op {
            TransferOp::Copy => {
                super::ops::copy_beside(source, job.target.path(), &mut |bytes, _| {
                    op.advance(bytes, &display_name(source));
                    !op.cancelled()
                })
                .and_then(|(path, outcome)| {
                    if outcome.cancelled {
                        Err(gated::cancelled())
                    } else {
                        Ok(Some(Placed {
                            path,
                            skipped: outcome.skipped,
                        }))
                    }
                })
            }
            TransferOp::Move => Ok(None),
        };
    }
    let mut keep_both = false;
    if gated::holds(&job.target, &name)? {
        match job.resolutions.get(&source.display().to_string()) {
            None | Some(Resolution::Skip) => return Ok(None),
            Some(Resolution::KeepBoth) => keep_both = true,
            Some(Resolution::Replace) => replace_existing(job, source, &name)?,
        }
    }
    match job.op {
        TransferOp::Copy => copy_named(source, &job.target, &mut names_from(&name, keep_both), op),
        TransferOp::Move => move_one(source, &parent, &name, job, keep_both, op),
    }
}

fn transfer(window: &str, job: Job, sources: &[PathBuf], op: &mut Op) -> TransferResult {
    let mut result = TransferResult::default();
    let mut moved = Vec::new();
    let mut copied = Vec::new();
    for source in sources {
        if op.cancelled() {
            result.cancelled = true;
            break;
        }
        match transfer_one(&job, source, op) {
            Ok(None) => {}
            Ok(Some(placed)) => {
                for (path, why) in &placed.skipped {
                    result.failed.push(Failure::new(path, why));
                }
                let target = placed.path;
                let whole_move = job.op == TransferOp::Move && placed.skipped.is_empty();
                match job.op {
                    TransferOp::Move if !whole_move => {
                        super::search::note_added(&target);
                        copied.push(target.clone());
                    }
                    TransferOp::Copy => {
                        super::search::note_added(&target);
                        copied.push(target.clone());
                    }
                    TransferOp::Move => {
                        super::search::note_renamed(source, &target);
                        moved.push((source.clone(), target.clone()));
                    }
                }
                result.created.push(target.display().to_string());
            }
            Err(error) if gated::is_cancel(&error) => {
                result.cancelled = true;
                break;
            }
            Err(error) => result.failed.push(Failure::new(source, io_text(&error))),
        }
    }
    if !copied.is_empty() {
        undo::record(window, "Copy", Change::Copied(copied));
    }
    if !moved.is_empty() {
        undo::record(window, "Move", Change::Moved(moved));
    }
    result
}

#[tauri::command]
pub async fn files_transfer(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    op: TransferOp,
    sources: Vec<String>,
    dir: String,
    resolutions: HashMap<String, Resolution>,
    op_id: String,
) -> Result<TransferResult, String> {
    person_window(&webview)?;
    let dir = asked_path(&dir)?;
    let sources = asked_paths(&sources)?;
    let label = match op {
        TransferOp::Copy => "Copying",
        TransferOp::Move => "Moving",
    };
    let attach = app.clone();
    super::runtime::run(&app, &webview, &op_id, label, move |progress| {
        super::trash::attach(&attach);
        let target = gated::dir(&dir, Access::Write, walk::WalkFor::Person)
            .map_err(|error| failed(&dir, io_text(&error)))?;
        let total: u64 = sources
            .iter()
            .filter(|source| op == TransferOp::Copy || !same_volume(source, target.path()))
            .map(|source| tree_size(source, &*progress))
            .sum();
        progress.set_total(total);
        let window = progress.window().to_owned();
        let job = Job {
            op,
            target,
            resolutions,
        };
        Ok(transfer(&window, job, &sources, progress))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keep_both_finds_the_first_free_name() {
        let dir = tempfile::tempdir().expect("temp folder");
        let dir = dir.path();
        file_access::fs::write(dir.join("photo.jpg"), b"x").unwrap();
        file_access::fs::write(dir.join("photo 2.jpg"), b"x").unwrap();
        assert_eq!(keep_both_name(dir, "photo.jpg"), dir.join("photo 3.jpg"));
        assert_eq!(keep_both_name(dir, "notes.txt"), dir.join("notes 2.txt"));
    }
}
