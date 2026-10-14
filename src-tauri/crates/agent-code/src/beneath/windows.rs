//! Windows: every name is opened relative to the folder before it, and a
//! link is never followed (see `misty-windows-files`). Symlinks and
//! junctions are refused at any depth.
use std::{
    ffi::{OsStr, OsString},
    fs::File,
    io::{self, Write},
    os::windows::{
        ffi::{OsStrExt, OsStringExt},
        io::AsRawHandle,
    },
    path::{Path, PathBuf},
    ptr,
};

use misty_windows_files::{
    self as files, Disposition, Expect, Kind, DELETE_ACCESS, FILE_GENERIC_READ, FILE_GENERIC_WRITE,
    FOLDER_ACCESS,
};
pub use misty_windows_files::{is_link_refusal, is_not_folder, list_names};
use windows_sys::Win32::{
    Foundation::HANDLE,
    Storage::FileSystem::{
        CreateSymbolicLinkW, GetFinalPathNameByHandleW, FILE_READ_ATTRIBUTES,
        SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE, SYMBOLIC_LINK_FLAG_DIRECTORY,
    },
    System::{Ioctl::FSCTL_GET_REPARSE_POINT, IO::DeviceIoControl},
};

use super::Entry;

const IO_REPARSE_TAG_MOUNT_POINT: u32 = 0xA000_0003;
const IO_REPARSE_TAG_SYMLINK: u32 = 0xA000_000C;
const MAX_REPARSE_BYTES: usize = 16 * 1024;

/// The project's top folder, opened as a folder handle. The project path
/// itself may go through links; nothing below it may.
pub fn open_root(root: &Path) -> io::Result<File> {
    files::open_folder(root)
}

/// Opens the folder that holds `relative`, creating missing folders when
/// asked. Returns that folder and the final name.
pub fn open_parent<'a>(
    root: &File,
    relative: &'a Path,
    create: bool,
) -> io::Result<(File, &'a OsStr)> {
    let parts: Vec<&OsStr> = relative.iter().collect();
    let Some((last, folders)) = parts.split_last() else {
        return Err(io::Error::from(io::ErrorKind::InvalidInput));
    };
    // Every folder on the way is also checked by identity against the
    // project's real .git and .misty, whatever name reached it.
    let guarded: Vec<(u64, [u8; 16])> = [".git", ".misty"]
        .iter()
        .filter_map(|name| files::open_entry(root, OsStr::new(name), FILE_READ_ATTRIBUTES).ok())
        .filter_map(|entry| files::identity(&entry).ok())
        .collect();
    let disposition = if create {
        Disposition::Either
    } else {
        Disposition::Existing
    };
    let mut current = root.try_clone()?;
    for folder in folders {
        current = files::open(&current, folder, FOLDER_ACCESS, disposition, Expect::Folder)?;
        if guarded.contains(&files::identity(&current)?) {
            return Err(io::Error::from(io::ErrorKind::PermissionDenied));
        }
    }
    Ok((current, last))
}

/// Opens a regular file for reading. Links and folders are refused.
pub fn open_file(root: &File, relative: &Path) -> io::Result<File> {
    let (dir, name) = open_parent(root, relative, false)?;
    let file = files::open(
        &dir,
        name,
        FILE_GENERIC_READ,
        Disposition::Existing,
        Expect::Anything,
    )?;
    if files::kind(&file)? == Kind::Folder {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "not a regular file",
        ));
    }
    Ok(file)
}

/// Opens a folder inside the project (the root itself for an empty path).
pub fn open_dir(root: &File, relative: &Path) -> io::Result<File> {
    if relative.as_os_str().is_empty() {
        return root.try_clone();
    }
    let (dir, name) = open_parent(root, relative, false)?;
    files::open(
        &dir,
        name,
        FOLDER_ACCESS,
        Disposition::Existing,
        Expect::Folder,
    )
}

pub fn entry(dir: &File, name: &OsStr) -> io::Result<Entry> {
    Ok(match files::kind_at(dir, name)? {
        None => Entry::Missing,
        Some(Kind::Link) => Entry::Symlink,
        Some(Kind::Folder) => Entry::Directory,
        Some(Kind::File { read_only: true }) => Entry::File { mode: 0o444 },
        Some(Kind::File { read_only: false }) => Entry::File { mode: 0o644 },
    })
}

