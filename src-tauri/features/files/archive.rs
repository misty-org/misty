// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
//! Compress and Extract, as Finder's Archive Utility does them: Compress makes a zip next to the
//! items ("name.zip" for one, "Archive.zip" for several), Extract opens an archive into a new
//! folder named after it. Zip and tar (plain or gzipped) are read here, written through open,
//! checked folder handles, with caps on the bytes and items one archive may unpack to. tar.bz2 and
//! tar.xz go to the system's own `tar`, and 7z and rar to `7z` or `unar` when one is installed:
//! each unpacks into a hidden folder of its own beside the archive, with a time limit, and what it
//! made is walked before the folder takes the archive's name, so links that lead outside and
//! anything that isn't a file, a folder or a link are taken out. Links inside archives Files reads
//! itself are left out.
use std::{
    ffi::{OsStr, OsString},
    io::{self, Read, Write},
    path::{Component, Path, PathBuf},
    process::Command,
    sync::{mpsc, Arc, Mutex},
    time::{Duration, SystemTime},
};

use file_access::disk::{place, walk, CheckedDir, CheckedFile as File, ItemKind};
use file_access::Access;
use tauri::AppHandle;
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

use super::listing::io_text;
use super::progress::{Op, Stop};
use super::undo::{record, Change};
use super::{asked_path, asked_paths, display_name, failed, gated, person_window};

const ENTRIES_MOST: usize = 200_000;
const BYTES_MOST: u64 = 50 << 30;
const SPARE: u64 = 1 << 30;
const TOOL_TIME: Duration = Duration::from_secs(30 * 60);
const CHUNK: usize = 256 * 1024;

pub(crate) fn free_name(dir: &Path, name: &str) -> PathBuf {
    let wanted = dir.join(name);
    match file_access::disk::fs_disk::symlink_metadata(&wanted) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => wanted,
        _ => super::transfer::keep_both_name(dir, name),
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct Limits {
    pub bytes: u64,
    pub entries: usize,
}

impl Limits {
    pub(crate) fn for_folder(folder: &Path) -> Self {
        let room = super::places::free_space(folder)
            .map(|space| space.free.saturating_sub(SPARE))
            .unwrap_or(BYTES_MOST);
        Self {
            bytes: room.min(BYTES_MOST),
            entries: ENTRIES_MOST,
        }
    }
}

#[derive(Debug, Default)]
pub(crate) struct Tally {
    pub files: u64,
    pub bytes: u64,
    pub entries: usize,
    pub skipped: u64,
}

fn too_big() -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        "it unpacks to more than there is room for here",
    )
}

fn too_many() -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        "it holds more items than can be unpacked here",
    )
}

fn outside() -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        "an item in it would land outside its folder",
    )
}

pub(crate) fn safe_relative(name: &str) -> Option<PathBuf> {
    let normalized = name.replace('\\', "/");
    let mut relative = PathBuf::new();
    for component in Path::new(&normalized).components() {
        match component {
            Component::Normal(part) => relative.push(part),
            Component::CurDir => {}
            _ => return None,
        }
    }
    (!relative.as_os_str().is_empty()).then_some(relative)
}

fn open_inside(root: &CheckedDir, relative: &Path) -> io::Result<Option<CheckedDir>> {
    let mut current: Option<CheckedDir> = None;
    for part in relative.components() {
        let Component::Normal(name) = part else {
            return Err(outside());
        };
        let here = current.as_ref().unwrap_or(root);
        let next = match here.child(name, Access::Write) {
            Ok(dir) => dir,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                match here.create_dir(name) {
                    Err(error) if error.kind() != io::ErrorKind::AlreadyExists => {
                        return Err(error)
                    }
                    _ => {}
                }
                here.child(name, Access::Write)?
            }
            Err(error) => return Err(error),
        };
        current = Some(next);
    }
    Ok(current)
}

