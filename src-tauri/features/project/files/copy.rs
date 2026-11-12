// Duplicate and paste for the file tree: Finder-style copy names, a staged copy published with an
// exclusive rename, and the system clipboard's files copied in.
//
// Adapted from desktop-cc-gui's files.rs (MIT, Copyright (c) 2026 zhukunpenglinyutong).

use std::path::{Path, PathBuf};

use super::{FileOpResult, PasteClipboardResult};

/// Finder-style copy names: `name copy`, `name copy 2`, …; a file keeps its extension
/// (`name copy.txt`).
pub(super) fn copy_destination_name(
    source: &Path,
    is_dir: bool,
    counter: u32,
) -> Result<String, String> {
    let name = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("{} has no name to copy.", source.display()))?;
    let stem = source
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or(name);
    let extension = source.extension().and_then(|extension| extension.to_str());
    let suffix = if counter == 0 {
        " copy".to_string()
    } else {
        format!(" copy {counter}")
    };
    // A folder's name is all name: `src.v2` copies to `src.v2 copy`.
    Ok(match (is_dir, extension) {
        (false, Some(extension)) => format!("{stem}{suffix}.{extension}"),
        (false, None) => format!("{stem}{suffix}"),
        (true, _) => format!("{name}{suffix}"),
    })
}

fn copy_dir_recursive_with(
    source: &Path,
    destination: &Path,
    before_read: &mut impl FnMut(&Path),
    copy_file: &mut impl FnMut(&Path, &Path) -> Result<u64, String>,
) -> Result<(), String> {
    file_access::fs::create_dir_all(destination)
        .map_err(|error| format!("Couldn't make {}: {error}", destination.display()))?;
    before_read(source);
    let entries = file_access::fs::read_dir(source)
        .map_err(|error| format!("Couldn't read {}: {error}", source.display()))?;
    for entry in entries {
        let entry =
            entry.map_err(|error| format!("Couldn't read in {}: {error}", source.display()))?;
        let from = entry.path();
        let to = destination.join(entry.file_name());
        before_read(&from);
        let kind = file_access::fs::symlink_metadata(&from)
            .map_err(|error| format!("Couldn't read {}: {error}", from.display()))?
            .file_type();
        if kind.is_symlink() {
            return Err(format!(
                "{} is a link, which can't be copied.",
                from.display()
            ));
        }
        if kind.is_dir() {
            copy_dir_recursive_with(&from, &to, before_read, copy_file)?;
        } else {
            copy_file(&from, &to)?;
        }
    }
    Ok(())
}

/// Copies `source` into `target_dir` under a name nothing has yet (`prefer_original_name` keeps
/// the plain name when it is free, as paste does; a duplicate always takes the " copy" suffix).
/// Returns where it landed.
pub(super) fn copy_item_into_dir_with(
    source: &Path,
    is_dir: bool,
    target_dir: &Path,
    prefer_original_name: bool,
    before_read: &mut impl FnMut(&Path),
    copy_file: &mut impl FnMut(&Path, &Path) -> Result<u64, String>,
) -> Result<PathBuf, String> {
    if is_dir && target_dir.starts_with(source) {
        return Err("A folder can't be pasted into itself.".into());
    }
    let source_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("{} has no name to copy.", source.display()))?;
    let mut destination = target_dir.join(source_name);
    if !prefer_original_name || file_access::fs::symlink_metadata(&destination).is_ok() {
        destination = (0..=999u32)
            .map(|counter| copy_destination_name(source, is_dir, counter))
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .map(|name| target_dir.join(name))
            .find(|candidate| file_access::fs::symlink_metadata(candidate).is_err())
            .ok_or("There are too many copies already.")?;
    }
    // A unique staged name keeps copies running at once apart; only this copy's own staged item
    // is ever cleaned up. It doesn't hold the source's name: a long name plus the suffix could
    // pass the 255-character limit and fail a copy whose real destination fits.
    let staged = target_dir.join(format!(".misty-copying-{}", uuid::Uuid::new_v4()));
    if is_dir {
        file_access::fs::create_dir(&staged)
            .map_err(|error| format!("Couldn't make {}: {error}", staged.display()))?;
    }
    let copied = if is_dir {
        copy_dir_recursive_with(source, &staged, before_read, copy_file)
    } else {
        before_read(source);
        copy_file(source, &staged).map(|_| ())
    };
    if let Err(error) = copied {
        return Err(remove_partial_copy(&staged, is_dir, error));
    }
    if let Err(error) = publish_copy(&staged, &destination) {
        let error = format!("Couldn't name the copy {}: {error}", destination.display());
        return Err(remove_partial_copy(&staged, is_dir, error));
    }
    Ok(destination)
}

