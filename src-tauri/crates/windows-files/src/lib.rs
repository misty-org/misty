//! File access relative to an open folder on Windows, one name at a time,
//! never following a link: the counterpart of `openat` with `O_NOFOLLOW`.
//!
//! Every open is `NtCreateFile` relative to the folder handle before it,
//! opening a reparse point itself rather than what it points to. Symlinks and
//! junctions (name-surrogate reparse points) are refused by [`open`]. Other
//! reparse points, such as OneDrive placeholders, are ordinary files: they
//! are reopened by file ID, so the cloud filter can supply their data,
//! without any name being resolved again.
#![cfg(windows)]

use std::{
    ffi::{OsStr, OsString},
    fs::File,
    io, mem,
    os::windows::{
        ffi::{OsStrExt, OsStringExt},
        fs::OpenOptionsExt,
        io::{AsRawHandle, FromRawHandle},
    },
    path::Path,
    ptr,
};

use windows_sys::{
    Wdk::{
        Foundation::OBJECT_ATTRIBUTES,
        Storage::FileSystem::{
            FileDispositionInformation, FileDispositionInformationEx, FileRenameInformation,
            FileRenameInformationEx, NtCreateFile, NtSetInformationFile, FILE_CREATE,
            FILE_DIRECTORY_FILE, FILE_DISPOSITION_DELETE,
            FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE, FILE_DISPOSITION_INFORMATION,
            FILE_DISPOSITION_INFORMATION_EX, FILE_DISPOSITION_POSIX_SEMANTICS,
            FILE_NON_DIRECTORY_FILE, FILE_OPEN, FILE_OPEN_BY_FILE_ID, FILE_OPEN_IF,
            FILE_OPEN_REPARSE_POINT, FILE_RENAME_IGNORE_READONLY_ATTRIBUTE,
            FILE_RENAME_INFORMATION, FILE_RENAME_POSIX_SEMANTICS, FILE_RENAME_REPLACE_IF_EXISTS,
            FILE_SYNCHRONOUS_IO_NONALERT,
        },
    },
    Win32::{
        Foundation::{
            RtlNtStatusToDosError, ERROR_DIRECTORY, ERROR_NO_MORE_FILES, ERROR_STOPPED_ON_SYMLINK,
            HANDLE, UNICODE_STRING,
        },
        Storage::FileSystem::{
            FileAttributeTagInfo, FileFullDirectoryInfo, FileFullDirectoryRestartInfo, FileIdInfo,
            GetFileInformationByHandle, GetFileInformationByHandleEx, BY_HANDLE_FILE_INFORMATION,
            DELETE, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_NORMAL, FILE_ATTRIBUTE_READONLY,
            FILE_ATTRIBUTE_REPARSE_POINT, FILE_ATTRIBUTE_TAG_INFO, FILE_FLAG_BACKUP_SEMANTICS,
            FILE_FULL_DIR_INFO, FILE_ID_INFO, FILE_LIST_DIRECTORY, FILE_READ_ATTRIBUTES,
            FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, FILE_TRAVERSE, SYNCHRONIZE,
        },
        System::{Kernel::OBJ_CASE_INSENSITIVE, IO::IO_STATUS_BLOCK},
    },
};

pub use windows_sys::Win32::Storage::FileSystem::{FILE_GENERIC_READ, FILE_GENERIC_WRITE};

/// What a folder handle needs: listing, passing through, and its attributes.
pub const FOLDER_ACCESS: u32 = FILE_LIST_DIRECTORY | FILE_TRAVERSE | FILE_READ_ATTRIBUTES;
/// Removing what an open handle names.
pub const DELETE_ACCESS: u32 = DELETE;
/// Reparse tags with this bit stand for another name: symlinks, junctions.
const NAME_SURROGATE: u32 = 0x2000_0000;

/// What an open entry is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    File {
        read_only: bool,
    },
    Folder,
    /// A symlink or junction, opened as itself.
    Link,
}