pub(crate) struct Unpacker<'a> {
    root: &'a CheckedDir,
    last: Option<(PathBuf, Option<CheckedDir>)>,
    limits: Limits,
    pub tally: Tally,
    stop: &'a Stop,
    progress: &'a mut dyn FnMut(u64, &str),
}

impl<'a> Unpacker<'a> {
    pub(crate) fn new(
        root: &'a CheckedDir,
        limits: Limits,
        stop: &'a Stop,
        progress: &'a mut dyn FnMut(u64, &str),
    ) -> Self {
        Self {
            root,
            last: None,
            limits,
            tally: Tally::default(),
            stop,
            progress,
        }
    }

    fn counted(&mut self) -> io::Result<()> {
        if self.stop.stopped() {
            return Err(gated::cancelled());
        }
        self.tally.entries += 1;
        if self.tally.entries > self.limits.entries {
            return Err(too_many());
        }
        Ok(())
    }

    fn folder(&mut self, relative: &Path) -> io::Result<&CheckedDir> {
        let fresh = !matches!(&self.last, Some((path, _)) if path.as_path() == relative);
        if fresh {
            let opened = open_inside(self.root, relative)?;
            self.last = Some((relative.to_path_buf(), opened));
        }
        Ok(match &self.last {
            Some((_, Some(dir))) => dir,
            _ => self.root,
        })
    }

    pub(crate) fn dir(&mut self, relative: &Path) -> io::Result<()> {
        self.counted()?;
        self.folder(relative).map(drop)
    }

    pub(crate) fn file(
        &mut self,
        relative: &Path,
        reader: &mut dyn Read,
        executable: bool,
    ) -> io::Result<()> {
        self.counted()?;
        let (Some(name), parent) = (
            relative.file_name().map(OsStr::to_owned),
            relative.parent().unwrap_or(Path::new("")).to_path_buf(),
        ) else {
            return Err(outside());
        };
        let shown = name.to_string_lossy().into_owned();
        let mut out = match self.folder(&parent)?.create_file(&name) {
            Ok(out) => out,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                self.tally.skipped += 1;
                return Ok(());
            }
            Err(error) => return Err(error),
        };
        let mut buffer = vec![0u8; CHUNK];
        loop {
            if self.stop.stopped() {
                return Err(gated::cancelled());
            }
            let read = match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => read,
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(error) => return Err(error),
            };
            self.tally.bytes = self.tally.bytes.saturating_add(read as u64);
            if self.tally.bytes > self.limits.bytes {
                return Err(too_big());
            }
            out.write_all(&buffer[..read])?;
            (self.progress)(read as u64, &shown);
        }
        #[cfg(unix)]
        if executable {
            use std::os::unix::fs::PermissionsExt;
            let _ = out.set_permissions(std::fs::Permissions::from_mode(0o755));
        }
        #[cfg(not(unix))]
        let _ = executable;
        self.tally.files += 1;
        Ok(())
    }

    pub(crate) fn skip(&mut self) -> io::Result<()> {
        self.counted()?;
        self.tally.skipped += 1;
        Ok(())
    }
}

pub(crate) fn unpack_zip(file: File, into: &mut Unpacker<'_>) -> io::Result<()> {
    let mut zip = ZipArchive::new(file).map_err(io::Error::other)?;
    if zip.len() > into.limits.entries {
        return Err(too_many());
    }
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(io::Error::other)?;
        let relative = safe_relative(entry.name()).ok_or_else(outside)?;
        if relative.starts_with("__MACOSX") || entry.is_symlink() {
            into.skip()?;
            continue;
        }
        if entry.is_dir() {
            into.dir(&relative)?;
        } else {
            let executable = entry.unix_mode().is_some_and(|mode| mode & 0o111 != 0);
            into.file(&relative, &mut entry, executable)?;
        }
    }
    Ok(())
}

