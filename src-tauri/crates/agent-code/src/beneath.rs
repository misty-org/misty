//! File access that can never leave a project folder.
//!
//! Commands inside the project can create symlinks anywhere, and Misty's own
//! file tools run outside the sandbox. So every path is opened one component
//! at a time with `O_NOFOLLOW`, starting from the project's directory handle:
//! a symlink at any depth is refused, and a directory swapped for a symlink
//! between a check and an open is refused too.
use std::{
    ffi::{CString, OsStr},
    fs::File,
    io,
    os::{
        fd::{AsRawFd, FromRawFd},
        unix::ffi::OsStrExt,
    },
    path::{Component, Path, PathBuf},
};

use crate::CodeError;

/// Relative path inside a project, validated: no root, no `..`, no empty parts.
pub fn clean_relative(value: &str) -> Result<PathBuf, CodeError> {
    let trimmed = value.trim().trim_start_matches("./").trim_matches('/');
    if trimmed.contains('\0') {
        return Err(CodeError::fix("Paths can't contain NUL characters."));
    }
    let path = Path::new(trimmed);
    let mut clean = PathBuf::new();
    for part in path.components() {
        match part {
            Component::Normal(name) => clean.push(name),
            Component::CurDir => {}
            _ => {
                return Err(CodeError::fix(
                    "Use a path inside the project, relative to its top folder.",
                ))
            }
        }
    }
    if clean.as_os_str().len() > 1024 {
        return Err(CodeError::fix("That path is too long."));
    }
    Ok(clean)
}

/// Names Misty never reads or writes for an agent: secrets and Git internals.
/// `.env.example` and similar templates stay readable.
pub fn protected(relative: &Path) -> Option<&'static str> {
    for part in relative.components() {
        if let Some(reason) = internal_folder(&part.as_os_str().to_string_lossy()) {
            return Some(reason);
        }
    }
    let file = relative
        .file_name()
        .map(|name| name.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if is_secret_name(&file) {
        return Some("Environment and key files can hold secrets, so agents can't open them. Use .env.example for placeholders.");
    }
    None
}

/// Git's and Misty's own folders, by any case: macOS volumes are usually
/// case-insensitive, so `.GIT` opens the real `.git`.
pub fn internal_folder(name: &str) -> Option<&'static str> {
    match name.to_lowercase().as_str() {
        ".git" => Some("Git's own files are off limits to agents."),
        ".misty" => Some("Misty's own project files are off limits to agents."),
        _ => None,
    }
}

pub fn is_secret_name(file: &str) -> bool {
    let env = file == ".env"
        || (file.starts_with(".env.")
            && ![".example", ".sample", ".template", ".dist"]
                .iter()
                .any(|suffix| file.ends_with(suffix)));
    env || file.ends_with(".pem")
        || file.ends_with(".key")
        || file == "id_rsa"
        || file == "id_ed25519"
        || file == ".npmrc"
        || file == ".netrc"
        || file == ".pypirc"
}

fn c_name(name: &OsStr) -> io::Result<CString> {
    CString::new(name.as_bytes()).map_err(|_| io::Error::from(io::ErrorKind::InvalidInput))
}

fn cvt(value: libc::c_int) -> io::Result<libc::c_int> {
    if value < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(value)
    }
}

/// The project's top folder, opened as a directory handle.
pub fn open_root(root: &Path) -> io::Result<File> {
    let path = CString::new(root.as_os_str().as_bytes())
        .map_err(|_| io::Error::from(io::ErrorKind::InvalidInput))?;
    let fd = cvt(unsafe {
        libc::open(
            path.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC,
        )
    })?;
    Ok(unsafe { File::from_raw_fd(fd) })
}

fn open_at(dir: &File, name: &OsStr, flags: libc::c_int, mode: libc::c_uint) -> io::Result<File> {
    let name = c_name(name)?;
    let fd = cvt(unsafe {
        libc::openat(
            dir.as_raw_fd(),
            name.as_ptr(),
            flags | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            mode,
        )
    })?;
    Ok(unsafe { File::from_raw_fd(fd) })
}