/// How [`open`] treats a missing entry.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Disposition {
    /// It must exist.
    Existing,
    /// It must not exist yet; it is created.
    New,
    /// Opened when it exists, created when it doesn't.
    Either,
}

/// What [`open`] may find.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Expect {
    Anything,
    File,
    Folder,
}

pub fn link_refused() -> io::Error {
    io::Error::from_raw_os_error(ERROR_STOPPED_ON_SYMLINK as i32)
}

pub fn not_a_folder() -> io::Error {
    io::Error::from_raw_os_error(ERROR_DIRECTORY as i32)
}

fn from_status(status: i32) -> io::Error {
    // SAFETY: plain status conversion.
    io::Error::from_raw_os_error(unsafe { RtlNtStatusToDosError(status) } as i32)
}

/// A folder by path, as a handle the other functions start from. The path
/// itself may go through links; nothing opened from it may.
pub fn open_folder(path: &Path) -> io::Result<File> {
    let file = std::fs::OpenOptions::new()
        .access_mode(FOLDER_ACCESS | SYNCHRONIZE)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(path)?;
    if kind(&file)? != Kind::Folder {
        return Err(not_a_folder());
    }
    Ok(file)
}

/// One name inside a folder: not empty, not `.` or `..`, and no separator,
/// stream (`:`) or NUL.
fn component(name: &OsStr) -> io::Result<Vec<u16>> {
    let units: Vec<u16> = name.encode_wide().collect();
    let dots = units == [0x2e] || units == [0x2e, 0x2e];
    if units.is_empty()
        || dots
        || units.len() > 255
        || units
            .iter()
            .any(|unit| matches!(unit, 0 | 0x2f | 0x3a | 0x5c))
    {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "invalid name"));
    }
    Ok(units)
}

fn raw_open(
    dir: &File,
    name: &UNICODE_STRING,
    access: u32,
    disposition: u32,
    options: u32,
) -> io::Result<File> {
    let attributes = OBJECT_ATTRIBUTES {
        Length: mem::size_of::<OBJECT_ATTRIBUTES>() as u32,
        RootDirectory: dir.as_raw_handle() as HANDLE,
        ObjectName: name,
        Attributes: OBJ_CASE_INSENSITIVE as u32,
        SecurityDescriptor: ptr::null(),
        SecurityQualityOfService: ptr::null(),
    };
    let mut handle: HANDLE = ptr::null_mut();
    // SAFETY: zeroed output buffer.
    let mut status_block: IO_STATUS_BLOCK = unsafe { mem::zeroed() };
    // SAFETY: every pointer refers to a live local; the handle is owned by
    // the returned file.
    let status = unsafe {
        NtCreateFile(
            &mut handle,
            access | SYNCHRONIZE,
            &attributes,
            &mut status_block,
            ptr::null(),
            FILE_ATTRIBUTE_NORMAL,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            disposition,
            options | FILE_SYNCHRONOUS_IO_NONALERT,
            ptr::null(),
            0,
        )
    };
    if status < 0 {
        return Err(from_status(status));
    }
    // SAFETY: NtCreateFile returned an owned handle.
    Ok(unsafe { File::from_raw_handle(handle.cast()) })
}

/// Opens `name` inside `dir` exactly as named: a link is opened as itself,
/// never followed. For looking at, renaming or removing what is there.
pub fn open_entry(dir: &File, name: &OsStr, access: u32) -> io::Result<File> {
    let units = component(name)?;
    let bytes = (units.len() * 2) as u16;
    let object_name = UNICODE_STRING {
        Length: bytes,
        MaximumLength: bytes,
        Buffer: units.as_ptr().cast_mut(),
    };
    raw_open(
        dir,
        &object_name,
        access,
        FILE_OPEN,
        FILE_OPEN_REPARSE_POINT,
    )
}

