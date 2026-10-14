//! Shared Win32 helpers for Misty's Windows integrations.
pub mod automation;
pub mod registry;
pub mod sandbox;

use std::{
    ffi::{OsStr, OsString},
    io,
    os::windows::{
        ffi::{OsStrExt, OsStringExt},
        io::{AsHandle, AsRawHandle},
    },
    path::PathBuf,
};

const VERBATIM: &str = "\\\\?\\";
const VERBATIM_UNC: &str = "\\\\?\\UNC\\";

/// A NUL-terminated UTF-16 copy of `value` for Win32 calls.
pub fn wide(value: impl AsRef<OsStr>) -> Vec<u16> {
    value.as_ref().encode_wide().chain(Some(0)).collect()
}

/// The text before the first NUL in a UTF-16 buffer that Win32 filled in.
pub fn from_wide(buffer: &[u16]) -> OsString {
    let end = buffer
        .iter()
        .position(|&unit| unit == 0)
        .unwrap_or(buffer.len());
    OsString::from_wide(&buffer[..end])
}

/// Where an open file or directory actually is, resolved from its handle
/// rather than from any caller-supplied string. Drive-letter paths come back
/// without the verbatim prefix; network paths come back as `\\server\share`.
pub fn final_path(handle: &impl AsHandle) -> io::Result<PathBuf> {
    use windows_sys::Win32::Storage::FileSystem::{
        GetFinalPathNameByHandleW, FILE_NAME_NORMALIZED, VOLUME_NAME_DOS,
    };
    let raw = handle.as_handle().as_raw_handle();
    let mut buffer = vec![0u16; 512];
    loop {
        // SAFETY: the buffer length is passed alongside it.
        let length = unsafe {
            GetFinalPathNameByHandleW(
                raw,
                buffer.as_mut_ptr(),
                buffer.len() as u32,
                FILE_NAME_NORMALIZED | VOLUME_NAME_DOS,
            )
        } as usize;
        if length == 0 {
            return Err(io::Error::last_os_error());
        }
        if length < buffer.len() {
            buffer.truncate(length);
            break;
        }
        // Too small: `length` is the size needed, including the terminator.
        buffer.resize(length, 0);
    }
    let path =
        String::from_utf16(&buffer).map_err(|_| io::Error::other("Path is not valid text"))?;
    Ok(PathBuf::from(strip_verbatim(&path)))
}

fn strip_verbatim(path: &str) -> String {
    if let Some(share) = path.strip_prefix(VERBATIM_UNC) {
        format!("\\\\{share}")
    } else {
        path.strip_prefix(VERBATIM).unwrap_or(path).to_owned()
    }
}

/// The volume and file ID of an open file: unchanged by renames and moves on
/// the same volume, and never reused while the file exists. The 128-bit file
/// ID is folded to 64 bits; NTFS IDs fit already.
pub fn file_identity(handle: &impl AsHandle) -> io::Result<(u64, u64)> {
    use windows_sys::Win32::Storage::FileSystem::{
        FileIdInfo, GetFileInformationByHandleEx, FILE_ID_INFO,
    };
    // SAFETY: an all-zero FILE_ID_INFO is a valid output buffer.
    let mut info: FILE_ID_INFO = unsafe { std::mem::zeroed() };
    // SAFETY: the buffer and its size describe `info`.
    let ok = unsafe {
        GetFileInformationByHandleEx(
            handle.as_handle().as_raw_handle(),
            FileIdInfo,
            (&mut info as *mut FILE_ID_INFO).cast(),
            std::mem::size_of::<FILE_ID_INFO>() as u32,
        )
    };
    if ok == 0 {
        return Err(io::Error::last_os_error());
    }
    let id = u128::from_le_bytes(info.FileId.Identifier);
    Ok((info.VolumeSerialNumber, (id as u64) ^ ((id >> 64) as u64)))
}

/// The identity of whatever `path` names right now, without following a final
/// symbolic link or junction. Fails when it is not a `directory` (or not a
/// regular file when `directory` is false), or is a link.
pub fn identity_at(path: &std::path::Path, directory: bool) -> io::Result<(u64, u64)> {
    use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS,
        FILE_FLAG_OPEN_REPARSE_POINT, FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE, FILE_SHARE_READ,
        FILE_SHARE_WRITE,
    };
    let file = std::fs::OpenOptions::new()
        .access_mode(FILE_READ_ATTRIBUTES)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)?;
    let attributes = file.metadata()?.file_attributes();
    let is_directory = attributes & FILE_ATTRIBUTE_DIRECTORY != 0;
    if attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 || is_directory != directory {
        return Err(io::Error::other("The path names a different kind of item"));
    }
    file_identity(&file)
}

