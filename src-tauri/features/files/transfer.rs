// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
//! Copy and Move into a folder, as Finder does them: first the names already there
//! (`files_conflicts`), which the person answers with Replace, Keep both or Skip, then the work
//! itself (`files_transfer`), reporting its progress and stopping between files on Cancel. A move
//! on one drive is a rename; across drives it is a copy, then the original goes. A copy is the
//! system's own (a clone on APFS), and links are copied as links. Replace moves the item that was
//! there to the Trash first, so nothing is lost. Nothing goes into itself.
use std::{
    collections::HashMap,
    io,
    path::{Path, PathBuf},
};

use file_access::disk::{check_disk, fs_disk};
use file_access::Access;
use serde::{Deserialize, Serialize};

use super::entry::{entry_for, FileEntry};
use super::listing::io_text;
use super::progress::Op;
use super::undo::{self, Change};
use super::{asked_path, blocking, display_name, failed, person_window};

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

fn counter_base(stem: &str) -> (&str, u32) {
    match stem.rsplit_once(' ') {
        Some((base, number)) if !base.is_empty() && !number.starts_with('0') => {
            match number.parse::<u32>() {
                Ok(number) if number >= 2 => (base, number + 1),
                _ => (stem, 2),
            }
        }
        _ => (stem, 2),
    }
}

fn numbered(name: &str, n: u32) -> String {
    let (stem, ext) = match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() && !ext.is_empty() => (stem, Some(ext)),
        _ => (name, None),
    };
    let (base, _) = counter_base(stem);
    match ext {
        Some(ext) => format!("{base} {n}.{ext}"),
        None => format!("{base} {n}"),
    }
}

pub fn keep_both_name(dir: &Path, name: &str) -> PathBuf {
    let stem = name.rsplit_once('.').map_or(name, |(stem, ext)| {
        if stem.is_empty() || ext.is_empty() {
            name
        } else {
            stem
        }
    });
    let (_, start) = counter_base(stem);
    (start..start.saturating_add(10_000))
        .map(|n| dir.join(numbered(name, n)))
        .find(|candidate| !fs_disk::exists(candidate))
        .unwrap_or_else(|| dir.join(numbered(name, start.saturating_add(10_000))))
}

fn cancelled() -> io::Error {
    io::Error::new(io::ErrorKind::Interrupted, "Cancelled.")
}

fn is_cancel(error: &io::Error) -> bool {
    error.kind() == io::ErrorKind::Interrupted
}