/// Publishes a finished staged copy without replacing anything that appeared at the destination
/// meanwhile. The staged item sits beside the destination, so the rename stays on one disk.
fn publish_copy(from: &Path, to: &Path) -> std::io::Result<()> {
    publish_copy_with(from, to, rename_exclusive)
}

/// Some file systems have no exclusive rename: exFAT on macOS answers `RENAME_EXCL` with ENOTSUP,
/// and network or FUSE mounts on Linux may refuse `RENAME_NOREPLACE` with EINVAL. Duplicate and
/// paste still work there: the fallback checks the destination, then renames. Something made at
/// the destination in that short gap can still be replaced, the best such a disk allows.
pub(super) fn publish_copy_with(
    from: &Path,
    to: &Path,
    exclusive: impl FnOnce(&Path, &Path) -> std::io::Result<()>,
) -> std::io::Result<()> {
    match exclusive(from, to) {
        Err(error) if exclusive_rename_unsupported(&error) => {
            if file_access::fs::symlink_metadata(to).is_ok() {
                return Err(std::io::Error::from(std::io::ErrorKind::AlreadyExists));
            }
            file_access::fs::rename(from, to)
        }
        result => result,
    }
}

#[cfg(unix)]
fn exclusive_rename_unsupported(error: &std::io::Error) -> bool {
    error.raw_os_error().is_some_and(|code| {
        [libc::ENOTSUP, libc::EOPNOTSUPP, libc::EINVAL, libc::ENOSYS].contains(&code)
    })
}

/// `MoveFileExW` without `MOVEFILE_REPLACE_EXISTING` works on every Windows file system, so there
/// is nothing to fall back from.
#[cfg(windows)]
fn exclusive_rename_unsupported(_error: &std::io::Error) -> bool {
    false
}

#[cfg(target_os = "macos")]
fn rename_exclusive(from: &Path, to: &Path) -> std::io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    file_access::check(from, file_access::Access::Write)?;
    file_access::check(to, file_access::Access::Write)?;
    let from = CString::new(from.as_os_str().as_bytes())
        .map_err(|_| std::io::Error::other("The path holds a NUL byte."))?;
    let to = CString::new(to.as_os_str().as_bytes())
        .map_err(|_| std::io::Error::other("The path holds a NUL byte."))?;
    // SAFETY: both NUL-terminated paths live through the call; RENAME_EXCL asks the file system
    // to refuse an existing destination atomically.
    if unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), libc::RENAME_EXCL) } == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn rename_exclusive(from: &Path, to: &Path) -> std::io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    file_access::check(from, file_access::Access::Write)?;
    file_access::check(to, file_access::Access::Write)?;
    let from = CString::new(from.as_os_str().as_bytes())
        .map_err(|_| std::io::Error::other("The path holds a NUL byte."))?;
    let to = CString::new(to.as_os_str().as_bytes())
        .map_err(|_| std::io::Error::other("The path holds a NUL byte."))?;
    // SAFETY: AT_FDCWD resolves relative paths against this process's working directory, which
    // nothing changes; the staged paths are absolute in practice.
    if unsafe {
        libc::renameat2(
            libc::AT_FDCWD,
            from.as_ptr(),
            libc::AT_FDCWD,
            to.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    } == 0
    {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

/// `MoveFileExW` gets the raw path, without the `\\?\` prefix and normalization `std::fs` adds,
/// so a path near `MAX_PATH` fails although each `std::fs` step of the same copy worked. Paths
/// past the legacy limit are made absolute by `GetFullPathNameW` and get the prefix.
#[cfg(windows)]
fn rename_exclusive(from: &Path, to: &Path) -> std::io::Result<()> {
    use windows_sys::Win32::Storage::FileSystem::MoveFileExW;

    file_access::check(from, file_access::Access::Write)?;
    file_access::check(to, file_access::Access::Write)?;
    let from = windows_path::wide(from)?;
    let to = windows_path::wide(to)?;
    // SAFETY: both buffers are NUL-terminated UTF-16 and live through the call. Without
    // MOVEFILE_REPLACE_EXISTING, MoveFileExW refuses to replace an existing file.
    if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), 0) } != 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(windows)]