/// [`super::write_file`] with an explicit permission mode (undo restores
/// modes). On Windows only the write bits matter: none makes the file
/// read-only.
pub fn write_file_mode(
    root: &File,
    relative: &Path,
    bytes: &[u8],
    mode: Option<u32>,
) -> io::Result<bool> {
    let (dir, name) = open_parent(root, relative, true)?;
    let (created, mode) = match entry(&dir, name)? {
        Entry::Missing => (true, mode.unwrap_or(0o644)),
        Entry::File { mode: current } => (false, mode.unwrap_or(current)),
        Entry::Symlink => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "that path is a symlink",
            ))
        }
        _ => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "that path is not a regular file",
            ))
        }
    };
    let temp_name = format!(".misty-write-{}", uuid::Uuid::new_v4().simple());
    let mut file = files::open(
        &dir,
        OsStr::new(&temp_name),
        FILE_GENERIC_WRITE | FILE_READ_ATTRIBUTES | DELETE_ACCESS,
        Disposition::New,
        Expect::File,
    )?;
    let written = file
        .write_all(bytes)
        .and_then(|_| file.sync_data())
        .and_then(|_| {
            if mode & 0o222 == 0 {
                files::set_read_only(&file)
            } else {
                Ok(())
            }
        })
        .and_then(|_| files::rename(&file, &dir, name, true));
    if let Err(error) = written {
        let _ = files::delete(&file);
        return Err(error);
    }
    Ok(created)
}

/// Removes one file, link or empty folder inside the project, never
/// following links.
pub fn remove(root: &File, relative: &Path, directory: bool) -> io::Result<()> {
    let (dir, name) = open_parent(root, relative, false)?;
    let entry = files::open_entry(&dir, name, DELETE_ACCESS | FILE_READ_ATTRIBUTES)?;
    let folder = files::kind(&entry)? == Kind::Folder;
    if folder != directory {
        return Err(if directory {
            files::not_a_folder()
        } else {
            io::Error::new(io::ErrorKind::InvalidInput, "that path is a folder")
        });
    }
    files::delete(&entry)
}

pub(super) fn remove_entry(dir: &File, name: &OsStr, depth: usize) -> io::Result<()> {
    if depth > 256 {
        return Err(io::Error::from(io::ErrorKind::InvalidInput));
    }
    match entry(dir, name)? {
        Entry::Missing => Ok(()),
        Entry::Directory => {
            let child = files::open(
                dir,
                name,
                FOLDER_ACCESS | DELETE_ACCESS,
                Disposition::Existing,
                Expect::Folder,
            )?;
            for inner in list_names(&child)? {
                remove_entry(&child, &inner, depth + 1)?;
            }
            files::delete(&child)
        }
        _ => files::delete(&files::open_entry(
            dir,
            name,
            DELETE_ACCESS | FILE_READ_ATTRIBUTES,
        )?),
    }
}

