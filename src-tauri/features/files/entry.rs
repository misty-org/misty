use std::{ffi::OsStr, path::Path, time::SystemTime};

use file_access::disk::{fs_disk, CheckedDir, DirItem, DiskFolder, ItemKind};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct FinderTag {
    pub name: String,
    pub color: u8,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FileKind {
    Folder,
    File,
    Link,
    Package,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub kind: FileKind,
    pub size: u64,
    pub modified_ms: i64,
    pub created_ms: i64,
    pub hidden: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ext: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link_target: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<FinderTag>,
}

pub(crate) fn millis(time: std::io::Result<std::time::SystemTime>) -> i64 {
    time.ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}

fn millis_of(time: Option<SystemTime>) -> i64 {
    millis(time.ok_or_else(|| std::io::Error::other("no time")))
}

const PACKAGES: &[&str] = &[
    "app",
    "bundle",
    "framework",
    "kext",
    "plugin",
    "photoslibrary",
    "musiclibrary",
    "tvlibrary",
    "fcpbundle",
    "logicx",
    "band",
    "pages",
    "numbers",
    "key",
    "xcodeproj",
    "xcworkspace",
    "playground",
    "rtfd",
    "scriptlibrary",
    "lproj",
];

pub(crate) fn extension(name: &str) -> Option<String> {
    let (stem, ext) = name.rsplit_once('.')?;
    (!stem.is_empty() && !ext.is_empty()).then(|| ext.to_ascii_lowercase())
}

pub(crate) fn is_package_name(name: &str) -> bool {
    cfg!(target_os = "macos") && extension(name).is_some_and(|ext| PACKAGES.contains(&ext.as_str()))
}

#[cfg(windows)]
fn hidden_by_system(meta: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const HIDDEN: u32 = 0x2;
    const SYSTEM: u32 = 0x4;
    meta.file_attributes() & (HIDDEN | SYSTEM) != 0
}

#[cfg(target_os = "macos")]
const UF_HIDDEN: u32 = 0x8000;

#[cfg(target_os = "macos")]
fn hidden_by_system(meta: &std::fs::Metadata) -> bool {
    use std::os::macos::fs::MetadataExt;
    meta.st_flags() & UF_HIDDEN != 0
}

#[cfg(all(unix, not(target_os = "macos")))]
fn hidden_by_system(_meta: &std::fs::Metadata) -> bool {
    false
}

#[cfg(target_os = "macos")]
pub(crate) fn hidden_item(_folder: &Path, item: &DirItem) -> bool {
    item.flags & UF_HIDDEN != 0
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn hidden_item(folder: &Path, item: &DirItem) -> bool {
    hidden_at(&folder.join(&item.name))
}

#[cfg(windows)]
pub(crate) fn hidden_at(real: &Path) -> bool {
    fs_disk::symlink_metadata(real).is_ok_and(|meta| hidden_by_system(&meta))
}

#[cfg(all(unix, not(target_os = "macos")))]
pub(crate) fn hidden_at(_real: &Path) -> bool {
    false
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct Facts {
    pub kind: ItemKind,
    pub len: u64,
    pub modified: Option<SystemTime>,
    pub created: Option<SystemTime>,
    pub system_hidden: bool,
}

impl Facts {
    pub(crate) fn of_item(item: &DirItem, system_hidden: bool) -> Self {
        Self {
            kind: item.kind,
            len: item.len,
            modified: item.modified,
            created: item.created,
            system_hidden,
        }
    }

    pub(crate) fn of_meta(meta: &std::fs::Metadata) -> Self {
        let kind = if meta.file_type().is_symlink() {
            ItemKind::Link
        } else if meta.is_dir() {
            ItemKind::Dir
        } else if meta.is_file() {
            ItemKind::File
        } else {
            ItemKind::Other
        };
        Self {
            kind,
            len: meta.len(),
            modified: meta.modified().ok(),
            created: meta.created().ok(),
            system_hidden: hidden_by_system(meta),
        }
    }
}

pub(crate) fn hidden_name(name: &str) -> bool {
    name.starts_with('.')
}

pub(crate) fn entry_in(
    folder: &CheckedDir,
    tags: &DiskFolder,
    shown: &Path,
    name: &OsStr,
    facts: Facts,
) -> FileEntry {
    let text = name.to_string_lossy().into_owned();
    let path = shown.join(name);
    let (kind, len, modified, created, link_target) = match facts.kind {
        ItemKind::Link => {
            let target = folder
                .read_link(name)
                .ok()
                .map(|target| target.display().to_string());
            match fs_disk::metadata(&path) {
                Ok(followed) => {
                    let kind = if followed.is_dir() {
                        FileKind::Folder
                    } else {
                        FileKind::Link
                    };
                    (
                        kind,
                        followed.len(),
                        followed.modified().ok(),
                        followed.created().ok(),
                        target,
                    )
                }
                Err(_) => (
                    FileKind::Link,
                    facts.len,
                    facts.modified,
                    facts.created,
                    target,
                ),
            }
        }
        ItemKind::Dir if is_package_name(&text) => (
            FileKind::Package,
            facts.len,
            facts.modified,
            facts.created,
            None,
        ),
        ItemKind::Dir => (FileKind::Folder, 0, facts.modified, facts.created, None),
        ItemKind::File | ItemKind::Other => (
            FileKind::File,
            facts.len,
            facts.modified,
            facts.created,
            None,
        ),
    };
    let folder_kind = matches!(kind, FileKind::Folder);
    FileEntry {
        hidden: hidden_name(&text) || facts.system_hidden,
        ext: if folder_kind { None } else { extension(&text) },
        size: if folder_kind { 0 } else { len },
        modified_ms: millis_of(modified),
        created_ms: millis_of(created),
        tags: super::tags::read_tags_in(tags, &text, &folder.path().join(name)),
        path: path.display().to_string(),
        link_target,
        kind,
        name: text,
    }
}

pub fn entry_for(path: &Path) -> std::io::Result<FileEntry> {
    let own = fs_disk::symlink_metadata(path)?;
    let name = super::display_name(path);
    let (meta, kind, link_target) = if own.file_type().is_symlink() {
        let target = fs_disk::read_link(path)
            .ok()
            .map(|target| target.display().to_string());
        match fs_disk::metadata(path) {
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
    Ok(FileEntry {
        hidden: hidden_name(&name) || hidden_by_system(&meta),
        ext: if folder { None } else { extension(&name) },
        size: if folder { 0 } else { meta.len() },
        modified_ms: millis(meta.modified()),
        created_ms: millis(meta.created()),
        tags: super::tags::read_tags(path),
        path: path.display().to_string(),
        link_target,
        kind,
        name,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extensions_are_lowercase_and_need_a_stem() {
        assert_eq!(extension("Report.PDF").as_deref(), Some("pdf"));
        assert_eq!(extension(".bashrc"), None);
        assert_eq!(extension("Makefile"), None);
        assert_eq!(extension("archive.tar.gz").as_deref(), Some("gz"));
    }

    #[test]
    fn packages_are_a_macos_idea() {
        assert_eq!(is_package_name("Safari.app"), cfg!(target_os = "macos"));
        assert!(!is_package_name("Projects"));
    }

    #[test]
    fn an_entry_without_tags_leaves_them_out() {
        let entry = FileEntry {
            name: "a.txt".into(),
            path: "/x/a.txt".into(),
            kind: FileKind::File,
            size: 1,
            modified_ms: 0,
            created_ms: 0,
            hidden: false,
            ext: Some("txt".into()),
            link_target: None,
            tags: Vec::new(),
        };
        let text = serde_json::to_string(&entry).unwrap();
        assert!(!text.contains("tags"));
    }
}
