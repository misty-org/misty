//! Host-owned macOS folder references use a stable volume UUID, inode and creation
//! identity. Restoration neither trusts an old path nor searches an entire volume.
use cap_std::fs::Dir;
use serde::{Deserialize, Serialize};
use std::{
    ffi::{CStr, OsStr},
    os::{
        fd::AsRawFd,
        unix::{ffi::OsStrExt, fs::MetadataExt},
    },
};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Identity {
    volume: [u8; 16],
    inode: u64,
    created_ns: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    bookmark: Option<String>,
}
fn supported_mount(mount: &libc::statfs) -> bool {
    let kind = unsafe { CStr::from_ptr(mount.f_fstypename.as_ptr()) }.to_bytes();
    let device = unsafe { CStr::from_ptr(mount.f_mntfromname.as_ptr()) }.to_bytes();
    mount.f_flags & libc::MNT_LOCAL as u32 != 0
        && matches!(kind, b"apfs" | b"hfs")
        && device.starts_with(b"/dev/")
}
fn identity(dir: &Dir) -> Result<Identity, String> {
    let mut mount = unsafe { std::mem::zeroed::<libc::statfs>() };
    if unsafe { libc::fstatfs(dir.as_raw_fd(), &mut mount) } != 0 || !supported_mount(&mount) {
        return Err("Saved folder access requires a local APFS or HFS+ volume. Choose this folder again when reopening it.".into());
    }
    let metadata = dir
        .try_clone()
        .and_then(|d| d.into_std_file().metadata())
        .map_err(|_| "The chosen folder is unavailable.")?;
    #[repr(C)]
    struct Volume {
        length: u32,
        uuid: [u8; 16],
    }
    let mut attributes: libc::attrlist = unsafe { std::mem::zeroed() };
    attributes.bitmapcount = libc::ATTR_BIT_MAP_COUNT;
    attributes.volattr = libc::ATTR_VOL_INFO | libc::ATTR_VOL_UUID;
    let mut volume = Volume {
        length: 0,
        uuid: [0; 16],
    };
    let status = unsafe {
        libc::fgetattrlist(
            dir.as_raw_fd(),
            (&mut attributes as *mut libc::attrlist).cast(),
            (&mut volume as *mut Volume).cast(),
            std::mem::size_of::<Volume>(),
            0,
        )
    };
    if status != 0
        || volume.length as usize != std::mem::size_of::<Volume>()
        || volume.uuid == [0; 16]
    {
        return Err("This volume cannot retain a reliable folder identity. Choose the folder again when reopening it.".into());
    }
    Ok(Identity {
        bookmark: None,
        volume: volume.uuid,
        inode: metadata.ino(),
        created_ns: metadata
            .created()
            .map_err(|_| "Folder creation identity is unavailable.")?
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| "Folder creation identity is unavailable.")?
            .as_nanos()
            .try_into()
            .map_err(|_| "Folder creation identity is unavailable.")?,
    })
}
pub fn remember(dir: &Dir) -> Result<Identity, String> {
    let mut id = identity(dir)?;
    let mut path = [0 as libc::c_char; libc::PATH_MAX as usize];
    if unsafe { libc::fcntl(dir.as_raw_fd(), libc::F_GETPATH, path.as_mut_ptr()) } == -1 {
        return Err("The folder location is unavailable.".into());
    }
    let encoded = unsafe { misty_folder_bookmark_create(path.as_ptr()) };
    if encoded.is_null() {
        return Err("Could not remember macOS folder access. Choose the folder again.".into());
    }
    id.bookmark = Some(
        unsafe { CStr::from_ptr(encoded) }
            .to_string_lossy()
            .into_owned(),
    );
    unsafe { libc::free(encoded.cast()) };
    Ok(id)
}

