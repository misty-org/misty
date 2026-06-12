use std::{collections::BTreeMap, fs, io::Read, path::Path};

use serde::{Deserialize, Serialize};
use zip::ZipArchive;

use crate::error::{ApiError, ApiResult};

// Must remain aligned with the server's SmartLibraryMaxTextBytes request validator.
pub const MAX_EXTRACTED_TEXT_BYTES: usize = 64 * 1024;
const MAX_SOURCE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_TEXT_READ_BYTES: usize = 512 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 2_000;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES: u64 = 128 * 1024 * 1024;
const MAX_ZIP_ENTRY_READ_BYTES: u64 = 4 * 1024 * 1024;
const MAX_PDF_SOURCE_BYTES: u64 = 16 * 1024 * 1024;

const VIDEO_EXTENSIONS: &[&str] = &[
    "3g2", "3gp", "asf", "avi", "flv", "m2ts", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "mts",
    "ogv", "rm", "rmvb", "vob", "webm", "wmv",
];
const IMAGE_EXTENSIONS: &[&str] = &[
    "avif", "bmp", "cr2", "cr3", "dng", "gif", "heic", "heif", "hdr", "jpeg", "jpg", "nef", "png",
    "pnm", "psd", "raw", "svg", "tga", "tif", "tiff", "webp",
];
const TEXT_EXTENSIONS: &[&str] = &[
    "asm",
    "bash",
    "c",
    "cc",
    "cfg",
    "clj",
    "conf",
    "cpp",
    "cs",
    "css",
    "csv",
    "dart",
    "ex",
    "fish",
    "go",
    "graphql",
    "h",
    "hpp",
    "html",
    "ini",
    "java",
    "jl",
    "js",
    "json",
    "jsonl",
    "jsx",
    "kt",
    "kts",
    "less",
    "log",
    "lua",
    "m",
    "md",
    "mm",
    "php",
    "pl",
    "properties",
    "proto",
    "py",
    "r",
    "rb",
    "rs",
    "rst",
    "sass",
    "scala",
    "scss",
    "sh",
    "sql",
    "svelte",
    "swift",
    "tex",
    "toml",
    "ts",
    "tsx",
    "txt",
    "vue",
    "xml",
    "yaml",
    "yml",
    "zsh",
];
const DOCUMENT_EXTENSIONS: &[&str] = &[
    "docx", "epub", "odp", "ods", "odt", "pdf", "pptx", "rtf", "xlsx",
];
const ARCHIVE_EXTENSIONS: &[&str] = &["cbz", "jar", "kmz", "whl", "zip"];
const AUDIO_EXTENSIONS: &[&str] = &[
    "aac", "aif", "aiff", "alac", "flac", "m4a", "mp3", "oga", "ogg", "opus", "wav", "wma",
];

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SemanticAssetKind {
    Image,
    Document,
    Text,
    Audio,
    Archive,
    Binary,
}

impl SemanticAssetKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Image => "image",
            Self::Document => "document",
            Self::Text => "text",
            Self::Audio => "audio",
            Self::Archive => "archive",
            Self::Binary => "binary",
        }
    }

    pub fn from_str(value: &str) -> Self {
        match value {
            "image" => Self::Image,
            "document" => Self::Document,
            "text" => Self::Text,
            "audio" => Self::Audio,
            "archive" => Self::Archive,
            _ => Self::Binary,
        }
    }
}

#[derive(Debug, Clone)]
pub struct AssetClassification {
    pub kind: SemanticAssetKind,
    pub mime_type: String,
    pub analysis_supported: bool,
    pub unsupported_reason: Option<String>,
}

#[derive(Debug, Default)]
pub struct ExtractedSemanticContent {
    pub text: Option<String>,
    pub metadata: BTreeMap<String, String>,
    pub truncated: bool,
}

