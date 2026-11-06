//! The few places Misty looks at a path no grant covers. Each learns only what kind of thing a path
//! is, its real location, or a folder's names, sizes and dates, never a file's contents, and each
//! has its own function so reading this file lists them all.
use std::{
    fs, io,
    path::{Path, PathBuf},
};

/// A folder the person just chose, looked at before deciding whether it can be granted.
pub struct ChosenFolder {
    pub real: PathBuf,
    pub is_folder: bool,
}

/// Looks at a folder the person picked, before it's granted, or the home folder it's compared to.
pub fn chosen_folder(path: &Path) -> io::Result<ChosenFolder> {
    let real = fs::canonicalize(path)?;
    let is_folder = real.is_dir();
    Ok(ChosenFolder { real, is_folder })
}

/// Whether Windows marks a folder on the way to a chosen folder as hidden or the system's.
#[cfg(windows)]
pub fn chosen_folder_attributes(path: &Path) -> Option<u32> {
    use std::os::windows::fs::MetadataExt;
    fs::metadata(path)
        .ok()
        .map(|metadata| metadata.file_attributes())
}

/// Misty's own file picker: the real location of a folder the person browsed to.
pub fn picker_real_path(path: &Path) -> io::Result<PathBuf> {
    fs::canonicalize(path)
}

/// Misty's own file picker: a folder's listing, for the person choosing a file.
pub fn picker_list(path: &Path) -> io::Result<fs::ReadDir> {
    fs::read_dir(path)
}

/// Misty's own file picker: the size and dates of an entry it lists, without following links.
pub fn picker_entry(path: &Path) -> io::Result<fs::Metadata> {
    fs::symlink_metadata(path)
}

/// What the clipboard's file references are. They're paths the person copied in another app, and
/// Misty never opens them; the pasting app does.
pub struct ClipboardFile {
    pub is_folder: bool,
}

/// `None` when a copied path no longer exists.
pub fn clipboard_file(path: &Path) -> Option<ClipboardFile> {
    fs::metadata(path).ok().map(|metadata| ClipboardFile {
        is_folder: metadata.is_dir(),
    })
}

/// A file from Misty's own download history: its size, and whether it's still there, for the list.
pub fn recorded_download(path: &Path) -> Option<fs::Metadata> {
    fs::metadata(path).ok()
}

/// Whether a mounted drive takes writes, for the list of drives.
pub fn mount_is_writable(path: &Path) -> bool {
    fs::metadata(path).is_ok_and(|metadata| !metadata.permissions().readonly())
}

/// Whether a program Misty might start is there. Starting it is `Command`'s business; nothing is
/// read. Used to find the agent runtime and the Node that runs it.
pub fn program_is_installed(path: &Path) -> bool {
    path.is_file()
}
