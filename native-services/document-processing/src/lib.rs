pub mod explorer_images;
pub mod images;
pub mod processor;
pub mod semantic;

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

pub const PROTOCOL_VERSION: u32 = 5;

#[derive(Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Operation {
    #[default]
    Document,
    PdfText,
    ImagePreview,
    ExplorerImage,
    SemanticText,
    SemanticDocument,
    SemanticAudio,
    SemanticArchive,
    SemanticBinary,
    SemanticImage,
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
    #[serde(default)]
    pub max_dimension: Option<u32>,
    #[serde(default)]
    pub source_extension: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub protocol: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document: Option<processor::PreparedAgentDocument>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub semantic: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<serde_json::Value>,
}

pub fn process(work: &std::path::Path, request: Request) -> Response {
    if matches!(request.operation, Operation::ExplorerImage) {
        let result = (|| -> Result<serde_json::Value, String> {
            if request.protocol != PROTOCOL_VERSION
                || request.extension.is_empty()
                || request.extension.len() > 16
                || !request.extension.bytes().all(|c| c.is_ascii_alphanumeric())
            {
                return Err("Invalid Files image request.".into());
            }
            let path = work.join(format!("input.{}", request.extension.to_ascii_lowercase()));
            let metadata = std::fs::symlink_metadata(&path).map_err(|_| "Image unavailable.")?;
            if !metadata.file_type().is_file() || metadata.len() > 256 * 1024 * 1024 {
                return Err("Image exceeds preview limits.".into());
            }
            let bytes = explorer_images::render(&path, request.max_dimension.unwrap_or(1600))
                .map_err(|e| e.to_string())?;
            if bytes.len() > 16 * 1024 * 1024 {
                return Err("PNG exceeds preview limits.".into());
            }
            // create_new prevents a substituted output symlink from being followed.
            use std::io::Write;
            let mut output = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(work.join("preview.png"))
                .map_err(|_| "Preview output unavailable.")?;
            output
                .write_all(&bytes)
                .map_err(|_| "Could not write preview.")?;
            Ok(serde_json::json!({"mimeType":"image/png","byteLength":bytes.len()}))
        })();
        return match result {
            Ok(image) => Response {
                protocol: PROTOCOL_VERSION,
                document: None,
                semantic: None,
                image: Some(image),
                error: None,
            },
            Err(error) => Response {
                protocol: PROTOCOL_VERSION,
                document: None,
                semantic: None,
                image: None,
                error: Some(error),
            },
        };
    }
    let kind = match request.operation {
        Operation::SemanticText => Some(semantic::SemanticAssetKind::Text),
        Operation::SemanticDocument => Some(semantic::SemanticAssetKind::Document),
        Operation::SemanticAudio => Some(semantic::SemanticAssetKind::Audio),
        Operation::SemanticArchive => Some(semantic::SemanticAssetKind::Archive),
        Operation::SemanticBinary => Some(semantic::SemanticAssetKind::Binary),
        Operation::SemanticImage => Some(semantic::SemanticAssetKind::Image),
        _ => None,
    };
    if let Some(kind) = kind {
        let result = (|| -> Result<serde_json::Value, String> {
            if request.protocol != PROTOCOL_VERSION
                || request.extension.len() > 16
                || !request.extension.bytes().all(|c| c.is_ascii_alphanumeric())
            {
                return Err("Invalid semantic extraction request.".into());
            }
            let path = work.join(format!("input.{}", request.extension.to_ascii_lowercase()));
            let metadata = std::fs::symlink_metadata(&path).map_err(|_| "Input unavailable.")?;
            if !metadata.file_type().is_file() || metadata.len() > 64 * 1024 * 1024 {
                return Err("Input exceeds semantic extraction limits.".into());
            }
            let source_extension = request
                .source_extension
                .as_deref()
                .unwrap_or(&request.extension);
            if source_extension.len() > 16
                || !source_extension.bytes().all(|c| c.is_ascii_alphanumeric())
            {
                return Err("Invalid source extension.".into());
            }
            let content = semantic::extract(&path, &source_extension.to_ascii_lowercase(), kind)
                .map_err(|error| error.to_string())?;
            serde_json::to_value(content).map_err(|error| error.to_string())
        })();
        return match result {
            Ok(semantic) => Response {
                protocol: PROTOCOL_VERSION,
                document: None,
                semantic: Some(semantic),
                image: None,
                error: None,
            },
            Err(error) => Response {
                protocol: PROTOCOL_VERSION,
                document: None,
                semantic: None,
                image: None,
                error: Some(error),
            },
        };
    }
    if matches!(request.operation, Operation::ImagePreview) {
        let result = (|| -> Result<serde_json::Value, String> {
            if request.protocol != PROTOCOL_VERSION
                || request.extension.is_empty()
                || request.extension.len() > 16
                || !request.extension.bytes().all(|c| c.is_ascii_alphanumeric())
            {
                return Err("Invalid image preview request.".into());
            }
            let dimension = request.max_dimension.unwrap_or(512);
            if !(384..=512).contains(&dimension) {
                return Err("Invalid Library preview dimensions.".into());
            }
            let path = work.join(format!("input.{}", request.extension.to_ascii_lowercase()));
            let metadata = std::fs::symlink_metadata(&path).map_err(|_| "Image unavailable.")?;
            if !metadata.file_type().is_file() || metadata.len() > 256 * 1024 * 1024 {
                return Err("Image exceeds preview limits.".into());
            }
            let (bytes, width, height) = images::render_private_image_preview(&path, dimension)
                .map_err(|error| error.to_string())?;
            Ok(
                serde_json::json!({"bytes":bytes,"width":width,"height":height,"mimeType":"image/jpeg"}),
            )
        })();
        return match result {
            Ok(image) => Response {
                protocol: PROTOCOL_VERSION,
                document: None,
                semantic: None,
                error: None,
                image: Some(image),
            },
            Err(error) => Response {
                protocol: PROTOCOL_VERSION,
                document: None,
                semantic: None,
                error: Some(error),
                image: None,
            },
        };
    }
    if matches!(request.operation, Operation::PdfText) {
        let result = (|| -> Result<serde_json::Value, String> {
            if request.protocol != PROTOCOL_VERSION || request.extension != "pdf" {
                return Err("Invalid PDF text request.".into());
            }
            let path = work.join("input.pdf");
            let metadata = std::fs::symlink_metadata(&path).map_err(|_| "PDF unavailable.")?;
            if !metadata.file_type().is_file() || metadata.len() > 16 * 1024 * 1024 {
                return Err("PDF exceeds the text extraction limit.".into());
            }
            let mut text = std::panic::catch_unwind(|| pdf_extract::extract_text(&path))
                .map_err(|_| "PDF extraction failed safely.")?
                .map_err(|_| "Could not extract PDF text.")?;
            let truncated = text.len() > 64 * 1024;
            let mut end = text.len().min(64 * 1024);
            while !text.is_char_boundary(end) {
                end -= 1;
            }
            text.truncate(end);
            Ok(serde_json::json!({"text":text,"truncated":truncated}))
        })();
        return match result {
            Ok(semantic) => Response {
                image: None,
                protocol: PROTOCOL_VERSION,
                document: None,
                error: None,
                semantic: Some(semantic),
            },
            Err(error) => Response {
                image: None,
                protocol: PROTOCOL_VERSION,
                document: None,
                error: Some(error),
                semantic: None,
            },
        };
    }
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
            image: None,
            protocol: PROTOCOL_VERSION,
            document: Some(document),
            semantic: None,
            error: None,
        },
        Err(error) => Response {
            image: None,
            protocol: PROTOCOL_VERSION,
            document: None,
            semantic: None,
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
                max_dimension: None,
                source_extension: None,
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
                    max_dimension: None,
                    source_extension: None,
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
    fn library_pdf_text_and_agent_page_citations_survive_worker_protocol() {
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
            max_dimension: None,
            source_extension: None,
            protocol: PROTOCOL_VERSION,
            display_name: "Original.pdf".into(),
            extension: "pdf".into(),
            operation,
        };
        let response = process(work.path(), request(Operation::PdfText));
        assert!(response.error.is_none(), "{:?}", response.error);
        let semantic = response.semantic.unwrap();
        assert!(semantic["text"]
            .as_str()
            .unwrap()
            .contains("Hello from Library"));
        assert_eq!(semantic["truncated"], false);
        let document = process(work.path(), request(Operation::Document))
            .document
            .unwrap();
        assert_eq!(document.display_name, "Original.pdf");
        assert_eq!(document.sections.len(), 1);
        assert!(document.sections[0].text.contains("Hello from Library"));
    }
}

