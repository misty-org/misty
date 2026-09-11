//! Host-owned Windows folder references: the volume serial number, the
//! folder's 128-bit file ID and its creation time, with the last known path
//! as a hint. Restoration tries the hint, trusts it only when the identity
//! matches, and otherwise finds the exact folder by its file ID on the same
//! volume; it never accepts a replacement at the old path. Windows needs no
//! grant like a macOS security scope: the person's own access is enough.
use cap_std::fs::Dir;
use serde::{Deserialize, Serialize};
use std::{
    ffi::c_void,
    mem::{size_of, zeroed},
    os::windows::{
        ffi::OsStrExt,
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
    },
    path::{Path, PathBuf},
    ptr,
};
use windows_sys::Win32::{
    Foundation::{HANDLE, INVALID_HANDLE_VALUE},
    Storage::FileSystem::{
        ExtendedFileIdType, FileIdInfo, GetDriveTypeW, GetFileInformationByHandleEx,
        GetFinalPathNameByHandleW, GetLogicalDrives, GetVolumeInformationByHandleW, OpenFileById,
        FILE_FLAG_BACKUP_SEMANTICS, FILE_ID_DESCRIPTOR, FILE_ID_INFO, FILE_READ_ATTRIBUTES,
        FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, VOLUME_NAME_DOS,
    },
    System::WindowsProgramming::{DRIVE_FIXED, DRIVE_REMOVABLE},
};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Identity {
    volume: u64,
    file_id: [u8; 16],
    created_ns: u64,
    /// Where the folder was when last opened.
    path: String,
}

/// Windows grants no folder scope to hold; a reopened folder carries none.
#[derive(Debug)]
pub enum SecurityScope {}

fn unavailable() -> String {
    "The chosen folder is unavailable.".into()
}

/// The volume serial number and file ID of an open file or folder.
fn file_id(handle: HANDLE) -> Option<(u64, [u8; 16])> {
    // SAFETY: plain out-structure for a live handle.
    let mut info: FILE_ID_INFO = unsafe { zeroed() };
    let read = unsafe {
        GetFileInformationByHandleEx(
            handle,
            FileIdInfo,
            (&mut info as *mut FILE_ID_INFO).cast::<c_void>(),
            size_of::<FILE_ID_INFO>() as u32,
        )
    } != 0;
    (read && info.VolumeSerialNumber != 0)
        .then_some((info.VolumeSerialNumber, info.FileId.Identifier))
}