mod windows_path {
    use std::path::Path;

    /// `std`'s legacy limit for Windows paths: folders at 248 UTF-16 units (260 for files)
    /// unless the `\\?\` prefix lifts it.
    const LEGACY_MAX_PATH: usize = 248;

    pub(super) fn wide(path: &Path) -> std::io::Result<Vec<u16>> {
        use std::os::windows::ffi::OsStrExt;

        const SEP: u16 = b'\\' as u16;
        const ALT_SEP: u16 = b'/' as u16;
        const COLON: u16 = b':' as u16;
        const DOT: u16 = b'.' as u16;
        const QUERY: u16 = b'?' as u16;
        const VERBATIM: [u16; 4] = [SEP, SEP, QUERY, SEP];
        const NT: [u16; 4] = [SEP, QUERY, QUERY, SEP];
        const UNC: [u16; 8] = [
            SEP,
            SEP,
            QUERY,
            SEP,
            b'U' as u16,
            b'N' as u16,
            b'C' as u16,
            SEP,
        ];

        let wide: Vec<u16> = path.as_os_str().encode_wide().collect();
        if wide.starts_with(&VERBATIM) || wide.starts_with(&NT) {
            return Ok(terminated(wide));
        }
        let short_and_absolute = matches!(
            wide.as_slice(),
            [drive, COLON, SEP | ALT_SEP, ..] if *drive != SEP && *drive != ALT_SEP
        ) || matches!(wide.as_slice(), [SEP | ALT_SEP, SEP | ALT_SEP, ..]);
        if short_and_absolute && wide.len() < LEGACY_MAX_PATH {
            return Ok(terminated(wide));
        }
        let mut absolute = full_path(&wide)?;
        let prefix: &[u16] = match absolute.as_slice() {
            [_, COLON, SEP, ..] => &VERBATIM,
            [SEP, SEP, DOT, SEP, ..] => {
                absolute.drain(..4);
                &VERBATIM
            }
            [SEP, SEP, QUERY, SEP, ..] | [SEP, QUERY, QUERY, SEP, ..] => &[],
            [SEP, SEP, ..] => {
                absolute.drain(..2);
                &UNC
            }
            _ => &[],
        };
        let mut out = Vec::with_capacity(prefix.len() + absolute.len() + 1);
        out.extend_from_slice(prefix);
        out.extend_from_slice(&absolute);
        out.push(0);
        Ok(out)
    }

    fn terminated(mut wide: Vec<u16>) -> Vec<u16> {
        wide.push(0);
        wide
    }

    /// The absolute, normalized form of `wide`. `GetFullPathNameW` reports the size it needs when
    /// the buffer is too small; success returns the length without the NUL.
    fn full_path(wide: &[u16]) -> std::io::Result<Vec<u16>> {
        use windows_sys::Win32::Storage::FileSystem::GetFullPathNameW;

        let input = terminated(wide.to_vec());
        let mut buffer = vec![0u16; wide.len().max(LEGACY_MAX_PATH)];
        loop {
            // SAFETY: `input` is NUL-terminated and `buffer` is as long as the size passed.
            let len = unsafe {
                GetFullPathNameW(
                    input.as_ptr(),
                    buffer.len() as u32,
                    buffer.as_mut_ptr(),
                    std::ptr::null_mut(),
                )
            } as usize;
            if len == 0 {
                return Err(std::io::Error::last_os_error());
            }
            if len < buffer.len() {
                buffer.truncate(len);
                return Ok(buffer);
            }
            buffer = vec![0u16; len];
        }
    }
}

