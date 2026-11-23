// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
//! New Folder, New File, Rename and Duplicate, as Finder does them: a name that is taken is
//! refused (never replaced), a rename that only changes case goes through a temporary name so a
//! disk that ignores case still takes it, and a duplicate is named "name copy.ext", then
//! "name copy 2.ext". Each one is noted for Undo and for the search index.
use std::{
    io,
    path::{Component, Path, PathBuf},
};

use file_access::disk::fs_disk;

use super::entry::{entry_for, FileEntry};
use super::listing::io_text;
use super::undo::{self, Change};
use super::{asked_path, blocking, failed, person_window};

pub(crate) fn valid_name(name: &str) -> Result<&str, String> {
    if name.trim().is_empty() {
        return Err("Enter a name.".into());
    }
    if name.contains('\0') || name.contains('/') || (cfg!(windows) && name.contains('\\')) {
        return Err("A name can't hold a slash.".into());
    }
    let mut parts = Path::new(name).components();
    match (parts.next(), parts.next()) {
        (Some(Component::Normal(_)), None) => Ok(name),
        _ => Err("Choose a different name.".into()),
    }
}

fn taken(name: &str) -> String {
    format!("The name {name} is already taken.")
}

pub(crate) fn rename_path(from: &Path, to: &Path) -> io::Result<()> {
    let case_only = from.parent() == to.parent()
        && from.file_name() != to.file_name()
        && from
            .file_name()
            .map(|name| name.to_string_lossy().to_lowercase())
            == to
                .file_name()
                .map(|name| name.to_string_lossy().to_lowercase());
    if case_only {
        let parent = from.parent().unwrap_or(from);
        let step = parent.join(format!(".misty-rename-{}", uuid::Uuid::new_v4()));
        fs_disk::rename(from, &step)?;
        return fs_disk::rename(&step, to).inspect_err(|_| {
            let _ = fs_disk::rename(&step, from);
        });
    }
    if fs_disk::exists(to) {
        return Err(io::Error::from(io::ErrorKind::AlreadyExists));
    }
    fs_disk::rename(from, to)
}

fn folder(dir: &Path) -> Result<(), String> {
    if fs_disk::is_dir(dir) {
        Ok(())
    } else {
        Err(failed(dir, "That isn't a folder."))
    }
}

fn entry(path: &Path) -> Result<FileEntry, String> {
    entry_for(path).map_err(|error| failed(path, io_text(&error)))
}

fn create(dir: &Path, name: &str, make_folder: bool) -> Result<FileEntry, String> {
    let name = valid_name(name)?;
    folder(dir)?;
    let path = dir.join(name);
    if fs_disk::exists(&path) {
        return Err(taken(name));
    }
    let made = if make_folder {
        fs_disk::create_dir(&path)
    } else {
        fs_disk::create_new(&path).map(drop)
    };
    made.map_err(|error| match error.kind() {
        io::ErrorKind::AlreadyExists => taken(name),
        _ => failed(&path, io_text(&error)),
    })?;
    undo::record(
        if make_folder {
            "New Folder"
        } else {
            "New File"
        },
        Change::Created(path.clone()),
    );
    super::search::note_added(&path);
    entry(&path)
}

#[tauri::command]
pub async fn files_create_folder(
    webview: tauri::Webview,
    dir: String,
    name: String,
) -> Result<FileEntry, String> {
    person_window(&webview)?;
    let dir = asked_path(&dir)?;
    blocking(move || create(&dir, &name, true)).await
}

#[tauri::command]
pub async fn files_create_file(
    webview: tauri::Webview,
    dir: String,
    name: String,
) -> Result<FileEntry, String> {
    person_window(&webview)?;
    let dir = asked_path(&dir)?;
    blocking(move || create(&dir, &name, false)).await
}