/// Opens the directory that holds `relative`, creating missing folders when
/// asked. Returns that directory and the final name.
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
    let guarded: Vec<(u64, u64)> = [".git", ".misty"]
        .iter()
        .filter_map(|name| identity_at(root, OsStr::new(name)))
        .collect();
    let mut current = root.try_clone()?;
    for folder in folders {
        current = match open_at(&current, folder, libc::O_RDONLY | libc::O_DIRECTORY, 0) {
            Ok(next) => next,
            Err(error) if create && error.kind() == io::ErrorKind::NotFound => {
                let name = c_name(folder)?;
                let made = unsafe { libc::mkdirat(current.as_raw_fd(), name.as_ptr(), 0o755) };
                if made < 0 {
                    let error = io::Error::last_os_error();
                    if error.kind() != io::ErrorKind::AlreadyExists {
                        return Err(error);
                    }
                }
                open_at(&current, folder, libc::O_RDONLY | libc::O_DIRECTORY, 0)?
            }
            Err(error) => return Err(error),
        };
        if guarded.contains(&identity(&current)?) {
            return Err(io::Error::from(io::ErrorKind::PermissionDenied));
        }
    }
    Ok((current, last))
}

fn identity(file: &File) -> io::Result<(u64, u64)> {
    use std::os::unix::fs::MetadataExt;
    let metadata = file.metadata()?;
    Ok((metadata.dev(), metadata.ino()))
}

/// Device and inode of an entry, without following a symlink.
fn identity_at(dir: &File, name: &OsStr) -> Option<(u64, u64)> {
    let name = c_name(name).ok()?;
    let mut stat: libc::stat = unsafe { std::mem::zeroed() };
    let found = unsafe {
        libc::fstatat(dir.as_raw_fd(), name.as_ptr(), &mut stat, libc::AT_SYMLINK_NOFOLLOW)
    };
    (found == 0).then_some((stat.st_dev as u64, stat.st_ino as u64))
}

/// Opens a regular file for reading. Symlinks and special files are refused.
pub fn open_file(root: &File, relative: &Path) -> io::Result<File> {
    let (dir, name) = open_parent(root, relative, false)?;
    let file = open_at(&dir, name, libc::O_RDONLY | libc::O_NONBLOCK, 0)?;
    if !file.metadata()?.is_file() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "not a regular file"));
    }
    Ok(file)
}

/// Opens a directory inside the project (the root itself for an empty path).
pub fn open_dir(root: &File, relative: &Path) -> io::Result<File> {
    if relative.as_os_str().is_empty() {
        return root.try_clone();
    }
    let (dir, name) = open_parent(root, relative, false)?;
    open_at(&dir, name, libc::O_RDONLY | libc::O_DIRECTORY, 0)
}

/// What sits at a path, without following a final symlink.
pub enum Entry {
    Missing,
    File { mode: u32 },
    Directory,
    Symlink,
    Other,
}

pub fn entry(dir: &File, name: &OsStr) -> io::Result<Entry> {
    let name = c_name(name)?;
    let mut stat: libc::stat = unsafe { std::mem::zeroed() };
    let result = unsafe {
        libc::fstatat(
            dir.as_raw_fd(),
            name.as_ptr(),
            &mut stat,
            libc::AT_SYMLINK_NOFOLLOW,
        )
    };
    if result < 0 {
        let error = io::Error::last_os_error();
        return if error.kind() == io::ErrorKind::NotFound {
            Ok(Entry::Missing)
        } else {
            Err(error)
        };
    }
    Ok(match stat.st_mode & libc::S_IFMT {
        libc::S_IFREG => Entry::File {
            mode: (stat.st_mode & 0o7777) as u32,
        },
        libc::S_IFDIR => Entry::Directory,
        libc::S_IFLNK => Entry::Symlink,
        _ => Entry::Other,
    })
}

/// Replaces (or creates) a file atomically: the bytes go to a temporary file
/// in the same folder, which is then renamed over the target. A symlink at the
/// target is refused rather than written through.
pub fn write_file(root: &File, relative: &Path, bytes: &[u8]) -> io::Result<bool> {
    write_file_mode(root, relative, bytes, None)
}