fn remove_partial_copy(path: &Path, is_dir: bool, error: String) -> String {
    let cleanup = if is_dir {
        file_access::fs::remove_dir_all(path)
    } else {
        file_access::fs::remove_file(path)
    };
    match cleanup {
        Ok(()) => error,
        // The copy failed before making its staged item: nothing partial to report.
        Err(cleanup) if cleanup.kind() == std::io::ErrorKind::NotFound => error,
        Err(cleanup) => format!(
            "{error}; a partial copy is left at {}: {cleanup}",
            path.display()
        ),
    }
}

fn copy_item_into_dir(
    source: &Path,
    is_dir: bool,
    target_dir: &Path,
    prefer_original_name: bool,
) -> Result<PathBuf, String> {
    copy_item_into_dir_with(
        source,
        is_dir,
        target_dir,
        prefer_original_name,
        &mut |_| {},
        // fs::copy keeps mode bits, and on macOS clones on APFS (instant, no extra space) with
        // timestamps and extended attributes.
        &mut |from, to| {
            file_access::fs::copy(from, to)
                .map_err(|error| format!("Couldn't copy {}: {error}", from.display()))
        },
    )
}

fn result(path: PathBuf, is_dir: bool) -> FileOpResult {
    FileOpResult {
        path: path.to_string_lossy().into_owned(),
        is_dir,
    }
}

pub(super) fn duplicate(source: &Path) -> Result<FileOpResult, String> {
    let meta = file_access::fs::symlink_metadata(source)
        .map_err(|error| format!("Couldn't read {}: {error}", source.display()))?;
    if meta.file_type().is_symlink() {
        return Err(format!(
            "{} is a link, which can't be copied.",
            source.display()
        ));
    }
    let parent = source
        .parent()
        .ok_or_else(|| format!("{} has no folder.", source.display()))?;
    let destination = copy_item_into_dir(source, meta.is_dir(), parent, false)?;
    Ok(result(destination, meta.is_dir()))
}

pub(super) fn paste(source: &Path, dir: &Path) -> Result<FileOpResult, String> {
    if !file_access::fs::is_dir(dir) {
        return Err(format!("{} isn't a folder.", dir.display()));
    }
    let meta = file_access::fs::symlink_metadata(source)
        .map_err(|error| format!("Couldn't read {}: {error}", source.display()))?;
    if meta.file_type().is_symlink() {
        return Err(format!(
            "{} is a link, which can't be copied.",
            source.display()
        ));
    }
    let destination = copy_item_into_dir(source, meta.is_dir(), dir, true)?;
    Ok(result(destination, meta.is_dir()))
}

/// Copies the files the system clipboard named into `target_dir`. The paths came from the
/// clipboard natively, after the person copied them in Finder or Explorer, so each is read under
/// a picked-file grant the way a file chosen in a dialog is; nothing a window sends gets one.
pub(super) fn copy_clipboard_items_into(
    sources: &[String],
    target_dir: &Path,
) -> PasteClipboardResult {
    let mut created = Vec::new();
    let mut failed = Vec::new();
    let mut grant = |path: &Path| file_access::allow_picked_file(path, file_access::Access::Read);
    for raw in sources {
        let original = Path::new(raw);
        grant(original);
        let meta = match file_access::fs::symlink_metadata(original) {
            Ok(meta) => meta,
            Err(error) => {
                failed.push(format!("Couldn't read {}: {error}", original.display()));
                continue;
            }
        };
        if meta.file_type().is_symlink() {
            failed.push(format!(
                "{} is a link, which can't be copied.",
                original.display()
            ));
            continue;
        }
        let is_dir = meta.is_dir();
        let copied = copy_item_into_dir_with(
            original,
            is_dir,
            target_dir,
            true,
            &mut grant,
            &mut |from, to| {
                file_access::fs::copy(from, to)
                    .map_err(|error| format!("Couldn't copy {}: {error}", from.display()))
            },
        );
        match copied {
            Ok(destination) => created.push(result(destination, is_dir)),
            Err(error) => failed.push(error),
        }
    }
    PasteClipboardResult { created, failed }
}

#[cfg(test)]
mod tests;
