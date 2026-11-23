// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
use std::{
    ffi::{OsStr, OsString},
    fs::File,
    io::{self, Read, Write},
    path::PathBuf,
};

use super::checked::{CheckedDir, Gate, ItemKind};
use super::{closed, closed_places, same_place, sys};
use crate::Access;

const CHUNK: usize = 1 << 20;

#[derive(Debug)]
pub(crate) struct Cancelled;

impl std::fmt::Display for Cancelled {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("Cancelled.")
    }
}

impl std::error::Error for Cancelled {}

pub(crate) fn cancelled() -> io::Error {
    io::Error::new(io::ErrorKind::Interrupted, Cancelled)
}

pub(crate) fn is_cancelled(error: &io::Error) -> bool {
    error.get_ref().is_some_and(|inner| inner.is::<Cancelled>())
}

fn counter_base(stem: &str) -> (&str, u32) {
    match stem.rsplit_once(' ') {
        Some((base, number)) if !base.is_empty() && !number.starts_with('0') => {
            match number.parse::<u32>() {
                Ok(number) if number >= 2 => (base, number + 1),
                _ => (stem, 2),
            }
        }
        _ => (stem, 2),
    }
}

fn numbered(name: &str, n: u32) -> String {
    let (stem, ext) = match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() && !ext.is_empty() => (stem, Some(ext)),
        _ => (name, None),
    };
    let (base, _) = counter_base(stem);
    match ext {
        Some(ext) => format!("{base} {n}.{ext}"),
        None => format!("{base} {n}"),
    }
}

pub fn keep_both_names(name: &str) -> impl Iterator<Item = String> + '_ {
    let stem = name.rsplit_once('.').map_or(name, |(stem, ext)| {
        if stem.is_empty() || ext.is_empty() {
            name
        } else {
            stem
        }
    });
    let (_, start) = counter_base(stem);
    (start..start.saturating_add(10_000)).map(move |n| numbered(name, n))
}

fn placement(
    from_dir: &CheckedDir,
    from: &OsStr,
    to_dir: &CheckedDir,
    to: &OsStr,
) -> io::Result<(PathBuf, PathBuf)> {
    let source = from_dir.admit_child(from, Access::Write)?;
    let target = to_dir.admit_child(to, Access::Write)?;
    if from_dir.gate() != Gate::App {
        if let Some(why) = closed_places().inside(&source) {
            return Err(closed(&source, why));
        }
    }
    if target != source && target.starts_with(&source) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("{} can't go inside itself.", from.to_string_lossy()),
        ));
    }
    Ok((source, target))
}

fn same_item(from_dir: &CheckedDir, from: &OsStr, to_dir: &CheckedDir, to: &OsStr) -> bool {
    if from == to || !same_place(from_dir.path(), to_dir.path()) {
        return false;
    }
    let same_text = from.to_string_lossy().to_lowercase() == to.to_string_lossy().to_lowercase();
    same_text
        && match (from_dir.stat_at(from), to_dir.stat_at(to)) {
            (Ok(a), Ok(b)) => a.ino == b.ino && a.dev == b.dev && a.ino != 0,
            _ => false,
        }
}

pub fn rename_new(
    from_dir: &CheckedDir,
    from: &OsStr,
    to_dir: &CheckedDir,
    to: &OsStr,
) -> io::Result<()> {
    placement(from_dir, from, to_dir, to)?;
    if same_item(from_dir, from, to_dir, to) {
        return sys::rename(from_dir.sys(), from, to_dir.sys(), to, true);
    }
    sys::rename(from_dir.sys(), from, to_dir.sys(), to, false)
}

pub fn rename_keep_both(
    from_dir: &CheckedDir,
    from: &OsStr,
    to_dir: &CheckedDir,
    to: &OsStr,
) -> io::Result<OsString> {
    match rename_new(from_dir, from, to_dir, to) {
        Ok(()) => return Ok(to.to_owned()),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error),
    }
    let wanted = to.to_string_lossy().into_owned();
    for candidate in keep_both_names(&wanted) {
        let candidate = OsString::from(candidate);
        match rename_new(from_dir, from, to_dir, &candidate) {
            Ok(()) => return Ok(candidate),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "Every name like this one is taken.",
    ))
}

pub fn replace_with(
    from_dir: &CheckedDir,
    from: &OsStr,
    to_dir: &CheckedDir,
    to: &OsStr,
) -> io::Result<()> {
    placement(from_dir, from, to_dir, to)?;
    sys::rename(from_dir.sys(), from, to_dir.sys(), to, true)
}

pub fn clone_or_copy_new(
    from_dir: &CheckedDir,
    from: &OsStr,
    to_dir: &CheckedDir,
    to: &OsStr,
) -> io::Result<u64> {
    let source = from_dir.admit_child(from, Access::Read)?;
    to_dir.admit_child(to, Access::Write)?;
    match from_dir.stat_at(from)?.kind {
        ItemKind::File => copy_file(from_dir, from, to_dir, to, &mut |_| true),
        ItemKind::Link => {
            let points = from_dir.read_link(from)?;
            to_dir.sys().symlink(&points, to, &source)?;
            Ok(0)
        }
        ItemKind::Dir => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "That's a folder.",
        )),
        ItemKind::Other => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Only files, folders and links can be copied.",
        )),
    }
}

fn chunked(
    source: &mut File,
    target: &mut File,
    progress: &mut dyn FnMut(u64) -> bool,
) -> io::Result<u64> {
    let mut buffer = vec![0u8; CHUNK];
    let mut total = 0u64;
    loop {
        let read = match source.read(&mut buffer) {
            Ok(0) => return Ok(total),
            Ok(read) => read,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        };
        target.write_all(&buffer[..read])?;
        total += read as u64;
        if !progress(read as u64) {
            return Err(cancelled());
        }
    }
}

fn finish(target: &File, meta: &std::fs::Metadata) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        target.set_permissions(std::fs::Permissions::from_mode(meta.mode() & 0o1777))?;
    }
    #[cfg(not(unix))]
    target.set_permissions(meta.permissions())?;
    if let Ok(modified) = meta.modified() {
        target.set_modified(modified)?;
    }
    Ok(())
}

pub(crate) fn copy_file(
    from_dir: &CheckedDir,
    from: &OsStr,
    to_dir: &CheckedDir,
    to: &OsStr,
    progress: &mut dyn FnMut(u64) -> bool,
) -> io::Result<u64> {
    to_dir.admit_child(to, Access::Write)?;
    let mut source = from_dir.open_file(from)?;
    let meta = source.metadata()?;
    if sys::clone_file(&source, to_dir.sys(), to)? {
        #[cfg(target_os = "macos")]
        {
            use std::os::unix::fs::MetadataExt;
            if meta.mode() & 0o6000 != 0 {
                if let Err(error) = to_dir.sys().set_mode_at(to, meta.mode() & 0o1777) {
                    let _ = to_dir.sys().unlink(to);
                    return Err(error);
                }
            }
        }
        if !progress(meta.len()) {
            return Err(cancelled());
        }
        return Ok(meta.len());
    }
    let mut target = to_dir.create_file(to)?;
    let copied = chunked(&mut source, &mut target, progress)
        .and_then(|bytes| finish(&target, &meta).map(|()| bytes));
    if copied.is_err() {
        drop(target);
        let _ = to_dir.sys().unlink(to);
    }
    copied
}