#[cfg(test)]
mod image_protocol_tests {
    use super::*;
    #[test]
    fn image_operation_rejects_path_injection_symlinks_and_invalid_dimensions() {
        let root = tempfile::tempdir().unwrap();
        let request = |extension: &str, dimension| Request {
            protocol: PROTOCOL_VERSION,
            operation: Operation::ImagePreview,
            display_name: "Image".into(),
            extension: extension.into(),
            max_dimension: Some(dimension),
            source_extension: None,
        };
        assert!(process(root.path(), request("../private", 512))
            .error
            .is_some());
        assert!(process(root.path(), request("png", 32)).error.is_some());
        image::RgbImage::new(800, 400)
            .save(root.path().join("input.png"))
            .unwrap();
        let response = process(root.path(), request("png", 384));
        assert!(response.error.is_none(), "{:?}", response.error);
        assert_eq!(response.image.as_ref().unwrap()["width"], 384);
        assert_eq!(response.image.as_ref().unwrap()["height"], 192);
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(
                root.path().join("input.png"),
                root.path().join("input.jpg"),
            )
            .unwrap();
            assert!(process(root.path(), request("jpg", 512)).error.is_some());
        }
    }
}

#[cfg(test)]
mod semantic_protocol_tests {
    use super::*;
    #[test]
    fn preserves_catalog_format_independently_of_staged_filename() {
        let work = tempfile::tempdir().unwrap();
        std::fs::write(work.path().join("input.txt"), b"{\\rtf1 hello}").unwrap();
        let request = |source: &str| Request {
            operation: Operation::SemanticDocument,
            protocol: PROTOCOL_VERSION,
            display_name: "Notes".into(),
            extension: "txt".into(),
            source_extension: Some(source.into()),
            max_dimension: None,
        };
        let response = process(work.path(), request("rtf"));
        assert!(response.error.is_none(), "{:?}", response.error);
        let content = response.semantic.unwrap();
        assert_eq!(content["metadata"]["extension"], "rtf");
        assert!(content["text"].as_str().unwrap().contains("hello"));
        assert!(process(work.path(), request("../private")).error.is_some());
    }
}

