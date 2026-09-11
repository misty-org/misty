use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};

use calamine::{open_workbook_auto, Reader};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use zip::ZipArchive;

use crate::error::{ApiError, ApiResult};

pub const MAX_AGENT_DOCUMENT_BYTES: u64 = 50 * 1024 * 1024;
pub const MAX_AGENT_DOCUMENT_PAGES: usize = 200;
const MAX_AGENT_DOCUMENT_TEXT_BYTES: usize = 384 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareAgentDocumentRequest {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedAgentDocument {
    pub document_id: String,
    pub display_name: String,
    pub mime_type: String,
    pub size_bytes: u64,
    pub sections: Vec<PreparedDocumentSection>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedDocumentSection {
    pub kind: String,
    pub locator: String,
    pub text: String,
}

pub async fn prepare_document(
    request: PrepareAgentDocumentRequest,
) -> ApiResult<PreparedAgentDocument> {
    tokio::task::spawn_blocking(move || prepare_document_sync(&request.path))
        .await
        .map_err(|error| {
            ApiError::Message(format!("Document preparation worker failed: {error}"))
        })?
}

fn prepare_document_sync(path_value: &str) -> ApiResult<PreparedAgentDocument> {
    let path = PathBuf::from(path_value);
    let metadata = fs::metadata(&path).map_err(|error| {
        ApiError::Message(format!(
            "Could not inspect document {}: {error}",
            path.display()
        ))
    })?;
    if !metadata.is_file() {
        return Err(ApiError::Message(
            "Document intelligence requires a file.".to_owned(),
        ));
    }
    if metadata.len() > MAX_AGENT_DOCUMENT_BYTES {
        return Err(ApiError::Message(format!(
            "Document exceeds the {} MiB agent limit.",
            MAX_AGENT_DOCUMENT_BYTES / (1024 * 1024)
        )));
    }
    let display_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("document")
        .to_owned();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let mime_type = document_mime(&extension).to_owned();
    let (mut sections, mut truncated) = match extension.as_str() {
        "pdf" => prepare_pdf(&path)?,
        "docx" => prepare_docx_sections(&path)?,
        "pptx" => prepare_zip_sections(&path, "slide")?,
        "xlsx" | "ods" => prepare_spreadsheet_sections(&path)?,
        "csv" => prepare_csv_sections(&path)?,
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" | "tif" | "tiff" => {
            return Err(ApiError::Message(
                "unsupported_content: image files do not contain supported native text".to_owned(),
            ))
        }
        _ => prepare_text_sections(&path)?,
    };
    truncated |= cap_document_text(&mut sections);
    Ok(PreparedAgentDocument {
        document_id: format!("document_{}", Uuid::new_v4().simple()),
        display_name,
        mime_type,
        size_bytes: metadata.len(),
        sections,
        truncated,
    })
}

fn prepare_pdf(path: &Path) -> ApiResult<(Vec<PreparedDocumentSection>, bool)> {
    let pages = std::panic::catch_unwind(|| pdf_extract::extract_text_by_pages(path))
        .map_err(|_| ApiError::Message("PDF page extraction failed safely.".to_owned()))?
        .map_err(|error| ApiError::Message(format!("Could not extract PDF pages: {error}")))?;
    let truncated = pages.len() > MAX_AGENT_DOCUMENT_PAGES;
    let mut sections = Vec::with_capacity(pages.len().min(MAX_AGENT_DOCUMENT_PAGES));
    for (index, page_text) in pages.into_iter().take(MAX_AGENT_DOCUMENT_PAGES).enumerate() {
        let normalized = normalize_extracted_text(&page_text);
        sections.push(PreparedDocumentSection {
            kind: "page".to_owned(),
            locator: (index + 1).to_string(),
            text: normalized,
        });
    }
    if sections
        .iter()
        .all(|section| section.text.trim().is_empty())
    {
        return Err(ApiError::Message(
            "unsupported_content: PDF contains no embedded text".to_owned(),
        ));
    }
    Ok((sections, truncated))
}

fn prepare_spreadsheet_sections(path: &Path) -> ApiResult<(Vec<PreparedDocumentSection>, bool)> {
    let mut workbook = open_workbook_auto(path)
        .map_err(|error| ApiError::Message(format!("Could not open spreadsheet: {error}")))?;
    let sheet_names = workbook.sheet_names().to_vec();
    let truncated = sheet_names.len() > MAX_AGENT_DOCUMENT_PAGES;
    let mut sections = Vec::new();
    for sheet_name in sheet_names.into_iter().take(MAX_AGENT_DOCUMENT_PAGES) {
        let range = workbook.worksheet_range(&sheet_name).map_err(|error| {
            ApiError::Message(format!("Could not read spreadsheet sheet: {error}"))
        })?;
        let (height, width) = range.get_size();
        let text = range
            .rows()
            .map(|row| {
                row.iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
                    .join("\t")
            })
            .collect::<Vec<_>>()
            .join("\n");
        let locator = if height == 0 || width == 0 {
            format!("{sheet_name}!A1")
        } else {
            format!(
                "{sheet_name}!A1:{}{}",
                spreadsheet_column_name(width),
                height
            )
        };
        sections.push(PreparedDocumentSection {
            kind: "sheet".to_owned(),
            locator,
            text,
        });
    }
    Ok((sections, truncated))
}

fn prepare_csv_sections(path: &Path) -> ApiResult<(Vec<PreparedDocumentSection>, bool)> {
    let mut reader = csv::ReaderBuilder::new()
        .flexible(true)
        .from_path(path)
        .map_err(|error| ApiError::Message(format!("Could not open CSV: {error}")))?;
    let mut rows = Vec::new();
    if let Ok(headers) = reader.headers() {
        rows.push(headers.iter().map(ToOwned::to_owned).collect::<Vec<_>>());
    }
    let row_limit = 500 * MAX_AGENT_DOCUMENT_PAGES;
    let mut truncated = false;
    for record in reader.records() {
        if rows.len() >= row_limit {
            truncated = true;
            break;
        }
        let record =
            record.map_err(|error| ApiError::Message(format!("Could not read CSV: {error}")))?;
        rows.push(record.iter().map(ToOwned::to_owned).collect());
    }
    let mut sections = Vec::new();
    for (index, chunk) in rows.chunks(500).take(MAX_AGENT_DOCUMENT_PAGES).enumerate() {
        let start = index * 500 + 1;
        let end = start + chunk.len().saturating_sub(1);
        let width = chunk.iter().map(Vec::len).max().unwrap_or(1).max(1);
        sections.push(PreparedDocumentSection {
            kind: "sheet".to_owned(),
            locator: format!("Sheet1!A{start}:{}{end}", spreadsheet_column_name(width)),
            text: chunk
                .iter()
                .map(|row| row.join("\t"))
                .collect::<Vec<_>>()
                .join("\n"),
        });
    }
    Ok((sections, truncated))
}

fn spreadsheet_column_name(mut column_count: usize) -> String {
    let mut result = String::new();
    while column_count > 0 {
        column_count -= 1;
        result.insert(0, (b'A' + (column_count % 26) as u8) as char);
        column_count /= 26;
    }
    if result.is_empty() {
        "A".to_owned()
    } else {
        result
    }
}

fn prepare_docx_sections(path: &Path) -> ApiResult<(Vec<PreparedDocumentSection>, bool)> {
    let file = fs::File::open(path)
        .map_err(|error| ApiError::Message(format!("Could not open document: {error}")))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|error| ApiError::Message(format!("Could not read document package: {error}")))?;
    let mut entry = archive
        .by_name("word/document.xml")
        .map_err(|error| ApiError::Message(format!("Could not read DOCX content: {error}")))?;
    let mut xml = String::new();
    entry
        .by_ref()
        .take(16 * 1024 * 1024)
        .read_to_string(&mut xml)
        .map_err(|error| ApiError::Message(format!("Could not extract DOCX content: {error}")))?;

    let mut sections: Vec<(String, Vec<String>)> = Vec::new();
    let mut current_heading = "Document".to_owned();
    let mut current_paragraphs = Vec::new();
    for paragraph_xml in xml.split("</w:p>") {
        let paragraph = normalize_extracted_text(&strip_xml(paragraph_xml));
        if paragraph.is_empty() {
            continue;
        }
        let is_heading = paragraph_xml.contains("w:pStyle")
            && (paragraph_xml.contains("Heading") || paragraph_xml.contains("heading"));
        if is_heading {
            if !current_paragraphs.is_empty() {
                sections.push((current_heading, current_paragraphs));
                current_paragraphs = Vec::new();
            }
            current_heading = paragraph;
        } else {
            current_paragraphs.push(paragraph);
        }
    }
    if !current_paragraphs.is_empty() || sections.is_empty() {
        sections.push((current_heading, current_paragraphs));
    }
    let truncated = sections.len() > MAX_AGENT_DOCUMENT_PAGES;
    let prepared = sections
        .into_iter()
        .take(MAX_AGENT_DOCUMENT_PAGES)
        .map(|(heading, paragraphs)| PreparedDocumentSection {
            kind: "section".to_owned(),
            locator: heading,
            text: paragraphs.join("\n"),
        })
        .collect();
    Ok((prepared, truncated))
}