/// Opens `name` inside `dir` for use, refusing a link (and, with `expect`,
/// the wrong kind of entry).
pub fn open(
    dir: &File,
    name: &OsStr,
    access: u32,
    disposition: Disposition,
    expect: Expect,
) -> io::Result<File> {
    let units = component(name)?;
    let bytes = (units.len() * 2) as u16;
    let object_name = UNICODE_STRING {
        Length: bytes,
        MaximumLength: bytes,
        Buffer: units.as_ptr().cast_mut(),
    };
    let disposition = match disposition {
        Disposition::Existing => FILE_OPEN,
        Disposition::New => FILE_CREATE,
        Disposition::Either => FILE_OPEN_IF,
    };
    let options = match expect {
        Expect::Anything => 0,
        Expect::File => FILE_NON_DIRECTORY_FILE,
        Expect::Folder => FILE_DIRECTORY_FILE,
    };
    let file = raw_open(
        dir,
        &object_name,
        access,
        disposition,
        options | FILE_OPEN_REPARSE_POINT,
    )?;
    let (_, reparse_tag) = tag(&file)?;
    if reparse_tag == 0 {
        return Ok(file);
    }
    if reparse_tag & NAME_SURROGATE != 0 {
        return Err(link_refused());
    }
    // SAFETY: zeroed output buffer.
    let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { mem::zeroed() };
    // SAFETY: a live handle and an output buffer.
    if unsafe { GetFileInformationByHandle(file.as_raw_handle() as HANDLE, &mut info) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let id = (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow);
    let id_bytes = id.to_le_bytes();
    let by_id = UNICODE_STRING {
        Length: 8,
        MaximumLength: 8,
        Buffer: id_bytes.as_ptr().cast_mut().cast(),
    };
    let reopened = raw_open(
        dir,
        &by_id,
        access,
        FILE_OPEN,
        options | FILE_OPEN_BY_FILE_ID,
    )?;
    if kind(&reopened)? == Kind::Link {
        return Err(link_refused());
    }
    Ok(reopened)
}

/// The attributes and reparse tag of an open entry.
fn tag(file: &File) -> io::Result<(u32, u32)> {
    // SAFETY: zeroed output buffer of the requested class's size.
    let mut info: FILE_ATTRIBUTE_TAG_INFO = unsafe { mem::zeroed() };
    // SAFETY: a live handle and a buffer of the class's size.
    let ok = unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle() as HANDLE,
            FileAttributeTagInfo,
            ptr::addr_of_mut!(info).cast(),
            mem::size_of::<FILE_ATTRIBUTE_TAG_INFO>() as u32,
        )
    } != 0;
    if !ok {
        return Err(io::Error::last_os_error());
    }
    let reparse = info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0;
    Ok((
        info.FileAttributes,
        if reparse { info.ReparseTag } else { 0 },
    ))
}

/// What an open entry is.
pub fn kind(file: &File) -> io::Result<Kind> {
    let (attributes, reparse_tag) = tag(file)?;
    Ok(if reparse_tag & NAME_SURROGATE != 0 {
        Kind::Link
    } else if attributes & FILE_ATTRIBUTE_DIRECTORY != 0 {
        Kind::Folder
    } else {
        Kind::File {
            read_only: attributes & FILE_ATTRIBUTE_READONLY != 0,
        }
    })
}

/// What sits at `name` in `dir`, without following a link; `None` when
/// nothing does.
pub fn kind_at(dir: &File, name: &OsStr) -> io::Result<Option<Kind>> {
    match open_entry(dir, name, FILE_READ_ATTRIBUTES) {
        Ok(file) => kind(&file).map(Some),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

/// Volume and file ID: an entry's identity, whatever name reached it.
pub fn identity(file: &File) -> io::Result<(u64, [u8; 16])> {
    // SAFETY: zeroed output buffer of the requested class's size.
    let mut info: FILE_ID_INFO = unsafe { mem::zeroed() };
    // SAFETY: a live handle and a buffer of the class's size.
    let ok = unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle() as HANDLE,
            FileIdInfo,
            ptr::addr_of_mut!(info).cast(),
            mem::size_of::<FILE_ID_INFO>() as u32,
        )
    } != 0;
    if !ok {
        return Err(io::Error::last_os_error());
    }
    Ok((info.VolumeSerialNumber, info.FileId.Identifier))
}

