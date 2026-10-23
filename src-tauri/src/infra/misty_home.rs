//! Creates and maintains `~/.misty` on every launch.
//!
//! The home lives outside the app bundle, so installing or updating Misty never
//! replaces it. This module only ever adds what is missing and tightens
//! permissions; it never deletes. Paths retired by an earlier layout are moved
//! to the Trash (the Recycle Bin on Windows) so the user can still recover
//! them.
use crate::infra::paths;
use serde::{Deserialize, Serialize};
use std::{
    fs, io,
    path::{Path, PathBuf},
};

const LAYOUT_JSON: &str = include_str!("../../misty-home-layout.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Layout {
    layout_version: u32,
    directories: Vec<String>,
    /// Owner-only files; Windows keeps the whole home private instead.
    #[cfg(unix)]
    private_files: Vec<String>,
    retired: Vec<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HomeManifest {
    format: String,
    layout_version: u32,
}

#[derive(Debug, Default)]
pub struct HomeReport {
    pub created: Vec<String>,
    pub retired: Vec<String>,
    /// Retired paths that could not be moved and were left in place.
    pub kept: Vec<String>,
}

fn layout() -> Layout {
    serde_json::from_str(LAYOUT_JSON).expect("misty-home-layout.json is valid")
}

/// Ensures the signed-in user's Misty home exists and matches the current layout.
pub fn ensure_misty_home() -> io::Result<HomeReport> {
    let root = paths::misty_home_dir()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "no home directory"))?;
    ensure_at(&root, &Trash::for_this_system())
}

fn ensure_at(root: &Path, trash: &Trash) -> io::Result<HomeReport> {
    let layout = layout();
    let mut report = HomeReport::default();
    secure_dir(root, &mut report, "")?;

    if manifest_version(root) < layout.layout_version {
        retire(root, &layout.retired, trash, &mut report)?;
    }
    for relative in &layout.directories {
        secure_dir(&root.join(relative), &mut report, relative)?;
    }
    #[cfg(unix)]
    for relative in &layout.private_files {
        use std::os::unix::fs::PermissionsExt;
        let path = root.join(relative);
        if path.is_file() {
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
        }
    }
    if manifest_version(root) != layout.layout_version {
        misty_credential_store::set_layout_version(root, layout.layout_version)?;
        // The manifest an earlier layout kept as a file is superseded.
        let _ = fs::remove_file(root.join("home.json"));
    }
    Ok(report)
}

fn manifest_version(root: &Path) -> u32 {
    if let Ok(Some(version)) = misty_credential_store::layout_version(root) {
        return version;
    }
    // An earlier layout recorded it in `home.json`.
    fs::read(root.join("home.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<HomeManifest>(&bytes).ok())
        .filter(|manifest| manifest.format == "misty-home")
        .map_or(0, |manifest| manifest.layout_version)
}

fn retire(
    root: &Path,
    retired: &[String],
    trash: &Trash,
    report: &mut HomeReport,
) -> io::Result<()> {
    let present: Vec<&String> = retired
        .iter()
        .filter(|relative| root.join(relative).symlink_metadata().is_ok())
        .collect();
    if present.is_empty() {
        return Ok(());
    }
    let stamp = chrono::Local::now().format("%Y-%m-%d %H.%M.%S");
    for relative in present {
        let moved = match trash {
            Trash::Folder(folder) => {
                let target = folder
                    .join(format!("Misty retired files {stamp}"))
                    .join(relative);
                // A cross-volume Trash cannot take a rename; the path stays
                // rather than user data being copied and deleted.
                target
                    .parent()
                    .map_or(Ok(()), fs::create_dir_all)
                    .and_then(|_| fs::rename(root.join(relative), &target))
            }
            #[cfg(windows)]
            Trash::RecycleBin => recycle(&root.join(relative)),
        };
        match moved {
            Ok(()) => report.retired.push(relative.clone()),
            Err(_) => report.kept.push(relative.clone()),
        }
    }
    Ok(())
}

/// Where retired paths go, so the person can still recover them.
enum Trash {
    // Windows retires to the Recycle Bin; its tests still use a folder.
    #[cfg_attr(all(windows, not(test)), allow(dead_code))]
    Folder(PathBuf),
    #[cfg(windows)]
    RecycleBin,
}

impl Trash {
    fn for_this_system() -> Self {
        #[cfg(windows)]
        {
            Self::RecycleBin
        }
        #[cfg(not(windows))]
        {
            let home = paths::misty_data_root().unwrap_or_default();
            if cfg!(target_os = "macos") {
                Self::Folder(home.join(".Trash"))
            } else {
                // Linux has no portable user Trash without a desktop service;
                // retired paths stay inside the home, recoverable and out of
                // the live layout.
                Self::Folder(home.join(".misty").join(".retired"))
            }
        }
    }
}

/// Moves `path` to the Recycle Bin, where the person can restore it.
#[cfg(windows)]
fn recycle(path: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::{
        SHFileOperationW, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT, FO_DELETE,
        SHFILEOPSTRUCTW,
    };
    // A double-NUL-terminated list of one path.
    let from: Vec<u16> = path.as_os_str().encode_wide().chain([0, 0]).collect();
    // SAFETY: zeroed input, then the fields the operation reads.
    let mut operation: SHFILEOPSTRUCTW = unsafe { std::mem::zeroed() };
    operation.wFunc = FO_DELETE;
    operation.pFrom = from.as_ptr();
    operation.fFlags = (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_SILENT) as u16;
    // SAFETY: `from` outlives the call; nothing is shown to the person.
    let status = unsafe { SHFileOperationW(&mut operation) };
    if status != 0 || operation.fAnyOperationsAborted != 0 {
        return Err(io::Error::other(format!(
            "Recycle Bin refused {}",
            path.display()
        )));
    }
    Ok(())
}

fn secure_dir(path: &Path, report: &mut HomeReport, relative: &str) -> io::Result<()> {
    if !path.is_dir() {
        fs::create_dir_all(path)?;
        if !relative.is_empty() {
            report.created.push(relative.to_owned());
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    // The home's own DACL admits only its owner and SYSTEM; everything
    // inside inherits it.
    #[cfg(windows)]
    if relative.is_empty() {
        misty_credential_store::restrict_private_directory(path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests;