fn unpack_tar(file: File, gzipped: bool, into: &mut Unpacker<'_>) -> io::Result<()> {
    let reader: Box<dyn Read> = if gzipped {
        Box::new(flate2::read::GzDecoder::new(file))
    } else {
        Box::new(file)
    };
    let mut tar = tar::Archive::new(reader);
    for entry in tar.entries()? {
        let mut entry = entry?;
        let name = entry.path()?.to_string_lossy().into_owned();
        let relative = safe_relative(&name).ok_or_else(outside)?;
        let kind = entry.header().entry_type();
        if kind.is_dir() {
            into.dir(&relative)?;
        } else if kind.is_file() {
            let executable = entry.header().mode().is_ok_and(|mode| mode & 0o111 != 0);
            into.file(&relative, &mut entry, executable)?;
        } else {
            into.skip()?;
        }
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Format {
    Zip,
    Tar,
    TarGz,
    OtherTar,
    SevenZip,
    Rar,
}

fn format_of(name: &str) -> Option<(Format, &str)> {
    let lower = name.to_ascii_lowercase();
    let formats: [(&str, Format); 12] = [
        (".tar.gz", Format::TarGz),
        (".tgz", Format::TarGz),
        (".tar.bz2", Format::OtherTar),
        (".tbz2", Format::OtherTar),
        (".tbz", Format::OtherTar),
        (".tar.xz", Format::OtherTar),
        (".txz", Format::OtherTar),
        (".tar", Format::Tar),
        (".zip", Format::Zip),
        (".7z", Format::SevenZip),
        (".rar", Format::Rar),
        (".cbz", Format::Zip),
    ];
    formats.iter().find_map(|(ending, format)| {
        lower
            .ends_with(ending)
            .then(|| (*format, &name[..name.len() - ending.len()]))
    })
}

fn installed(tools: &[&str]) -> Option<PathBuf> {
    tools.iter().find_map(|tool| which::which(tool).ok())
}

#[cfg(unix)]
fn kill_group(pid: u32) {
    if let Ok(pid) = i32::try_from(pid) {
        // SAFETY: kill takes a process group id and a signal and touches no memory; the group
        // is the tool's own, started with process_group(0).
        unsafe {
            libc::kill(-pid, libc::SIGKILL);
        }
    }
}

#[cfg(not(unix))]
fn kill_group(_pid: u32) {}

fn run_tool(archive: &Path, mut command: Command, stop: &Stop) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut child = command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| failed(archive, error))?;
    let pid = child.id();
    let (tell, heard) = mpsc::channel::<()>();
    let ended: Arc<Mutex<Option<(io::Result<std::process::ExitStatus>, Vec<u8>)>>> = Arc::default();
    let waiter = {
        let (tell, ended) = (tell.clone(), ended.clone());
        let stderr = child.stderr.take();
        std::thread::spawn(move || {
            let mut said = Vec::new();
            if let Some(mut stderr) = stderr {
                let _ = (&mut stderr).take(64 * 1024).read_to_end(&mut said);
                let _ = io::copy(&mut stderr, &mut io::sink());
            }
            let status = child.wait();
            *ended
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some((status, said));
            let _ = tell.send(());
        })
    };
    stop.tell(tell);
    let woke = heard.recv_timeout(TOOL_TIME);
    let finished = ended
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .take();
    let Some((status, said)) = finished else {
        kill_group(pid);
        let _ = waiter.join();
        return Err(match woke {
            Ok(()) => failed(archive, "unpacking was stopped"),
            Err(_) => failed(archive, "unpacking took too long"),
        });
    };
    let _ = waiter.join();
    let status = status.map_err(|error| failed(archive, error))?;
    if status.success() {
        return Ok(());
    }
    let said = String::from_utf8_lossy(&said);
    let line = said
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("it couldn't be opened");
    Err(failed(archive, line))
}

