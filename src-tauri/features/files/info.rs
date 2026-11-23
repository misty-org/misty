// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
//! Get Info (what an item is, its folder, permissions, owner, whether agents may change it, an
//! image's size, the app that opens it), a folder's size, and a file's text or bytes for Quick
//! Look and previews.
use std::{
    io::{BufReader, Read},
    path::Path,
};

use file_access::disk::{check_disk, fs_disk};
use file_access::Access;
use serde::Serialize;

use super::entry::{entry_for, FileEntry, FileKind};
use super::listing::io_text;
use super::{asked_path, blocking, display_name, failed, person_window};

#[derive(Serialize)]
pub struct Dimensions {
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub entry: FileEntry,
    pub kind_label: String,
    pub parent: String,
    pub permissions: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
    pub owned_by_you: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dimensions: Option<Dimensions>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_app: Option<String>,
}

#[derive(Serialize)]
pub struct FolderSize {
    pub bytes: u64,
    pub items: u64,
}

#[derive(Serialize)]
pub struct TextStart {
    pub text: String,
    pub truncated: bool,
}

const MAX_TEXT: usize = 1024 * 1024;
const MAX_BYTES: u64 = 100 * 1024 * 1024;

fn file_kind_label(ext: &str) -> Option<&'static str> {
    Some(match ext {
        "pdf" => "PDF document",
        "png" => "PNG image",
        "jpg" | "jpeg" => "JPEG image",
        "gif" => "GIF image",
        "webp" => "WebP image",
        "heic" | "heif" => "HEIF image",
        "avif" => "AVIF image",
        "tif" | "tiff" => "TIFF image",
        "bmp" => "BMP image",
        "svg" => "SVG image",
        "ico" | "icns" => "Icon",
        "txt" => "Plain text document",
        "md" | "markdown" => "Markdown document",
        "rtf" => "Rich text document",
        "html" | "htm" => "HTML document",
        "css" => "CSS style sheet",
        "js" | "mjs" | "cjs" => "JavaScript file",
        "ts" | "tsx" => "TypeScript file",
        "json" => "JSON document",
        "xml" => "XML document",
        "yaml" | "yml" => "YAML document",
        "toml" => "TOML document",
        "csv" => "CSV document",
        "rs" => "Rust source",
        "py" => "Python script",
        "sh" | "zsh" | "bash" => "Shell script",
        "swift" => "Swift source",
        "go" => "Go source",
        "c" | "h" => "C source",
        "cpp" | "cc" | "hpp" => "C++ source",
        "java" => "Java source",
        "zip" => "ZIP archive",
        "gz" | "tgz" => "Gzip archive",
        "tar" => "Tar archive",
        "7z" => "7-Zip archive",
        "rar" => "RAR archive",
        "dmg" => "Disk image",
        "iso" => "Disc image",
        "pkg" => "Installer package",
        "exe" => "Application",
        "msi" => "Installer package",
        "mp4" | "m4v" => "MPEG-4 movie",
        "mov" => "QuickTime movie",
        "webm" => "WebM movie",
        "mkv" => "Matroska movie",
        "avi" => "AVI movie",
        "mp3" => "MP3 audio",
        "m4a" | "aac" => "AAC audio",
        "wav" => "WAV audio",
        "flac" => "FLAC audio",
        "ogg" | "opus" => "Ogg audio",
        "aiff" | "aif" => "AIFF audio",
        "doc" | "docx" => "Word document",
        "xls" | "xlsx" => "Excel spreadsheet",
        "ppt" | "pptx" => "PowerPoint presentation",
        "pages" => "Pages document",
        "numbers" => "Numbers spreadsheet",
        "key" => "Keynote presentation",
        "ttf" | "otf" | "woff" | "woff2" => "Font",
        _ => return None,
    })
}

pub(crate) fn kind_label(entry: &FileEntry) -> String {
    let ext = entry.ext.as_deref().unwrap_or("");
    match entry.kind {
        FileKind::Folder => "Folder".to_owned(),
        FileKind::Link => "Link".to_owned(),
        FileKind::Package if ext == "app" => "Application".to_owned(),
        FileKind::Package => file_kind_label(ext).unwrap_or("Package").to_owned(),
        FileKind::File => match file_kind_label(ext) {
            Some(label) => label.to_owned(),
            None if !ext.is_empty() => format!("{} file", ext.to_uppercase()),
            None => "Document".to_owned(),
        },
    }
}

#[cfg(unix)]
fn permissions(meta: &std::fs::Metadata) -> String {
    use std::os::unix::fs::PermissionsExt;
    let mode = meta.permissions().mode();
    [
        0o400, 0o200, 0o100, 0o040, 0o020, 0o010, 0o004, 0o002, 0o001,
    ]
    .iter()
    .zip("rwxrwxrwx".chars())
    .map(|(bit, letter)| if mode & bit != 0 { letter } else { '-' })
    .collect()
}

#[cfg(windows)]
fn permissions(meta: &std::fs::Metadata) -> String {
    if meta.permissions().readonly() {
        "Read only"
    } else {
        "Read and write"
    }
    .to_owned()
}

#[cfg(unix)]
fn owner(meta: &std::fs::Metadata) -> Option<String> {
    use std::os::unix::fs::MetadataExt;
    let uid = meta.uid();
    let mut buffer = vec![0 as libc::c_char; 1024];
    let mut record = std::mem::MaybeUninit::<libc::passwd>::uninit();
    let mut result: *mut libc::passwd = std::ptr::null_mut();
    // SAFETY: every pointer is valid for the call; `result` is null or points at `record`, whose
    // strings live in `buffer`.
    let status = unsafe {
        libc::getpwuid_r(
            uid,
            record.as_mut_ptr(),
            buffer.as_mut_ptr(),
            buffer.len(),
            &mut result,
        )
    };
    if status != 0 || result.is_null() {
        return Some(uid.to_string());
    }
    // SAFETY: getpwuid_r succeeded, so `pw_name` is a NUL-terminated string inside `buffer`.
    let name = unsafe { std::ffi::CStr::from_ptr((*result).pw_name) };
    Some(name.to_string_lossy().into_owned())
}

