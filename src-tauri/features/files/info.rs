// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
//! Get Info (what an item is, its folder, permissions, owner, whether agents may change it, an
//! image's size, the app that opens it), a folder's size on the ops queue, and the start of a
//! file for previews.
use std::{
    io::{BufReader, Read},
    path::Path,
};

use file_access::disk::walk;
use serde::Serialize;

use super::entry::{entry_for, FileEntry, FileKind};
use super::listing::io_text;
use super::{asked_path, blocking, failed, gated, person_window};

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
pub struct FileHead {
    pub text: String,
    pub truncated: bool,
    pub binary: bool,
}

const MAX_HEAD: u64 = 1024 * 1024;

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
    let file = gated::open_read(path).ok()?;
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
    let meta = gated::stat(path)
        .or_else(|error| match path.parent() {
            None => file_access::disk::fs_disk::metadata(path),
            Some(_) => Err(error),
        })
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

#[tauri::command]
pub async fn files_folder_size(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    path: String,
    op_id: String,
) -> Result<FolderSize, String> {
    person_window(&webview)?;
    let path = asked_path(&path)?;
    super::runtime::run(&app, &webview, &op_id, "Calculating size", move |op| {
        let stop = op.stop();
        walk::tree_size_checked(&path, walk::WalkFor::Person, &|| stop.stopped())
            .map(|(bytes, items)| FolderSize {
                bytes,
                items: items.saturating_sub(1),
            })
            .map_err(|error| failed(&path, io_text(&error)))
    })
    .await
}

pub(crate) fn read_head(path: &Path, limit: u64) -> Result<FileHead, String> {
    let limit = limit.clamp(1, MAX_HEAD);
    let file = gated::open_read(path).map_err(|error| failed(path, io_text(&error)))?;
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| failed(path, io_text(&error)))?;
    let truncated = bytes.len() as u64 > limit;
    bytes.truncate(limit as usize);
    let binary = bytes.contains(&0);
    Ok(FileHead {
        text: String::from_utf8_lossy(&bytes).into_owned(),
        truncated,
        binary,
    })
}

#[tauri::command]
pub async fn files_read_head(
    webview: tauri::Webview,
    path: String,
    limit: u64,
) -> Result<FileHead, String> {
    person_window(&webview)?;
    let path = asked_path(&path)?;
    blocking(move || read_head(&path, limit)).await
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
    fn the_head_of_a_file_is_capped_and_says_when_it_is_binary() {
        let root = tempfile::tempdir().expect("temp folder");
        let text = root.path().join("a.txt");
        file_access::fs::write(&text, b"hello world").expect("write");
        let head = read_head(&text, 5).expect("head");
        assert_eq!(
            (head.text.as_str(), head.truncated, head.binary),
            ("hello", true, false)
        );
        let binary = root.path().join("b.bin");
        file_access::fs::write(&binary, b"ab\0cd").expect("write");
        assert!(read_head(&binary, 1 << 30).expect("head").binary);
        assert!(read_head(root.path(), 10).is_err());
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
