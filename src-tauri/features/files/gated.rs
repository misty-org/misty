use std::{
    ffi::{OsStr, OsString},
    fs::Metadata,
    io,
    path::Path,
};

use file_access::disk::{walk::WalkFor, CheckedDir, CheckedFile as File};
use file_access::Access;

pub(crate) fn split(path: &Path) -> io::Result<(&Path, &OsStr)> {
    match (path.parent(), path.file_name()) {
        (Some(parent), Some(name)) => Ok((parent, name)),
        _ => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "A whole drive can't be used here.",
        )),
    }
}

pub(crate) fn dir(path: &Path, access: Access, who: WalkFor) -> io::Result<CheckedDir> {
    match who {
        WalkFor::Person => CheckedDir::open(path, access),
        WalkFor::Agent => CheckedDir::open_for_agent(path, access),
    }
}

pub(crate) fn parent(path: &Path, access: Access) -> io::Result<(CheckedDir, OsString)> {
    parent_for(path, access, WalkFor::Person)
}

pub(crate) fn parent_for(
    path: &Path,
    access: Access,
    who: WalkFor,
) -> io::Result<(CheckedDir, OsString)> {
    let (folder, name) = split(path)?;
    Ok((dir(folder, access, who)?, name.to_owned()))
}

pub(crate) fn open_read(path: &Path) -> io::Result<File> {
    open_read_for(path, WalkFor::Person)
}

pub(crate) fn open_read_for(path: &Path, who: WalkFor) -> io::Result<File> {
    let (folder, name) = parent_for(path, Access::Read, who)?;
    folder.open_file(&name)
}

pub(crate) fn stat(path: &Path) -> io::Result<Metadata> {
    let (folder, name) = parent(path, Access::Read)?;
    folder.metadata(&name)
}

pub(crate) fn is_dir(path: &Path) -> bool {
    stat(path).is_ok_and(|meta| meta.is_dir())
}

pub(crate) fn holds(folder: &CheckedDir, name: &OsStr) -> io::Result<bool> {
    match folder.metadata(name) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

pub(crate) fn make_folder_keep_both(folder: &CheckedDir, wanted: &str) -> io::Result<OsString> {
    let first = std::iter::once(wanted.to_owned());
    for name in first.chain(file_access::disk::place::keep_both_names(wanted)) {
        let name = OsString::from(name);
        match folder.create_dir(&name) {
            Ok(()) => return Ok(name),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "Every name like this one is taken.",
    ))
}

pub(crate) fn create_file_keep_both(
    folder: &CheckedDir,
    wanted: &str,
) -> io::Result<(OsString, File)> {
    let first = std::iter::once(wanted.to_owned());
    for name in first.chain(file_access::disk::place::keep_both_names(wanted)) {
        let name = OsString::from(name);
        match folder.create_file(&name) {
            Ok(file) => return Ok((name, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "Every name like this one is taken.",
    ))
}

pub(crate) fn is_cancel(error: &io::Error) -> bool {
    error.kind() == io::ErrorKind::Interrupted
}

pub(crate) fn cancelled() -> io::Error {
    io::Error::new(io::ErrorKind::Interrupted, "Cancelled.")
}