#[cfg(windows)]
fn owner(_meta: &std::fs::Metadata) -> Option<String> {
    None
}

fn dimensions(path: &Path) -> Option<Dimensions> {
    let file = fs_disk::open(path).ok()?;
    let (width, height) = image::ImageReader::new(BufReader::new(file))
        .with_guessed_format()
        .ok()?
        .into_dimensions()
        .ok()?;
    Some(Dimensions { width, height })
}

fn is_picture(ext: Option<&str>) -> bool {
    matches!(
        ext,
        Some(
            "png"
                | "jpg"
                | "jpeg"
                | "gif"
                | "webp"
                | "bmp"
                | "tif"
                | "tiff"
                | "ico"
                | "tga"
                | "hdr"
        )
    )
}

fn info(path: &Path) -> Result<FileInfo, String> {
    let entry = entry_for(path).map_err(|error| failed(path, io_text(&error)))?;
    let meta = fs_disk::metadata(path)
        .or_else(|_| fs_disk::symlink_metadata(path))
        .map_err(|error| failed(path, io_text(&error)))?;
    let picture = matches!(entry.kind, FileKind::File) && is_picture(entry.ext.as_deref());
    Ok(FileInfo {
        kind_label: kind_label(&entry),
        parent: path
            .parent()
            .map(|parent| parent.display().to_string())
            .unwrap_or_default(),
        permissions: permissions(&meta),
        owner: owner(&meta),
        owned_by_you: file_access::disk::owned_by_you(path),
        dimensions: if picture { dimensions(path) } else { None },
        default_app: super::open::default_app_name(path),
        entry,
    })
}

#[tauri::command]
pub async fn files_info(webview: tauri::Webview, path: String) -> Result<FileInfo, String> {
    person_window(&webview)?;
    let path = asked_path(&path)?;
    blocking(move || info(&path)).await
}

fn folder_size(root: &Path) -> Result<FolderSize, String> {
    check_disk(root, Access::Read).map_err(|error| failed(root, io_text(&error)))?;
    let mut size = FolderSize { bytes: 0, items: 0 };
    let walk = walkdir::WalkDir::new(root)
        .follow_links(false)
        .min_depth(1)
        .into_iter()
        .filter_entry(|item| {
            !item.file_type().is_dir() || check_disk(item.path(), Access::Read).is_ok()
        });
    for item in walk.filter_map(Result::ok) {
        size.items += 1;
        if item.file_type().is_file() {
            size.bytes += item.metadata().map_or(0, |meta| meta.len());
        }
    }
    Ok(size)
}

#[tauri::command]
pub async fn files_folder_size(
    webview: tauri::Webview,
    path: String,
) -> Result<FolderSize, String> {
    person_window(&webview)?;
    let path = asked_path(&path)?;
    blocking(move || folder_size(&path)).await
}

fn read_text(path: &Path) -> Result<TextStart, String> {
    let file = fs_disk::open(path).map_err(|error| failed(path, io_text(&error)))?;
    let mut bytes = Vec::new();
    file.take((MAX_TEXT + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| failed(path, io_text(&error)))?;
    let truncated = bytes.len() > MAX_TEXT;
    bytes.truncate(MAX_TEXT);
    if bytes[..bytes.len().min(8192)].contains(&0) {
        return Err(format!("{} isn't a text file.", display_name(path)));
    }
    Ok(TextStart {
        text: String::from_utf8_lossy(&bytes).into_owned(),
        truncated,
    })
}

#[tauri::command]
pub async fn files_read_text(webview: tauri::Webview, path: String) -> Result<TextStart, String> {
    person_window(&webview)?;
    let path = asked_path(&path)?;
    blocking(move || read_text(&path)).await
}

fn read_bytes(path: &Path) -> Result<Vec<u8>, String> {
    let name = display_name(path);
    let meta = fs_disk::metadata(path).map_err(|error| failed(path, io_text(&error)))?;
    if meta.is_dir() {
        return Err(format!("{name} is a folder."));
    }
    if meta.len() > MAX_BYTES {
        return Err(format!("{name} is larger than 100 MB."));
    }
    fs_disk::read(path).map_err(|error| failed(path, io_text(&error)))
}

#[tauri::command]
pub async fn files_read_bytes(
    webview: tauri::Webview,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    person_window(&webview)?;
    let path = asked_path(&path)?;
    blocking(move || read_bytes(&path))
        .await
        .map(tauri::ipc::Response::new)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(name: &str, kind: FileKind) -> FileEntry {
        FileEntry {
            name: name.to_owned(),
            path: format!("/x/{name}"),
            kind,
            size: 0,
            modified_ms: 0,
            created_ms: 0,
            hidden: false,
            ext: super::super::entry::extension(name),
            link_target: None,
            tags: Vec::new(),
        }
    }

    #[test]
    fn kinds_are_named_in_words() {
        assert_eq!(
            kind_label(&file("Report.PDF", FileKind::File)),
            "PDF document"
        );
        assert_eq!(
            kind_label(&file("data.parquet", FileKind::File)),
            "PARQUET file"
        );
        assert_eq!(kind_label(&file("Makefile", FileKind::File)), "Document");
        assert_eq!(
            kind_label(&file("Safari.app", FileKind::Package)),
            "Application"
        );
        assert_eq!(kind_label(&file("Projects", FileKind::Folder)), "Folder");
    }
}
