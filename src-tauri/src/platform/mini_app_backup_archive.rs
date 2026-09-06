//! Streaming backup/restore through retained directory handles. No ambient paths.
//! On a streaming error the worker owner must kill Restic before closing stdin:
//! EOF alone would let Restic commit a snapshot containing incomplete input.
#![allow(dead_code)] // In progress: the grant-owned Backups job API consumes this.
use cap_std::fs::{Dir, OpenOptions};
use std::{
    collections::{HashMap, HashSet},
    ffi::OsString,
    fs::{File, Metadata},
    io::{self, Read, Write},
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
#[path = "mini_app_backup_attributes.rs"]
mod attributes;
const MAX_ENTRIES: usize = 2_000_000;
const MAX_DEPTH: usize = 128;
const MAX_BYTES: u64 = 64 * 1024 * 1024 * 1024 * 1024;
const MAX_METADATA: usize = 32 * 1024 * 1024;
const MAX_PATH: usize = 32_768;
pub const ARCHIVE_NAME: &str = "Misty Backup.tar";
pub struct Source {
    pub directory: Arc<Dir>,
    pub name: String,
}
#[derive(Default, Debug)]
pub struct Report {
    pub files: u64,
    pub directories: u64,
    pub links: u64,
    pub bytes: u64,
    indexed_bytes: usize,
}
fn invalid(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}
fn check(cancel: &AtomicBool) -> io::Result<()> {
    if cancel.load(Ordering::Acquire) {
        Err(io::Error::new(
            io::ErrorKind::ConnectionAborted,
            "Backup operation cancelled.",
        ))
    } else {
        Ok(())
    }
}
struct Checked<T> {
    inner: T,
    cancel: Arc<AtomicBool>,
}
impl<T: Read> Read for Checked<T> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        check(&self.cancel)?;
        let length = buffer.len().min(65_536);
        self.inner.read(&mut buffer[..length])
    }
}
impl<T: Write> Write for Checked<T> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        check(&self.cancel)?;
        self.inner.write(&bytes[..bytes.len().min(65_536)])
    }
    fn flush(&mut self) -> io::Result<()> {
        check(&self.cancel)?;
        self.inner.flush()
    }
}
struct Meter<R> {
    inner: R,
    count: u64,
    tail: [u8; 512],
}
impl<R: Read> Read for Meter<R> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let size = self.inner.read(buffer)?;
        self.count = self
            .count
            .checked_add(size as u64)
            .ok_or_else(|| invalid("Archive size overflow."))?;
        if size >= 512 {
            self.tail.copy_from_slice(&buffer[size - 512..size]);
        } else if size > 0 {
            self.tail.rotate_left(size);
            self.tail[512 - size..].copy_from_slice(&buffer[..size]);
        }
        Ok(size)
    }
}
fn index_path(report: &mut Report, path: &Path) -> io::Result<()> {
    report.indexed_bytes = report
        .indexed_bytes
        .checked_add(path.as_os_str().len())
        .filter(|n| *n <= 128 * 1024 * 1024)
        .ok_or_else(|| invalid("Backup path index exceeds 128 MiB."))?;
    Ok(())
}
fn safe_path(path: &Path) -> io::Result<()> {
    if path.as_os_str().is_empty()
        || path.as_os_str().len() > MAX_PATH
        || path.components().count() > MAX_DEPTH
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(invalid(
            "Backup contains an unsafe or excessively deep path.",
        ));
    }
    Ok(())
}
fn open(dir: &Dir, name: &Path, directory: bool) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use cap_std::fs::OpenOptionsExt;
        options.custom_flags(
            libc::O_NOFOLLOW | libc::O_NONBLOCK | if directory { libc::O_DIRECTORY } else { 0 },
        );
    }
    let file = dir.open_with(name, &options)?.into_std();
    let metadata = file.metadata()?;
    if (directory && !metadata.is_dir()) || (!directory && !metadata.is_file()) {
        return Err(invalid(
            "Selected folder entry changed type or is unsupported.",
        ));
    }
    Ok(file)
}
fn entry_parent(root: &Dir, path: &Path, create: bool) -> io::Result<(Dir, OsString)> {
    safe_path(path)?;
    let mut components = path.components().peekable();
    let mut current = root.try_clone()?;
    while let Some(Component::Normal(name)) = components.next() {
        if components.peek().is_none() {
            return Ok((current, name.to_owned()));
        }
        if create {
            match current.create_dir(name) {
                Ok(()) => {}
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {}
                Err(e) => return Err(e),
            }
        }
        current = Dir::from_std_file(open(&current, Path::new(name), true)?);
    }
    Err(invalid("Missing backup entry name."))
}
fn metadata_header(metadata: &Metadata) -> tar::Header {
    let mut header = tar::Header::new_gnu();
    header.set_metadata(metadata);
    header
}
fn metadata_extensions<W: Write>(archive: &mut tar::Builder<W>, file: &File) -> io::Result<()> {
    let metadata = file.metadata()?;
    let time = filetime::FileTime::from_last_modification_time(&metadata);
    let mut values = attributes::read(file)?;
    values.push((
        "mtime".into(),
        format!("{}.{:09}", time.unix_seconds(), time.nanoseconds()).into_bytes(),
    ));
    archive.append_pax_extensions(
        values
            .iter()
            .map(|(name, value)| (name.as_str(), value.as_slice())),
    )
}
fn unchanged(before: &Metadata, after: &Metadata) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        before.len() == after.len()
            && before.mtime() == after.mtime()
            && before.mtime_nsec() == after.mtime_nsec()
            && before.ctime() == after.ctime()
            && before.ctime_nsec() == after.ctime_nsec()
    }
    #[cfg(not(unix))]
    {
        before.len() == after.len() && before.modified().ok() == after.modified().ok()
    }
}

