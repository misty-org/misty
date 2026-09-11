//! Private directory staging for app-orchestrated tree copies. The app receives
//! folder handles; destination paths and exclusive publication stay in the host.
use super::{
    directories::{decode_name, encode_name},
    file_jobs::FolderGrant,
    PermissionSet,
};
use cap_std::fs::{Dir, DirBuilder, DirBuilderExt, MetadataExt};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    ffi::{CString, OsStr, OsString},
    os::{fd::AsRawFd, unix::ffi::OsStrExt},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

pub struct TreeDraft {
    destination: Arc<Dir>,
    destination_released: Arc<AtomicBool>,
    staging: Arc<Dir>,
    container: OsString,
    identity: (u64, u64),
    root_identity: (u64, u64),
    desired: OsString,
    conflicts: bool,
    released: Arc<AtomicBool>,
    handles: HashMap<Vec<OsString>, String>,
    child_flags: Vec<std::sync::Weak<AtomicBool>>,
    writers: Vec<std::sync::Weak<std::sync::Mutex<Value>>>,
}
impl Drop for TreeDraft {
    fn drop(&mut self) {
        self.released.store(true, Ordering::Release);
        for flag in &self.child_flags {
            if let Some(flag) = flag.upgrade() {
                flag.store(true, Ordering::Release);
            }
        }
        let destination = self.destination.clone();
        let name = self.container.clone();
        let identity = self.identity;
        // Cleanup can touch a large tree; never hold the permission registry lock.
        std::thread::spawn(move || {
            if destination
                .symlink_metadata(&name)
                .is_ok_and(|m| m.is_dir() && (m.dev(), m.ino()) == identity)
            {
                let _ = destination.remove_dir_all(&name);
            }
        });
    }
}
fn key<'a>(params: &'a Value, name: &str) -> Result<&'a str, String> {
    params
        .get(name)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty() && s.len() <= 4098)
        .ok_or("Missing tree copy handle.".into())
}
fn rename_exclusive(from: &Dir, source: &OsStr, to: &Dir, target: &OsStr) -> std::io::Result<()> {
    let source = CString::new(source.as_bytes())?;
    let target = CString::new(target.as_bytes())?;
    if unsafe {
        libc::renameatx_np(
            from.as_raw_fd(),
            source.as_ptr(),
            to.as_raw_fd(),
            target.as_ptr(),
            libc::RENAME_EXCL,
        )
    } == 0
    {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}
pub(super) fn execute(
    p: &mut PermissionSet,
    method: &str,
    params: &Value,
) -> Result<Value, String> {
    p.authorize("files.write")?;
    p.authorize("files.read")?;
    if method == "files.treeBegin" {
        if p.tree_drafts.len() >= 4 {
            return Err("Finish an earlier folder copy first.".into());
        }
        let destination = p
            .folders
            .get(key(params, "destinationDirectory")?)
            .ok_or("Choose the destination folder.")?;
        if !destination.writable || destination.released.load(Ordering::Acquire) {
            return Err("Destination access is unavailable.".into());
        }
        let desired = decode_name(key(params, "entry")?)?;
        let conflicts = match params.get("conflict").and_then(Value::as_str) {
            None | Some("error") => false,
            Some("rename") => true,
            _ => return Err("Invalid conflict policy.".into()),
        };
        let container = OsString::from(format!(".misty-tree-{}", uuid::Uuid::new_v4()));
        destination
            .directory
            .create_dir_with(&container, DirBuilder::new().mode(0o700))
            .map_err(|_| "Could not stage the folder copy.")?;
        let staging = Arc::new(
            destination
                .directory
                .open_dir(&container)
                .map_err(|_| "Staging folder unavailable.")?,
        );
        let metadata = staging
            .dir_metadata()
            .map_err(|_| "Staging metadata unavailable.")?;
        let mut draft = TreeDraft {
            destination: destination.directory.clone(),
            destination_released: destination.released.clone(),
            staging: staging.clone(),
            container,
            identity: (metadata.dev(), metadata.ino()),
            root_identity: (0, 0),
            desired,
            conflicts,
            released: Arc::new(AtomicBool::new(false)),
            handles: HashMap::new(),
            child_flags: Vec::new(),
            writers: Vec::new(),
        };
        staging
            .create_dir_with("entry", DirBuilder::new().mode(0o700))
            .map_err(|_| "Could not stage the copied folder.")?;
        let root = staging
            .open_dir("entry")
            .map_err(|_| "Staged folder unavailable.")?;
        let metadata = root
            .dir_metadata()
            .map_err(|_| "Staged folder metadata unavailable.")?;
        draft.root_identity = (metadata.dev(), metadata.ino());
        let id = uuid::Uuid::new_v4().to_string();
        p.tree_drafts.insert(id.clone(), draft);
        return Ok(json!({"draft":id}));
    }
    let id = key(params, "draft")?;
    if method == "files.treeDiscard" {
        if let Some(draft) = p.tree_drafts.remove(id) {
            for handle in draft.handles.values() {
                p.folders.remove(handle);
            }
        }
        return Ok(Value::Null);
    }
    let draft = p
        .tree_drafts
        .get_mut(id)
        .ok_or("This folder copy belongs to another view or has closed.")?;
    if draft.destination_released.load(Ordering::Acquire) || draft.released.load(Ordering::Acquire)
    {
        return Err("Folder copy access was revoked.".into());
    }
    let metadata = draft
        .staging
        .symlink_metadata("entry")
        .map_err(|_| "Staged folder unavailable.")?;
    if !metadata.is_dir() || (metadata.dev(), metadata.ino()) != draft.root_identity {
        return Err("Staged folder was replaced.".into());
    }
    if method == "files.treeSymlink" {
        let handle = key(params, "directory")?;
        if !draft.handles.values().any(|owned| owned == handle) {
            return Err("The link destination is outside this tree copy.".into());
        }
        let directory = p
            .folders
            .get(handle)
            .ok_or("The staging folder was released.")?;
        if directory.released.load(Ordering::Acquire) {
            return Err("The staging folder was released.".into());
        }
        let name = decode_name(key(params, "entry")?)?;
        let target = params
            .get("target")
            .and_then(Value::as_array)
            .filter(|bytes| !bytes.is_empty() && bytes.len() <= 16 * 1024)
            .ok_or("Invalid symbolic link target.")?;
        let bytes = target
            .iter()
            .map(|value| {
                value
                    .as_u64()
                    .filter(|byte| *byte > 0 && *byte <= 255)
                    .map(|byte| byte as u8)
                    .ok_or("Invalid symbolic link byte.")
            })
            .collect::<Result<Vec<_>, _>>()?;
        directory
            .directory
            .symlink_contents(OsStr::from_bytes(&bytes), &name)
            .map_err(|_| "Could not copy the symbolic link; existing entries were preserved.")?;
        return Ok(Value::Null);
    }
    if method == "files.treeDirectory" {
        let path = params
            .get("entries")
            .and_then(Value::as_array)
            .filter(|p| p.len() <= 256)
            .ok_or("Invalid copy subfolder.")?;
        let names = path
            .iter()
            .map(|v| decode_name(v.as_str().ok_or("Invalid copy subfolder.")?))
            .collect::<Result<Vec<_>, String>>()?;
        draft
            .handles
            .retain(|_, handle| p.folders.contains_key(handle));
        draft.child_flags.retain(|flag| flag.strong_count() > 0);
        if let Some(handle) = draft.handles.get(&names) {
            return Ok(json!({"handle":handle}));
        }
        if p.folders.len() >= 64 {
            return Err("Close a folder before copying another directory.".into());
        }
        let mut directory = draft
            .staging
            .open_dir("entry")
            .map_err(|_| "Staged folder unavailable.")?;
        for name in &names {
            match directory.create_dir_with(name, DirBuilder::new().mode(0o700)) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(_) => return Err("Could not stage a subfolder.".into()),
            }
            directory = directory
                .open_dir(name)
                .map_err(|_| "Staged subfolder is unavailable.")?;
        }
        let handle = uuid::Uuid::new_v4().to_string();
        let released = Arc::new(AtomicBool::new(false));
        draft.child_flags.push(Arc::downgrade(&released));
        // Temporary, copy-only grants; dropping the draft revokes every live child.
        p.folders.insert(
            handle.clone(),
            FolderGrant {
                directory: Arc::new(directory),
                released,
                name: names
                    .last()
                    .unwrap_or(&draft.desired)
                    .to_string_lossy()
                    .into_owned(),
                writable: true,
            },
        );
        draft.handles.insert(names, handle.clone());
        return Ok(json!({"handle":handle}));
    }
    if method != "files.treeCommit" {
        return Err("Unknown folder copy operation.".into());
    }
    if draft
        .writers
        .iter()
        .filter_map(|writer| writer.upgrade())
        .any(|writer| {
            writer
                .lock()
                .map(|state| state["status"] == "running")
                .unwrap_or(true)
        })
    {
        return Err("Wait for the folder's file copies to finish before publishing.".into());
    }
    let mut published = None;
    for number in 0..if draft.conflicts { 1000 } else { 1 } {
        let name = if number == 0 {
            draft.desired.clone()
        } else {
            let suffix = format!(" (copy {number})");
            let bytes = draft.desired.as_bytes();
            let end = bytes.len().min(255 - suffix.len());
            let mut end = end;
            if let Ok(text) = std::str::from_utf8(bytes) {
                while !text.is_char_boundary(end) {
                    end -= 1;
                }
            }
            let mut bytes = bytes[..end].to_vec();
            bytes.extend_from_slice(suffix.as_bytes());
            OsStr::from_bytes(&bytes).to_owned()
        };
        match rename_exclusive(
            &draft.staging,
            OsStr::new("entry"),
            &draft.destination,
            &name,
        ) {
            Ok(()) => {
                published = Some(name);
                break;
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists && draft.conflicts => {}
            Err(_) => {
                return Err(
                    "Could not publish the folder copy; existing files were preserved.".into(),
                )
            }
        }
    }
    let name = published.ok_or("Too many copies already use this folder name.")?;
    let draft = p.tree_drafts.remove(id).unwrap();
    for handle in draft.handles.values() {
        p.folders.remove(handle);
    }
    Ok(
        json!({"entry":encode_name(&name),"name":name.to_string_lossy(),"kind":"directory","sourceRemoved":false}),
    )
}

pub(super) fn record_transfer(
    p: &mut PermissionSet,
    directory: &str,
    state: &Arc<std::sync::Mutex<Value>>,
) {
    for draft in p.tree_drafts.values_mut() {
        if draft.handles.values().any(|handle| handle == directory) {
            draft.writers.retain(|writer| {
                writer.upgrade().is_some_and(|writer| {
                    writer
                        .lock()
                        .map(|state| state["status"] == "running")
                        .unwrap_or(true)
                })
            });
            draft.writers.push(Arc::downgrade(state));
        }
    }
}