fn prepare_zip_sections(
    path: &Path,
    section_kind: &str,
) -> ApiResult<(Vec<PreparedDocumentSection>, bool)> {
    let file = fs::File::open(path)
        .map_err(|error| ApiError::Message(format!("Could not open document package: {error}")))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|error| ApiError::Message(format!("Could not read document package: {error}")))?;
    let mut candidates = Vec::new();
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|error| {
            ApiError::Message(format!("Could not inspect document package: {error}"))
        })?;
        let name = entry.name().to_ascii_lowercase();
        let include = match section_kind {
            "slide" => name.starts_with("ppt/slides/slide") && name.ends_with(".xml"),
            "sheet" => {
                name.starts_with("xl/worksheets/sheet") && name.ends_with(".xml")
                    || name == "content.xml"
            }
            _ => name == "word/document.xml" || name == "content.xml",
        };
        if include {
            candidates.push((name, index));
        }
    }
    candidates
        .sort_by(|left, right| natural_entry_number(&left.0).cmp(&natural_entry_number(&right.0)));
    let truncated = candidates.len() > MAX_AGENT_DOCUMENT_PAGES;
    let mut sections = Vec::new();
    for (ordinal, (_, index)) in candidates
        .into_iter()
        .take(MAX_AGENT_DOCUMENT_PAGES)
        .enumerate()
    {
        let mut entry = archive.by_index(index).map_err(|error| {
            ApiError::Message(format!("Could not read document section: {error}"))
        })?;
        let mut xml = String::new();
        entry
            .by_ref()
            .take(4 * 1024 * 1024)
            .read_to_string(&mut xml)
            .map_err(|error| {
                ApiError::Message(format!("Could not extract document section: {error}"))
            })?;
        sections.push(PreparedDocumentSection {
            kind: section_kind.to_owned(),
            locator: (ordinal + 1).to_string(),
            text: normalize_extracted_text(&strip_xml(&xml)),
        });
    }
    if sections.is_empty() {
        return prepare_text_sections(path);
    }
    Ok((sections, truncated))
}