fn tool_command(archive: &Path, folder: &Path, format: Format) -> Result<Command, String> {
    let missing = |tool: &str| {
        failed(
            archive,
            format!("opening it needs {tool}, which isn't installed"),
        )
    };
    let mut command = match format {
        Format::OtherTar => {
            let tar = installed(&["tar"]).ok_or_else(|| missing("tar"))?;
            let mut command = Command::new(tar);
            command.arg("-xf").arg(archive).arg("-C").arg(folder);
            return Ok(command);
        }
        Format::SevenZip | Format::Rar => {
            let seven = installed(&["7z", "7zz", "7za"]);
            let unar = installed(&["unar"]);
            let (first, second) = if format == Format::Rar {
                (unar, seven)
            } else {
                (seven, unar)
            };
            match first.or(second) {
                Some(tool) if tool.file_stem().is_some_and(|stem| stem == "unar") => {
                    let mut command = Command::new(tool);
                    command
                        .arg("-quiet")
                        .arg("-no-directory")
                        .arg("-output-directory")
                        .arg(folder);
                    command
                }
                Some(tool) => {
                    let mut command = Command::new(tool);
                    command
                        .arg("x")
                        .arg("-y")
                        .arg(format!("-o{}", folder.display()));
                    command
                }
                None => return Err(missing("7-Zip or The Unarchiver")),
            }
        }
        Format::Zip | Format::Tar | Format::TarGz => {
            return Err(failed(archive, "Files opens it itself"))
        }
    };
    command.arg(archive);
    Ok(command)
}

pub(crate) fn link_stays_inside(depth: usize, target: &Path) -> bool {
    let mut level = depth;
    for part in target.components() {
        match part {
            Component::Normal(_) => level += 1,
            Component::CurDir => {}
            Component::ParentDir => {
                if level == 0 {
                    return false;
                }
                level -= 1;
            }
            Component::RootDir | Component::Prefix(_) => return false,
        }
    }
    true
}

fn tidy_tool_output(folder: &Path, limits: Limits, stop: &Stop) -> io::Result<()> {
    let mut tally = Tally::default();
    walk::walk(folder, Access::Write, walk::WalkFor::Person, &mut |step| {
        if stop.stopped() {
            return Err(gated::cancelled());
        }
        tally.entries += 1;
        if tally.entries > limits.entries {
            return Err(too_many());
        }
        match step.item.kind {
            ItemKind::Link => {
                let target = step.dir.read_link(&step.item.name)?;
                if !link_stays_inside(step.depth, &target) {
                    step.dir.remove_file(&step.item.name)?;
                }
            }
            ItemKind::Other => step.dir.remove_file(&step.item.name)?,
            ItemKind::File => {
                tally.bytes = tally.bytes.saturating_add(step.item.len);
                if tally.bytes > limits.bytes {
                    return Err(too_big());
                }
            }
            ItemKind::Dir => {}
        }
        Ok(walk::WalkFlow::Continue)
    })
}

fn extract_with_tool(
    archive: &Path,
    parent: &CheckedDir,
    stem: &str,
    format: Format,
    limits: Limits,
    stop: &Stop,
) -> Result<OsString, String> {
    let held = format!(".misty-extract-{}", uuid::Uuid::new_v4().simple());
    let held =
        gated::make_folder_keep_both(parent, &held).map_err(|error| failed(archive, error))?;
    let folder = parent.path().join(&held);
    let made = tool_command(archive, &folder, format)
        .and_then(|command| run_tool(archive, command, stop))
        .and_then(|()| {
            tidy_tool_output(&folder, limits, stop)
                .map_err(|error| failed(archive, io_text(&error)))
        })
        .and_then(|()| {
            place::rename_keep_both(parent, &held, parent, OsStr::new(stem))
                .map_err(|error| failed(archive, io_text(&error)))
        });
    if made.is_err() {
        let _ = walk::remove_tree_checked(&folder, walk::WalkFor::Person, &mut |_| true);
    }
    made
}