pub fn write_sources<W: Write>(
    sources: &[Source],
    writer: &mut W,
    cancel: Arc<AtomicBool>,
) -> io::Result<Report> {
    if sources.is_empty() || sources.len() > 64 {
        return Err(invalid("Choose between one and 64 source folders."));
    }
    let mut archive = tar::Builder::new(Checked {
        inner: writer,
        cancel: cancel.clone(),
    });
    archive.follow_symlinks(false);
    let mut report = Report::default();
    let mut count = 0usize;
    let mut names = HashSet::new();
    let mut hardlinks = HashMap::<(u64, u64), PathBuf>::new();
    for source in sources {
        check(&cancel)?;
        safe_path(Path::new(&source.name))?;
        if Path::new(&source.name).components().count() != 1 {
            return Err(invalid("Invalid source folder name."));
        }
        let mut name = source.name.clone();
        let mut suffix = 2;
        while !names.insert(name.clone()) {
            name = format!("{} ({suffix})", source.name);
            suffix += 1;
        }
        walk(
            &source.directory,
            Path::new(&name),
            &mut archive,
            &cancel,
            &mut report,
            &mut count,
            &mut hardlinks,
        )?;
    }
    archive.finish()?;
    Ok(report)
}
fn walk<W: Write>(
    dir: &Dir,
    path: &Path,
    archive: &mut tar::Builder<W>,
    cancel: &Arc<AtomicBool>,
    report: &mut Report,
    count: &mut usize,
    hardlinks: &mut HashMap<(u64, u64), PathBuf>,
) -> io::Result<()> {
    check(cancel)?;
    safe_path(path)?;
    *count += 1;
    if *count > MAX_ENTRIES {
        return Err(invalid("Backup entry limit exceeded."));
    }
    index_path(report, path)?;
    let file = dir.try_clone()?.into_std_file();
    let metadata = file.metadata()?;
    metadata_extensions(archive, &file)?;
    let mut header = metadata_header(&metadata);
    header.set_entry_type(tar::EntryType::Directory);
    header.set_size(0);
    archive.append_data(&mut header, path, io::empty())?;
    report.directories += 1;
    for entry in dir.entries()? {
        check(cancel)?;
        let entry = entry?;
        let name = entry.file_name();
        let path = path.join(&name);
        safe_path(&path)?;
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            let child = Dir::from_std_file(open(dir, Path::new(&name), true)?);
            walk(&child, &path, archive, cancel, report, count, hardlinks)?;
            continue;
        }
        index_path(report, &path)?;
        *count += 1;
        if *count > MAX_ENTRIES {
            return Err(invalid("Backup entry limit exceeded."));
        }
        if file_type.is_symlink() {
            let target = dir.read_link_contents(&name)?;
            if target.as_os_str().len() > MAX_PATH {
                return Err(invalid("Backup link target is too large."));
            }
            let mut header = tar::Header::new_gnu();
            header.set_mode(0o777);
            header.set_entry_type(tar::EntryType::Symlink);
            header.set_size(0);
            archive.append_link(&mut header, &path, &target)?;
            report.links += 1;
        } else if file_type.is_file() {
            let mut file = open(dir, Path::new(&name), false)?;
            let metadata = file.metadata()?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                if metadata.nlink() > 1 {
                    if let Some(original) = hardlinks.get(&(metadata.dev(), metadata.ino())) {
                        let mut header = metadata_header(&metadata);
                        header.set_entry_type(tar::EntryType::Link);
                        header.set_size(0);
                        archive.append_link(&mut header, &path, original)?;
                        report.links += 1;
                        continue;
                    }
                    hardlinks.insert((metadata.dev(), metadata.ino()), path.clone());
                }
            }
            report.bytes = report
                .bytes
                .checked_add(metadata.len())
                .filter(|value| *value <= MAX_BYTES)
                .ok_or_else(|| invalid("Backup data limit exceeded."))?;
            metadata_extensions(archive, &file)?;
            let mut header = metadata_header(&metadata);
            header.set_entry_type(tar::EntryType::Regular);
            let mut reader = Checked {
                inner: (&mut file).take(metadata.len()),
                cancel: cancel.clone(),
            };
            archive.append_data(&mut header, &path, &mut reader)?;
            if reader.inner.limit() != 0 || !unchanged(&metadata, &file.metadata()?) {
                return Err(invalid(
                    "A source file changed during backup. Run the backup again.",
                ));
            }
            report.files += 1;
        } else {
            return Err(invalid(
                "Source includes a socket, device, or other unsupported special file.",
            ));
        }
    }
    Ok(())
}

