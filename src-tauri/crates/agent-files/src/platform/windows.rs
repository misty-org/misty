//! Windows: names opened relative to the folder before them, never following
//! a link (see `misty-windows-files`), and renames that never replace.
use std::{
    ffi::OsStr,
    fs::{DirEntry, File},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use misty_windows_files::{
    self as files, Disposition, Expect, Kind, DELETE_ACCESS, FILE_GENERIC_READ, FOLDER_ACCESS,
};
use windows_sys::Win32::Storage::FileSystem::FILE_READ_ATTRIBUTES;

use crate::{err, Fingerprint, Result};

/// Volume, file ID, size and modification time. NTFS file IDs fit the low
/// 64 bits.
pub(crate) fn fingerprint(file: &File) -> Result<Fingerprint> {
    let (volume, id) = files::identity(file).map_err(err)?;
    let metadata = file.metadata().map_err(err)?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .unwrap_or_default();
    Ok(Fingerprint {
        device: volume,
        inode: u64::from_le_bytes(id[..8].try_into().unwrap_or_default()),
        size: metadata.len(),
        modified: modified.as_secs() as i64,
        nanos: i64::from(modified.subsec_nanos()),
    })
}

pub(crate) fn child(dir: &File, name: &str, directory: bool) -> Result<File> {
    let (access, expect) = if directory {
        (FOLDER_ACCESS, Expect::Folder)
    } else {
        (FILE_GENERIC_READ, Expect::Anything)
    };
    files::open(dir, OsStr::new(name), access, Disposition::Existing, expect).map_err(err)
}

pub(crate) fn absent(dir: &File, name: &str) -> Result<()> {
    match files::kind_at(dir, OsStr::new(name)).map_err(err)? {
        None => Ok(()),
        Some(_) => Err("Destination already exists; nothing was overwritten".into()),
    }
}

/// Moves `source` in `from` to `destination` in `to`, failing rather than
/// replacing anything already there. A link at the source moves as a link.
pub(crate) fn rename_exclusive(
    from: &File,
    source: &str,
    to: &File,
    destination: &str,
) -> Result<()> {
    let entry = files::open_entry(
        from,
        OsStr::new(source),
        DELETE_ACCESS | FILE_READ_ATTRIBUTES,
    )
    .map_err(err)?;
    files::rename(&entry, to, OsStr::new(destination), false).map_err(err)
}

/// The chosen folder itself; a link there is refused.
pub(crate) fn open_root(path: &Path) -> Result<File> {
    let parent = path.parent().ok_or("Choose a folder, not a disk")?;
    let name = path.file_name().ok_or("Choose a folder, not a disk")?;
    let parent = files::open_folder(parent).map_err(err)?;
    files::open(
        &parent,
        name,
        FOLDER_ACCESS,
        Disposition::Existing,
        Expect::Folder,
    )
    .map_err(err)
}

pub(crate) fn make_folder(dir: &File, name: &str) -> Result<()> {
    files::open(
        dir,
        OsStr::new(name),
        FOLDER_ACCESS,
        Disposition::New,
        Expect::Folder,
    )
    .map(drop)
    .map_err(err)
}

/// Removes an empty folder; a link or file there is left alone.
pub(crate) fn remove_folder(dir: &File, name: &str) -> Result<()> {
    let entry = files::open_entry(dir, OsStr::new(name), DELETE_ACCESS | FILE_READ_ATTRIBUTES)
        .map_err(err)?;
    if files::kind(&entry).map_err(err)? != Kind::Folder {
        return Err("Created folder changed; undo stopped".into());
    }
    files::delete(&entry).map_err(err)
}

/// NTFS journals folder changes itself; a folder handle can't be flushed
/// without write access to it.
pub(crate) fn sync_folder(_dir: &File) -> Result<()> {
    Ok(())
}

pub(crate) fn is_link(entry: &DirEntry) -> bool {
    entry
        .file_type()
        .map(|kind| kind.is_symlink())
        .unwrap_or(true)
        || std::fs::symlink_metadata(entry.path()).map_or(true, |metadata| {
            use std::os::windows::fs::MetadataExt;
            // A junction is a reparse point std doesn't call a symlink.
            const REPARSE_POINT: u32 = 0x400;
            metadata.file_attributes() & REPARSE_POINT != 0 && metadata.is_dir()
        })
}

/// A path without the `\\?\` prefix canonicalizing adds.
pub(crate) fn plain(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    match text.strip_prefix(r"\\?\UNC\") {
        Some(rest) => PathBuf::from(format!(r"\\{rest}")),
        None => PathBuf::from(text.strip_prefix(r"\\?\").unwrap_or(&text)),
    }
}

/// Whole disks, the home folder, app data and Windows' own folders are never
/// organization scopes.
pub(crate) fn refused_scope(canonical: &Path) -> bool {
    if canonical.parent().is_none() {
        return true;
    }
    let lower = canonical.to_string_lossy().to_lowercase();
    let inside = |folder: &std::ffi::OsString| {
        let folder = folder.to_string_lossy().to_lowercase();
        lower == folder || lower.starts_with(&format!("{folder}\\"))
    };
    let system = [
        "SystemRoot",
        "ProgramFiles",
        "ProgramFiles(x86)",
        "ProgramData",
    ]
    .iter()
    .filter_map(std::env::var_os)
    .any(|folder| inside(&folder));
    // Temporary folders are fine, as on macOS; the rest of AppData belongs
    // to apps.
    let temporary = canonical.starts_with(plain(&std::env::temp_dir()));
    let home = std::env::var_os("USERPROFILE").is_some_and(|home| {
        let home = PathBuf::from(home);
        canonical == home
            || home.starts_with(canonical)
            || (canonical.starts_with(home.join("AppData")) && !temporary)
    });
    system || home
}