#[cfg(test)]
mod explorer_protocol_tests {
    use super::*;
    #[test]
    fn png_uses_fixed_binary_output_and_rejects_symlinks() {
        let work = tempfile::tempdir().unwrap();
        image::RgbaImage::new(800, 400)
            .save(work.path().join("input.png"))
            .unwrap();
        let request = |extension: &str| Request {
            operation: Operation::ExplorerImage,
            protocol: PROTOCOL_VERSION,
            display_name: "Image".into(),
            extension: extension.into(),
            max_dimension: Some(384),
            source_extension: None,
        };
        assert!(process(work.path(), request("../png")).error.is_some());
        let response = process(work.path(), request("png"));
        assert!(response.error.is_none(), "{:?}", response.error);
        let bytes = std::fs::read(work.path().join("preview.png")).unwrap();
        assert_eq!(response.image.unwrap()["byteLength"], bytes.len());
        let decoded = image::load_from_memory(&bytes).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (384, 192));
        assert!(process(work.path(), request("png")).error.is_some());
        #[cfg(unix)]
        {
            std::fs::remove_file(work.path().join("preview.png")).unwrap();
            let private = work.path().join("private");
            std::fs::write(&private, b"keep").unwrap();
            std::os::unix::fs::symlink(&private, work.path().join("preview.png")).unwrap();
            assert!(process(work.path(), request("png")).error.is_some());
            assert_eq!(std::fs::read(private).unwrap(), b"keep");
            std::os::unix::fs::symlink(
                work.path().join("input.png"),
                work.path().join("input.jpg"),
            )
            .unwrap();
            assert!(process(work.path(), request("jpg")).error.is_some());
        }
    }
}
