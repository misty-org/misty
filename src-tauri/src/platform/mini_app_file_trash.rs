//! Persistent Trash belongs to the installed App/account/Space, not a WebView session.
use super::{file_jobs::FolderGrant, PermissionSet};
use cap_std::fs::Dir;
use serde_json::{json, Value};
use std::{
    path::Path,
    sync::{atomic::AtomicBool, Arc},
};

fn open(root: &Path, owner: &str) -> Result<Dir, String> {
    if owner.len() != 64 || !owner.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Trash requires an identified Host account and Space.".into());
    }
    std::fs::create_dir_all(root).map_err(|_| "Could not create App Trash storage.")?;
    let parent = Dir::open_ambient_dir(root, cap_std::ambient_authority())
        .map_err(|_| "Could not open App Trash storage.")?;
    match parent.create_dir(owner) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => return Err("Could not create this App's Trash.".into()),
    }
    if !parent
        .symlink_metadata(owner)
        .map_err(|_| "App Trash is unavailable.")?
        .is_dir()
    {
        return Err("App Trash must be a directory.".into());
    }
    parent
        .open_dir(owner)
        .map_err(|_| "Could not open this App's Trash.".into())
}

pub fn prepare(permissions: &PermissionSet) -> Result<(String, u64), String> {
    permissions.authorize("files.write")?;
    if permissions.folders.len() >= 32 {
        return Err("Close an open folder before opening Trash.".into());
    }
    Ok((
        permissions
            .owner_namespace
            .clone()
            .ok_or("Sign in before opening App Trash.")?,
        permissions.epoch,
    ))
}
pub fn open_directory(root: &Path, owner: &str) -> Result<Dir, String> {
    open(root, owner)
}
pub fn commit(
    permissions: &mut PermissionSet,
    owner: &str,
    epoch: u64,
    directory: Dir,
) -> Result<Value, String> {
    permissions.authorize("files.write")?;
    if permissions.epoch != epoch || permissions.owner_namespace.as_deref() != Some(owner) {
        return Err("App Trash permission changed.".into());
    }
    if permissions.folders.len() >= 32 {
        return Err("Close an open folder before opening Trash.".into());
    }
    let handle = uuid::Uuid::new_v4().to_string();
    permissions.folders.insert(
        handle.clone(),
        FolderGrant {
            released: Arc::new(AtomicBool::new(false)),
            directory: Arc::new(directory),
            name: "Trash".into(),
            writable: true,
        },
    );
    Ok(json!({"handle":handle,"name":"Trash","writable":true}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn trash_survives_reopening_and_is_scoped_to_owner() {
        let root = tempfile::tempdir().unwrap();
        let owner = "a".repeat(64);
        let first = open(root.path(), &owner).unwrap();
        first.write("kept.txt", b"recoverable").unwrap();
        drop(first);
        let reopened = open(root.path(), &owner).unwrap();
        assert_eq!(reopened.read("kept.txt").unwrap(), b"recoverable");
        let other = open(root.path(), &"b".repeat(64)).unwrap();
        assert!(!other.exists("kept.txt"));
        assert!(open(root.path(), "../other").is_err());
    }
    #[cfg(unix)]
    #[test]
    fn trash_rejects_a_symlink_in_place_of_its_directory() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let owner = "a".repeat(64);
        std::os::unix::fs::symlink(outside.path(), root.path().join(&owner)).unwrap();
        assert!(open(root.path(), &owner).is_err());
    }
}