pub fn classify(extension: &str, size_bytes: u64) -> AssetClassification {
    let extension = extension.to_ascii_lowercase();
    if VIDEO_EXTENSIONS.contains(&extension.as_str()) {
        return AssetClassification {
            kind: SemanticAssetKind::Binary,
            mime_type: mime_for_extension(&extension).to_owned(),
            analysis_supported: false,
            unsupported_reason: Some(
                "Video formats are excluded from semantic indexing".to_owned(),
            ),
        };
    }
    let kind = if IMAGE_EXTENSIONS.contains(&extension.as_str()) {
        SemanticAssetKind::Image
    } else if TEXT_EXTENSIONS.contains(&extension.as_str()) {
        SemanticAssetKind::Text
    } else if DOCUMENT_EXTENSIONS.contains(&extension.as_str()) {
        SemanticAssetKind::Document
    } else if AUDIO_EXTENSIONS.contains(&extension.as_str()) {
        SemanticAssetKind::Audio
    } else if ARCHIVE_EXTENSIONS.contains(&extension.as_str()) {
        SemanticAssetKind::Archive
    } else {
        SemanticAssetKind::Binary
    };
    let too_large_for_content =
        matches!(kind, SemanticAssetKind::Document | SemanticAssetKind::Text)
            && size_bytes > MAX_SOURCE_BYTES;
    AssetClassification {
        kind,
        mime_type: mime_for_extension(&extension).to_owned(),
        // Oversized and unknown binaries remain indexable from their safe file metadata.
        analysis_supported: true,
        unsupported_reason: too_large_for_content
            .then(|| "File is too large for content extraction; metadata only".to_owned()),
    }
}

pub fn classify_with_declared_mime(
    extension: &str,
    size_bytes: u64,
    declared_mime: Option<&str>,
) -> AssetClassification {
    if declared_mime.is_some_and(|mime| mime.to_ascii_lowercase().starts_with("video/")) {
        return AssetClassification {
            kind: SemanticAssetKind::Binary,
            mime_type: declared_mime
                .unwrap_or("application/octet-stream")
                .to_owned(),
            analysis_supported: false,
            unsupported_reason: Some(
                "Video formats are excluded from semantic indexing".to_owned(),
            ),
        };
    }
    classify(extension, size_bytes)
}

pub fn is_mpeg_transport_stream(path: &Path) -> bool {
    let Ok(bytes) = read_prefix(path, 188 * 4) else {
        return false;
    };
    bytes.len() >= 188 * 3 && bytes[0] == 0x47 && bytes[188] == 0x47 && bytes[188 * 2] == 0x47
}

pub fn extract(
    path: &Path,
    extension: &str,
    kind: SemanticAssetKind,
) -> ApiResult<ExtractedSemanticContent> {
    let metadata = fs::metadata(path).map_err(io_error(path))?;
    let mut content = ExtractedSemanticContent::default();
    content
        .metadata
        .insert("sizeBytes".to_owned(), metadata.len().to_string());
    content
        .metadata
        .insert("extension".to_owned(), extension.to_owned());
    if metadata.len() > MAX_SOURCE_BYTES {
        content.metadata.insert(
            "extraction".to_owned(),
            "metadata_only_size_limit".to_owned(),
        );
        return Ok(content);
    }

    match kind {
        SemanticAssetKind::Text => extract_plain_text(path, &mut content)?,
        SemanticAssetKind::Document => extract_document(path, extension, &mut content)?,
        SemanticAssetKind::Audio => extract_audio_metadata(path, extension, &mut content)?,
        SemanticAssetKind::Archive => extract_archive_summary(path, &mut content)?,
        SemanticAssetKind::Binary => extract_binary_summary(path, &mut content)?,
        SemanticAssetKind::Image if extension == "svg" => {
            let bytes = read_prefix(path, MAX_TEXT_READ_BYTES)?;
            content.truncated =
                fs::metadata(path).map_err(io_error(path))?.len() > bytes.len() as u64;
            let text = capped_text(strip_xml(&String::from_utf8_lossy(&bytes)), &mut content);
            content.text = nonempty(text);
            content
                .metadata
                .insert("format".to_owned(), "SVG".to_owned());
        }
        SemanticAssetKind::Image => {}
    }
    Ok(content)
}

