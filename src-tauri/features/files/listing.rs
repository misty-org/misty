// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
//! One folder's items, as Files lists them: folders first, then by name without regard to case,
//! without the system's own junk files, hidden items only when asked. The folder is checked by
//! the disk gate once; each item is then read from its directory entry, and a large folder is
//! read on a few threads at once, as Kura does, since one stat (and one tag read) per item is
//! what a big listing costs.
use std::{
    io,
    path::{Path, PathBuf},
};

use file_access::disk::{fs_disk, DiskFolder};
use serde::Serialize;

use super::entry::{extension, is_package_name, millis, FileEntry, FileKind};
use super::{asked_path, blocking, failed, person_window};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    pub path: String,
    pub entries: Vec<FileEntry>,
}

const PARALLEL_FROM: usize = 512;
const MAX_THREADS: usize = 8;

pub(crate) fn is_os_junk(name: &str) -> bool {
    [".DS_Store", "Thumbs.db", "desktop.ini"]
        .iter()
        .any(|junk| name.eq_ignore_ascii_case(junk))
}

pub(crate) fn io_text(error: &io::Error) -> String {
    match error.kind() {
        io::ErrorKind::NotFound => "It isn't there anymore.".to_owned(),
        io::ErrorKind::PermissionDenied if error.raw_os_error().is_some() => {
            "Misty can't open this folder.".to_owned()
        }
        io::ErrorKind::AlreadyExists => "An item with that name is already there.".to_owned(),
        _ => error.to_string(),
    }
}

#[cfg(windows)]
fn hidden_by_system(meta: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const HIDDEN: u32 = 0x2;
    const SYSTEM: u32 = 0x4;
    meta.file_attributes() & (HIDDEN | SYSTEM) != 0
}

#[cfg(target_os = "macos")]
fn hidden_by_system(meta: &std::fs::Metadata) -> bool {
    use std::os::macos::fs::MetadataExt;
    const UF_HIDDEN: u32 = 0x8000;
    meta.st_flags() & UF_HIDDEN != 0
}

#[cfg(all(unix, not(target_os = "macos")))]
fn hidden_by_system(_meta: &std::fs::Metadata) -> bool {
    false
}

fn entry_from(
    gate: &DiskFolder,
    item: &std::fs::DirEntry,
    name: String,
    path: PathBuf,
) -> Option<FileEntry> {
    let own = item.metadata().ok()?;
    let (meta, kind, link_target) = if own.file_type().is_symlink() {
        let target = fs_disk::read_link(&path)
            .ok()
            .map(|target| target.display().to_string());
        match fs_disk::metadata(&path) {
            Ok(followed) if followed.is_dir() => (followed, FileKind::Folder, target),
            Ok(followed) => (followed, FileKind::Link, target),
            Err(_) => (own, FileKind::Link, target),
        }
    } else if own.is_dir() {
        let kind = if is_package_name(&name) {
            FileKind::Package
        } else {
            FileKind::Folder
        };
        (own, kind, None)
    } else {
        (own, FileKind::File, None)
    };
    let folder = matches!(kind, FileKind::Folder);
    Some(FileEntry {
        hidden: name.starts_with('.') || hidden_by_system(&meta),
        ext: if folder { None } else { extension(&name) },
        size: if folder { 0 } else { meta.len() },
        modified_ms: millis(meta.modified()),
        created_ms: millis(meta.created()),
        tags: super::tags::read_tags_in(gate, &name, &path),
        path: path.display().to_string(),
        link_target,
        kind,
        name,
    })
}

pub(crate) fn sort_entries(entries: &mut [FileEntry]) {
    entries.sort_by_cached_key(|entry| {
        let rank = u8::from(!matches!(entry.kind, FileKind::Folder));
        (rank, entry.name.to_lowercase(), entry.name.clone())
    });
}

pub(crate) fn list_folder(dir: &Path, hidden: bool) -> io::Result<Vec<FileEntry>> {
    let items: Vec<(std::fs::DirEntry, String)> = fs_disk::read_dir(dir)?
        .flatten()
        .map(|item| {
            let name = item.file_name().to_string_lossy().into_owned();
            (item, name)
        })
        .filter(|(_, name)| !is_os_junk(name))
        .filter(|(_, name)| hidden || !name.starts_with('.'))
        .collect();
    let folder = DiskFolder::open(dir)?;
    let read = |(item, name): (std::fs::DirEntry, String)| {
        let path = dir.join(&name);
        entry_from(&folder, &item, name, path)
    };
    let threads = std::thread::available_parallelism()
        .map_or(1, |count| count.get())
        .min(MAX_THREADS);
    let mut entries: Vec<FileEntry> = if items.len() < PARALLEL_FROM || threads < 2 {
        items.into_iter().filter_map(read).collect()
    } else {
        let chunk = items.len().div_ceil(threads).max(1);
        let mut shares = Vec::new();
        let mut rest = items;
        while !rest.is_empty() {
            let tail = rest.split_off(rest.len().min(chunk));
            shares.push(rest);
            rest = tail;
        }
        std::thread::scope(|scope| {
            let workers: Vec<_> = shares
                .into_iter()
                .map(|share| {
                    scope.spawn(move || share.into_iter().filter_map(read).collect::<Vec<_>>())
                })
                .collect();
            workers
                .into_iter()
                .flat_map(|worker| worker.join().unwrap_or_default())
                .collect()
        })
    };
    if !hidden {
        entries.retain(|entry| !entry.hidden);
    }
    sort_entries(&mut entries);
    Ok(entries)
}

#[tauri::command]
pub async fn files_list(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    path: String,
    hidden: bool,
) -> Result<Listing, String> {
    person_window(&webview)?;
    let dir = asked_path(&path)?;
    blocking(move || {
        super::trash::attach(&app);
        let entries = list_folder(&dir, hidden).map_err(|error| failed(&dir, io_text(&error)))?;
        Ok(Listing { path, entries })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(name: &str, kind: FileKind) -> FileEntry {
        FileEntry {
            name: name.to_owned(),
            path: format!("/x/{name}"),
            kind,
            size: 0,
            modified_ms: 0,
            created_ms: 0,
            hidden: false,
            ext: None,
            link_target: None,
            tags: Vec::new(),
        }
    }

    #[test]
    fn folders_come_first_then_names_without_case() {
        let mut entries = vec![
            entry("beta.txt", FileKind::File),
            entry("Zeta", FileKind::Folder),
            entry("Alpha.txt", FileKind::File),
            entry("Safari.app", FileKind::Package),
            entry("alpha", FileKind::Folder),
        ];
        sort_entries(&mut entries);
        let names: Vec<&str> = entries.iter().map(|entry| entry.name.as_str()).collect();
        assert_eq!(
            names,
            ["alpha", "Zeta", "Alpha.txt", "beta.txt", "Safari.app"]
        );
    }

    #[test]
    fn the_systems_own_files_are_junk() {
        assert!(is_os_junk(".DS_Store"));
        assert!(is_os_junk("thumbs.db"));
        assert!(is_os_junk("Desktop.ini"));
        assert!(!is_os_junk(".gitignore"));
    }
}