/// The path of an open file or directory, confirmed to still name that same
/// object, so nothing was swapped in at its location since it was opened.
pub fn verified_path(handle: &impl AsHandle, directory: bool) -> io::Result<PathBuf> {
    let path = final_path(handle)?;
    if !path.is_absolute() || identity_at(&path, directory)? != file_identity(handle)? {
        return Err(io::Error::other("The item moved or was replaced"));
    }
    Ok(path)
}

/// Renames the open `entry` to `name` inside `directory` without replacing an
/// existing item: the rename fails if `name` already exists, even if it
/// appeared a moment ago. `name` must be a single component, so the entry
/// never leaves `directory`. `entry` needs DELETE access.
///
/// This calls the kernel directly: the Win32 rename resolves a bare name
/// against the process's current directory and rejects a root directory.
pub fn rename_without_replacing(
    entry: &impl AsHandle,
    directory: &impl AsHandle,
    name: &OsStr,
) -> io::Result<()> {
    use windows_sys::{
        Wdk::Storage::FileSystem::{
            FileRenameInformation, NtSetInformationFile, FILE_RENAME_INFORMATION,
        },
        Win32::{Foundation::RtlNtStatusToDosError, System::IO::IO_STATUS_BLOCK},
    };
    let name: Vec<u16> = name.encode_wide().collect();
    let dots = name == [0x2e] || name == [0x2e, 0x2e];
    if name.is_empty()
        || dots
        || name
            .iter()
            .any(|unit| matches!(unit, 0 | 0x2f | 0x3a | 0x5c))
    {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "Invalid name"));
    }
    let header = std::mem::offset_of!(FILE_RENAME_INFORMATION, FileName);
    let bytes = header + name.len() * 2;
    // u64 storage keeps the structure aligned for its handle field.
    let mut buffer = vec![0u64; bytes.div_ceil(8)];
    let info = buffer.as_mut_ptr().cast::<FILE_RENAME_INFORMATION>();
    // SAFETY: `buffer` holds the header and the name; both handles are open.
    let status = unsafe {
        (*info).Anonymous.ReplaceIfExists = 0;
        (*info).RootDirectory = directory.as_handle().as_raw_handle();
        (*info).FileNameLength = (name.len() * 2) as u32;
        std::ptr::copy_nonoverlapping(
            name.as_ptr(),
            std::ptr::addr_of_mut!((*info).FileName).cast::<u16>(),
            name.len(),
        );
        let mut io_status: IO_STATUS_BLOCK = std::mem::zeroed();
        NtSetInformationFile(
            entry.as_handle().as_raw_handle(),
            &mut io_status,
            info.cast(),
            bytes as u32,
            FileRenameInformation,
        )
    };
    if status < 0 {
        // SAFETY: plain status conversion.
        let code = unsafe { RtlNtStatusToDosError(status) };
        return Err(io::Error::from_raw_os_error(code as i32));
    }
    Ok(())
}

