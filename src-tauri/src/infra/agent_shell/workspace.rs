//! Each chat's private folder. It lasts until the chat is deleted, has a size limit, and no other
//! chat can see it.
use crate::infra::file_access::fs;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use super::SharedFolder;

/// The most one workspace may hold before commands are refused.
const MAX_WORKSPACE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
/// The name a chat's shared folder has inside its workspace. The agent never needs the real path.
pub(super) const SHARED_FOLDER_LINK: &str = "shared-folder";

fn root(misty_dir: &Path) -> PathBuf {
    misty_dir.join("agent-workspaces")
}

/// A key's folder. Keys come through the server, so they're hashed and can't name another path.
fn folder(misty_dir: &Path, key: &str) -> PathBuf {
    root(misty_dir).join(hex::encode(Sha256::digest(key.as_bytes())))
}

/// Creates the workspace if needed and refuses one that's over its limit. Returns its real path,
/// which is what an OS profile compares against.
pub(super) fn prepare(misty_dir: &Path, key: &str) -> Result<PathBuf, String> {
    if key.trim().is_empty() {
        return Err("shell_workspace_missing".into());
    }
    let path = folder(misty_dir, key);
    fs::create_dir_all(&path).map_err(|_| "shell_workspace_unavailable".to_owned())?;
    restrict_to_owner(&path);
    let path = fs::canonicalize(&path).map_err(|_| "shell_workspace_unavailable".to_owned())?;
    if folder_bytes(&path) > MAX_WORKSPACE_BYTES {
        return Err("shell_workspace_full".into());
    }
    fs::create_dir_all(path.join(".tmp")).map_err(|_| "shell_workspace_unavailable".to_owned())?;
    Ok(path)
}

#[cfg(unix)]
fn restrict_to_owner(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o700));
}

#[cfg(not(unix))]
fn restrict_to_owner(_path: &Path) {}

/// Points the workspace's link at the chat's shared folder, or removes a stale one. A link an agent
/// changed gets nothing from it: the OS profile decides by real path, not by this link.
pub(super) fn link_folder(
    workspace: &Path,
    folder: Option<&SharedFolder>,
) -> Result<Option<&'static str>, String> {
    let link = workspace.join(SHARED_FOLDER_LINK);
    if let Ok(metadata) = fs::symlink_metadata(&link) {
        let removed = if metadata.is_dir() && !metadata.file_type().is_symlink() {
            fs::remove_dir_all(&link)
        } else {
            remove_link(&link)
        };
        removed.map_err(|_| "shell_workspace_unavailable".to_owned())?;
    }
    let Some(folder) = folder else {
        return Ok(None);
    };
    make_link(&folder.root, &link).map_err(|_| "shell_folder_unavailable".to_owned())?;
    Ok(Some(SHARED_FOLDER_LINK))
}

#[cfg(unix)]
fn remove_link(link: &Path) -> std::io::Result<()> {
    fs::remove_file(link)
}

#[cfg(windows)]
fn remove_link(link: &Path) -> std::io::Result<()> {
    fs::remove_dir(link).or_else(|_| fs::remove_file(link))
}

#[cfg(unix)]
fn make_link(target: &Path, link: &Path) -> std::io::Result<()> {
    fs::symlink(target, link)
}

#[cfg(windows)]
fn make_link(target: &Path, link: &Path) -> std::io::Result<()> {
    fs::symlink_dir(target, link)
}

/// The bytes held by the files under `folder`, without following links.
fn folder_bytes(folder: &Path) -> u64 {
    fs::read_dir(folder)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| match entry.file_type() {
            Ok(kind) if kind.is_dir() => folder_bytes(&entry.path()),
            Ok(kind) if kind.is_file() => entry.metadata().map(|m| m.len()).unwrap_or(0),
            _ => 0,
        })
        .sum()
}

/// Deletes a chat's workspace, when the chat is deleted. Files a person's shared folder holds aren't
/// touched: `remove_dir_all` removes a link rather than following it.
pub fn forget(misty_dir: &Path, key: &str) -> Result<(), String> {
    let path = folder(misty_dir, key);
    match fs::remove_dir_all(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("shell_workspace_unavailable".into()),
    }
}