fn extract_plain_text(path: &Path, content: &mut ExtractedSemanticContent) -> ApiResult<()> {
    let bytes = read_prefix(path, MAX_TEXT_READ_BYTES)?;
    let text = match String::from_utf8(bytes.clone()) {
        Ok(value) => value,
        Err(_) => String::from_utf8_lossy(&bytes).into_owned(),
    };
    content.truncated = fs::metadata(path).map_err(io_error(path))?.len() > bytes.len() as u64;
    content.text = nonempty(capped_text(text, content));
    content
        .metadata
        .insert("contentEncoding".to_owned(), "utf-8".to_owned());
    Ok(())
}

fn extract_document(
    path: &Path,
    extension: &str,
    content: &mut ExtractedSemanticContent,
) -> ApiResult<()> {
    match extension {
        "pdf" => {
            if fs::metadata(path).map_err(io_error(path))?.len() > MAX_PDF_SOURCE_BYTES {
                content.metadata.insert(
                    "extraction".to_owned(),
                    "metadata_only_pdf_size_limit".to_owned(),
                );
                return Ok(());
            }
            let extracted = std::panic::catch_unwind(|| pdf_extract::extract_text(path))
                .map_err(|_| ApiError::Message("PDF text extraction failed safely".to_owned()))?
                .map_err(|error| {
                    ApiError::Message(format!("Could not extract PDF text: {error}"))
                })?;
            content.text = nonempty(capped_text(extracted, content));
            content
                .metadata
                .insert("format".to_owned(), "PDF".to_owned());
        }
        "docx" | "xlsx" | "pptx" | "odt" | "ods" | "odp" | "epub" => {
            extract_zip_document(path, extension, content)?;
        }
        "rtf" => {
            let bytes = read_prefix(path, MAX_TEXT_READ_BYTES)?;
            let text = strip_rtf(&String::from_utf8_lossy(&bytes));
            content.truncated =
                fs::metadata(path).map_err(io_error(path))?.len() > bytes.len() as u64;
            content.text = nonempty(capped_text(text, content));
        }
        _ => {}
    }
    Ok(())
}

fn extract_zip_document(
    path: &Path,
    extension: &str,
    content: &mut ExtractedSemanticContent,
) -> ApiResult<()> {
    let file = fs::File::open(path).map_err(io_error(path))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|error| ApiError::Message(format!("Could not read document package: {error}")))?;
    let mut names = Vec::new();
    let mut text = String::new();
    let mut declared_total = 0_u64;
    for index in 0..archive.len().min(MAX_ARCHIVE_ENTRIES) {
        let entry = archive.by_index(index).map_err(|error| {
            ApiError::Message(format!("Could not inspect document entry: {error}"))
        })?;
        declared_total = declared_total.saturating_add(entry.size());
        if declared_total > MAX_ARCHIVE_UNCOMPRESSED_BYTES {
            content.truncated = true;
            break;
        }
        let name = entry.name().to_ascii_lowercase();
        if should_extract_package_entry(extension, &name)
            && entry.size() <= MAX_ZIP_ENTRY_READ_BYTES
        {
            let mut xml = String::new();
            entry
                .take(MAX_ZIP_ENTRY_READ_BYTES)
                .read_to_string(&mut xml)
                .map_err(|error| {
                    ApiError::Message(format!("Could not read document text: {error}"))
                })?;
            text.push_str(&strip_xml(&xml));
            text.push('\n');
        }
        if let Some(base) = Path::new(&name)
            .file_name()
            .and_then(|value| value.to_str())
        {
            if !base.is_empty() && names.len() < 128 {
                names.push(base.to_owned());
            }
        }
        if text.len() >= MAX_EXTRACTED_TEXT_BYTES * 2 {
            content.truncated = true;
            break;
        }
    }
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        content.truncated = true;
    }
    content.text = nonempty(capped_text(text, content));
    content
        .metadata
        .insert("packageEntries".to_owned(), archive.len().to_string());
    if extension == "epub" && content.text.is_none() {
        content.text = nonempty(names.join(" "));
    }
    Ok(())
}