/// The path Windows has for an open handle, without the `\\?\` prefix.
fn final_path(handle: HANDLE) -> Option<PathBuf> {
    let mut buffer = vec![0u16; 1024];
    loop {
        // SAFETY: the buffer holds `len` units.
        let length = unsafe {
            GetFinalPathNameByHandleW(
                handle,
                buffer.as_mut_ptr(),
                buffer.len() as u32,
                VOLUME_NAME_DOS,
            )
        } as usize;
        if length == 0 {
            return None;
        }
        if length < buffer.len() {
            let text = String::from_utf16(&buffer[..length]).ok()?;
            // Local volumes only: a network share comes back as `\\?\UNC\…`.
            return text
                .strip_prefix(r"\\?\")
                .filter(|rest| !rest.starts_with("UNC\\"))
                .map(PathBuf::from);
        }
        buffer.resize(length + 1, 0);
    }
}

/// Whether `root` (`X:\`) is a local fixed or removable drive.
fn local_drive(root: &Path) -> bool {
    let wide: Vec<u16> = root.as_os_str().encode_wide().chain([0]).collect();
    // SAFETY: a NUL-terminated path.
    matches!(
        unsafe { GetDriveTypeW(wide.as_ptr()) },
        DRIVE_FIXED | DRIVE_REMOVABLE
    )
}

/// Whether the handle's volume keeps stable file IDs (NTFS or ReFS).
fn stable_ids(handle: HANDLE) -> bool {
    let mut name = [0u16; 32];
    // SAFETY: only the file system name buffer is requested.
    let read = unsafe {
        GetVolumeInformationByHandleW(
            handle,
            ptr::null_mut(),
            0,
            ptr::null_mut(),
            ptr::null_mut(),
            ptr::null_mut(),
            name.as_mut_ptr(),
            name.len() as u32,
        )
    } != 0;
    let length = name
        .iter()
        .position(|&unit| unit == 0)
        .unwrap_or(name.len());
    read && matches!(
        String::from_utf16_lossy(&name[..length]).as_str(),
        "NTFS" | "ReFS"
    )
}

fn identity(dir: &Dir) -> Result<Identity, String> {
    let handle = dir.as_raw_handle() as HANDLE;
    let path = final_path(handle).ok_or("Saved folder access requires a folder on a local drive. Choose this folder again when reopening it.")?;
    let local = path.ancestors().last().is_some_and(local_drive);
    if !local || !stable_ids(handle) {
        return Err("Saved folder access requires a local NTFS or ReFS drive. Choose this folder again when reopening it.".into());
    }
    let (volume, file_id) = file_id(handle).ok_or_else(unavailable)?;
    let metadata = dir
        .try_clone()
        .and_then(|d| d.into_std_file().metadata())
        .map_err(|_| unavailable())?;
    let created_ns = metadata
        .created()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .and_then(|age| u64::try_from(age.as_nanos()).ok())
        .ok_or("Folder creation identity is unavailable.")?;
    Ok(Identity {
        volume,
        file_id,
        created_ns,
        path: path.to_string_lossy().into_owned(),
    })
}

fn same_identity(actual: &Identity, expected: &Identity) -> bool {
    actual.volume == expected.volume
        && actual.file_id == expected.file_id
        && actual.created_ns == expected.created_ns
}

pub fn remember(dir: &Dir) -> Result<Identity, String> {
    identity(dir)
}

pub fn reopen_scoped(expected: &Identity) -> Result<(Dir, Option<SecurityScope>), String> {
    let hinted = Dir::open_ambient_dir(&expected.path, cap_std::ambient_authority())
        .ok()
        .filter(|dir| identity(dir).is_ok_and(|actual| same_identity(&actual, expected)));
    match hinted {
        Some(dir) => Ok((dir, None)),
        None => reopen_identity(expected).map(|dir| (dir, None)),
    }
}

#[cfg(test)]
pub fn reopen(expected: &Identity) -> Result<Dir, String> {
    reopen_scoped(expected).map(|(dir, _)| dir)
}

/// Finds the exact folder by its file ID on the local drive with the
/// recorded volume serial number, wherever it has moved there.
fn reopen_identity(expected: &Identity) -> Result<Dir, String> {
    let missing = || {
        "The saved folder is unavailable or was replaced. Reconnect its drive or choose it again."
            .to_owned()
    };
    // SAFETY: no arguments.
    let drives = unsafe { GetLogicalDrives() };
    let volume = (0..26u8)
        .filter(|index| drives & (1 << index) != 0)
        .map(|index| PathBuf::from(format!("{}:\\", char::from(b'A' + index))))
        .filter(|root| local_drive(root))
        .filter_map(|root| Dir::open_ambient_dir(&root, cap_std::ambient_authority()).ok())
        .find(|root| {
            file_id(root.as_raw_handle() as HANDLE)
                .is_some_and(|(volume, _)| volume == expected.volume)
        })
        .ok_or_else(missing)?;
    // SAFETY: a zeroed descriptor, then filled in; the union holds the ID.
    let mut descriptor: FILE_ID_DESCRIPTOR = unsafe { zeroed() };
    descriptor.dwSize = size_of::<FILE_ID_DESCRIPTOR>() as u32;
    descriptor.Type = ExtendedFileIdType;
    descriptor.Anonymous.ExtendedFileId.Identifier = expected.file_id;
    // SAFETY: a live volume handle and a valid descriptor; only attributes
    // are read through the returned handle.
    let found = unsafe {
        OpenFileById(
            volume.as_raw_handle() as HANDLE,
            &descriptor,
            FILE_READ_ATTRIBUTES,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            ptr::null(),
            FILE_FLAG_BACKUP_SEMANTICS,
        )
    };
    if found.is_null() || found == INVALID_HANDLE_VALUE {
        return Err(missing());
    }
    // SAFETY: a handle this function owns from here.
    let found = unsafe { OwnedHandle::from_raw_handle(found.cast()) };
    let path = final_path(found.as_raw_handle() as HANDLE).ok_or_else(missing)?;
    drop(found);
    // Opened again by path, so it is checked once more: the folder may have
    // moved in between.
    let directory =
        Dir::open_ambient_dir(&path, cap_std::ambient_authority()).map_err(|_| missing())?;
    if identity(&directory).is_ok_and(|actual| same_identity(&actual, expected)) {
        Ok(directory)
    } else {
        Err(missing())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saved_folders_follow_their_identity_after_a_move() {
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
    fn a_replaced_folder_is_refused() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("project")).unwrap();
        let dir = Dir::open_ambient_dir(root.path().join("project"), cap_std::ambient_authority())
            .unwrap();
        let id = remember(&dir).unwrap();
        drop(dir);
        std::fs::remove_dir(root.path().join("project")).unwrap();
        std::fs::create_dir(root.path().join("project")).unwrap();
        assert!(reopen(&id).is_err());
    }

    #[test]
    fn records_hold_no_handles_and_round_trip() {
        let root = tempfile::tempdir().unwrap();
        let dir = Dir::open_ambient_dir(root.path(), cap_std::ambient_authority()).unwrap();
        let id = remember(&dir).unwrap();
        let text = serde_json::to_string(&id).unwrap();
        assert_eq!(serde_json::from_str::<Identity>(&text).unwrap(), id);
    }
}