fn prepare_text_sections(path: &Path) -> ApiResult<(Vec<PreparedDocumentSection>, bool)> {
    let bytes = fs::read(path)
        .map_err(|error| ApiError::Message(format!("Could not read document: {error}")))?;
    let text = String::from_utf8_lossy(&bytes);
    let lines: Vec<&str> = text.lines().collect();
    let mut sections = Vec::new();
    for (chunk_index, chunk) in lines.chunks(500).take(MAX_AGENT_DOCUMENT_PAGES).enumerate() {
        let start = chunk_index * 500 + 1;
        let end = start + chunk.len().saturating_sub(1);
        sections.push(PreparedDocumentSection {
            kind: "lines".to_owned(),
            locator: format!("{start}-{end}"),
            text: chunk.join("\n"),
        });
    }
    if sections.is_empty() {
        sections.push(PreparedDocumentSection {
            kind: "section".to_owned(),
            locator: "1".to_owned(),
            text: String::new(),
        });
    }
    Ok((sections, lines.len() > 500 * MAX_AGENT_DOCUMENT_PAGES))
}

fn cap_document_text(sections: &mut [PreparedDocumentSection]) -> bool {
    let mut remaining = MAX_AGENT_DOCUMENT_TEXT_BYTES;
    let mut truncated = false;
    for section in sections {
        if section.text.len() <= remaining {
            remaining -= section.text.len();
            continue;
        }
        section.text = truncate_utf8(&section.text, remaining);
        remaining = 0;
        truncated = true;
    }
    truncated
}