/// [`write_file`] with an explicit permission mode (undo restores modes).
pub fn write_file_mode(
    root: &File,
    relative: &Path,
    bytes: &[u8],
    mode: Option<u32>,
) -> io::Result<bool> {
    use std::io::Write;
    let (dir, name) = open_parent(root, relative, true)?;
    let (created, mode) = match entry(&dir, name)? {
        Entry::Missing => (true, mode.unwrap_or(0o644) & 0o777),
        Entry::File { mode: current } => (false, mode.unwrap_or(current) & 0o777),
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
    let temp = OsStr::new(&temp_name);
    let mut file = open_at(
        &dir,
        temp,
        libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL,
        mode as libc::c_uint,
    )?;
    let written = file
        .write_all(bytes)
        .and_then(|_| {
            // O_CREAT applies the umask; set the intended mode explicitly.
            cvt(unsafe { libc::fchmod(file.as_raw_fd(), mode as libc::mode_t) }).map(|_| ())
        })
        .and_then(|_| file.sync_data());
    let temp_c = c_name(temp)?;
    if let Err(error) = written {
        unsafe { libc::unlinkat(dir.as_raw_fd(), temp_c.as_ptr(), 0) };
        return Err(error);
    }
    let target = c_name(name)?;
    let renamed = unsafe {
        libc::renameat(
            dir.as_raw_fd(),
            temp_c.as_ptr(),
            dir.as_raw_fd(),
            target.as_ptr(),
        )
    };
    if renamed < 0 {
        let error = io::Error::last_os_error();
        unsafe { libc::unlinkat(dir.as_raw_fd(), temp_c.as_ptr(), 0) };
        return Err(error);
    }
    Ok(created)
}

/// Removes one file or empty folder inside the project, never following links.
pub fn remove(root: &File, relative: &Path, directory: bool) -> io::Result<()> {
    let (dir, name) = open_parent(root, relative, false)?;
    let name = c_name(name)?;
    let flags = if directory { libc::AT_REMOVEDIR } else { 0 };
    cvt(unsafe { libc::unlinkat(dir.as_raw_fd(), name.as_ptr(), flags) }).map(|_| ())
}

/// Removes a folder and everything in it, through directory handles only:
/// no path is ever resolved again, and a symlink anywhere is removed as a
/// link, never followed.
pub fn remove_tree(root: &File, relative: &Path) -> io::Result<()> {
    let (parent, name) = open_parent(root, relative, false)?;
    remove_entry(&parent, name, 0)
}

fn remove_entry(dir: &File, name: &OsStr, depth: usize) -> io::Result<()> {
    if depth > 256 {
        return Err(io::Error::from(io::ErrorKind::InvalidInput));
    }
    let c = c_name(name)?;
    match entry(dir, name)? {
        Entry::Missing => Ok(()),
        Entry::Directory => {
            let child = open_at(dir, name, libc::O_RDONLY | libc::O_DIRECTORY, 0)?;
            for inner in list_names(&child)? {
                remove_entry(&child, OsStr::new(&inner), depth + 1)?;
            }
            cvt(unsafe { libc::unlinkat(dir.as_raw_fd(), c.as_ptr(), libc::AT_REMOVEDIR) }).map(|_| ())
        }
        _ => cvt(unsafe { libc::unlinkat(dir.as_raw_fd(), c.as_ptr(), 0) }).map(|_| ()),
    }
}

fn list_names(dir: &File) -> io::Result<Vec<std::ffi::OsString>> {
    let fd = unsafe { libc::dup(dir.as_raw_fd()) };
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    let stream = unsafe { libc::fdopendir(fd) };
    if stream.is_null() {
        unsafe { libc::close(fd) };
        return Err(io::Error::last_os_error());
    }
    let mut names = Vec::new();
    loop {
        let entry = unsafe { libc::readdir(stream) };
        if entry.is_null() {
            break;
        }
        let name = unsafe { std::ffi::CStr::from_ptr((*entry).d_name.as_ptr()) };
        let bytes = name.to_bytes();
        if bytes != b"." && bytes != b".." {
            names.push(OsStr::from_bytes(bytes).to_os_string());
        }
    }
    unsafe { libc::closedir(stream) };
    Ok(names)
}

/// Creates a symlink inside the project (used only when undo restores one).
pub fn symlink(root: &File, relative: &Path, target: &Path) -> io::Result<()> {
    let (dir, name) = open_parent(root, relative, true)?;
    let name = c_name(name)?;
    let target = CString::new(target.as_os_str().as_bytes())
        .map_err(|_| io::Error::from(io::ErrorKind::InvalidInput))?;
    cvt(unsafe { libc::symlinkat(target.as_ptr(), dir.as_raw_fd(), name.as_ptr()) }).map(|_| ())
}

/// Reads a symlink's target without following it.
pub fn read_link(root: &File, relative: &Path) -> io::Result<PathBuf> {
    let (dir, name) = open_parent(root, relative, false)?;
    let name = c_name(name)?;
    let mut buffer = vec![0u8; 4096];
    let length = unsafe {
        libc::readlinkat(
            dir.as_raw_fd(),
            name.as_ptr(),
            buffer.as_mut_ptr() as *mut libc::c_char,
            buffer.len(),
        )
    };
    if length < 0 {
        return Err(io::Error::last_os_error());
    }
    buffer.truncate(length as usize);
    Ok(PathBuf::from(OsStr::from_bytes(&buffer)))
}
