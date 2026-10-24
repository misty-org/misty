//! Spreadsheets and CSV files, one section per sheet.
use super::*;

pub(super) fn prepare_spreadsheet_sections(
    path: &Path,
) -> ApiResult<(Vec<PreparedDocumentSection>, bool)> {
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

pub(super) fn prepare_csv_sections(path: &Path) -> ApiResult<(Vec<PreparedDocumentSection>, bool)> {
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

pub(super) fn spreadsheet_column_name(mut column_count: usize) -> String {
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
