use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use zip::ZipArchive;

use crate::error::{ApiError, ApiResult};

#[derive(Clone, Default)]
pub struct MetadataService;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMetadataSnapshot {
    pub path: String,
    pub kind: String,
    pub size_bytes: Option<u64>,
    pub readonly: bool,
    pub hidden: bool,
    pub created_ms: Option<u64>,
    pub modified_ms: Option<u64>,
    pub accessed_ms: Option<u64>,
    pub os_tags: Vec<String>,
    pub fields: Vec<FileMetadataField>,
    pub extracted: Vec<FileMetadataField>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileMetadataField {
    pub label: String,
    pub value: String,
}

impl MetadataService {
    pub fn new() -> Self {
        Self
    }

    pub async fn snapshot(&self, path: String) -> ApiResult<FileMetadataSnapshot> {
        tokio::task::spawn_blocking(move || metadata_snapshot_blocking(PathBuf::from(path)))
            .await
            .map_err(|error| ApiError::Message(format!("Metadata worker failed: {error}")))?
    }
}

fn metadata_snapshot_blocking(path: PathBuf) -> ApiResult<FileMetadataSnapshot> {
    let metadata = fs::symlink_metadata(&path).map_err(io_error(&path))?;
    let file_type = metadata.file_type();
    let kind = if file_type.is_symlink() {
        "symlink"
    } else if metadata.is_dir() {
        "folder"
    } else if metadata.is_file() {
        "file"
    } else {
        "other"
    };
    let mut fields = Vec::new();
    fields.push(FileMetadataField {
        label: "Filesystem".to_owned(),
        value: filesystem_label(&path),
    });
    #[cfg(unix)]
    fields.push(FileMetadataField {
        label: "Unix Mode".to_owned(),
        value: unix_mode(&metadata),
    });
    if file_type.is_symlink() {
        if let Ok(target) = fs::read_link(&path) {
            fields.push(FileMetadataField {
                label: "Link Target".to_owned(),
                value: target.display().to_string(),
            });
        }
    }

    let extracted = if metadata.is_file() {
        extract_file_metadata(&path)?
    } else {
        Vec::new()
    };

    Ok(FileMetadataSnapshot {
        path: path.display().to_string(),
        kind: kind.to_owned(),
        size_bytes: metadata.is_file().then_some(metadata.len()),
        readonly: metadata.permissions().readonly(),
        hidden: path
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(|name| name.starts_with('.')),
        created_ms: metadata.created().ok().and_then(system_time_ms),
        modified_ms: metadata.modified().ok().and_then(system_time_ms),
        accessed_ms: metadata.accessed().ok().and_then(system_time_ms),
        os_tags: os_tags(&path),
        fields,
        extracted,
    })
}

fn extract_file_metadata(path: &Path) -> ApiResult<Vec<FileMetadataField>> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if let Some((width, height)) = image_dimensions(path, &extension)? {
        return Ok(vec![
            FileMetadataField {
                label: "Image Dimensions".to_owned(),
                value: format!("{width} x {height}"),
            },
            FileMetadataField {
                label: "Pixels".to_owned(),
                value: width.saturating_mul(height).to_string(),
            },
        ]);
    }
    if extension == "pdf" {
        return pdf_metadata(path);
    }
    if matches!(extension.as_str(), "docx" | "xlsx" | "pptx") {
        return office_metadata(path);
    }
    Ok(Vec::new())
}

fn image_dimensions(path: &Path, extension: &str) -> ApiResult<Option<(u64, u64)>> {
    let bytes = fs::read(path).map_err(io_error(path))?;
    Ok(match extension {
        "png" => png_dimensions(&bytes),
        "jpg" | "jpeg" => jpeg_dimensions(&bytes),
        "gif" => gif_dimensions(&bytes),
        "webp" => webp_dimensions(&bytes),
        _ => None,
    })
}

fn png_dimensions(bytes: &[u8]) -> Option<(u64, u64)> {
    if bytes.len() < 24 || &bytes[0..8] != b"\x89PNG\r\n\x1a\n" {
        return None;
    }
    Some((
        u32::from_be_bytes(bytes[16..20].try_into().ok()?) as u64,
        u32::from_be_bytes(bytes[20..24].try_into().ok()?) as u64,
    ))
}

