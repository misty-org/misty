use std::{io, time::SystemTime};

use super::checked::ItemKind;

#[derive(Clone, Copy, Debug)]
pub(crate) struct Stat {
    pub kind: ItemKind,
    pub len: u64,
    pub mode: u32,
    pub ino: u64,
    pub dev: u64,
    #[cfg_attr(not(unix), allow(dead_code))]
    pub uid: u32,
    pub flags: u32,
    pub modified: Option<SystemTime>,
    pub created: Option<SystemTime>,
}

pub(crate) fn link_error(error: &io::Error) -> bool {
    #[cfg(unix)]
    {
        error.raw_os_error() == Some(libc::ELOOP)
    }
    #[cfg(not(unix))]
    {
        let _ = error;
        false
    }
}

#[cfg(unix)]
mod imp {
    use std::{
        ffi::{CStr, CString, OsStr, OsString},
        fs::File,
        io,
        os::{
            fd::{AsRawFd, FromRawFd, IntoRawFd, OwnedFd, RawFd},
            unix::ffi::{OsStrExt, OsStringExt},
        },
        path::{Component, Path, PathBuf},
        time::{Duration, SystemTime, UNIX_EPOCH},
    };

    use super::{ItemKind, Stat};

    const DIR_FLAGS: libc::c_int =
        libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC;

    #[derive(Debug)]
    pub(crate) struct Dir {
        fd: OwnedFd,
    }