fn should_extract_package_entry(extension: &str, name: &str) -> bool {
    match extension {
        "docx" => name.starts_with("word/") && name.ends_with(".xml"),
        "xlsx" => {
            name == "xl/sharedstrings.xml"
                || (name.starts_with("xl/worksheets/") && name.ends_with(".xml"))
        }
        "pptx" => name.starts_with("ppt/slides/") && name.ends_with(".xml"),
        "odt" | "ods" | "odp" => name == "content.xml" || name == "meta.xml",
        "epub" => name.ends_with(".xhtml") || name.ends_with(".html") || name.ends_with(".opf"),
        _ => false,
    }
}

fn extract_archive_summary(path: &Path, content: &mut ExtractedSemanticContent) -> ApiResult<()> {
    let file = fs::File::open(path).map_err(io_error(path))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|error| ApiError::Message(format!("Could not inspect archive: {error}")))?;
    let mut basenames = Vec::new();
    let mut declared_total = 0_u64;
    for index in 0..archive.len().min(MAX_ARCHIVE_ENTRIES) {
        let entry = archive.by_index(index).map_err(|error| {
            ApiError::Message(format!("Could not inspect archive entry: {error}"))
        })?;
        declared_total = declared_total.saturating_add(entry.size());
        if declared_total > MAX_ARCHIVE_UNCOMPRESSED_BYTES {
            content.truncated = true;
            break;
        }
        if let Some(name) = Path::new(entry.name())
            .file_name()
            .and_then(|value| value.to_str())
        {
            if !name.is_empty() && basenames.len() < 256 {
                basenames.push(name.to_owned());
            }
        }
    }
    content.truncated |= archive.len() > MAX_ARCHIVE_ENTRIES;
    content.text = nonempty(capped_text(basenames.join(" "), content));
    content
        .metadata
        .insert("archiveEntries".to_owned(), archive.len().to_string());
    content.metadata.insert(
        "declaredUncompressedBytes".to_owned(),
        declared_total.to_string(),
    );
    Ok(())
}

fn extract_audio_metadata(
    path: &Path,
    extension: &str,
    content: &mut ExtractedSemanticContent,
) -> ApiResult<()> {
    content
        .metadata
        .insert("mediaType".to_owned(), "audio".to_owned());
    content
        .metadata
        .insert("container".to_owned(), extension.to_owned());
    if extension == "mp3" {
        let bytes = read_prefix(path, 256 * 1024)?;
        let frames = parse_id3v2(&bytes);
        let mut searchable = Vec::new();
        for (key, value) in frames {
            searchable.push(value.clone());
            content.metadata.insert(key, value);
        }
        content.text = nonempty(capped_text(searchable.join(" "), content));
    }
    Ok(())
}

fn parse_id3v2(bytes: &[u8]) -> BTreeMap<String, String> {
    let mut values = BTreeMap::new();
    if bytes.len() < 10 || &bytes[..3] != b"ID3" {
        return values;
    }
    let tag_len = syncsafe(&bytes[6..10]).min(bytes.len().saturating_sub(10));
    let mut offset = 10;
    let end = 10 + tag_len;
    while offset + 10 <= end && offset + 10 <= bytes.len() {
        let id = &bytes[offset..offset + 4];
        let size = u32::from_be_bytes(bytes[offset + 4..offset + 8].try_into().unwrap()) as usize;
        offset += 10;
        if size == 0 || offset + size > end || offset + size > bytes.len() {
            break;
        }
        let key = match id {
            b"TIT2" => Some("title"),
            b"TPE1" => Some("artist"),
            b"TALB" => Some("album"),
            b"TCON" => Some("genre"),
            b"TDRC" | b"TYER" => Some("year"),
            _ => None,
        };
        if let Some(key) = key {
            let frame = &bytes[offset..offset + size];
            let value = decode_id3_text(frame);
            if !value.is_empty() {
                values.insert(key.to_owned(), value);
            }
        }
        offset += size;
    }
    values
}