pub(crate) fn extract(window: &str, archive: &Path, op: &mut Op) -> Result<PathBuf, String> {
    let name = display_name(archive);
    let (format, stem) =
        format_of(&name).ok_or_else(|| failed(archive, "it isn't an archive Files can open"))?;
    let stem = if stem.trim().is_empty() {
        "Archive"
    } else {
        stem
    };
    let (folder_path, _) = gated::split(archive).map_err(|error| failed(archive, error))?;
    let parent = gated::dir(folder_path, Access::Write, walk::WalkFor::Person)
        .map_err(|error| failed(archive, io_text(&error)))?;
    let file = gated::open_read(archive).map_err(|error| failed(archive, io_text(&error)))?;
    op.set_total(file.metadata().map(|meta| meta.len()).unwrap_or(0));
    let limits = Limits::for_folder(parent.path());
    let stop = op.stop();
    let landed = match format {
        Format::Zip | Format::Tar | Format::TarGz => {
            let made = gated::make_folder_keep_both(&parent, stem)
                .map_err(|error| failed(archive, io_text(&error)))?;
            let made_path = parent.path().join(&made);
            let unpacked = parent.child(&made, Access::Write).and_then(|root| {
                let mut progress = |bytes: u64, item: &str| op.advance(bytes, item);
                let mut into = Unpacker::new(&root, limits, &stop, &mut progress);
                match format {
                    Format::Zip => unpack_zip(file, &mut into),
                    Format::Tar => unpack_tar(file, false, &mut into),
                    _ => unpack_tar(file, true, &mut into),
                }
            });
            match unpacked {
                Ok(()) => made,
                Err(error) => {
                    let _ =
                        walk::remove_tree_checked(&made_path, walk::WalkFor::Person, &mut |_| true);
                    return Err(if gated::is_cancel(&error) {
                        failed(archive, "unpacking was stopped")
                    } else {
                        failed(archive, io_text(&error))
                    });
                }
            }
        }
        other => {
            drop(file);
            extract_with_tool(archive, &parent, stem, other, limits, &stop)?
        }
    };
    let folder = folder_path.join(landed);
    record(window, "Extract", Change::Created(folder.clone()));
    super::search::note_added(&folder);
    Ok(folder)
}

#[tauri::command]
pub async fn files_extract(
    app: AppHandle,
    webview: tauri::Webview,
    path: String,
    op_id: String,
) -> Result<String, String> {
    person_window(&webview)?;
    let archive = asked_path(&path)?;
    super::runtime::run(&app, &webview, &op_id, "Extracting", move |op| {
        let window = op.window().to_owned();
        extract(&window, &archive, op).map(|folder| folder.display().to_string())
    })
    .await
}

fn zip_time(modified: Option<SystemTime>) -> Option<zip::DateTime> {
    use chrono::{Datelike, Timelike};
    let local = chrono::DateTime::<chrono::Local>::from(modified?);
    zip::DateTime::from_date_and_time(
        u16::try_from(local.year()).ok()?,
        local.month() as u8,
        local.day() as u8,
        local.hour() as u8,
        local.minute() as u8,
        (local.second() as u8).min(58),
    )
    .ok()
}

fn options_for(size: u64, modified: Option<SystemTime>, mode: u32) -> SimpleFileOptions {
    let mut options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .large_file(size >= u32::MAX as u64);
    if let Some(time) = zip_time(modified) {
        options = options.last_modified_time(time);
    }
    if cfg!(unix) {
        options = options.unix_permissions(mode & 0o777);
    }
    options
}

pub(crate) enum Naming<'a> {
    Exact(&'a str),
    KeepBoth(&'a str),
}

pub(crate) struct Packer<'a> {
    writer: ZipWriter<File>,
    who: walk::WalkFor,
    stop: &'a Stop,
    progress: &'a mut dyn FnMut(u64, &str),
    limits: Limits,
    pub tally: Tally,
}

fn zip_error(error: zip::result::ZipError) -> io::Error {
    io::Error::other(error)
}

#[cfg(unix)]
fn mode_of(meta: &std::fs::Metadata) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    meta.permissions().mode()
}

