pub mod processor;

#[derive(Debug)]
pub enum ApiError {
    Message(String),
}
impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Message(message) => f.write_str(message),
        }
    }
}
impl std::error::Error for ApiError {}
pub type ApiResult<T> = Result<T, ApiError>;

pub const PROTOCOL_VERSION: u32 = 6;

/// The only operation: parse a document into sections an agent can cite.
#[derive(Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Operation {
    #[default]
    Document,
}

/// Fixed, versioned operation. Input and output are staged by the host, never
/// arbitrary paths or commands supplied by an app.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    #[serde(default)]
    pub operation: Operation,
    pub protocol: u32,
    pub display_name: String,
    pub extension: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub protocol: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document: Option<processor::PreparedAgentDocument>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub fn process(work: &std::path::Path, request: Request) -> Response {
    let Operation::Document = request.operation;
    let result = (|| {
        if request.protocol != PROTOCOL_VERSION {
            return Err(ApiError::Message(
                "Unsupported document worker protocol.".into(),
            ));
        }
        if request.extension.is_empty()
            || request.extension.len() > 16
            || !request.extension.bytes().all(|c| c.is_ascii_alphanumeric())
            || request.display_name.is_empty()
            || request.display_name.len() > 1024
            || request
                .display_name
                .chars()
                .any(|c| matches!(c, '/' | '\\' | '\0'))
        {
            return Err(ApiError::Message("Invalid document description.".into()));
        }
        let path = work.join(format!("input.{}", request.extension.to_ascii_lowercase()));
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|_| ApiError::Message("The staged document is unavailable.".into()))?;
        if !metadata.file_type().is_file() {
            return Err(ApiError::Message(
                "The staged input must be a regular file.".into(),
            ));
        }
        let mut document = processor::prepare_document_sync(
            path.to_str()
                .ok_or_else(|| ApiError::Message("Invalid worker directory.".into()))?,
        )?;
        document.display_name = request.display_name;
        Ok(document)
    })();
    match result {
        Ok(document) => Response {
            protocol: PROTOCOL_VERSION,
            document: Some(document),
            error: None,
        },
        Err(error) => Response {
            protocol: PROTOCOL_VERSION,
            document: None,
            error: Some(error.to_string()),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn worker_preserves_document_sections_and_original_name() {
        let work = tempfile::tempdir().unwrap();
        std::fs::write(work.path().join("input.csv"), "name,total\nAlpha,10\n").unwrap();
        let response = process(
            work.path(),
            Request {
                operation: Operation::Document,
                protocol: PROTOCOL_VERSION,
                display_name: "Totals.csv".into(),
                extension: "csv".into(),
            },
        );
        let document = response.document.unwrap();
        assert_eq!(document.display_name, "Totals.csv");
        assert_eq!(document.sections[0].locator, "Sheet1!A1:B2");
        assert!(document.sections[0].text.contains("Alpha\t10"));
    }
    #[test]
    fn worker_rejects_paths_and_unknown_protocols() {
        let work = tempfile::tempdir().unwrap();
        for (protocol, extension) in [(3, "txt"), (1, "../txt"), (1, "txt/secret")] {
            assert!(process(
                work.path(),
                Request {
                    operation: Operation::Document,
                    protocol,
                    display_name: "Notes.txt".into(),
                    extension: extension.into()
                }
            )
            .error
            .is_some());
        }
        assert!(serde_json::from_value::<Request>(serde_json::json!({"protocol":2,"displayName":"Notes","extension":"txt","path":"/private"})).is_err());
    }
}

#[cfg(test)]
mod pdf_tests {
    use super::*;
    #[test]
    fn agent_page_citations_survive_worker_protocol() {
        let stream = "BT /F1 12 Tf 72 720 Td (Hello from Library) Tj ET";
        let objects = [
            "<< /Type /Catalog /Pages 2 0 R >>".to_owned(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_owned(),
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>".to_owned(),
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_owned(),
            format!("<< /Length {} >>\nstream\n{}\nendstream", stream.len(), stream),
        ];
        let mut pdf = "%PDF-1.4\n".to_owned();
        let mut offsets = vec![];
        for (i, object) in objects.iter().enumerate() {
            offsets.push(pdf.len());
            pdf.push_str(&format!("{} 0 obj\n{}\nendobj\n", i + 1, object));
        }
        let xref = pdf.len();
        pdf.push_str("xref\n0 6\n0000000000 65535 f \n");
        for offset in offsets {
            pdf.push_str(&format!("{offset:010} 00000 n \n"));
        }
        pdf.push_str(&format!(
            "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
        ));
        let work = tempfile::tempdir().unwrap();
        std::fs::write(work.path().join("input.pdf"), pdf).unwrap();
        let request = |operation| Request {
            protocol: PROTOCOL_VERSION,
            display_name: "Original.pdf".into(),
            extension: "pdf".into(),
            operation,
        };
        let document = process(work.path(), request(Operation::Document))
            .document
            .unwrap();
        assert_eq!(document.display_name, "Original.pdf");
        assert_eq!(document.sections.len(), 1);
        assert!(document.sections[0].text.contains("Hello from Library"));
    }
}
