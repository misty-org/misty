// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
//! New Folder, New File, Rename and Duplicate, as Finder does them: a name that is taken is
//! refused (never replaced), a rename that only changes case is allowed on a disk that ignores
//! case, and a duplicate is named "name copy.ext", then "name copy 2.ext". Each one is noted for
//! Undo and for the search index.
use std::{
    ffi::OsString,
    io,
    path::{Component, Path, PathBuf},
};

use file_access::disk::{place, walk};
use file_access::Access;

use super::entry::{entry_for, FileEntry};
use super::listing::io_text;
use super::undo::{self, Change};
use super::{asked_path, asked_paths, blocking, failed, gated, person_window};

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

fn entry(path: &Path) -> Result<FileEntry, String> {
    entry_for(path).map_err(|error| failed(path, io_text(&error)))
}

fn create(window: &str, dir: &Path, name: &str, make_folder: bool) -> Result<FileEntry, String> {
    let name = valid_name(name)?;
    let folder = gated::dir(dir, Access::Write, walk::WalkFor::Person)
        .map_err(|error| failed(dir, io_text(&error)))?;
    let wanted = OsString::from(name);
    let made = if make_folder {
        folder.create_dir(&wanted)
    } else {
        folder.create_file(&wanted).map(drop)
    };
    let path = folder.path().join(name);
    made.map_err(|error| match error.kind() {
        io::ErrorKind::AlreadyExists => taken(name),
        _ => failed(&path, io_text(&error)),
    })?;
    undo::record(
        window,
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
    let window = webview.label().to_owned();
    blocking(move || create(&window, &dir, &name, true)).await
}

#[tauri::command]
pub async fn files_create_file(
    webview: tauri::Webview,
    dir: String,
    name: String,
) -> Result<FileEntry, String> {
    person_window(&webview)?;
    let dir = asked_path(&dir)?;
    let window = webview.label().to_owned();
    blocking(move || create(&window, &dir, &name, false)).await
}

fn rename(window: &str, path: &Path, name: &str) -> Result<FileEntry, String> {
    let name = valid_name(name)?;
    let (folder, from) =
        gated::parent(path, Access::Write).map_err(|error| failed(path, io_text(&error)))?;
    folder
        .metadata(&from)
        .map_err(|error| failed(path, io_text(&error)))?;
    let to = OsString::from(name);
    if to == from {
        return entry(path);
    }
    place::rename_new(&folder, &from, &folder, &to).map_err(|error| match error.kind() {
        io::ErrorKind::AlreadyExists => taken(name),
        _ => failed(path, io_text(&error)),
    })?;
    let target = path.with_file_name(name);
    undo::record(
        window,
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
    let window = webview.label().to_owned();
    blocking(move || rename(&window, &path, &name)).await
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

pub(crate) fn copy_beside(
    source: &Path,
    dir: &Path,
    progress: &mut dyn FnMut(u64, &Path) -> bool,
) -> io::Result<(PathBuf, walk::CopyOutcome)> {
    let name = super::display_name(source);
    let folder = gated::stat(source)?.is_dir();
    for counter in 1..=9999u32 {
        let candidate = copy_name(&name, folder, counter);
        match walk::copy_tree_checked(
            source,
            dir,
            std::ffi::OsStr::new(&candidate),
            walk::WalkFor::Person,
            progress,
        ) {
            Ok(outcome) => return Ok((dir.join(candidate), outcome)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::other("There are too many copies already."))
}

fn duplicate(window: &str, paths: &[PathBuf]) -> Result<Vec<String>, String> {
    let mut made = Vec::new();
    let mut problem = None;
    for source in paths {
        let Some(dir) = source.parent() else {
            problem.get_or_insert_with(|| failed(source, "A drive can't be duplicated."));
            continue;
        };
        match copy_beside(source, dir, &mut |_, _| true) {
            Ok((target, _)) => {
                super::search::note_added(&target);
                made.push(target);
            }
            Err(error) => {
                problem.get_or_insert_with(|| failed(source, io_text(&error)));
            }
        }
    }
    if !made.is_empty() {
        undo::record(window, "Duplicate", Change::Copied(made.clone()));
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
    let paths = asked_paths(&paths)?;
    let window = webview.label().to_owned();
    blocking(move || duplicate(&window, &paths)).await
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