#[cfg(not(unix))]
fn mode_of(_meta: &std::fs::Metadata) -> u32 {
    0o644
}

impl<'a> Packer<'a> {
    fn room(&mut self, size: u64) -> io::Result<()> {
        if self.stop.stopped() {
            return Err(gated::cancelled());
        }
        self.tally.entries += 1;
        if self.tally.entries > self.limits.entries {
            return Err(too_many());
        }
        if self.tally.bytes.saturating_add(size) > self.limits.bytes {
            return Err(too_big());
        }
        Ok(())
    }

    fn copy_in(&mut self, mut source: File, name: &str) -> io::Result<()> {
        let mut buffer = vec![0u8; CHUNK];
        loop {
            if self.stop.stopped() {
                return Err(gated::cancelled());
            }
            let read = match source.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => read,
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(error) => return Err(error),
            };
            self.writer.write_all(&buffer[..read])?;
            self.tally.bytes += read as u64;
            (self.progress)(read as u64, name);
        }
        self.tally.files += 1;
        Ok(())
    }

    fn file(
        &mut self,
        dir: &CheckedDir,
        name: &OsStr,
        inside: &str,
        size: u64,
        modified: Option<SystemTime>,
        mode: u32,
    ) -> io::Result<()> {
        self.room(size)?;
        let source = dir.open_file(name)?;
        self.writer
            .start_file(inside, options_for(size, modified, mode))
            .map_err(zip_error)?;
        self.copy_in(source, inside)
    }

    fn link(&mut self, dir: &CheckedDir, name: &OsStr, inside: &str) -> io::Result<()> {
        if self.who == walk::WalkFor::Agent {
            self.tally.skipped += 1;
            return Ok(());
        }
        self.room(0)?;
        let target = dir.read_link(name)?;
        self.writer
            .add_symlink(
                inside,
                target.to_string_lossy().replace('\\', "/"),
                options_for(0, None, 0o777),
            )
            .map_err(zip_error)
    }

    fn folder(&mut self, inside: &str, modified: Option<SystemTime>, mode: u32) -> io::Result<()> {
        self.room(0)?;
        self.writer
            .add_directory(format!("{inside}/"), options_for(0, modified, mode))
            .map_err(zip_error)
    }

    pub(crate) fn add(&mut self, source: &Path) -> io::Result<()> {
        let (parent, name) = gated::parent_for(source, Access::Read, self.who)?;
        let meta = parent.metadata(&name)?;
        let inside = name.to_string_lossy().into_owned();
        let modified = meta.modified().ok();
        if meta.file_type().is_symlink() {
            return self.link(&parent, &name, &inside);
        }
        if meta.is_file() {
            return self.file(
                &parent,
                &name,
                &inside,
                meta.len(),
                modified,
                mode_of(&meta),
            );
        }
        if !meta.is_dir() {
            self.tally.skipped += 1;
            return Ok(());
        }
        self.folder(&inside, modified, mode_of(&meta))?;
        let who = self.who;
        walk::walk(source, Access::Read, who, &mut |step| {
            if step.item.name == ".DS_Store" {
                return Ok(walk::WalkFlow::Continue);
            }
            let relative = step
                .relative
                .components()
                .map(|part| part.as_os_str().to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join("/");
            let path = format!("{inside}/{relative}");
            match step.item.kind {
                ItemKind::Dir => self.folder(&path, step.item.modified, step.item.mode)?,
                ItemKind::File => self.file(
                    step.dir,
                    &step.item.name,
                    &path,
                    step.item.len,
                    step.item.modified,
                    step.item.mode,
                )?,
                ItemKind::Link => self.link(step.dir, &step.item.name, &path)?,
                ItemKind::Other => self.tally.skipped += 1,
            }
            Ok(walk::WalkFlow::Continue)
        })
    }
}