/// Runs `body` with COM initialized for this thread as a single-threaded
/// apartment, as shell APIs such as ShellExecuteEx and IFileOperation need.
pub fn with_com<T>(body: impl FnOnce() -> T) -> T {
    use windows_sys::Win32::System::Com::{
        CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
    };
    // SAFETY: balanced with CoUninitialize below whenever it succeeded
    // (S_OK or S_FALSE). A thread already in another apartment keeps it.
    let initialized = unsafe {
        CoInitializeEx(
            std::ptr::null(),
            (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32,
        )
    } >= 0;
    let result = body();
    if initialized {
        // SAFETY: matches the successful CoInitializeEx above.
        unsafe { CoUninitialize() };
    }
    result
}

/// Turns off the "There is no disk in the drive" dialog for this thread while
/// `body` runs, so probing empty card readers and optical drives stays silent.
pub fn without_error_dialogs<T>(body: impl FnOnce() -> T) -> T {
    use windows_sys::Win32::System::Diagnostics::Debug::{
        SetThreadErrorMode, SEM_FAILCRITICALERRORS, SEM_NOOPENFILEERRORBOX,
    };
    let mut previous = 0;
    // SAFETY: plain flag swap for the calling thread.
    let changed = unsafe {
        SetThreadErrorMode(
            SEM_FAILCRITICALERRORS | SEM_NOOPENFILEERRORBOX,
            &mut previous,
        )
    } != 0;
    let result = body();
    if changed {
        // SAFETY: restores the mode saved above.
        unsafe { SetThreadErrorMode(previous, std::ptr::null_mut()) };
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::windows::fs::OpenOptionsExt;

    #[test]
    fn final_path_and_identity_follow_the_handle() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("file.txt");
        std::fs::write(&path, "x").unwrap();
        let file = std::fs::File::open(&path).unwrap();
        let resolved = final_path(&file).unwrap();
        assert_eq!(
            resolved.canonicalize().unwrap(),
            path.canonicalize().unwrap()
        );
        assert!(!resolved.to_string_lossy().starts_with(VERBATIM));
        let before = file_identity(&file).unwrap();
        let moved = temp.path().join("moved.txt");
        drop(file);
        std::fs::rename(&path, &moved).unwrap();
        let after = file_identity(&std::fs::File::open(&moved).unwrap()).unwrap();
        assert_eq!(before, after);
        assert_eq!(
            strip_verbatim("\\\\?\\UNC\\server\\share\\a"),
            "\\\\server\\share\\a"
        );
        assert_eq!(strip_verbatim("\\\\?\\C:\\a"), "C:\\a");
    }

    #[test]
    fn verified_path_rejects_a_replaced_item() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("chosen.txt");
        std::fs::write(&path, "chosen").unwrap();
        let file = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(7)
            .open(&path)
            .unwrap();
        assert!(verified_path(&file, false).is_ok());
        assert!(verified_path(&file, true).is_err());
        std::fs::rename(&path, temp.path().join("moved.txt")).unwrap();
        std::fs::write(&path, "replacement").unwrap();
        // The handle now resolves to its new name, which still matches.
        assert!(verified_path(&file, false).unwrap().ends_with("moved.txt"));
        assert!(identity_at(&path, false).unwrap() != file_identity(&file).unwrap());
    }

    #[test]
    fn renames_never_replace_an_existing_item() {
        use windows_sys::Win32::Storage::FileSystem::{DELETE, SYNCHRONIZE};
        let temp = tempfile::tempdir().unwrap();
        let outside = std::env::current_dir().unwrap().join("b.txt");
        assert!(!outside.exists());
        std::fs::write(temp.path().join("a.txt"), "a").unwrap();
        std::fs::write(temp.path().join("taken.txt"), "taken").unwrap();
        let open = || {
            std::fs::OpenOptions::new()
                .access_mode(DELETE | SYNCHRONIZE)
                .share_mode(7)
                .open(temp.path().join("a.txt"))
                .unwrap()
        };
        let directory = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(7)
            .custom_flags(windows_sys::Win32::Storage::FileSystem::FILE_FLAG_BACKUP_SEMANTICS)
            .open(temp.path())
            .unwrap();
        let entry = open();
        let error =
            rename_without_replacing(&entry, &directory, OsStr::new("taken.txt")).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(
            std::fs::read_to_string(temp.path().join("taken.txt")).unwrap(),
            "taken"
        );
        for name in [r"..\b.txt", "..", "c:b.txt"] {
            assert!(rename_without_replacing(&entry, &directory, OsStr::new(name)).is_err());
        }
        rename_without_replacing(&entry, &directory, OsStr::new("b.txt")).unwrap();
        drop(entry);
        assert_eq!(
            std::fs::read_to_string(temp.path().join("b.txt")).unwrap(),
            "a"
        );
        assert!(!outside.exists());
    }

    #[test]
    fn wide_round_trips() {
        let value = wide("C:\\Users\\Ünïcode");
        assert_eq!(value.last(), Some(&0));
        assert_eq!(from_wide(&value), OsString::from("C:\\Users\\Ünïcode"));
        assert_eq!(from_wide(&[0x41, 0, 0x42]), OsString::from("A"));
    }
}