    fn name_text(name: &OsStr) -> io::Result<CString> {
        CString::new(name.as_bytes())
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "That name can't be used."))
    }

    fn checked(status: libc::c_int) -> io::Result<libc::c_int> {
        if status < 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(status)
        }
    }

    fn owned(fd: libc::c_int) -> OwnedFd {
        // SAFETY: fd was just returned open by the kernel and nothing else owns it.
        unsafe { OwnedFd::from_raw_fd(fd) }
    }

    fn time(secs: i64, nanos: i64) -> Option<SystemTime> {
        if secs >= 0 {
            UNIX_EPOCH.checked_add(Duration::new(
                secs as u64,
                nanos.clamp(0, 999_999_999) as u32,
            ))
        } else {
            UNIX_EPOCH.checked_sub(Duration::from_secs(secs.unsigned_abs()))
        }
    }

    fn stat_from(raw: &libc::stat) -> Stat {
        let format = raw.st_mode & libc::S_IFMT;
        let kind = if format == libc::S_IFDIR {
            ItemKind::Dir
        } else if format == libc::S_IFREG {
            ItemKind::File
        } else if format == libc::S_IFLNK {
            ItemKind::Link
        } else {
            ItemKind::Other
        };
        #[cfg(target_os = "macos")]
        let created = time(raw.st_birthtime as i64, raw.st_birthtime_nsec as i64);
        #[cfg(not(target_os = "macos"))]
        let created = None;
        #[cfg(any(target_os = "macos", target_os = "ios", target_os = "freebsd"))]
        let flags = raw.st_flags as u32;
        #[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "freebsd")))]
        let flags = 0;
        Stat {
            kind,
            len: raw.st_size.max(0) as u64,
            mode: raw.st_mode as u32,
            ino: raw.st_ino as u64,
            dev: raw.st_dev as u64,
            uid: raw.st_uid as u32,
            flags,
            modified: time(raw.st_mtime as i64, raw.st_mtime_nsec as i64),
            created,
        }
    }

    fn clear_errno() {
        #[cfg(target_os = "macos")]
        // SAFETY: __error returns this thread's errno slot, which is always valid to write.
        unsafe {
            *libc::__error() = 0;
        }
        #[cfg(target_os = "linux")]
        // SAFETY: __errno_location returns this thread's errno slot, which is always valid to write.
        unsafe {
            *libc::__errno_location() = 0;
        }
    }

    pub(crate) fn fd_path(fd: RawFd) -> io::Result<Option<PathBuf>> {
        #[cfg(target_os = "macos")]
        {
            let mut buffer = vec![0u8; libc::MAXPATHLEN as usize + 1];
            // SAFETY: F_GETPATH writes at most MAXPATHLEN bytes, NUL-terminated, into the buffer,
            // which is one byte larger than that.
            checked(unsafe { libc::fcntl(fd, libc::F_GETPATH, buffer.as_mut_ptr()) })?;
            let text = CStr::from_bytes_until_nul(&buffer)
                .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "No path came back."))?;
            Ok(Some(PathBuf::from(OsStr::from_bytes(text.to_bytes()))))
        }
        #[cfg(target_os = "linux")]
        {
            Ok(std::fs::read_link(format!("/proc/self/fd/{fd}")).ok())
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        {
            let _ = fd;
            Ok(None)
        }
    }

    pub(crate) fn file_path(file: &File) -> io::Result<Option<PathBuf>> {
        fd_path(file.as_raw_fd())
    }

    impl Dir {
        pub(crate) fn open_real(real: &Path) -> io::Result<Dir> {
            // SAFETY: a static NUL-terminated path; the descriptor is owned right after.
            let fd = checked(unsafe {
                libc::open(
                    c"/".as_ptr(),
                    libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC,
                )
            })?;
            let mut dir = Dir { fd: owned(fd) };
            for part in real.components() {
                match part {
                    Component::RootDir => {}
                    Component::Normal(name) => dir = dir.open_dir(name)?,
                    _ => {
                        return Err(io::Error::new(
                            io::ErrorKind::InvalidInput,
                            "That path isn't a real one.",
                        ))
                    }
                }
            }
            Ok(dir)
        }

        pub(crate) fn open_dir(&self, name: &OsStr) -> io::Result<Dir> {
            let name = name_text(name)?;
            // SAFETY: self.fd is an open directory and name is NUL-terminated.
            let fd =
                checked(unsafe { libc::openat(self.fd.as_raw_fd(), name.as_ptr(), DIR_FLAGS) })?;
            Ok(Dir { fd: owned(fd) })
        }

        fn reopen(&self) -> io::Result<Dir> {
            // SAFETY: self.fd is an open directory; "." names that same directory.
            let fd = checked(unsafe {
                libc::openat(
                    self.fd.as_raw_fd(),
                    c".".as_ptr(),
                    libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC,
                )
            })?;
            Ok(Dir { fd: owned(fd) })
        }

        pub(crate) fn path(&self) -> io::Result<Option<PathBuf>> {
            fd_path(self.fd.as_raw_fd())
        }

        pub(crate) fn stat(&self) -> io::Result<Stat> {
            // SAFETY: an all-zero stat is a valid value of this plain C struct.
            let mut raw: libc::stat = unsafe { std::mem::zeroed() };
            // SAFETY: self.fd is open and raw is a writable stat.
            checked(unsafe { libc::fstat(self.fd.as_raw_fd(), &mut raw) })?;
            Ok(stat_from(&raw))
        }

        pub(crate) fn stat_at(&self, name: &OsStr) -> io::Result<Stat> {
            let name = name_text(name)?;
            // SAFETY: an all-zero stat is a valid value of this plain C struct.
            let mut raw: libc::stat = unsafe { std::mem::zeroed() };
            // SAFETY: self.fd is an open directory, name is NUL-terminated and raw is writable.
            checked(unsafe {
                libc::fstatat(
                    self.fd.as_raw_fd(),
                    name.as_ptr(),
                    &mut raw,
                    libc::AT_SYMLINK_NOFOLLOW,
                )
            })?;
            Ok(stat_from(&raw))
        }

        pub(crate) fn names(&self) -> io::Result<Vec<OsString>> {
            let raw = self.reopen()?.fd.into_raw_fd();
            // SAFETY: raw is an open directory descriptor we own; fdopendir takes it over on success.
            let stream = unsafe { libc::fdopendir(raw) };
            if stream.is_null() {
                let error = io::Error::last_os_error();
                // SAFETY: fdopendir failed, so raw is still ours to close, once.
                unsafe { libc::close(raw) };
                return Err(error);
            }
            let mut names = Vec::new();
            let result = loop {
                clear_errno();
                // SAFETY: stream is a valid DIR* until closedir below.
                let entry = unsafe { libc::readdir(stream) };
                if entry.is_null() {
                    let error = io::Error::last_os_error();
                    break match error.raw_os_error() {
                        None | Some(0) => Ok(()),
                        Some(_) => Err(error),
                    };
                }
                // SAFETY: readdir returned a valid dirent whose d_name is NUL-terminated.
                let name = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) };
                let bytes = name.to_bytes();
                if bytes != b"." && bytes != b".." {
                    names.push(OsString::from_vec(bytes.to_vec()));
                }
            };
            // SAFETY: stream came from fdopendir and is closed exactly once.
            unsafe { libc::closedir(stream) };
            result.map(|()| names)
        }

        pub(crate) fn open_file(&self, name: &OsStr) -> io::Result<File> {
            let name = name_text(name)?;
            // SAFETY: self.fd is an open directory and name is NUL-terminated.
            let fd = checked(unsafe {
                libc::openat(
                    self.fd.as_raw_fd(),
                    name.as_ptr(),
                    libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK,
                )
            })?;
            let fd = owned(fd);
            // SAFETY: fd is open; F_GETFL takes no argument.
            let flags = checked(unsafe { libc::fcntl(fd.as_raw_fd(), libc::F_GETFL) })?;
            // SAFETY: fd is open; F_SETFL takes the flags as an int.
            checked(unsafe {
                libc::fcntl(fd.as_raw_fd(), libc::F_SETFL, flags & !libc::O_NONBLOCK)
            })?;
            Ok(File::from(fd))
        }

        pub(crate) fn create_file(&self, name: &OsStr, mode: u32) -> io::Result<File> {
            let name = name_text(name)?;
            // SAFETY: self.fd is an open directory, name is NUL-terminated, and O_CREAT takes the
            // mode as its one variadic argument.
            let fd = checked(unsafe {
                libc::openat(
                    self.fd.as_raw_fd(),
                    name.as_ptr(),
                    libc::O_WRONLY
                        | libc::O_CREAT
                        | libc::O_EXCL
                        | libc::O_NOFOLLOW
                        | libc::O_CLOEXEC,
                    mode as libc::c_uint,
                )
            })?;
            Ok(File::from(owned(fd)))
        }

        pub(crate) fn mkdir(&self, name: &OsStr, mode: u32) -> io::Result<()> {
            let name = name_text(name)?;
            // SAFETY: self.fd is an open directory and name is NUL-terminated.
            checked(unsafe {
                libc::mkdirat(self.fd.as_raw_fd(), name.as_ptr(), mode as libc::mode_t)
            })
            .map(drop)
        }

        pub(crate) fn unlink(&self, name: &OsStr) -> io::Result<()> {
            let name = name_text(name)?;
            // SAFETY: self.fd is an open directory and name is NUL-terminated.
            checked(unsafe { libc::unlinkat(self.fd.as_raw_fd(), name.as_ptr(), 0) }).map(drop)
        }

        pub(crate) fn rmdir(&self, name: &OsStr) -> io::Result<()> {
            let name = name_text(name)?;
            // SAFETY: self.fd is an open directory and name is NUL-terminated.
            checked(unsafe {
                libc::unlinkat(self.fd.as_raw_fd(), name.as_ptr(), libc::AT_REMOVEDIR)
            })
            .map(drop)
        }

        pub(crate) fn read_link(&self, name: &OsStr) -> io::Result<PathBuf> {
            let name = name_text(name)?;
            let mut size = 4096usize;
            loop {
                let mut buffer = vec![0u8; size];
                // SAFETY: self.fd is an open directory, name is NUL-terminated and the buffer has
                // `size` writable bytes.
                let length = unsafe {
                    libc::readlinkat(
                        self.fd.as_raw_fd(),
                        name.as_ptr(),
                        buffer.as_mut_ptr().cast(),
                        size,
                    )
                };
                if length < 0 {
                    return Err(io::Error::last_os_error());
                }
                let length = length as usize;
                if length < size {
                    buffer.truncate(length);
                    return Ok(PathBuf::from(OsString::from_vec(buffer)));
                }
                if size >= 1 << 20 {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "That link is too long.",
                    ));
                }
                size *= 4;
            }
        }

        pub(crate) fn symlink(
            &self,
            target: &Path,
            name: &OsStr,
            _original: &Path,
        ) -> io::Result<()> {
            let target = name_text(target.as_os_str())?;
            let name = name_text(name)?;
            // SAFETY: both strings are NUL-terminated and self.fd is an open directory.
            checked(unsafe { libc::symlinkat(target.as_ptr(), self.fd.as_raw_fd(), name.as_ptr()) })
                .map(drop)
        }

        pub(crate) fn set_mode(&self, mode: u32) -> io::Result<()> {
            // SAFETY: self.fd is open.
            checked(unsafe { libc::fchmod(self.fd.as_raw_fd(), mode as libc::mode_t) }).map(drop)
        }

        #[cfg(target_os = "macos")]
        pub(crate) fn set_mode_at(&self, name: &OsStr, mode: u32) -> io::Result<()> {
            let name = name_text(name)?;
            // SAFETY: self.fd is an open directory and name is NUL-terminated.
            checked(unsafe {
                libc::fchmodat(
                    self.fd.as_raw_fd(),
                    name.as_ptr(),
                    mode as libc::mode_t,
                    libc::AT_SYMLINK_NOFOLLOW,
                )
            })
            .map(drop)
        }

        pub(crate) fn set_modified(&self, modified: SystemTime) -> io::Result<()> {
            let since = modified.duration_since(UNIX_EPOCH).unwrap_or_default();
            let times = [
                libc::timespec {
                    tv_sec: 0,
                    tv_nsec: libc::UTIME_OMIT,
                },
                libc::timespec {
                    tv_sec: since.as_secs() as libc::time_t,
                    tv_nsec: since.subsec_nanos() as libc::c_long,
                },
            ];
            // SAFETY: self.fd is open and times points at two timespecs.
            checked(unsafe { libc::futimens(self.fd.as_raw_fd(), times.as_ptr()) }).map(drop)
        }

        pub(crate) fn raw(&self) -> RawFd {
            self.fd.as_raw_fd()
        }
    }

    pub(crate) fn rename(
        from_dir: &Dir,
        from: &OsStr,
        to_dir: &Dir,
        to: &OsStr,
        replace: bool,
    ) -> io::Result<()> {
        let (from, to) = (name_text(from)?, name_text(to)?);
        let (from_fd, to_fd) = (from_dir.raw(), to_dir.raw());
        if replace {
            // SAFETY: both descriptors are open directories and both names are NUL-terminated.
            return checked(unsafe { libc::renameat(from_fd, from.as_ptr(), to_fd, to.as_ptr()) })
                .map(drop);
        }
        #[cfg(target_os = "macos")]
        {
            // SAFETY: both descriptors are open directories and both names are NUL-terminated.
            checked(unsafe {
                libc::renameatx_np(
                    from_fd,
                    from.as_ptr(),
                    to_fd,
                    to.as_ptr(),
                    libc::RENAME_EXCL,
                )
            })
            .map(drop)
        }
        #[cfg(all(target_os = "linux", target_env = "gnu"))]
        {
            // SAFETY: both descriptors are open directories and both names are NUL-terminated.
            checked(unsafe {
                libc::renameat2(
                    from_fd,
                    from.as_ptr(),
                    to_fd,
                    to.as_ptr(),
                    libc::RENAME_NOREPLACE,
                )
            })
            .map(drop)
        }
        #[cfg(not(any(target_os = "macos", all(target_os = "linux", target_env = "gnu"))))]
        {
            let probe = to_dir.stat_at(OsStr::from_bytes(to.as_bytes()));
            match probe {
                Ok(_) => return Err(io::Error::from(io::ErrorKind::AlreadyExists)),
                Err(error) if error.kind() != io::ErrorKind::NotFound => return Err(error),
                Err(_) => {}
            }
            // SAFETY: both descriptors are open directories and both names are NUL-terminated.
            checked(unsafe { libc::renameat(from_fd, from.as_ptr(), to_fd, to.as_ptr()) }).map(drop)
        }
    }

    pub(crate) fn clone_file(source: &File, to_dir: &Dir, to: &OsStr) -> io::Result<bool> {
        #[cfg(target_os = "macos")]
        {
            const CLONE_NOOWNERCOPY: u32 = 0x0002;
            let to = name_text(to)?;
            // SAFETY: source is an open regular file, to_dir an open directory and the name is
            // NUL-terminated. fclonefileat clones from the open file, never by path.
            let status = unsafe {
                libc::fclonefileat(
                    source.as_raw_fd(),
                    to_dir.raw(),
                    to.as_ptr(),
                    CLONE_NOOWNERCOPY,
                )
            };
            if status == 0 {
                return Ok(true);
            }
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::EEXIST) {
                return Err(error);
            }
            Ok(false)
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (source, to_dir, to);
            Ok(false)
        }
    }
}

