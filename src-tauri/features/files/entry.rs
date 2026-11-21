//! One item as Files shows it (`FileEntry` in `src/features/files/api/disk.ts`), read through the
//! disk gate. Listing, search, Starred, Recent and tags all hand these back.
use std::path::Path;

use file_access::disk::fs_disk;
use serde::{Deserialize, Serialize};

/// A Finder tag: its name and Finder's color number (0 none, 1 gray, 2 green, 3 purple, 4 blue,
/// 5 yellow, 6 red, 7 orange).
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

#[derive(Clone, Debug, Serialize)]
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
    pub tags: Vec<FinderTag>,
}

pub(crate) fn millis(time: std::io::Result<std::time::SystemTime>) -> i64 {
    time.ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}

/// Folder extensions macOS shows as one item (an app, a library, a bundle).
const PACKAGES: &[&str] = &[
    "app", "bundle", "framework", "kext", "plugin", "photoslibrary", "musiclibrary", "tvlibrary",
    "fcpbundle", "logicx", "band", "pages", "numbers", "key", "xcodeproj", "xcworkspace",
    "playground", "rtfd", "scriptlibrary", "lproj",
];

pub(crate) fn extension(name: &str) -> Option<String> {
    let (stem, ext) = name.rsplit_once('.')?;
    (!stem.is_empty() && !ext.is_empty()).then(|| ext.to_ascii_lowercase())
}

/// Whether a folder with this name is a package, on macOS (elsewhere every folder is a folder).
pub(crate) fn is_package_name(name: &str) -> bool {
    cfg!(target_os = "macos")
        && extension(name).is_some_and(|ext| PACKAGES.contains(&ext.as_str()))
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

/// The entry for one path. A link is described as itself (kind `link`, its target), except that a
/// link to a folder lists as a folder, as Finder does, so it opens like one.
pub fn entry_for(path: &Path) -> std::io::Result<FileEntry> {
    let own = fs_disk::symlink_metadata(path)?;
    let name = super::display_name(path);
    let (meta, kind, link_target) = if own.file_type().is_symlink() {
        let target = fs_disk::read_link(path).ok().map(|target| target.display().to_string());
        match fs_disk::metadata(path) {
            Ok(followed) if followed.is_dir() => (followed, FileKind::Folder, target),
            Ok(followed) => (followed, FileKind::Link, target),
            Err(_) => (own, FileKind::Link, target),
        }
    } else if own.is_dir() {
        let kind = if is_package_name(&name) { FileKind::Package } else { FileKind::Folder };
        (own, kind, None)
    } else {
        (own, FileKind::File, None)
    };
    let folder = matches!(kind, FileKind::Folder);
    Ok(FileEntry {
        hidden: name.starts_with('.') || hidden_by_system(&meta),
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
}