#[cfg(unix)]
fn same_volume(source: &Path, dir: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    match (fs_disk::symlink_metadata(source), fs_disk::metadata(dir)) {
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

#[cfg(unix)]
fn cross_device(error: &io::Error) -> bool {
    error.raw_os_error() == Some(libc::EXDEV)
}

#[cfg(windows)]
fn cross_device(error: &io::Error) -> bool {
    error.raw_os_error() == Some(17)
}

fn copy_link(source: &Path, target: &Path) -> io::Result<()> {
    let points = fs_disk::read_link(source)?;
    fs_disk::symlink(points, target)
}

pub(crate) fn copy_plain(source: &Path, target: &Path) -> io::Result<()> {
    let meta = fs_disk::symlink_metadata(source)?;
    if meta.file_type().is_symlink() {
        copy_link(source, target)
    } else if meta.is_dir() {
        fs_disk::copy_tree(source, target)
    } else {
        fs_disk::copy(source, target).map(drop)
    }
}

pub(crate) fn remove_item(path: &Path) -> io::Result<()> {
    let meta = fs_disk::symlink_metadata(path)?;
    if meta.is_dir() && !meta.file_type().is_symlink() {
        fs_disk::remove_dir_all(path)
    } else {
        fs_disk::remove_file(path)
    }
}

fn copy_tree_tracked(source: &Path, target: &Path, op: &mut Op) -> io::Result<()> {
    fs_disk::create_dir(target)?;
    for item in fs_disk::read_dir(source)? {
        if op.cancelled() {
            return Err(cancelled());
        }
        let item = item?;
        let (from, to) = (item.path(), target.join(item.file_name()));
        let kind = item.file_type()?;
        if kind.is_symlink() {
            copy_link(&from, &to)?;
        } else if kind.is_dir() {
            copy_tree_tracked(&from, &to, op)?;
        } else if kind.is_file() {
            let bytes = fs_disk::copy(&from, &to)?;
            op.advance(bytes, &display_name(&from));
        }
    }
    if let Ok(meta) = fs_disk::metadata(source) {
        let _ = fs_disk::set_permissions(target, meta.permissions());
    }
    Ok(())
}

fn copy_tracked(source: &Path, target: &Path, op: &mut Op) -> io::Result<()> {
    let meta = fs_disk::symlink_metadata(source)?;
    let copied = if meta.file_type().is_symlink() {
        copy_link(source, target)
    } else if meta.is_dir() {
        if cfg!(target_os = "macos") && target.parent().is_some_and(|dir| same_volume(source, dir))
        {
            let copied = fs_disk::copy_tree(source, target);
            op.advance(tree_size(source), &display_name(source));
            copied
        } else {
            copy_tree_tracked(source, target, op)
        }
    } else {
        fs_disk::copy(source, target).map(|bytes| op.advance(bytes, &display_name(source)))
    };
    if copied.is_err() && fs_disk::exists(target) {
        let _ = remove_item(target);
    }
    copied
}

pub fn move_or_copy(source: &Path, target: &Path) -> io::Result<()> {
    match fs_disk::rename(source, target) {
        Ok(()) => Ok(()),
        Err(error) if cross_device(&error) => {
            copy_plain(source, target)?;
            remove_item(source)
        }
        Err(error) => Err(error),
    }
}

fn move_tracked(source: &Path, target: &Path, op: &mut Op) -> io::Result<()> {
    let dir = target.parent().unwrap_or(target);
    if same_volume(source, dir) {
        match fs_disk::rename(source, target) {
            Ok(()) => {
                op.advance(0, &display_name(source));
                return Ok(());
            }
            Err(error) if !cross_device(&error) => return Err(error),
            Err(_) => {}
        }
    }
    copy_tracked(source, target, op)?;
    remove_item(source)
}

fn tree_size(path: &Path) -> u64 {
    if check_disk(path, Access::Read).is_err() {
        return 0;
    }
    walkdir::WalkDir::new(path)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter_map(|item| item.metadata().ok())
        .filter(|meta| meta.is_file())
        .map(|meta| meta.len())
        .sum()
}

fn real_item(path: &Path) -> io::Result<PathBuf> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("A drive can't be moved."))?;
    let name = path
        .file_name()
        .ok_or_else(|| io::Error::other("That item has no name."))?;
    Ok(fs_disk::canonicalize(parent)?.join(name))
}

fn landing(source: &Path, real_dir: &Path) -> io::Result<Option<PathBuf>> {
    let real = real_item(source)?;
    if real.parent() == Some(real_dir) {
        return Ok(None);
    }
    if fs_disk::is_dir(source) && real_dir.starts_with(fs_disk::canonicalize(source)?) {
        return Err(io::Error::other("A folder can't go inside itself."));
    }
    let name = source
        .file_name()
        .ok_or_else(|| io::Error::other("That item has no name."))?;
    Ok(Some(real_dir.join(name)))
}