fn extensions(bytes: &[u8]) -> io::Result<Vec<(String, Vec<u8>)>> {
    let mut cursor = 0;
    let mut values = Vec::new();
    while cursor < bytes.len() {
        let space = bytes[cursor..]
            .iter()
            .position(|b| *b == b' ')
            .ok_or_else(|| invalid("Invalid backup metadata."))?
            + cursor;
        if space - cursor > 10 {
            return Err(invalid("Invalid backup metadata length."));
        }
        let length = std::str::from_utf8(&bytes[cursor..space])
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .ok_or_else(|| invalid("Invalid backup metadata length."))?;
        let end = cursor
            .checked_add(length)
            .filter(|end| *end <= bytes.len() && *end > space + 2)
            .ok_or_else(|| invalid("Invalid backup metadata length."))?;
        if bytes[end - 1] != b'\n' {
            return Err(invalid("Invalid backup metadata record."));
        }
        let equals = bytes[space + 1..end - 1]
            .iter()
            .position(|b| *b == b'=')
            .ok_or_else(|| invalid("Invalid backup metadata record."))?
            + space
            + 1;
        let name = std::str::from_utf8(&bytes[space + 1..equals])
            .map_err(|_| invalid("Invalid backup metadata name."))?
            .to_owned();
        if values.len() >= 1024 {
            return Err(invalid("Too many backup attributes."));
        }
        values.push((name, bytes[equals + 1..end - 1].to_vec()));
        cursor = end;
    }
    Ok(values)
}
fn small_entry<R: Read>(entry: &mut tar::Entry<'_, R>, limit: usize) -> io::Result<Vec<u8>> {
    if entry.size() > limit as u64 {
        return Err(invalid("Backup metadata exceeds its size limit."));
    }
    let mut value = Vec::new();
    entry.take(limit as u64 + 1).read_to_end(&mut value)?;
    if value.len() > limit {
        return Err(invalid("Backup metadata exceeds its size limit."));
    }
    Ok(value)
}
fn bytes_path(mut bytes: Vec<u8>) -> io::Result<PathBuf> {
    if bytes.last() == Some(&0) {
        bytes.pop();
    }
    if bytes.contains(&0) || bytes.len() > MAX_PATH {
        return Err(invalid("Invalid backup path."));
    }
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStringExt;
        Ok(OsString::from_vec(bytes).into())
    }
    #[cfg(not(unix))]
    {
        Ok(String::from_utf8(bytes)
            .map_err(|_| invalid("Unsupported backup path encoding."))?
            .into())
    }
}
fn finish_metadata(
    file: &File,
    header: &tar::Header,
    values: &[(String, Vec<u8>)],
) -> io::Result<()> {
    attributes::write(file, values)?;
    let mut time = filetime::FileTime::from_unix_time(header.mtime()? as i64, 0);
    for (name, value) in values {
        if name == "mtime" {
            let value =
                std::str::from_utf8(value).map_err(|_| invalid("Invalid backup timestamp."))?;
            let (seconds, nanos) = value.split_once('.').unwrap_or((value, "0"));
            if nanos.len() > 9 || !nanos.bytes().all(|b| b.is_ascii_digit()) {
                return Err(invalid("Invalid backup timestamp."));
            }
            let nanos = format!("{nanos:0<9}")
                .parse()
                .map_err(|_| invalid("Invalid backup timestamp."))?;
            time = filetime::FileTime::from_unix_time(
                seconds
                    .parse()
                    .map_err(|_| invalid("Invalid backup timestamp."))?,
                nanos,
            );
        }
    }
    filetime::set_file_handle_times(file, None, Some(time))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(std::fs::Permissions::from_mode(header.mode()? & 0o777))?;
    }
    Ok(())
}