fn rename(path: &Path, name: &str) -> Result<FileEntry, String> {
    let name = valid_name(name)?;
    let parent = path
        .parent()
        .ok_or_else(|| failed(path, "A drive can't be renamed here."))?;
    fs_disk::symlink_metadata(path).map_err(|error| failed(path, io_text(&error)))?;
    let target = parent.join(name);
    if target == path {
        return entry(path);
    }
    rename_path(path, &target).map_err(|error| match error.kind() {
        io::ErrorKind::AlreadyExists => taken(name),
        _ => failed(path, io_text(&error)),
    })?;
    undo::record(
        "Rename",
        Change::Renamed {
            from: path.to_path_buf(),
            to: target.clone(),
        },
    );
    super::search::note_renamed(path, &target);
    entry(&target)
}

#[tauri::command]
pub async fn files_rename(
    webview: tauri::Webview,
    path: String,
    name: String,
) -> Result<FileEntry, String> {
    person_window(&webview)?;
    let path = asked_path(&path)?;
    blocking(move || rename(&path, &name)).await
}

pub(crate) fn copy_name(name: &str, folder: bool, counter: u32) -> String {
    let suffix = if counter <= 1 {
        " copy".to_owned()
    } else {
        format!(" copy {counter}")
    };
    match name.rsplit_once('.') {
        Some((stem, ext)) if !folder && !stem.is_empty() && !ext.is_empty() => {
            format!("{stem}{suffix}.{ext}")
        }
        _ => format!("{name}{suffix}"),
    }
}

pub(crate) fn copy_target(source: &Path, dir: &Path) -> io::Result<PathBuf> {
    let name = super::display_name(source);
    let folder = fs_disk::symlink_metadata(source)?.is_dir();
    (1..=9999u32)
        .map(|counter| dir.join(copy_name(&name, folder, counter)))
        .find(|candidate| !fs_disk::exists(candidate))
        .ok_or_else(|| io::Error::other("There are too many copies already."))
}

fn duplicate(paths: &[PathBuf]) -> Result<Vec<String>, String> {
    let mut made = Vec::new();
    let mut problem = None;
    for source in paths {
        let Some(dir) = source.parent() else {
            problem.get_or_insert_with(|| failed(source, "A drive can't be duplicated."));
            continue;
        };
        let copied = copy_target(source, dir)
            .and_then(|target| super::transfer::copy_plain(source, &target).map(|()| target));
        match copied {
            Ok(target) => {
                super::search::note_added(&target);
                made.push(target);
            }
            Err(error) => {
                problem.get_or_insert_with(|| failed(source, io_text(&error)));
            }
        }
    }
    if !made.is_empty() {
        undo::record("Duplicate", Change::Copied(made.clone()));
    }
    match (made.is_empty(), problem) {
        (true, Some(error)) => Err(error),
        _ => Ok(made.iter().map(|path| path.display().to_string()).collect()),
    }
}

#[tauri::command]
pub async fn files_duplicate(
    webview: tauri::Webview,
    paths: Vec<String>,
) -> Result<Vec<String>, String> {
    person_window(&webview)?;
    let paths = paths
        .iter()
        .map(|path| asked_path(path))
        .collect::<Result<Vec<_>, _>>()?;
    blocking(move || duplicate(&paths)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copies_are_named_as_finder_names_them() {
        assert_eq!(copy_name("report.pdf", false, 1), "report copy.pdf");
        assert_eq!(copy_name("report.pdf", false, 2), "report copy 2.pdf");
        assert_eq!(copy_name("Makefile", false, 1), "Makefile copy");
        assert_eq!(copy_name(".bashrc", false, 1), ".bashrc copy");
        assert_eq!(copy_name("src.v2", true, 3), "src.v2 copy 3");
    }

    #[test]
    fn a_name_is_one_item() {
        assert!(valid_name("notes.txt").is_ok());
        assert!(valid_name("  ").is_err());
        assert!(valid_name("a/b").is_err());
        assert!(valid_name("..").is_err());
        assert!(valid_name(".").is_err());
    }
}
