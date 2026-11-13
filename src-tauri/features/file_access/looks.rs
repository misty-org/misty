//! The few places Misty looks at a path no grant covers. Each learns only what kind of thing a path
//! is or its real location, never a file's contents or a folder's listing, and each has its own
//! function so reading this file lists them all.
// Some of these only have callers on one platform.
#![cfg_attr(windows, allow(dead_code))]
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