/// Caller creates a unique empty destination first. No archive extraction helper
/// receives an ambient destination path, and no existing file is overwritten.
pub fn restore<R: Read>(reader: R, root: &Dir, cancel: Arc<AtomicBool>) -> io::Result<Report> {
    let mut archive = tar::Archive::new(Meter {
        inner: Checked {
            inner: reader,
            cancel: cancel.clone(),
        },
        count: 0,
        tail: [0; 512],
    });
    let mut last_entry_end = 0u64;
    let mut pending_metadata = 0usize;
    let mut report = Report::default();
    let mut count = 0usize;
    let mut long_path = None;
    let mut long_link = None;
    let mut values = Vec::new();
    let mut seen = HashSet::new();
    let mut regular = HashSet::new();
    let mut directory_metadata = Vec::new();
    // Raw mode avoids unbounded internal allocation of attacker-sized GNU/PAX
    // metadata. Interpret only the explicitly supported bounded extensions.
    for entry in archive.entries()?.raw(true) {
        check(&cancel)?;
        let mut entry = entry?;
        count += 1;
        if count > MAX_ENTRIES * 3 {
            return Err(invalid("Restore entry limit exceeded."));
        }
        last_entry_end = entry
            .size()
            .checked_add(511)
            .map(|v| v / 512 * 512)
            .and_then(|size| entry.raw_file_position().checked_add(size))
            .ok_or_else(|| invalid("Archive size overflow."))?;
        let header = entry.header().clone();
        let kind = header.entry_type();
        if kind == tar::EntryType::XHeader {
            if !values.is_empty() {
                return Err(invalid("Repeated backup metadata."));
            }
            values = extensions(&small_entry(&mut entry, MAX_METADATA)?)?;
            continue;
        }
        if kind == tar::EntryType::GNULongName {
            if long_path.is_some() {
                return Err(invalid("Repeated backup path."));
            }
            long_path = Some(bytes_path(small_entry(&mut entry, MAX_PATH)?)?);
            continue;
        }
        if kind == tar::EntryType::GNULongLink {
            if long_link.is_some() {
                return Err(invalid("Repeated backup link."));
            }
            long_link = Some(bytes_path(small_entry(&mut entry, MAX_PATH)?)?);
            continue;
        }
        if ![
            tar::EntryType::Regular,
            tar::EntryType::Directory,
            tar::EntryType::Symlink,
            tar::EntryType::Link,
        ]
        .contains(&kind)
        {
            return Err(invalid("Unsupported backup entry type."));
        }
        for (name, _) in &values {
            if name != "mtime" && !name.starts_with("SCHILY.xattr.") {
                return Err(invalid("Unsupported backup metadata."));
            }
        }
        let path = long_path.take().unwrap_or(header.path()?.into_owned());
        safe_path(&path)?;
        index_path(&mut report, &path)?;
        if !seen.insert(path.clone()) || seen.len() > MAX_ENTRIES {
            return Err(invalid("Duplicate or excessive restore entries."));
        }
        let (parent, name) = entry_parent(root, &path, false)?;
        if kind == tar::EntryType::Directory {
            if entry.size() != 0 {
                return Err(invalid("Directory entry contains unexpected data."));
            }
            parent.create_dir(&name)?;
            pending_metadata = pending_metadata
                .checked_add(
                    path.as_os_str().len()
                        + 512
                        + values
                            .iter()
                            .map(|(key, value)| key.len() + value.len())
                            .sum::<usize>(),
                )
                .filter(|size| *size <= 64 * 1024 * 1024)
                .ok_or_else(|| invalid("Directory metadata exceeds 64 MiB."))?;
            directory_metadata.push((path, header, values));
            report.directories += 1;
        } else if kind == tar::EntryType::Regular {
            if long_link.is_some() {
                return Err(invalid("Unexpected link target."));
            }
            report.bytes = report
                .bytes
                .checked_add(entry.size())
                .filter(|v| *v <= MAX_BYTES)
                .ok_or_else(|| invalid("Restore data limit exceeded."))?;
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            let mut file = parent.open_with(&name, &options)?.into_std();
            let written = io::copy(
                &mut entry,
                &mut Checked {
                    inner: &mut file,
                    cancel: cancel.clone(),
                },
            )?;
            if written != header.size()? {
                return Err(invalid("Truncated backup data."));
            }
            check(&cancel)?;
            finish_metadata(&file, &header, &values)?;
            file.sync_all()?;
            regular.insert(path);
            report.files += 1;
        } else {
            if entry.size() != 0 || !values.is_empty() {
                return Err(invalid("Invalid link metadata."));
            }
            let target = long_link
                .take()
                .or(header.link_name()?.map(|v| v.into_owned()))
                .ok_or_else(|| invalid("Missing link target."))?;
            if target.as_os_str().len() > MAX_PATH {
                return Err(invalid("Link target is too large."));
            }
            if kind == tar::EntryType::Link {
                safe_path(&target)?;
                if !regular.contains(&target) {
                    return Err(invalid("Hard link does not name a restored regular file."));
                }
                let (source, source_name) = entry_parent(root, &target, false)?;
                let _file = open(&source, Path::new(&source_name), false)?;
                source.hard_link(&source_name, &parent, &name)?;
                regular.insert(path);
            } else {
                #[cfg(unix)]
                parent.symlink_contents(&target, &name)?;
                #[cfg(not(unix))]
                return Err(invalid(
                    "Symlink restoration is not supported on this platform.",
                ));
            }
            report.links += 1;
        }
        values = Vec::new();
    }
    if long_path.is_some() || long_link.is_some() || !values.is_empty() {
        return Err(invalid("Incomplete backup metadata."));
    }
    let mut input = archive.into_inner();
    if input.count
        != last_entry_end
            .checked_add(512)
            .ok_or_else(|| invalid("Archive size overflow."))?
        || input.tail != [0; 512]
    {
        return Err(invalid("Backup is missing its end marker."));
    }
    let mut end = [0u8; 512];
    input.read_exact(&mut end)?;
    if end != [0; 512] {
        return Err(invalid("Invalid backup end marker."));
    }
    let mut padding = [0u8; 4096];
    let mut padding_size = 0;
    loop {
        let size = input.read(&mut padding)?;
        if size == 0 {
            break;
        }
        padding_size += size;
        if padding_size > 1024 * 1024 || padding[..size].iter().any(|byte| *byte != 0) {
            return Err(invalid("Unexpected data after backup end marker."));
        }
    }
    if input.count % 512 != 0 {
        return Err(invalid("Truncated backup padding."));
    }
    for (path, header, values) in directory_metadata.into_iter().rev() {
        check(&cancel)?;
        let (dir, name) = entry_parent(root, &path, false)?;
        finish_metadata(&open(&dir, Path::new(&name), true)?, &header, &values)?;
    }
    Ok(report)
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use std::os::unix::fs::{symlink, MetadataExt, PermissionsExt};
    fn chosen(path: &Path) -> Arc<Dir> {
        Arc::new(Dir::open_ambient_dir(path, cap_std::ambient_authority()).unwrap())
    }
    fn cancel() -> Arc<AtomicBool> {
        Arc::new(AtomicBool::new(false))
    }
    fn fixture() -> (tempfile::TempDir, Arc<Dir>) {
        let dir = tempfile::tempdir().unwrap();
        let handle = chosen(dir.path());
        (dir, handle)
    }
    fn append(
        builder: &mut tar::Builder<Vec<u8>>,
        path: &str,
        kind: tar::EntryType,
        target: Option<&str>,
        data: &[u8],
    ) {
        let mut header = tar::Header::new_gnu();
        header.set_entry_type(kind);
        header.set_mode(0o644);
        header.set_mtime(1700000000);
        header.set_size(data.len() as u64);
        if let Some(target) = target {
            builder.append_link(&mut header, path, target).unwrap();
        } else {
            builder.append_data(&mut header, path, data).unwrap();
        }
    }
    #[test]
    fn round_trip_preserves_contents_links_names_modes_times_and_binary_attributes() {
        let (input, source) = fixture();
        let (output, destination) = fixture();
        std::fs::create_dir(input.path().join("Nested")).unwrap();
        let name = OsString::from("Résumé 📁:notes");
        let file_path = input.path().join("Nested").join(&name);
        std::fs::write(&file_path, b"back up these bytes").unwrap();
        std::fs::set_permissions(&file_path, std::fs::Permissions::from_mode(0o640)).unwrap();
        let file = File::open(&file_path).unwrap();
        let time = filetime::FileTime::from_unix_time(1700000000, 123456789);
        filetime::set_file_handle_times(&file, None, Some(time)).unwrap();
        attributes::write(
            &file,
            &[(
                "SCHILY.xattr.com.misty.backup-test".into(),
                b"binary\0value\nsecond=line".to_vec(),
            )],
        )
        .unwrap();
        std::fs::hard_link(&file_path, input.path().join("alias")).unwrap();
        symlink("Nested", input.path().join("folder-link")).unwrap();
        symlink("/outside/private", input.path().join("outside-link")).unwrap();
        let long = "l".repeat(200);
        std::fs::write(input.path().join(&long), b"long name").unwrap();
        let mut bytes = Vec::new();
        let written = write_sources(
            &[Source {
                directory: source,
                name: "Documents".into(),
            }],
            &mut bytes,
            cancel(),
        )
        .unwrap();
        let restored = restore(bytes.as_slice(), &destination, cancel()).unwrap();
        assert_eq!(written.bytes, restored.bytes);
        assert_eq!(written.files, restored.files);
        assert_eq!(written.links, restored.links);
        let restored_path = output.path().join("Documents/Nested").join(name);
        let restored_file = File::open(&restored_path).unwrap();
        assert_eq!(
            std::fs::read(&restored_path).unwrap(),
            b"back up these bytes"
        );
        assert_eq!(restored_file.metadata().unwrap().mode() & 0o777, 0o640);
        assert_eq!(
            filetime::FileTime::from_last_modification_time(&restored_file.metadata().unwrap()),
            time
        );
        assert_eq!(
            attributes::read(&restored_file).unwrap(),
            attributes::read(&file).unwrap()
        );
        assert_eq!(
            restored_file.metadata().unwrap().ino(),
            std::fs::metadata(output.path().join("Documents/alias"))
                .unwrap()
                .ino()
        );
        assert_eq!(
            std::fs::read_link(output.path().join("Documents/outside-link")).unwrap(),
            Path::new("/outside/private")
        );
        assert_eq!(
            std::fs::read(output.path().join("Documents").join(long)).unwrap(),
            b"long name"
        );
    }
    #[test]
    fn retained_source_survives_path_replacement_and_duplicate_source_names_remain_distinct() {
        let input = tempfile::tempdir().unwrap();
        let path = input.path().join("chosen");
        std::fs::create_dir(&path).unwrap();
        std::fs::write(path.join("file"), b"original").unwrap();
        let source = chosen(&path);
        std::fs::rename(&path, input.path().join("moved")).unwrap();
        std::fs::create_dir(&path).unwrap();
        std::fs::write(path.join("file"), b"replacement").unwrap();
        let mut bytes = Vec::new();
        write_sources(
            &[
                Source {
                    directory: source.clone(),
                    name: "Same".into(),
                },
                Source {
                    directory: source,
                    name: "Same".into(),
                },
            ],
            &mut bytes,
            cancel(),
        )
        .unwrap();
        let (output, destination) = fixture();
        restore(bytes.as_slice(), &destination, cancel()).unwrap();
        for name in ["Same", "Same (2)"] {
            assert_eq!(
                std::fs::read(output.path().join(name).join("file")).unwrap(),
                b"original"
            );
        }
    }
    #[test]
    fn extraction_never_follows_links_or_overwrites_existing_files() {
        let (outside, _) = fixture();
        std::fs::write(outside.path().join("private"), b"keep").unwrap();
        let mut builder = tar::Builder::new(Vec::new());
        append(
            &mut builder,
            "link",
            tar::EntryType::Symlink,
            Some(outside.path().to_str().unwrap()),
            b"",
        );
        append(
            &mut builder,
            "link/private",
            tar::EntryType::Regular,
            None,
            b"overwrite",
        );
        let bytes = builder.into_inner().unwrap();
        let (_out, root) = fixture();
        assert!(restore(bytes.as_slice(), &root, cancel()).is_err());
        assert_eq!(
            std::fs::read(outside.path().join("private")).unwrap(),
            b"keep"
        );
        let (out, root) = fixture();
        std::fs::write(out.path().join("existing"), b"keep").unwrap();
        let mut builder = tar::Builder::new(Vec::new());
        append(
            &mut builder,
            "existing",
            tar::EntryType::Regular,
            None,
            b"overwrite",
        );
        assert!(restore(builder.into_inner().unwrap().as_slice(), &root, cancel()).is_err());
        assert_eq!(std::fs::read(out.path().join("existing")).unwrap(), b"keep");
        for path in ["../outside", "/absolute", "a/../../outside"] {
            assert!(safe_path(Path::new(path)).is_err());
        }
    }
    #[test]
    fn excessive_extensions_unsafe_hardlinks_and_truncated_streams_fail() {
        let mut header = tar::Header::new_gnu();
        header.set_entry_type(tar::EntryType::XHeader);
        header.set_size(MAX_METADATA as u64 + 1);
        header.set_cksum();
        let (_out, root) = fixture();
        assert!(restore(header.as_bytes().as_slice(), &root, cancel()).is_err());
        let mut builder = tar::Builder::new(Vec::new());
        append(
            &mut builder,
            "link",
            tar::EntryType::Link,
            Some("../outside"),
            b"",
        );
        assert!(restore(builder.into_inner().unwrap().as_slice(), &root, cancel()).is_err());
        let mut builder = tar::Builder::new(Vec::new());
        append(
            &mut builder,
            "file",
            tar::EntryType::Regular,
            None,
            &[0; 1024],
        );
        let bytes = builder.into_inner().unwrap();
        for size in [
            0,
            512,
            bytes.len() - 1024,
            bytes.len() - 512,
            bytes.len() - 1,
        ] {
            let (_out, root) = fixture();
            assert!(
                restore(&bytes[..size], &root, cancel()).is_err(),
                "accepted length {size}"
            );
        }
    }
    #[test]
    fn cancellation_during_streaming_is_an_error_and_does_not_claim_a_complete_backup() {
        let (input, root) = fixture();
        std::fs::write(input.path().join("file"), vec![7; 256 * 1024]).unwrap();
        struct CancelWriter {
            count: usize,
            cancel: Arc<AtomicBool>,
        }
        impl Write for CancelWriter {
            fn write(&mut self, data: &[u8]) -> io::Result<usize> {
                self.count += data.len();
                if self.count > 70_000 {
                    self.cancel.store(true, Ordering::Release);
                }
                Ok(data.len())
            }
            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }
        let flag = cancel();
        let mut output = CancelWriter {
            count: 0,
            cancel: flag.clone(),
        };
        assert_eq!(
            write_sources(
                &[Source {
                    directory: root,
                    name: "Input".into()
                }],
                &mut output,
                flag
            )
            .unwrap_err()
            .kind(),
            io::ErrorKind::ConnectionAborted
        );
        assert!(output.count < 256 * 1024);
    }
}