pub(crate) fn pack(
    sources: &[PathBuf],
    dir: &CheckedDir,
    naming: Naming<'_>,
    who: walk::WalkFor,
    stop: &Stop,
    progress: &mut dyn FnMut(u64, &str),
) -> io::Result<(PathBuf, Tally)> {
    let (name, file) = match naming {
        Naming::Exact(name) => {
            let name = OsString::from(name);
            let file = dir.create_file(&name)?;
            (name, file)
        }
        Naming::KeepBoth(name) => gated::create_file_keep_both(dir, name)?,
    };
    let mut packer = Packer {
        writer: ZipWriter::new(file),
        who,
        stop,
        progress,
        limits: Limits {
            bytes: BYTES_MOST,
            entries: ENTRIES_MOST,
        },
        tally: Tally::default(),
    };
    let added = sources.iter().try_for_each(|source| packer.add(source));
    let Packer { writer, tally, .. } = packer;
    let packed = added.and_then(|()| writer.finish().map(drop).map_err(zip_error));
    match packed {
        Ok(()) => Ok((dir.path().join(&name), tally)),
        Err(error) => {
            let _ = dir.remove_file(&name);
            Err(error)
        }
    }
}

pub(crate) fn compress(window: &str, sources: &[PathBuf], op: &mut Op) -> Result<PathBuf, String> {
    let first = sources
        .first()
        .ok_or_else(|| "Choose something to compress.".to_owned())?;
    let (folder, _) = gated::split(first).map_err(|error| failed(first, error))?;
    let dir = gated::dir(folder, Access::Write, walk::WalkFor::Person)
        .map_err(|error| failed(first, io_text(&error)))?;
    let name = match sources {
        [one] => format!("{}.zip", display_name(one)),
        _ => "Archive.zip".to_owned(),
    };
    let stop = op.stop();
    let total = sources
        .iter()
        .filter_map(|source| {
            walk::tree_size_checked(source, walk::WalkFor::Person, &|| stop.stopped()).ok()
        })
        .map(|(bytes, _)| bytes)
        .sum();
    op.set_total(total);
    let mut progress = |bytes: u64, item: &str| op.advance(bytes, item);
    let packed = pack(
        sources,
        &dir,
        Naming::KeepBoth(&name),
        walk::WalkFor::Person,
        &stop,
        &mut progress,
    );
    match packed {
        Ok((target, _)) => {
            record(window, "Compress", Change::Created(target.clone()));
            super::search::note_added(&target);
            Ok(target)
        }
        Err(error) if gated::is_cancel(&error) => Err(failed(first, "compressing was stopped")),
        Err(error) => Err(failed(first, io_text(&error))),
    }
}