#[cfg(windows)]
mod imp {
    use std::{
        ffi::{OsStr, OsString},
        fs::{self, File},
        io,
        os::windows::{ffi::OsStrExt, fs::OpenOptionsExt},
        path::{Path, PathBuf},
        time::SystemTime,
    };

    use super::{ItemKind, Stat};

    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;

    #[derive(Debug)]
    pub(crate) struct Dir {
        path: PathBuf,
    }

    fn stat_from(meta: &fs::Metadata) -> Stat {
        let kind = if meta.file_type().is_symlink() {
            ItemKind::Link
        } else if meta.is_dir() {
            ItemKind::Dir
        } else if meta.is_file() {
            ItemKind::File
        } else {
            ItemKind::Other
        };
        Stat {
            kind,
            len: meta.len(),
            mode: if meta.permissions().readonly() {
                0o444
            } else {
                0o666
            },
            ino: 0,
            dev: 0,
            uid: 0,
            flags: 0,
            modified: meta.modified().ok(),
            created: meta.created().ok(),
        }
    }

    fn real_dir(path: PathBuf) -> io::Result<Dir> {
        let meta = fs::symlink_metadata(&path)?;
        if meta.file_type().is_symlink() {
            return Err(io::Error::from_raw_os_error(1921));
        }
        if !meta.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "That isn't a folder.",
            ));
        }
        Ok(Dir { path })
    }

    pub(crate) fn file_path(_file: &File) -> io::Result<Option<PathBuf>> {
        Ok(None)
    }

    impl Dir {
        pub(crate) fn open_real(real: &Path) -> io::Result<Dir> {
            real_dir(real.to_path_buf())
        }

        pub(crate) fn open_dir(&self, name: &OsStr) -> io::Result<Dir> {
            real_dir(self.path.join(name))
        }

        pub(crate) fn path(&self) -> io::Result<Option<PathBuf>> {
            Ok(None)
        }

        pub(crate) fn stat_at(&self, name: &OsStr) -> io::Result<Stat> {
            fs::symlink_metadata(self.path.join(name)).map(|meta| stat_from(&meta))
        }

        pub(crate) fn names(&self) -> io::Result<Vec<OsString>> {
            fs::read_dir(&self.path)?
                .map(|entry| entry.map(|entry| entry.file_name()))
                .collect()
        }

        pub(crate) fn open_file(&self, name: &OsStr) -> io::Result<File> {
            fs::OpenOptions::new()
                .read(true)
                .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
                .open(self.path.join(name))
        }

        pub(crate) fn create_file(&self, name: &OsStr, _mode: u32) -> io::Result<File> {
            fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(self.path.join(name))
        }

        pub(crate) fn mkdir(&self, name: &OsStr, _mode: u32) -> io::Result<()> {
            fs::create_dir(self.path.join(name))
        }

        pub(crate) fn unlink(&self, name: &OsStr) -> io::Result<()> {
            let path = self.path.join(name);
            match fs::symlink_metadata(&path) {
                Ok(meta)
                    if meta.file_type().is_symlink()
                        && fs::metadata(&path).is_ok_and(|m| m.is_dir()) =>
                {
                    fs::remove_dir(path)
                }
                _ => fs::remove_file(path),
            }
        }

        pub(crate) fn rmdir(&self, name: &OsStr) -> io::Result<()> {
            fs::remove_dir(self.path.join(name))
        }

        pub(crate) fn read_link(&self, name: &OsStr) -> io::Result<PathBuf> {
            fs::read_link(self.path.join(name))
        }

        pub(crate) fn symlink(
            &self,
            target: &Path,
            name: &OsStr,
            original: &Path,
        ) -> io::Result<()> {
            let link = self.path.join(name);
            if fs::metadata(original).is_ok_and(|meta| meta.is_dir()) {
                std::os::windows::fs::symlink_dir(target, link)
            } else {
                std::os::windows::fs::symlink_file(target, link)
            }
        }

        pub(crate) fn set_mode(&self, _mode: u32) -> io::Result<()> {
            Ok(())
        }

        pub(crate) fn set_modified(&self, _modified: SystemTime) -> io::Result<()> {
            Ok(())
        }
    }

    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str().encode_wide().chain(Some(0)).collect()
    }

    pub(crate) fn rename(
        from_dir: &Dir,
        from: &OsStr,
        to_dir: &Dir,
        to: &OsStr,
        replace: bool,
    ) -> io::Result<()> {
        let (source, target) = (from_dir.path.join(from), to_dir.path.join(to));
        if replace {
            return fs::rename(source, target);
        }
        let (source, target) = (wide(&source), wide(&target));
        // SAFETY: both are NUL-terminated wide strings that outlive the call. Without
        // MOVEFILE_REPLACE_EXISTING the move fails when the target exists.
        let moved = unsafe {
            windows_sys::Win32::Storage::FileSystem::MoveFileExW(
                source.as_ptr(),
                target.as_ptr(),
                0,
            )
        };
        if moved == 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }

    pub(crate) fn clone_file(_source: &File, _to_dir: &Dir, _to: &OsStr) -> io::Result<bool> {
        Ok(false)
    }
}

pub(crate) use imp::{clone_file, file_path, rename, Dir};