fn syncsafe(bytes: &[u8]) -> usize {
    bytes.iter().take(4).fold(0_usize, |value, byte| {
        (value << 7) | (*byte as usize & 0x7f)
    })
}

fn decode_id3_text(frame: &[u8]) -> String {
    let Some((&encoding, body)) = frame.split_first() else {
        return String::new();
    };
    let value = if encoding == 0 || encoding == 3 {
        String::from_utf8_lossy(body).into_owned()
    } else {
        // UTF-16 frames are intentionally not decoded without a BOM-safe codec dependency.
        String::new()
    };
    value.trim_matches('\0').trim().chars().take(512).collect()
}

fn extract_binary_summary(path: &Path, content: &mut ExtractedSemanticContent) -> ApiResult<()> {
    let bytes = read_prefix(path, 16)?;
    content.metadata.insert(
        "magicHex".to_owned(),
        hex::encode(&bytes[..bytes.len().min(16)]),
    );
    content.metadata.insert(
        "extraction".to_owned(),
        "metadata_only_unknown_binary".to_owned(),
    );
    Ok(())
}

fn strip_xml(xml: &str) -> String {
    let mut text = String::with_capacity(xml.len().min(MAX_EXTRACTED_TEXT_BYTES));
    let mut in_tag = false;
    for character in xml.chars() {
        match character {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                text.push(' ');
            }
            _ if !in_tag => text.push(character),
            _ => {}
        }
    }
    decode_entities(&text)
}

fn strip_rtf(rtf: &str) -> String {
    let mut output = String::new();
    let mut control = false;
    for ch in rtf.chars() {
        match ch {
            '\\' => control = true,
            '{' | '}' => {}
            ' ' if control => control = false,
            _ if control && !ch.is_ascii_alphanumeric() && ch != '-' => control = false,
            _ if !control => output.push(ch),
            _ => {}
        }
    }
    output
}

fn decode_entities(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
}

fn read_prefix(path: &Path, limit: usize) -> ApiResult<Vec<u8>> {
    let file = fs::File::open(path).map_err(io_error(path))?;
    let mut bytes = Vec::with_capacity(limit.min(64 * 1024));
    file.take(limit as u64)
        .read_to_end(&mut bytes)
        .map_err(io_error(path))?;
    Ok(bytes)
}

fn capped_text(mut value: String, content: &mut ExtractedSemanticContent) -> String {
    if value.len() > MAX_EXTRACTED_TEXT_BYTES {
        let boundary = floor_char_boundary(&value, MAX_EXTRACTED_TEXT_BYTES);
        value.truncate(boundary);
        content.truncated = true;
    }
    value
}

fn floor_char_boundary(value: &str, mut index: usize) -> usize {
    index = index.min(value.len());
    while index > 0 && !value.is_char_boundary(index) {
        index -= 1;
    }
    index
}

fn nonempty(value: String) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_owned())
}

fn mime_for_extension(extension: &str) -> &'static str {
    match extension {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "tif" | "tiff" => "image/tiff",
        "heic" | "heif" => "image/heic",
        "pdf" => "application/pdf",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "odt" => "application/vnd.oasis.opendocument.text",
        "ods" => "application/vnd.oasis.opendocument.spreadsheet",
        "odp" => "application/vnd.oasis.opendocument.presentation",
        "epub" => "application/epub+zip",
        "zip" => "application/zip",
        "json" | "jsonl" => "application/json",
        "xml" => "application/xml",
        "csv" => "text/csv",
        "html" => "text/html",
        "md" => "text/markdown",
        "txt" | "log" => "text/plain",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "flac" => "audio/flac",
        "wav" => "audio/wav",
        "ogg" | "oga" | "opus" => "audio/ogg",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        _ => "application/octet-stream",
    }
}

