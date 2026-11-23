// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
//! One folder's items, as Files lists them: folders first, then by name without regard to case,
//! without the system's own junk files, hidden items only when asked. The folder is opened once
//! through the disk gate as a checked handle and read in one pass (names and their own stat);
//! closed places are left out, hidden items are dropped before any further work, a link is read
//! only through the handle, and a large folder is shaped on a few threads at once, as Kura does.
use std::{
    ffi::{OsStr, OsString},
    io,
    path::Path,
};

use file_access::{
    disk::{CheckedDir, DirItem, DiskFolder},
    Access,
};
use serde::Serialize;

use super::entry::{entry_in, hidden_name, Facts, FileEntry, FileKind};
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

pub(crate) fn sort_entries(entries: &mut [FileEntry]) {
    entries.sort_by_cached_key(|entry| {
        let rank = u8::from(!matches!(entry.kind, FileKind::Folder));
        (rank, entry.name.to_lowercase(), entry.name.clone())
    });
}

pub(crate) struct Lister<'a> {
    pub folder: &'a CheckedDir,
    pub gate: DiskFolder,
    pub shown: &'a Path,
    pub hidden: bool,
}

impl<'a> Lister<'a> {
    pub(crate) fn new(folder: &'a CheckedDir, shown: &'a Path, hidden: bool) -> io::Result<Self> {
        Ok(Self {
            gate: DiskFolder::open(folder.path())?,
            folder,
            shown,
            hidden,
        })
    }

    pub(crate) fn shows_name(&self, name: &OsStr) -> bool {
        let text = name.to_string_lossy();
        if is_os_junk(&text) || (!self.hidden && hidden_name(&text)) {
            return false;
        }
        self.gate.allows(&text, Access::Read)
    }

    fn shape(&self, name: &OsStr, facts: Facts) -> Option<FileEntry> {
        if !self.hidden && facts.system_hidden {
            return None;
        }
        Some(entry_in(self.folder, &self.gate, self.shown, name, facts))
    }

    pub(crate) fn from_item(&self, item: &DirItem) -> Option<FileEntry> {
        let system_hidden = super::entry::hidden_item(self.folder.path(), item);
        self.shape(&item.name, Facts::of_item(item, system_hidden))
    }

    pub(crate) fn one(&self, name: &OsStr) -> io::Result<Option<FileEntry>> {
        if !self.shows_name(name) {
            return Ok(None);
        }
        let meta = self.folder.metadata(name)?;
        Ok(self.shape(name, Facts::of_meta(&meta)))
    }

    pub(crate) fn all(&self) -> io::Result<Vec<(OsString, FileEntry)>> {
        let items: Vec<DirItem> = self
            .folder
            .read_dir()?
            .into_iter()
            .filter(|item| self.shows_name(&item.name))
            .collect();
        let read = |item: DirItem| self.from_item(&item).map(|entry| (item.name, entry));
        let threads = std::thread::available_parallelism()
            .map_or(1, |count| count.get())
            .min(MAX_THREADS);
        if items.len() < PARALLEL_FROM || threads < 2 {
            return Ok(items.into_iter().filter_map(read).collect());
        }
        let chunk = items.len().div_ceil(threads).max(1);
        let mut shares = Vec::new();
        let mut rest = items;
        while !rest.is_empty() {
            let tail = rest.split_off(rest.len().min(chunk));
            shares.push(rest);
            rest = tail;
        }
        Ok(std::thread::scope(|scope| {
            let workers: Vec<_> = shares
                .into_iter()
                .map(|share| {
                    let read = &read;
                    scope.spawn(move || share.into_iter().filter_map(read).collect::<Vec<_>>())
                })
                .collect();
            workers
                .into_iter()
                .flat_map(|worker| worker.join().unwrap_or_default())
                .collect()
        }))
    }
}

pub(crate) fn list_open(
    folder: &CheckedDir,
    shown: &Path,
    hidden: bool,
) -> io::Result<Vec<(OsString, FileEntry)>> {
    Lister::new(folder, shown, hidden)?.all()
}

pub(crate) fn list_folder(dir: &Path, hidden: bool) -> io::Result<Vec<FileEntry>> {
    let shown = file_access::disk::normalize_asked(dir)?;
    let folder = CheckedDir::open(&shown, Access::Read)?;
    let mut entries: Vec<FileEntry> = list_open(&folder, &shown, hidden)?
        .into_iter()
        .map(|(_, entry)| entry)
        .collect();
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

    #[allow(clippy::disallowed_methods)]
    fn scratch() -> (tempfile::TempDir, std::path::PathBuf) {
        let directory = tempfile::Builder::new()
            .prefix("misty-listing-")
            .tempdir()
            .unwrap();
        let root = std::fs::canonicalize(directory.path()).unwrap();
        (directory, root)
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

    #[allow(clippy::disallowed_methods)]
    #[test]
    fn hidden_items_and_junk_stay_out_unless_asked() {
        let (_directory, root) = scratch();
        std::fs::write(root.join("seen.txt"), b"x").unwrap();
        std::fs::write(root.join(".secret"), b"x").unwrap();
        std::fs::write(root.join(".DS_Store"), b"x").unwrap();
        let names = |hidden: bool| -> Vec<String> {
            list_folder(&root, hidden)
                .unwrap()
                .into_iter()
                .map(|entry| entry.name)
                .collect()
        };
        assert_eq!(names(false), ["seen.txt"]);
        assert_eq!(names(true), [".secret", "seen.txt"]);
    }

    #[cfg(unix)]
    #[allow(clippy::disallowed_methods)]
    #[test]
    fn a_link_is_listed_with_its_target_and_a_folder_link_as_a_folder() {
        let (_directory, root) = scratch();
        std::fs::create_dir_all(root.join("real")).unwrap();
        std::fs::write(root.join("file.txt"), b"hello").unwrap();
        std::os::unix::fs::symlink(root.join("real"), root.join("to-folder")).unwrap();
        std::os::unix::fs::symlink(root.join("file.txt"), root.join("to-file")).unwrap();
        std::os::unix::fs::symlink(root.join("gone"), root.join("dangling")).unwrap();
        let entries = list_folder(&root, false).unwrap();
        let find = |name: &str| entries.iter().find(|entry| entry.name == name).unwrap();
        assert_eq!(find("to-folder").kind, FileKind::Folder);
        assert_eq!(
            find("to-folder").link_target.as_deref(),
            Some(root.join("real").to_str().unwrap())
        );
        assert_eq!(find("to-file").kind, FileKind::Link);
        assert_eq!(find("to-file").size, 5);
        assert_eq!(find("dangling").kind, FileKind::Link);
        assert_eq!(
            find("file.txt").path,
            root.join("file.txt").display().to_string()
        );
    }

    #[cfg(target_os = "macos")]
    #[allow(clippy::disallowed_methods)]
    #[test]
    fn closed_places_are_left_out_of_a_listing() {
        let home = dirs::home_dir().expect("a home folder");
        let library = home.join("Library");
        std::fs::create_dir_all(library.join("Keychains")).unwrap();
        std::fs::create_dir_all(library.join("Fonts")).unwrap();
        let names: Vec<String> = list_folder(&library, true)
            .unwrap()
            .into_iter()
            .map(|entry| entry.name)
            .collect();
        assert!(names.contains(&"Fonts".to_owned()));
        assert!(!names.contains(&"Keychains".to_owned()));
    }
}