/// Creates a symlink inside the project (used only when undo restores one).
/// Windows needs Developer Mode or administrator rights to create one; when
/// it refuses, undo reports the link as not restored.
pub fn symlink(root: &File, relative: &Path, target: &Path) -> io::Result<()> {
    let (dir, name) = open_parent(root, relative, true)?;
    if name
        .encode_wide()
        .any(|unit| matches!(unit, 0 | 0x2f | 0x3a | 0x5c))
    {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "invalid name"));
    }
    let parent = final_path(&dir)?;
    let link: Vec<u16> = parent
        .join(name)
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let folder = parent.join(target).is_dir();
    let target: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut flags = SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE;
    if folder {
        flags |= SYMBOLIC_LINK_FLAG_DIRECTORY;
    }
    // SAFETY: NUL-terminated paths.
    if unsafe { CreateSymbolicLinkW(link.as_ptr(), target.as_ptr(), flags) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

/// The path of an open folder.
fn final_path(dir: &File) -> io::Result<PathBuf> {
    let mut buffer = vec![0u16; 1024];
    loop {
        // SAFETY: a live handle and a buffer of the given length.
        let length = unsafe {
            GetFinalPathNameByHandleW(
                dir.as_raw_handle() as HANDLE,
                buffer.as_mut_ptr(),
                buffer.len() as u32,
                0,
            )
        } as usize;
        if length == 0 {
            return Err(io::Error::last_os_error());
        }
        if length < buffer.len() {
            return Ok(crate::plain_path(Path::new(&OsString::from_wide(
                &buffer[..length],
            ))));
        }
        buffer.resize(length + 1, 0);
    }
}

/// Reads a link's target without following it: a symlink's as written, a
/// junction's as its absolute path.
pub fn read_link(root: &File, relative: &Path) -> io::Result<PathBuf> {
    let (dir, name) = open_parent(root, relative, false)?;
    let file = files::open_entry(&dir, name, FILE_READ_ATTRIBUTES)?;
    let mut buffer = vec![0u32; MAX_REPARSE_BYTES / 4];
    let mut returned = 0u32;
    // SAFETY: a live handle and an output buffer of the given size.
    let ok = unsafe {
        DeviceIoControl(
            file.as_raw_handle() as HANDLE,
            FSCTL_GET_REPARSE_POINT,
            ptr::null(),
            0,
            buffer.as_mut_ptr().cast(),
            MAX_REPARSE_BYTES as u32,
            &mut returned,
            ptr::null_mut(),
        )
    } != 0;
    if !ok {
        return Err(io::Error::last_os_error());
    }
    let data: Vec<u8> = buffer
        .iter()
        .flat_map(|word| word.to_le_bytes())
        .take(returned as usize)
        .collect();
    parse_link(&data).ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "not a link"))
}

/// The target in a REPARSE_DATA_BUFFER of a symlink or junction.
fn parse_link(data: &[u8]) -> Option<PathBuf> {
    let word = |at: usize| Some(u16::from_le_bytes(data.get(at..at + 2)?.try_into().ok()?));
    let tag = u32::from_le_bytes(data.get(0..4)?.try_into().ok()?);
    // Tag, length and reserved words, four name offsets and lengths, then
    // (for a symlink only) flags, then the names.
    let paths = match tag {
        IO_REPARSE_TAG_SYMLINK => 20,
        IO_REPARSE_TAG_MOUNT_POINT => 16,
        _ => return None,
    };
    let (print_offset, print_length) = (usize::from(word(12)?), usize::from(word(14)?));
    let (sub_offset, sub_length) = (usize::from(word(8)?), usize::from(word(10)?));
    let read = |offset: usize, length: usize| -> Option<OsString> {
        let bytes = data.get(paths + offset..paths + offset + length)?;
        let units: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        Some(OsString::from_wide(&units))
    };
    // The print name is what the person sees; the substitute name has the
    // `\??\` prefix and is used when no print name was stored.
    let target = match read(print_offset, print_length).filter(|name| !name.is_empty()) {
        Some(name) => name,
        None => {
            let name = read(sub_offset, sub_length)?;
            let text = name.to_string_lossy().into_owned();
            OsString::from(text.strip_prefix(r"\??\").unwrap_or(&text))
        }
    };
    Some(PathBuf::from(target))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn link_data_reads_back_its_target() {
        fn buffer(tag: u32, print: &str, substitute: &str, flags: Option<u32>) -> Vec<u8> {
            let print: Vec<u8> = print.encode_utf16().flat_map(u16::to_le_bytes).collect();
            let substitute: Vec<u8> = substitute
                .encode_utf16()
                .flat_map(u16::to_le_bytes)
                .collect();
            let mut data = tag.to_le_bytes().to_vec();
            data.extend([0u8; 4]);
            for value in [
                0u16,
                substitute.len() as u16,
                substitute.len() as u16,
                print.len() as u16,
            ] {
                data.extend(value.to_le_bytes());
            }
            if let Some(flags) = flags {
                data.extend(flags.to_le_bytes());
            }
            data.extend(substitute);
            data.extend(print);
            data
        }
        let link = buffer(IO_REPARSE_TAG_SYMLINK, "..\\shared", "..\\shared", Some(1));
        assert_eq!(parse_link(&link), Some(PathBuf::from("..\\shared")));
        let junction = buffer(IO_REPARSE_TAG_MOUNT_POINT, "", "\\??\\C:\\data", None);
        assert_eq!(parse_link(&junction), Some(PathBuf::from("C:\\data")));
        assert_eq!(parse_link(&0x9000_001Au32.to_le_bytes()), None);
    }
}