fn io_error(path: &Path) -> impl FnOnce(std::io::Error) -> ApiError + '_ {
    move |error| {
        ApiError::Message(format!(
            "Could not safely inspect {}: {error}",
            path.display()
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use uuid::Uuid;
    use zip::{write::SimpleFileOptions, ZipWriter};

    fn temp_file(extension: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("misty-ingestion-{}.{}", Uuid::new_v4(), extension))
    }

    #[test]
    fn videos_are_explicitly_rejected_but_unknown_binaries_are_indexable() {
        let video = classify("mp4", 10);
        assert!(!video.analysis_supported);
        assert!(video.unsupported_reason.unwrap().contains("Video"));
        let binary = classify("wasm", 10);
        assert!(binary.analysis_supported);
        assert_eq!(binary.kind, SemanticAssetKind::Binary);
        assert_eq!(classify("ts", 10).kind, SemanticAssetKind::Text);
        assert_eq!(classify("mp3", 10).kind, SemanticAssetKind::Audio);
        assert_eq!(classify("zip", 10).kind, SemanticAssetKind::Archive);
        assert!(!classify_with_declared_mime("ts", 10, Some("video/mp2t")).analysis_supported);
    }

    #[test]
    fn text_extraction_is_bounded_and_unicode_safe() {
        let path = temp_file("txt");
        fs::write(&path, "é".repeat(MAX_EXTRACTED_TEXT_BYTES)).unwrap();
        let extracted = extract(&path, "txt", SemanticAssetKind::Text).unwrap();
        assert!(extracted.truncated);
        assert!(extracted.text.unwrap().len() <= MAX_EXTRACTED_TEXT_BYTES);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn office_package_extracts_xml_text_without_member_paths() {
        let path = temp_file("docx");
        let file = fs::File::create(&path).unwrap();
        let mut zip = ZipWriter::new(file);
        zip.start_file("word/document.xml", SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"<w:p><w:t>Pikachu file manager</w:t></w:p>")
            .unwrap();
        zip.finish().unwrap();
        let extracted = extract(&path, "docx", SemanticAssetKind::Document).unwrap();
        assert!(extracted.text.unwrap().contains("Pikachu file manager"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn archive_summary_only_exposes_basenames_and_caps_entries() {
        let path = temp_file("zip");
        let file = fs::File::create(&path).unwrap();
        let mut zip = ZipWriter::new(file);
        zip.start_file("private/path/report.txt", SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"secret contents are not extracted").unwrap();
        zip.finish().unwrap();
        let extracted = extract(&path, "zip", SemanticAssetKind::Archive).unwrap();
        let text = extracted.text.unwrap();
        assert_eq!(text, "report.txt");
        assert!(!text.contains("private/path"));
        assert!(!text.contains("secret contents"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn id3_metadata_becomes_searchable_without_audio_upload() {
        let title = b"\x03Pikachu Theme";
        let mut frame = Vec::new();
        frame.extend_from_slice(b"TIT2");
        frame.extend_from_slice(&(title.len() as u32).to_be_bytes());
        frame.extend_from_slice(&[0, 0]);
        frame.extend_from_slice(title);
        let mut bytes = b"ID3\x04\x00\x00\x00\x00\x00\x20".to_vec();
        bytes.extend_from_slice(&frame);
        let parsed = parse_id3v2(&bytes);
        assert_eq!(parsed.get("title"), Some(&"Pikachu Theme".to_owned()));
    }

    #[test]
    fn unknown_binary_does_not_extract_embedded_secrets() {
        let path = temp_file("bin");
        fs::write(
            &path,
            b"\x7fELF OPENAI_API_KEY=sk-secret /Users/private/database.sqlite",
        )
        .unwrap();
        let extracted = extract(&path, "bin", SemanticAssetKind::Binary).unwrap();
        assert!(extracted.text.is_none());
        assert_eq!(
            extracted.metadata.get("extraction").map(String::as_str),
            Some("metadata_only_unknown_binary")
        );
        let serialized = serde_json::to_string(&extracted.metadata).unwrap();
        assert!(!serialized.contains("sk-secret"));
        assert!(!serialized.contains("/Users/private"));
        let _ = fs::remove_file(path);
    }
}