unsafe extern "C" {
    fn misty_folder_bookmark_create(path: *const libc::c_char) -> *mut libc::c_char;
    fn misty_folder_bookmark_open(
        encoded: *const libc::c_char,
        path: *mut *mut libc::c_char,
    ) -> *mut libc::c_void;
    fn misty_folder_bookmark_close(scope: *mut libc::c_void);
}
/// Owns a retained immutable Foundation lease; no UI or thread-affine state.
#[derive(Debug)]
pub struct SecurityScope(*mut libc::c_void);
unsafe impl Send for SecurityScope {}
unsafe impl Sync for SecurityScope {}
impl Drop for SecurityScope {
    fn drop(&mut self) {
        unsafe { misty_folder_bookmark_close(self.0) };
    }
}
fn same_identity(actual: &Identity, expected: &Identity) -> bool {
    actual.volume == expected.volume
        && actual.inode == expected.inode
        && actual.created_ns == expected.created_ns
}
pub fn reopen_scoped(expected: &Identity) -> Result<(Dir, Option<SecurityScope>), String> {
    let Some(bookmark) = &expected.bookmark else {
        return reopen_identity(expected).map(|dir| (dir, None));
    };
    let encoded =
        std::ffi::CString::new(bookmark.as_str()).map_err(|_| "Invalid saved folder access.")?;
    let mut path = std::ptr::null_mut();
    let lease = unsafe { misty_folder_bookmark_open(encoded.as_ptr(), &mut path) };
    if lease.is_null() {
        return Err("Saved macOS folder access is unavailable. Choose the folder again.".into());
    }
    let scope = SecurityScope(lease);
    let result = Dir::open_ambient_dir(
        OsStr::from_bytes(unsafe { CStr::from_ptr(path) }.to_bytes()),
        cap_std::ambient_authority(),
    );
    unsafe { libc::free(path.cast()) };
    let dir =
        result.map_err(|_| "Saved macOS folder access was denied. Choose the folder again.")?;
    if !identity(&dir).is_ok_and(|actual| same_identity(&actual, expected)) {
        // Foundation can prefer a replacement at the old path after a move.
        // Recover only the recorded volume/inode/creation identity, never that replacement.
        return reopen_identity(expected).map(|dir| (dir, Some(scope)));
    }
    Ok((dir, Some(scope)))
}
#[cfg(test)]
pub fn reopen(expected: &Identity) -> Result<Dir, String> {
    reopen_scoped(expected).map(|(dir, _)| dir)
}

// Recover only the exact original object on its already mounted local volume.
// fsgetpath uses the current mount's fsid; it is never persisted across boots.
fn reopen_identity(expected: &Identity) -> Result<Dir, String> {
    unsafe extern "C" {
        fn fsgetpath(
            buffer: *mut libc::c_char,
            size: libc::size_t,
            fsid: *mut libc::fsid_t,
            object_id: u64,
        ) -> libc::ssize_t;
    }
    const LIMIT: usize = 256;
    let mut mounts = vec![unsafe { std::mem::zeroed::<libc::statfs>() }; LIMIT];
    let count = unsafe {
        libc::getfsstat(
            mounts.as_mut_ptr(),
            std::mem::size_of_val(mounts.as_slice()) as libc::c_int,
            libc::MNT_NOWAIT,
        )
    };
    if count < 0 || count as usize >= LIMIT {
        return Err("Mounted folder volumes could not be inspected.".into());
    }
    for mount in mounts.into_iter().take(count as usize) {
        if !supported_mount(&mount) {
            continue;
        }
        let location = unsafe { CStr::from_ptr(mount.f_mntonname.as_ptr()) };
        let Ok(volume) = Dir::open_ambient_dir(
            OsStr::from_bytes(location.to_bytes()),
            cap_std::ambient_authority(),
        ) else {
            continue;
        };
        if !identity(&volume).is_ok_and(|id| id.volume == expected.volume) {
            continue;
        }
        let mut fsid = mount.f_fsid;
        let mut bytes = [0u8; libc::PATH_MAX as usize];
        let length = unsafe {
            fsgetpath(
                bytes.as_mut_ptr().cast(),
                bytes.len(),
                &mut fsid,
                expected.inode,
            )
        };
        if length <= 0 || length as usize > bytes.len() {
            break;
        }
        let Ok(path) = CStr::from_bytes_until_nul(&bytes) else {
            break;
        };
        let Ok(directory) = Dir::open_ambient_dir(
            OsStr::from_bytes(path.to_bytes()),
            cap_std::ambient_authority(),
        ) else {
            break;
        };
        if identity(&directory).is_ok_and(|actual| same_identity(&actual, expected)) {
            return Ok(directory);
        }
        break;
    }
    Err(
        "The saved folder is unavailable or was replaced. Reconnect its volume or choose it again."
            .into(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_bookmark_retains_identity_after_all_handles_close_and_folder_moves() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("日本語 project")).unwrap();
        std::fs::write(root.path().join("日本語 project/file.txt"), "original").unwrap();
        let dir = Dir::open_ambient_dir(
            root.path().join("日本語 project"),
            cap_std::ambient_authority(),
        )
        .unwrap();
        let id = remember(&dir).unwrap();
        drop(dir);
        std::fs::rename(
            root.path().join("日本語 project"),
            root.path().join("moved"),
        )
        .unwrap();
        std::fs::create_dir(root.path().join("日本語 project")).unwrap();
        std::fs::write(root.path().join("日本語 project/file.txt"), "replacement").unwrap();
        let restored = reopen(&id).unwrap();
        assert_eq!(restored.read_to_string("file.txt").unwrap(), "original");
    }
    #[test]
    fn rejects_replaced_folder() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("project")).unwrap();
        let dir = Dir::open_ambient_dir(root.path().join("project"), cap_std::ambient_authority())
            .unwrap();
        let id = remember(&dir).unwrap();
        // Keep the removed inode open to prevent immediate inode reuse by the fixture.
        std::fs::remove_dir(root.path().join("project")).unwrap();
        std::fs::create_dir(root.path().join("project")).unwrap();
        assert!(reopen(&id).is_err());
        drop(dir);
    }
}
