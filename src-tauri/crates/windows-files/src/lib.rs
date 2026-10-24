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

mod entry;
use entry::tag;
pub use entry::{delete, identity, kind, kind_at, list_names, rename};

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

#[cfg(test)]
mod tests;