fn conflicts(sources: &[PathBuf], dir: &Path) -> Result<Vec<Conflict>, String> {
    let real_dir = fs_disk::canonicalize(dir).map_err(|error| failed(dir, io_text(&error)))?;
    let mut found = Vec::new();
    for source in sources {
        let Ok(Some(target)) = landing(source, &real_dir) else {
            continue;
        };
        if fs_disk::exists(&target) {
            if let Ok(existing) = entry_for(&target) {
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
    let sources = sources
        .iter()
        .map(|path| asked_path(path))
        .collect::<Result<Vec<_>, _>>()?;
    blocking(move || conflicts(&sources, &dir)).await
}

struct Job {
    op: TransferOp,
    real_dir: PathBuf,
    resolutions: HashMap<String, Resolution>,
}

fn target_for(job: &Job, source: &Path) -> io::Result<Option<PathBuf>> {
    let Some(target) = landing(source, &job.real_dir)? else {
        return match job.op {
            TransferOp::Copy => super::ops::copy_target(source, &job.real_dir).map(Some),
            TransferOp::Move => Ok(None),
        };
    };
    if !fs_disk::exists(&target) {
        return Ok(Some(target));
    }
    match job.resolutions.get(&source.display().to_string()) {
        None | Some(Resolution::Skip) => Ok(None),
        Some(Resolution::KeepBoth) => {
            Ok(Some(keep_both_name(&job.real_dir, &display_name(&target))))
        }
        Some(Resolution::Replace) => {
            if real_item(source)?.starts_with(&target) {
                return Err(io::Error::other(
                    "An item can't replace the folder it is in.",
                ));
            }
            let (_, failures) = super::trash::trash_paths(std::slice::from_ref(&target));
            match failures.into_iter().next() {
                Some(failure) => Err(io::Error::other(failure.error)),
                None => Ok(Some(target)),
            }
        }
    }
}

fn transfer(job: Job, sources: &[PathBuf], op: &mut Op) -> TransferResult {
    let mut result = TransferResult::default();
    let mut moved = Vec::new();
    let mut copied = Vec::new();
    for source in sources {
        if op.cancelled() {
            result.cancelled = true;
            break;
        }
        let target = match target_for(&job, source) {
            Ok(Some(target)) => target,
            Ok(None) => continue,
            Err(error) => {
                result.failed.push(Failure::new(source, io_text(&error)));
                continue;
            }
        };
        let done = match job.op {
            TransferOp::Copy => copy_tracked(source, &target, op),
            TransferOp::Move => move_tracked(source, &target, op),
        };
        match done {
            Ok(()) => {
                match job.op {
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
            Err(error) if is_cancel(&error) => {
                result.cancelled = true;
                break;
            }
            Err(error) => result.failed.push(Failure::new(source, io_text(&error))),
        }
    }
    if !copied.is_empty() {
        undo::record("Copy", Change::Copied(copied));
    }
    if !moved.is_empty() {
        undo::record("Move", Change::Moved(moved));
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
    let sources = sources
        .iter()
        .map(|path| asked_path(path))
        .collect::<Result<Vec<_>, _>>()?;
    blocking(move || {
        super::trash::attach(&app);
        if !fs_disk::is_dir(&dir) {
            return Err(failed(&dir, "That isn't a folder."));
        }
        let real_dir =
            fs_disk::canonicalize(&dir).map_err(|error| failed(&dir, io_text(&error)))?;
        let label = match op {
            TransferOp::Copy => "Copying",
            TransferOp::Move => "Moving",
        };
        let mut progress = Op::start(&app, &op_id, label, 0);
        let total: u64 = sources
            .iter()
            .filter(|source| op == TransferOp::Copy || !same_volume(source, &real_dir))
            .map(|source| tree_size(source))
            .sum();
        progress.set_total(total);
        let job = Job {
            op,
            real_dir,
            resolutions,
        };
        Ok(transfer(job, &sources, &mut progress))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keep_both_numbers_names_as_finder_does() {
        assert_eq!(numbered("photo.jpg", 2), "photo 2.jpg");
        assert_eq!(numbered("photo 2.jpg", 3), "photo 3.jpg");
        assert_eq!(numbered("Folder", 2), "Folder 2");
        assert_eq!(numbered(".bashrc", 2), ".bashrc 2");
        assert_eq!(counter_base("photo 2"), ("photo", 3));
        assert_eq!(counter_base("photo"), ("photo", 2));
        assert_eq!(counter_base("Chapter 1"), ("Chapter 1", 2));
        assert_eq!(counter_base("track 07"), ("track 07", 2));
    }

    #[test]
    fn keep_both_finds_the_first_free_name() {
        let dir = std::env::temp_dir().join(format!("misty-keep-both-{}", uuid::Uuid::new_v4()));
        file_access::fs::create_dir_all(&dir).unwrap();
        file_access::fs::write(dir.join("photo.jpg"), b"x").unwrap();
        file_access::fs::write(dir.join("photo 2.jpg"), b"x").unwrap();
        assert_eq!(keep_both_name(&dir, "photo.jpg"), dir.join("photo 3.jpg"));
        assert_eq!(keep_both_name(&dir, "notes.txt"), dir.join("notes 2.txt"));
        file_access::fs::remove_dir_all(&dir).unwrap();
    }
}
