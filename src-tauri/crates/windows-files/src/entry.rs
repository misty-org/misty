//! What an open entry is and who it is, and renaming, deleting and listing.
use super::*;

/// The attributes and reparse tag of an open entry.
pub(crate) fn tag(file: &File) -> io::Result<(u32, u32)> {
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