#[tauri::command]
pub async fn files_compress(
    app: AppHandle,
    webview: tauri::Webview,
    paths: Vec<String>,
    op_id: Option<String>,
) -> Result<String, String> {
    person_window(&webview)?;
    let sources = asked_paths(&paths)?;
    let op_id = op_id.unwrap_or_else(super::runtime::new_op_id);
    super::runtime::run(&app, &webview, &op_id, "Compressing", move |op| {
        let window = op.window().to_owned();
        compress(&window, &sources, op).map(|target| target.display().to_string())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn archive_paths_never_leave_their_folder() {
        assert_eq!(safe_relative("a/b.txt"), Some(PathBuf::from("a/b.txt")));
        assert_eq!(safe_relative("./a"), Some(PathBuf::from("a")));
        assert_eq!(safe_relative("../evil"), None);
        assert_eq!(safe_relative("a/../../evil"), None);
        assert_eq!(safe_relative("/etc/passwd"), None);
        assert_eq!(safe_relative("..\\evil"), None);
        assert_eq!(safe_relative(""), None);
    }

    #[test]
    fn formats_are_told_by_their_ending() {
        assert_eq!(format_of("Photos.zip"), Some((Format::Zip, "Photos")));
        assert_eq!(format_of("src.tar.gz"), Some((Format::TarGz, "src")));
        assert_eq!(format_of("src.TGZ"), Some((Format::TarGz, "src")));
        assert_eq!(format_of("src.tar.xz"), Some((Format::OtherTar, "src")));
        assert_eq!(format_of("old.rar"), Some((Format::Rar, "old")));
        assert_eq!(format_of("notes.txt"), None);
    }

    #[test]
    fn links_made_by_a_tool_stay_inside() {
        assert!(link_stays_inside(0, Path::new("a/b")));
        assert!(link_stays_inside(1, Path::new("../b")));
        assert!(!link_stays_inside(0, Path::new("../b")));
        assert!(!link_stays_inside(3, Path::new("/etc/passwd")));
    }

    fn zip_of(entries: &[(&str, &[u8])]) -> PathBuf {
        let root = tempfile::tempdir().expect("temp folder").keep();
        let archive = root.join("test.zip");
        let file = CheckedDir::open(&root, Access::Write)
            .and_then(|dir| dir.create_file(OsStr::new("test.zip")))
            .expect("create");
        let mut writer = ZipWriter::new(file);
        for (name, body) in entries {
            writer
                .start_file(*name, SimpleFileOptions::default())
                .expect("entry");
            writer.write_all(body).expect("write");
        }
        writer.finish().expect("finish");
        archive
    }

    fn unpack(archive: &Path, limits: Limits) -> (io::Result<()>, PathBuf, Tally) {
        let parent = archive.parent().expect("folder");
        let into = parent.join("out");
        file_access::fs::create_dir_all(&into).expect("folder");
        let root = CheckedDir::open(&into, Access::Write).expect("open");
        let stop = Stop::default();
        let mut progress = |_: u64, _: &str| {};
        let mut unpacker = Unpacker::new(&root, limits, &stop, &mut progress);
        let file = gated::open_read(archive).expect("archive");
        let result = unpack_zip(file, &mut unpacker);
        (result, into, unpacker.tally)
    }

    #[test]
    fn a_zip_never_writes_outside_its_folder() {
        let archive = zip_of(&[("ok.txt", b"fine"), ("../evil.txt", b"bad")]);
        let parent = archive.parent().expect("folder").to_path_buf();
        let limits = Limits {
            bytes: 1 << 20,
            entries: 10,
        };
        let (result, into, _) = unpack(&archive, limits);
        assert!(result.is_err());
        assert!(!file_access::fs::exists(parent.join("evil.txt")));
        assert!(file_access::fs::exists(into.join("ok.txt")));
        let _ = file_access::fs::remove_dir_all(&parent);
    }

    #[test]
    fn a_zip_stops_at_its_item_and_byte_caps() {
        let archive = zip_of(&[("a.txt", b"1"), ("b.txt", b"2"), ("c.txt", b"3")]);
        let parent = archive.parent().expect("folder").to_path_buf();
        let (result, _, _) = unpack(
            &archive,
            Limits {
                bytes: 1 << 20,
                entries: 2,
            },
        );
        assert!(result.is_err());
        let _ = file_access::fs::remove_dir_all(&parent);
        let archive = zip_of(&[("big.bin", &[9u8; 4096])]);
        let parent = archive.parent().expect("folder").to_path_buf();
        let (result, _, _) = unpack(
            &archive,
            Limits {
                bytes: 1000,
                entries: 10,
            },
        );
        assert!(result.is_err());
        let archive_ok = zip_of(&[("dir/a.txt", b"hello")]);
        let parent_ok = archive_ok.parent().expect("folder").to_path_buf();
        let (result, into, tally) = unpack(
            &archive_ok,
            Limits {
                bytes: 1 << 20,
                entries: 10,
            },
        );
        assert!(result.is_ok());
        assert_eq!(tally.files, 1);
        assert_eq!(
            file_access::fs::read(into.join("dir/a.txt")).expect("read"),
            b"hello"
        );
        let _ = file_access::fs::remove_dir_all(&parent);
        let _ = file_access::fs::remove_dir_all(&parent_ok);
    }
}
