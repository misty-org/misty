//! Word documents and zip archives of documents.
use super::*;

pub(super) fn prepare_docx_sections(
    path: &Path,
) -> ApiResult<(Vec<PreparedDocumentSection>, bool)> {
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

pub(super) fn prepare_zip_sections(
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