fn gif_dimensions(bytes: &[u8]) -> Option<(u64, u64)> {
    if bytes.len() < 10 || (&bytes[0..6] != b"GIF87a" && &bytes[0..6] != b"GIF89a") {
        return None;
    }
    Some((
        u16::from_le_bytes(bytes[6..8].try_into().ok()?) as u64,
        u16::from_le_bytes(bytes[8..10].try_into().ok()?) as u64,
    ))
}

fn jpeg_dimensions(bytes: &[u8]) -> Option<(u64, u64)> {
    if bytes.len() < 4 || bytes[0] != 0xff || bytes[1] != 0xd8 {
        return None;
    }
    let mut index = 2;
    while index + 9 < bytes.len() {
        if bytes[index] != 0xff {
            index += 1;
            continue;
        }
        let marker = bytes[index + 1];
        index += 2;
        if marker == 0xd8 || marker == 0xd9 {
            continue;
        }
        if index + 2 > bytes.len() {
            return None;
        }
        let length = u16::from_be_bytes(bytes[index..index + 2].try_into().ok()?) as usize;
        if length < 2 || index + length > bytes.len() {
            return None;
        }
        if matches!(
            marker,
            0xc0 | 0xc1
                | 0xc2
                | 0xc3
                | 0xc5
                | 0xc6
                | 0xc7
                | 0xc9
                | 0xca
                | 0xcb
                | 0xcd
                | 0xce
                | 0xcf
        ) {
            return Some((
                u16::from_be_bytes(bytes[index + 5..index + 7].try_into().ok()?) as u64,
                u16::from_be_bytes(bytes[index + 3..index + 5].try_into().ok()?) as u64,
            ));
        }
        index += length;
    }
    None
}

fn webp_dimensions(bytes: &[u8]) -> Option<(u64, u64)> {
    if bytes.len() < 30 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WEBP" {
        return None;
    }
    match &bytes[12..16] {
        b"VP8X" if bytes.len() >= 30 => Some((
            read_24_le(&bytes[24..27]) as u64 + 1,
            read_24_le(&bytes[27..30]) as u64 + 1,
        )),
        b"VP8 " if bytes.len() >= 30 => Some((
            (u16::from_le_bytes(bytes[26..28].try_into().ok()?) & 0x3fff) as u64,
            (u16::from_le_bytes(bytes[28..30].try_into().ok()?) & 0x3fff) as u64,
        )),
        b"VP8L" if bytes.len() >= 25 => {
            let b0 = bytes[21] as u32;
            let b1 = bytes[22] as u32;
            let b2 = bytes[23] as u32;
            let b3 = bytes[24] as u32;
            Some((
                ((b1 & 0x3f) << 8 | b0) as u64 + 1,
                ((b3 & 0x0f) << 10 | b2 << 2 | (b1 >> 6)) as u64 + 1,
            ))
        }
        _ => None,
    }
}

fn pdf_metadata(path: &Path) -> ApiResult<Vec<FileMetadataField>> {
    let bytes = fs::read(path).map_err(io_error(path))?;
    let body = String::from_utf8_lossy(&bytes);
    let pages = body
        .match_indices("/Type")
        .filter(|(index, _)| {
            let tail = &body[*index..body.len().min(*index + 32)];
            tail.contains("/Page") && !tail.contains("/Pages")
        })
        .count();
    Ok((pages > 0)
        .then(|| FileMetadataField {
            label: "PDF Pages".to_owned(),
            value: pages.to_string(),
        })
        .into_iter()
        .collect())
}

fn office_metadata(path: &Path) -> ApiResult<Vec<FileMetadataField>> {
    let file = fs::File::open(path).map_err(io_error(path))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|error| ApiError::Message(format!("Could not read Office package: {error}")))?;
    let mut fields = Vec::new();
    if let Some(core) = read_zip_text(&mut archive, "docProps/core.xml")? {
        push_xml_field(&mut fields, &core, "dc:title", "Title");
        push_xml_field(&mut fields, &core, "dc:creator", "Creator");
        push_xml_field(&mut fields, &core, "cp:lastModifiedBy", "Last Modified By");
        push_xml_field(&mut fields, &core, "dcterms:created", "Created");
        push_xml_field(&mut fields, &core, "dcterms:modified", "Modified");
    }
    if let Some(app) = read_zip_text(&mut archive, "docProps/app.xml")? {
        push_xml_field(&mut fields, &app, "Application", "Application");
        push_xml_field(&mut fields, &app, "Pages", "Pages");
        push_xml_field(&mut fields, &app, "Words", "Words");
        push_xml_field(&mut fields, &app, "Slides", "Slides");
    }
    Ok(fields)
}

