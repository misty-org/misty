//! `std::fs`, through the gate. Each function has the standard signature and checks the path first,
//! so swapping `use std::fs` for this is the whole change at a call site.
// Some of these only have callers on one platform.
#![cfg_attr(windows, allow(dead_code))]
use std::{
    fs, io,
    path::{Path, PathBuf},
};

#[cfg(windows)]
pub use super::fs_handles::null_device;
pub use super::fs_handles::{DirBuilder, File, OpenOptions};
pub use std::fs::{Metadata, Permissions, ReadDir};

use super::{check, check_link, Access};

pub fn read(path: impl AsRef<Path>) -> io::Result<Vec<u8>> {
    check(path.as_ref(), Access::Read)?;
    fs::read(path)
}

pub fn read_to_string(path: impl AsRef<Path>) -> io::Result<String> {
    check(path.as_ref(), Access::Read)?;
    fs::read_to_string(path)
}

pub fn write(path: impl AsRef<Path>, contents: impl AsRef<[u8]>) -> io::Result<()> {
    check(path.as_ref(), Access::Write)?;
    fs::write(path, contents)
}

pub fn create_dir(path: impl AsRef<Path>) -> io::Result<()> {
    check(path.as_ref(), Access::Write)?;
    fs::create_dir(path)
}

pub fn create_dir_all(path: impl AsRef<Path>) -> io::Result<()> {
    check(path.as_ref(), Access::Write)?;
    fs::create_dir_all(path)
}

pub fn remove_file(path: impl AsRef<Path>) -> io::Result<()> {
    check_link(path.as_ref(), Access::Write)?;
    fs::remove_file(path)
}

pub fn remove_dir(path: impl AsRef<Path>) -> io::Result<()> {
    check_link(path.as_ref(), Access::Write)?;
    fs::remove_dir(path)
}

/// Removes a link rather than following it, and doesn't follow links inside the folder either.
pub fn remove_dir_all(path: impl AsRef<Path>) -> io::Result<()> {
    check_link(path.as_ref(), Access::Write)?;
    fs::remove_dir_all(path)
}

pub fn rename(from: impl AsRef<Path>, to: impl AsRef<Path>) -> io::Result<()> {
    check_link(from.as_ref(), Access::Write)?;
    check_link(to.as_ref(), Access::Write)?;
    fs::rename(from, to)
}

pub fn copy(from: impl AsRef<Path>, to: impl AsRef<Path>) -> io::Result<u64> {
    check(from.as_ref(), Access::Read)?;
    check(to.as_ref(), Access::Write)?;
    fs::copy(from, to)
}

pub fn metadata(path: impl AsRef<Path>) -> io::Result<Metadata> {
    check(path.as_ref(), Access::Read)?;
    fs::metadata(path)
}

pub fn symlink_metadata(path: impl AsRef<Path>) -> io::Result<Metadata> {
    check_link(path.as_ref(), Access::Read)?;
    fs::symlink_metadata(path)
}

pub fn read_link(path: impl AsRef<Path>) -> io::Result<PathBuf> {
    check_link(path.as_ref(), Access::Read)?;
    fs::read_link(path)
}

pub fn read_dir(path: impl AsRef<Path>) -> io::Result<ReadDir> {
    check(path.as_ref(), Access::Read)?;
    fs::read_dir(path)
}

pub fn canonicalize(path: impl AsRef<Path>) -> io::Result<PathBuf> {
    check(path.as_ref(), Access::Read)?;
    fs::canonicalize(path)
}

pub fn set_permissions(path: impl AsRef<Path>, permissions: Permissions) -> io::Result<()> {
    check(path.as_ref(), Access::Write)?;
    fs::set_permissions(path, permissions)
}

/// Makes a link. Only where the link goes is checked: its target stays refused unless something
/// else allows it, because reading through a link is checked at the target.
#[cfg(unix)]
pub fn symlink(target: impl AsRef<Path>, link: impl AsRef<Path>) -> io::Result<()> {
    check_link(link.as_ref(), Access::Write)?;
    std::os::unix::fs::symlink(target, link)
}

/// Makes a folder link, on the same terms as `symlink`.
#[cfg(windows)]
pub fn symlink_dir(target: impl AsRef<Path>, link: impl AsRef<Path>) -> io::Result<()> {
    check_link(link.as_ref(), Access::Write)?;
    std::os::windows::fs::symlink_dir(target, link)
}

/// `Path::exists`: false for anything refused, as for anything missing.
pub fn exists(path: impl AsRef<Path>) -> bool {
    metadata(path).is_ok()
}

/// `Path::is_file`: false for anything refused.
pub fn is_file(path: impl AsRef<Path>) -> bool {
    metadata(path).is_ok_and(|metadata| metadata.is_file())
}

/// `Path::is_dir`: false for anything refused.
pub fn is_dir(path: impl AsRef<Path>) -> bool {
    metadata(path).is_ok_and(|metadata| metadata.is_dir())
}

/// `rusqlite::Connection::open`: a database is a file like any other.
pub fn open_sqlite(path: impl AsRef<Path>) -> rusqlite::Result<rusqlite::Connection> {
    check(path.as_ref(), Access::Write).map_err(sqlite_refused)?;
    rusqlite::Connection::open(path)
}

/// `rusqlite::Connection::open_with_flags`, on the same terms.
pub fn open_sqlite_with_flags(
    path: impl AsRef<Path>,
    flags: rusqlite::OpenFlags,
) -> rusqlite::Result<rusqlite::Connection> {
    check(path.as_ref(), Access::Write).map_err(sqlite_refused)?;
    rusqlite::Connection::open_with_flags(path, flags)
}

fn sqlite_refused(error: io::Error) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(error))
}
