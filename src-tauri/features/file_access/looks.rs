#![cfg_attr(windows, allow(dead_code))]
use std::{
    fs, io,
    path::{Path, PathBuf},
};

pub struct ChosenFolder {
    pub real: PathBuf,
    pub is_folder: bool,
}

pub fn chosen_folder(path: &Path) -> io::Result<ChosenFolder> {
    let real = fs::canonicalize(path)?;
    let is_folder = real.is_dir();
    Ok(ChosenFolder { real, is_folder })
}
