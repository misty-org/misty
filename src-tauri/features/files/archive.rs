// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
//! Compress and Extract, as Finder's Archive Utility does them: Compress makes a zip next to the
//! items ("name.zip" for one, "Archive.zip" for several), Extract opens an archive into a new
//! folder named after it. Zip and tar (plain or gzipped) are read here; tar.bz2 and tar.xz go to
//! the system's own `tar`, and 7z and rar to `7z` or `unar` when one is installed. No entry ever
//! lands outside the new folder, and links inside archives are left out.
use std::{
    io::{self, Read},
    path::{Component, Path, PathBuf},
    process::Command,
};

use file_access::{
    disk::{check_disk, fs_disk},
    Access,
};
use tauri::AppHandle;
use walkdir::WalkDir;
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

use super::progress::Op;
use super::transfer::keep_both_name;
use super::undo::{record, Change};
use super::{asked_path, blocking, display_name, failed, person_window};

pub(crate) fn free_name(dir: &Path, name: &str) -> PathBuf {
    let wanted = dir.join(name);
    if fs_disk::exists(&wanted) {
        keep_both_name(dir, name)
    } else {
        wanted
    }
}

fn new_op_id() -> String {
    format!("files-{}", uuid::Uuid::new_v4())
}

enum Item {
    Folder,
    File(u64),
    Link(String),
}

fn plan(sources: &[PathBuf]) -> Result<Vec<(PathBuf, String, Item)>, String> {
    let mut items = Vec::new();
    for source in sources {
        check_disk(source, Access::Read).map_err(|error| failed(source, error))?;
        let base = source.parent().unwrap_or(source.as_path());
        for entry in WalkDir::new(source).follow_links(false).sort_by_file_name() {
            let entry = entry.map_err(|error| failed(source, error))?;
            if entry.file_name() == ".DS_Store" {
                continue;
            }
            let path = entry.path().to_path_buf();
            let Some(name) = entry_name(path.strip_prefix(base).unwrap_or(path.as_path())) else {
                continue;
            };
            let kind = entry.file_type();
            let item = if kind.is_symlink() {
                let target = fs_disk::read_link(&path).map_err(|error| failed(&path, error))?;
                Item::Link(target.to_string_lossy().replace('\\', "/"))
            } else if kind.is_dir() {
                Item::Folder
            } else {
                Item::File(entry.metadata().map(|meta| meta.len()).unwrap_or(0))
            };
            items.push((path, name, item));
        }
    }
    Ok(items)
}