/// STATUS_INVALID_PARAMETER, STATUS_NOT_SUPPORTED or
/// STATUS_INVALID_INFO_CLASS: the file system lacks the extended class.
fn unsupported(status: i32) -> bool {
    matches!(status as u32, 0xC000_000D | 0xC000_00BB | 0xC000_0003)
}

/// Renames the open entry (opened with DELETE access) to `name` inside
/// `dir`. With `replace`, what is there is replaced (a link as itself, never
/// followed); without it, an existing entry makes the rename fail, so
/// nothing is ever overwritten. POSIX semantics let a replace succeed while
/// another program has the old file open; older file systems take the plain
/// rename.
pub fn rename(entry: &File, dir: &File, name: &OsStr, replace: bool) -> io::Result<()> {
    let units = component(name)?;
    let header = mem::offset_of!(FILE_RENAME_INFORMATION, FileName);
    let bytes = header + units.len() * 2;
    let attempt = |class, flags: Option<u32>| {
        // u64 storage keeps the structure aligned for its handle field.
        let mut buffer = vec![0u64; bytes.div_ceil(8)];
        let info = buffer.as_mut_ptr().cast::<FILE_RENAME_INFORMATION>();
        // SAFETY: `buffer` holds the header and the name; both handles are open.
        unsafe {
            match flags {
                Some(flags) => (*info).Anonymous.Flags = flags,
                None => (*info).Anonymous.ReplaceIfExists = u8::from(replace),
            }
            (*info).RootDirectory = dir.as_raw_handle() as HANDLE;
            (*info).FileNameLength = (units.len() * 2) as u32;
            ptr::copy_nonoverlapping(
                units.as_ptr(),
                ptr::addr_of_mut!((*info).FileName).cast::<u16>(),
                units.len(),
            );
            let mut status_block: IO_STATUS_BLOCK = mem::zeroed();
            NtSetInformationFile(
                entry.as_raw_handle() as HANDLE,
                &mut status_block,
                info.cast(),
                bytes as u32,
                class,
            )
        }
    };
    let mut flags = FILE_RENAME_POSIX_SEMANTICS | FILE_RENAME_IGNORE_READONLY_ATTRIBUTE;
    if replace {
        flags |= FILE_RENAME_REPLACE_IF_EXISTS;
    }
    let status = attempt(FileRenameInformationEx, Some(flags));
    let status = if unsupported(status) {
        attempt(FileRenameInformation, None)
    } else {
        status
    };
    if status < 0 {
        return Err(from_status(status));
    }
    Ok(())
}

/// Deletes the open entry (opened with DELETE access). A link goes as a
/// link, a read-only file goes too, and the name is gone at once even if
/// another program has it open. A folder must be empty.
pub fn delete(entry: &File) -> io::Result<()> {
    let handle = entry.as_raw_handle() as HANDLE;
    let info = FILE_DISPOSITION_INFORMATION_EX {
        Flags: FILE_DISPOSITION_DELETE
            | FILE_DISPOSITION_POSIX_SEMANTICS
            | FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE,
    };
    // SAFETY: a live handle opened with DELETE; the structure is on the stack.
    let mut status = unsafe {
        let mut status_block: IO_STATUS_BLOCK = mem::zeroed();
        NtSetInformationFile(
            handle,
            &mut status_block,
            ptr::addr_of!(info).cast(),
            mem::size_of::<FILE_DISPOSITION_INFORMATION_EX>() as u32,
            FileDispositionInformationEx,
        )
    };
    if unsupported(status) {
        let info = FILE_DISPOSITION_INFORMATION { DeleteFile: 1 };
        // SAFETY: as above.
        status = unsafe {
            let mut status_block: IO_STATUS_BLOCK = mem::zeroed();
            NtSetInformationFile(
                handle,
                &mut status_block,
                ptr::addr_of!(info).cast(),
                mem::size_of::<FILE_DISPOSITION_INFORMATION>() as u32,
                FileDispositionInformation,
            )
        };
    }
    if status < 0 {
        return Err(from_status(status));
    }
    Ok(())
}