fn truncate_utf8(value: &str, limit: usize) -> String {
    if value.len() <= limit {
        return value.to_owned();
    }
    let mut end = limit.min(value.len());
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_owned()
}

fn normalize_extracted_text(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_owned()
}

fn strip_xml(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut in_tag = false;
    for character in value.chars() {
        match character {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                output.push(' ');
            }
            _ if !in_tag => output.push(character),
            _ => {}
        }
    }
    output
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

fn natural_entry_number(value: &str) -> u64 {
    value
        .chars()
        .filter(char::is_ascii_digit)
        .collect::<String>()
        .parse()
        .unwrap_or(u64::MAX)
}

fn document_mime(extension: &str) -> &'static str {
    match extension {
        "pdf" => "application/pdf",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "csv" => "text/csv",
        "md" => "text/markdown",
        "txt" => "text/plain",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_sections_preserve_line_citations_and_apply_caps() {
        let root = std::env::temp_dir().join(format!("misty-agent-doc-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("notes.md");
        fs::write(
            &path,
            (1..=620)
                .map(|line| format!("line {line}\n"))
                .collect::<String>(),
        )
        .unwrap();
        let prepared = prepare_document_sync(path.to_str().unwrap()).unwrap();
        assert_eq!(prepared.display_name, "notes.md");
        assert_eq!(prepared.sections[0].kind, "lines");
        assert_eq!(prepared.sections[0].locator, "1-500");
        assert_eq!(prepared.sections[1].locator, "501-620");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn csv_sections_preserve_sheet_ranges() {
        let root = std::env::temp_dir().join(format!("misty-agent-csv-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("totals.csv");
        fs::write(&path, "name,total\nAlpha,10\nBeta,20\n").unwrap();
        let prepared = prepare_document_sync(path.to_str().unwrap()).unwrap();
        assert_eq!(prepared.sections[0].kind, "sheet");
        assert_eq!(prepared.sections[0].locator, "Sheet1!A1:B3");
        assert!(prepared.sections[0].text.contains("Alpha\t10"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn image_files_fail_as_unsupported_content() {
        let root = std::env::temp_dir().join(format!("misty-agent-image-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("scan.png");
        fs::write(&path, [0x89, b'P', b'N', b'G']).unwrap();
        let error = prepare_document_sync(path.to_str().unwrap())
            .unwrap_err()
            .to_string();
        assert!(error.contains("unsupported_content"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn oversized_documents_are_rejected_before_reading() {
        let root = std::env::temp_dir().join(format!("misty-agent-large-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("large.txt");
        let file = fs::File::create(&path).unwrap();
        file.set_len(MAX_AGENT_DOCUMENT_BYTES + 1).unwrap();
        let error = prepare_document_sync(path.to_str().unwrap()).unwrap_err();
        assert!(error.to_string().contains("50 MiB"));
        let _ = fs::remove_dir_all(root);
    }
}
