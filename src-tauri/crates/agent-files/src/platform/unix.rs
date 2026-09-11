//! Unix: `openat` with `O_NOFOLLOW`, and renames that never replace.
use std::{
    ffi::CString,
    fs::{DirEntry, File, OpenOptions},
    io,
    os::{
        fd::{AsRawFd, FromRawFd},
        unix::fs::{MetadataExt, OpenOptionsExt},
    },
    path::{Path, PathBuf},
};

use crate::{err, Fingerprint, Result};

pub(crate) fn fingerprint(file: &File) -> Result<Fingerprint> {
    let m = file.metadata().map_err(err)?;
    Ok(Fingerprint {
        device: m.dev(),
        inode: m.ino(),
        size: m.len(),
        modified: m.mtime(),
        nanos: m.mtime_nsec(),
    })
}

fn cstring(s: &str) -> Result<CString> {
    CString::new(s).map_err(err)
}
pub(crate) fn child(dir: &File, name: &str, directory: bool) -> Result<File> {
    let name = cstring(name)?;
    let flags = libc::O_RDONLY
        | libc::O_CLOEXEC
        | libc::O_NOFOLLOW
        | libc::O_NONBLOCK
        | if directory { libc::O_DIRECTORY } else { 0 };
    let fd = unsafe { libc::openat(dir.as_raw_fd(), name.as_ptr(), flags) };
    if fd < 0 {
        return Err(err(io::Error::last_os_error()));
    }
    Ok(unsafe { File::from_raw_fd(fd) })
}

pub(crate) fn absent(dir: &File, name: &str) -> Result<()> {
    let name = cstring(name)?;
    let mut m = std::mem::MaybeUninit::<libc::stat>::uninit();
    let result = unsafe {
        libc::fstatat(
            dir.as_raw_fd(),
            name.as_ptr(),
            m.as_mut_ptr(),
            libc::AT_SYMLINK_NOFOLLOW,
        )
    };
    if result == 0 {
        return Err("Destination already exists; nothing was overwritten".into());
    }
    let error = io::Error::last_os_error();
    if error.kind() != io::ErrorKind::NotFound {
        return Err(err(error));
    }
    Ok(())
}
pub(crate) fn rename_exclusive(
    from: &File,
    source: &str,
    to: &File,
    destination: &str,
) -> Result<()> {
    let source = cstring(source)?;
    let destination = cstring(destination)?;
    #[cfg(target_os = "macos")]
    let result = unsafe {
        libc::renameatx_np(
            from.as_raw_fd(),
            source.as_ptr(),
            to.as_raw_fd(),
            destination.as_ptr(),
            libc::RENAME_EXCL,
        )
    };
    #[cfg(target_os = "linux")]
    let result = unsafe {
        libc::renameat2(
            from.as_raw_fd(),
            source.as_ptr(),
            to.as_raw_fd(),
            destination.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    return Err("Atomic no-replace moves are unavailable on this platform".into());
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    if result != 0 {
        return Err(err(io::Error::last_os_error()));
    }
    Ok(())
}

/// The chosen folder itself, never through a final link.
pub(crate) fn open_root(path: &Path) -> Result<File> {
    OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
        .open(path)
        .map_err(err)
}

pub(crate) fn make_folder(dir: &File, name: &str) -> Result<()> {
    let name = cstring(name)?;
    if unsafe { libc::mkdirat(dir.as_raw_fd(), name.as_ptr(), 0o755) } != 0 {
        return Err(err(io::Error::last_os_error()));
    }
    Ok(())
}

/// Removes an empty folder.
pub(crate) fn remove_folder(dir: &File, name: &str) -> Result<()> {
    let name = cstring(name)?;
    if unsafe { libc::unlinkat(dir.as_raw_fd(), name.as_ptr(), libc::AT_REMOVEDIR) } != 0 {
        return Err(err(io::Error::last_os_error()));
    }
    Ok(())
}

/// Makes a folder's changes durable.
pub(crate) fn sync_folder(dir: &File) -> Result<()> {
    dir.sync_all().map_err(err)
}

/// Journal files are readable by this account only.
pub(crate) fn private(options: &mut OpenOptions) {
    options.mode(0o600);
}

pub(crate) fn is_link(entry: &DirEntry) -> bool {
    entry
        .file_type()
        .map(|kind| kind.is_symlink())
        .unwrap_or(true)
}

/// The path as given; only Windows adds a prefix to canonical paths.
pub(crate) fn plain(path: &Path) -> PathBuf {
    path.to_path_buf()
}

/// Whole disks, home directories and operating-system folders are never
/// organization scopes.
pub(crate) fn refused_scope(canonical: &Path) -> bool {
    canonical.components().count() < 4
        || [
            "/System",
            "/Library",
            "/Applications",
            "/bin",
            "/sbin",
            "/usr",
            "/etc",
            "/private/etc",
            "/private/var/db",
            "/dev",
            "/proc",
            "/sys",
        ]
        .iter()
        .any(|p| canonical.starts_with(p))
        || std::env::var_os("HOME").is_some_and(|home| {
            canonical == Path::new(&home) || canonical.starts_with(Path::new(&home).join("Library"))
        })
}