fn read_zip_text(archive: &mut ZipArchive<fs::File>, name: &str) -> ApiResult<Option<String>> {
    let Ok(mut file) = archive.by_name(name) else {
        return Ok(None);
    };
    let mut text = String::new();
    file.read_to_string(&mut text)
        .map_err(|error| ApiError::Message(format!("Could not read {name}: {error}")))?;
    Ok(Some(text))
}

fn push_xml_field(fields: &mut Vec<FileMetadataField>, xml: &str, tag: &str, label: &str) {
    if let Some(value) = xml_text(xml, tag).filter(|value| !value.trim().is_empty()) {
        fields.push(FileMetadataField {
            label: label.to_owned(),
            value: decode_xml_entities(value.trim()),
        });
    }
}

fn xml_text<'a>(xml: &'a str, tag: &str) -> Option<&'a str> {
    let start = xml.find(&format!("<{tag}"))?;
    let after_open = xml[start..].find('>')? + start + 1;
    let end = xml[after_open..].find(&format!("</{tag}>"))? + after_open;
    Some(&xml[after_open..end])
}

fn decode_xml_entities(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

fn read_24_le(bytes: &[u8]) -> u32 {
    bytes[0] as u32 | ((bytes[1] as u32) << 8) | ((bytes[2] as u32) << 16)
}

fn filesystem_label(path: &Path) -> String {
    path.components()
        .next()
        .map(|component| format!("{component:?}"))
        .unwrap_or_else(|| "Unknown".to_owned())
}

#[cfg(unix)]
fn unix_mode(metadata: &fs::Metadata) -> String {
    use std::os::unix::fs::PermissionsExt;
    format!("{:o}", metadata.permissions().mode() & 0o7777)
}

fn os_tags(path: &Path) -> Vec<String> {
    os_tags_platform(path).unwrap_or_default()
}

#[cfg(target_os = "macos")]
fn os_tags_platform(path: &Path) -> Option<Vec<String>> {
    let output = Command::new("mdls")
        .args(["-raw", "-name", "kMDItemUserTags"])
        .arg(path)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(parse_mdls_tags(&String::from_utf8_lossy(&output.stdout)))
}

#[cfg(not(target_os = "macos"))]
fn os_tags_platform(_path: &Path) -> Option<Vec<String>> {
    None
}

fn parse_mdls_tags(output: &str) -> Vec<String> {
    let trimmed = output.trim();
    if trimmed.is_empty() || trimmed == "(null)" {
        return Vec::new();
    }
    trimmed
        .trim_start_matches('(')
        .trim_end_matches(')')
        .lines()
        .filter_map(|line| {
            let tag = line
                .trim()
                .trim_end_matches(',')
                .trim()
                .trim_matches('"')
                .split("\\n")
                .next()
                .unwrap_or("")
                .split('\n')
                .next()
                .unwrap_or("")
                .trim();
            (!tag.is_empty()).then(|| tag.to_owned())
        })
        .collect()
}

fn io_error(path: &Path) -> impl FnOnce(std::io::Error) -> ApiError + '_ {
    move |err| ApiError::Message(format!("{}: {err}", path.display()))
}

fn system_time_ms(value: SystemTime) -> Option<u64> {
    value
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_png_dimensions() {
        let bytes = [
            b"\x89PNG\r\n\x1a\n".as_slice(),
            &[0, 0, 0, 13],
            b"IHDR",
            &640u32.to_be_bytes(),
            &480u32.to_be_bytes(),
            &[8, 6, 0, 0, 0],
        ]
        .concat();
        assert_eq!(png_dimensions(&bytes), Some((640, 480)));
    }

    #[test]
    fn parses_mdls_tags() {
        let output = "(\n    \"Work\\n6\",\n    \"Draft\"\n)\n";
        assert_eq!(parse_mdls_tags(output), vec!["Work", "Draft"]);
    }

    #[test]
    fn decodes_office_xml_entities() {
        let mut fields = Vec::new();
        push_xml_field(
            &mut fields,
            "<dc:title>Plans &amp; Notes</dc:title>",
            "dc:title",
            "Title",
        );
        assert_eq!(
            fields,
            vec![FileMetadataField {
                label: "Title".to_owned(),
                value: "Plans & Notes".to_owned(),
            }]
        );
    }
}