/// The names in an open folder, without `.` and `..`.
pub fn list_names(dir: &File) -> io::Result<Vec<OsString>> {
    // u64 storage keeps each entry aligned.
    let mut buffer = vec![0u64; 8 * 1024];
    let mut names = Vec::new();
    let mut class = FileFullDirectoryRestartInfo;
    loop {
        // SAFETY: a live folder handle and a buffer of the given size.
        let ok = unsafe {
            GetFileInformationByHandleEx(
                dir.as_raw_handle() as HANDLE,
                class,
                buffer.as_mut_ptr().cast(),
                (buffer.len() * 8) as u32,
            )
        } != 0;
        if !ok {
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(ERROR_NO_MORE_FILES as i32) {
                return Ok(names);
            }
            return Err(error);
        }
        class = FileFullDirectoryInfo;
        let base = buffer.as_ptr().cast::<u8>();
        let mut offset = 0usize;
        loop {
            // SAFETY: Windows filled `buffer` with a chain of entries linked
            // by NextEntryOffset, each holding FileNameLength bytes of name.
            let (next, name) = unsafe {
                let info = base.add(offset).cast::<FILE_FULL_DIR_INFO>();
                let length = (*info).FileNameLength as usize / 2;
                let units = std::slice::from_raw_parts(
                    ptr::addr_of!((*info).FileName).cast::<u16>(),
                    length,
                );
                ((*info).NextEntryOffset as usize, OsString::from_wide(units))
            };
            if name != "." && name != ".." {
                names.push(name);
            }
            if next == 0 {
                break;
            }
            offset += next;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_single_components() {
        for bad in ["", ".", "..", "a\\b", "a/b", "file.txt:secret", "C:"] {
            assert!(component(OsStr::new(bad)).is_err(), "{bad}");
        }
        assert!(component(OsStr::new("ok.txt")).is_ok());
    }

    #[test]
    fn renames_never_overwrite_unless_asked() {
        let folder = tempfile::tempdir().unwrap();
        std::fs::write(folder.path().join("a.txt"), "a").unwrap();
        std::fs::write(folder.path().join("b.txt"), "b").unwrap();
        let dir = open_folder(folder.path()).unwrap();
        let a = open_entry(&dir, OsStr::new("a.txt"), DELETE_ACCESS).unwrap();
        assert!(rename(&a, &dir, OsStr::new("b.txt"), false).is_err());
        assert_eq!(
            std::fs::read_to_string(folder.path().join("b.txt")).unwrap(),
            "b"
        );
        rename(&a, &dir, OsStr::new("c.txt"), false).unwrap();
        assert!(folder.path().join("c.txt").exists());
        rename(&a, &dir, OsStr::new("b.txt"), true).unwrap();
        assert_eq!(
            std::fs::read_to_string(folder.path().join("b.txt")).unwrap(),
            "a"
        );
    }

    #[test]
    fn folders_are_made_listed_and_removed() {
        let folder = tempfile::tempdir().unwrap();
        let dir = open_folder(folder.path()).unwrap();
        let made = open(
            &dir,
            OsStr::new("made"),
            FOLDER_ACCESS | DELETE_ACCESS,
            Disposition::New,
            Expect::Folder,
        )
        .unwrap();
        assert!(open(
            &dir,
            OsStr::new("made"),
            FOLDER_ACCESS,
            Disposition::New,
            Expect::Folder
        )
        .is_err());
        assert_eq!(list_names(&dir).unwrap(), vec![OsString::from("made")]);
        assert_eq!(
            kind_at(&dir, OsStr::new("made")).unwrap(),
            Some(Kind::Folder)
        );
        delete(&made).unwrap();
        drop(made);
        assert_eq!(kind_at(&dir, OsStr::new("made")).unwrap(), None);
    }
}