fn entry_name(relative: &Path) -> Option<String> {
    safe_relative(&relative.to_string_lossy()).map(|path| {
        path.components()
            .map(|part| part.as_os_str().to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join("/")
    })
}

fn zip_time(path: &Path) -> Option<zip::DateTime> {
    use chrono::{Datelike, Timelike};
    let modified = fs_disk::symlink_metadata(path).ok()?.modified().ok()?;
    let local = chrono::DateTime::<chrono::Local>::from(modified);
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

fn options_for(path: &Path, size: u64) -> SimpleFileOptions {
    let mut options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .large_file(size >= u32::MAX as u64);
    if let Some(time) = zip_time(path) {
        options = options.last_modified_time(time);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = fs_disk::symlink_metadata(path) {
            options = options.unix_permissions(meta.permissions().mode() & 0o777);
        }
    }
    options
}

fn write_zip(
    target: &Path,
    items: &[(PathBuf, String, Item)],
    mut op: Option<&mut Op>,
) -> Result<bool, String> {
    let file = fs_disk::create_new(target).map_err(|error| failed(target, error))?;
    let mut writer = ZipWriter::new(file);
    let stopped = |op: &Option<&mut Op>| op.as_ref().is_some_and(|op| op.cancelled());
    for (path, name, item) in items {
        if stopped(&op) {
            return Ok(false);
        }
        match item {
            Item::Folder => writer
                .add_directory(name.clone(), options_for(path, 0))
                .map_err(|error| failed(path, error))?,
            Item::Link(link) => writer
                .add_symlink(name, link, options_for(path, 0))
                .map_err(|error| failed(path, error))?,
            Item::File(size) => {
                writer
                    .start_file(name, options_for(path, *size))
                    .map_err(|error| failed(path, error))?;
                let mut source = fs_disk::open(path).map_err(|error| failed(path, error))?;
                let mut buffer = vec![0u8; 256 * 1024];
                loop {
                    let read = source
                        .read(&mut buffer)
                        .map_err(|error| failed(path, error))?;
                    if read == 0 {
                        break;
                    }
                    io::Write::write_all(&mut writer, &buffer[..read])
                        .map_err(|error| failed(path, error))?;
                    if let Some(op) = op.as_mut() {
                        op.advance(read as u64, name);
                    }
                    if stopped(&op) {
                        return Ok(false);
                    }
                }
            }
        }
    }
    writer.finish().map_err(|error| failed(target, error))?;
    Ok(true)
}

pub(crate) fn compress(app: Option<&AppHandle>, sources: &[PathBuf]) -> Result<PathBuf, String> {
    let first = sources
        .first()
        .ok_or_else(|| "Choose something to compress.".to_owned())?;
    let dir = first
        .parent()
        .ok_or_else(|| failed(first, "it can't be compressed"))?;
    let name = match sources {
        [one] => format!("{}.zip", display_name(one)),
        _ => "Archive.zip".to_owned(),
    };
    let items = plan(sources)?;
    let total = items
        .iter()
        .map(|(_, _, item)| {
            if let Item::File(size) = item {
                *size
            } else {
                0
            }
        })
        .sum::<u64>();
    let target = free_name(dir, &name);
    let mut op = app.map(|app| Op::start(app, &new_op_id(), "Compressing", total));
    let written = write_zip(&target, &items, op.as_mut());
    drop(op);
    match written {
        Ok(true) => {
            record("Compress", Change::Created(target.clone()));
            super::search::note_added(&target);
            Ok(target)
        }
        Ok(false) => {
            let _ = fs_disk::remove_file(&target);
            Err(failed(&target, "compressing was stopped"))
        }
        Err(error) => {
            let _ = fs_disk::remove_file(&target);
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn files_compress(
    app: AppHandle,
    webview: tauri::Webview,
    paths: Vec<String>,
) -> Result<String, String> {
    person_window(&webview)?;
    let sources = paths
        .iter()
        .map(|path| asked_path(path))
        .collect::<Result<Vec<_>, _>>()?;
    blocking(move || compress(Some(&app), &sources).map(|target| target.display().to_string()))
        .await
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

fn safe_relative(name: &str) -> Option<PathBuf> {
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

fn write_entry(out: &Path, reader: &mut impl Read, executable: bool) -> Result<(), String> {
    if let Some(parent) = out.parent() {
        fs_disk::create_dir_all(parent).map_err(|error| failed(parent, error))?;
    }
    let mut file = fs_disk::create_new(out).map_err(|error| failed(out, error))?;
    io::copy(reader, &mut *file).map_err(|error| failed(out, error))?;
    #[cfg(unix)]
    if executable {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs_disk::set_permissions(out, fs_disk::Permissions::from_mode(0o755));
    }
    #[cfg(not(unix))]
    let _ = executable;
    Ok(())
}

fn extract_zip(archive: &Path, folder: &Path) -> Result<(), String> {
    let file = fs_disk::open(archive).map_err(|error| failed(archive, error))?;
    let mut zip = ZipArchive::new(file).map_err(|error| failed(archive, error))?;
    for index in 0..zip.len() {
        let mut entry = zip
            .by_index(index)
            .map_err(|error| failed(archive, error))?;
        let Some(relative) = safe_relative(entry.name()) else {
            return Err(failed(
                archive,
                "an item in it would land outside its folder",
            ));
        };
        if relative.starts_with("__MACOSX") || entry.is_symlink() {
            continue;
        }
        let out = folder.join(relative);
        if entry.is_dir() {
            fs_disk::create_dir_all(&out).map_err(|error| failed(&out, error))?;
        } else {
            let executable = entry.unix_mode().is_some_and(|mode| mode & 0o111 != 0);
            write_entry(&out, &mut entry, executable)?;
        }
    }
    Ok(())
}

fn extract_tar(archive: &Path, folder: &Path, gzipped: bool) -> Result<(), String> {
    let file = fs_disk::open(archive).map_err(|error| failed(archive, error))?;
    let reader: Box<dyn Read> = if gzipped {
        Box::new(flate2::read::GzDecoder::new(file))
    } else {
        Box::new(file)
    };
    let mut tar = tar::Archive::new(reader);
    for entry in tar.entries().map_err(|error| failed(archive, error))? {
        let mut entry = entry.map_err(|error| failed(archive, error))?;
        let name = entry
            .path()
            .map_err(|error| failed(archive, error))?
            .to_string_lossy()
            .into_owned();
        let Some(relative) = safe_relative(&name) else {
            return Err(failed(
                archive,
                "an item in it would land outside its folder",
            ));
        };
        let out = folder.join(relative);
        let kind = entry.header().entry_type();
        if kind.is_dir() {
            fs_disk::create_dir_all(&out).map_err(|error| failed(&out, error))?;
        } else if kind.is_file() {
            let executable = entry.header().mode().is_ok_and(|mode| mode & 0o111 != 0);
            write_entry(&out, &mut entry, executable)?;
        }
    }
    Ok(())
}

fn installed(tools: &[&str]) -> Option<PathBuf> {
    tools.iter().find_map(|tool| which::which(tool).ok())
}

fn run_tool(archive: &Path, mut command: Command) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let output = command
        .stdin(std::process::Stdio::null())
        .output()
        .map_err(|error| failed(archive, error))?;
    if output.status.success() {
        return Ok(());
    }
    let said = String::from_utf8_lossy(&output.stderr);
    let line = said
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("it couldn't be opened");
    Err(failed(archive, line))
}

fn extract_with_tool(archive: &Path, folder: &Path, format: Format) -> Result<(), String> {
    let missing = |tool: &str| {
        failed(
            archive,
            format!("opening it needs {tool}, which isn't installed"),
        )
    };
    match format {
        Format::OtherTar => {
            let tar = installed(&["tar"]).ok_or_else(|| missing("tar"))?;
            let mut command = Command::new(tar);
            command.arg("-xf").arg(archive).arg("-C").arg(folder);
            run_tool(archive, command)
        }
        Format::SevenZip | Format::Rar => {
            let seven = installed(&["7z", "7zz", "7za"]);
            let unar = installed(&["unar"]);
            let (first, second) = if format == Format::Rar {
                (unar, seven)
            } else {
                (seven, unar)
            };
            let mut command = match (first.or(second), format) {
                (Some(tool), _) if tool.file_stem().is_some_and(|stem| stem == "unar") => {
                    let mut command = Command::new(tool);
                    command
                        .arg("-quiet")
                        .arg("-no-directory")
                        .arg("-output-directory")
                        .arg(folder);
                    command
                }
                (Some(tool), _) => {
                    let mut command = Command::new(tool);
                    command
                        .arg("x")
                        .arg("-y")
                        .arg(format!("-o{}", folder.display()));
                    command
                }
                (None, _) => return Err(missing("7-Zip or The Unarchiver")),
            };
            command.arg(archive);
            run_tool(archive, command)
        }
        Format::Zip | Format::Tar | Format::TarGz => Ok(()),
    }
}

pub(crate) fn extract(archive: &Path) -> Result<PathBuf, String> {
    let name = display_name(archive);
    let (format, stem) =
        format_of(&name).ok_or_else(|| failed(archive, "it isn't an archive Files can open"))?;
    let dir = archive
        .parent()
        .ok_or_else(|| failed(archive, "it can't be opened here"))?;
    check_disk(archive, Access::Read).map_err(|error| failed(archive, error))?;
    let stem = if stem.trim().is_empty() {
        "Archive"
    } else {
        stem
    };
    let folder = free_name(dir, stem);
    fs_disk::create_dir(&folder).map_err(|error| failed(&folder, error))?;
    check_disk(&folder, Access::Write).map_err(|error| failed(&folder, error))?;
    let result = match format {
        Format::Zip => extract_zip(archive, &folder),
        Format::Tar => extract_tar(archive, &folder, false),
        Format::TarGz => extract_tar(archive, &folder, true),
        other => extract_with_tool(archive, &folder, other),
    };
    match result {
        Ok(()) => {
            record("Extract", Change::Created(folder.clone()));
            super::search::note_added(&folder);
            Ok(folder)
        }
        Err(error) => {
            let _ = fs_disk::remove_dir_all(&folder);
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn files_extract(webview: tauri::Webview, path: String) -> Result<String, String> {
    person_window(&webview)?;
    let archive = asked_path(&path)?;
    blocking(move || extract(&archive).map(|folder| folder.display().to_string())).await
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
}
