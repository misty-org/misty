//! Untrusted documents and images are parsed on Windows by the same bundled
//! worker macOS uses, confined in an AppContainer (see
//! `platform::windows::sandbox`). Misty's own process never parses them.
use std::{
    fs::File,
    io::{Read, Write},
    path::Path,
    sync::atomic::AtomicBool,
    time::Duration,
};

use serde_json::{json, Value};

use crate::platform::windows::sandbox::{Limits, Workspace};

const PROTOCOL: u32 = 5;
const CONTAINER: &str = "Misty.DocumentWorker";
/// The largest response and the largest preview image the worker returns.
const MAX_RESPONSE: u64 = 4 * 1024 * 1024;
const MAX_PREVIEW: u64 = 16 * 1024 * 1024;

fn worker() -> Result<&'static [u8], String> {
    builtin_worker("document-processing", PROTOCOL)
}

fn builtin_worker(service: &str, protocol: u32) -> Result<&'static [u8], String> {
    // Executable bytes are part of the signed Misty binary, never downloaded or
    // resolved from a user-controlled directory.
    include!(concat!(env!("OUT_DIR"), "/builtin_workers.rs"))
}

/// The largest input each operation accepts, as on macOS.
fn input_limit(operation: &str) -> u64 {
    if matches!(operation, "imagePreview" | "explorerImage") {
        256 * 1024 * 1024
    } else if operation.starts_with("semantic") {
        64 * 1024 * 1024
    } else {
        crate::infra::document_intelligence::MAX_AGENT_DOCUMENT_BYTES
    }
}

/// Runs one worker operation on `path`. `stop` cancels it.
pub(crate) fn process(
    path: &Path,
    operation: &str,
    max_dimension: Option<u32>,
    stop: &AtomicBool,
) -> Result<(Value, Option<Vec<u8>>), String> {
    let display_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Invalid document name.")?
        .to_owned();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("txt")
        .to_ascii_lowercase();
    let source = File::open(path).map_err(|_| "Selected document is unavailable.")?;
    let request = Request {
        display_name: &display_name,
        extension: &extension,
        operation,
        max_dimension,
        source_extension: None,
    };
    run_file(worker()?, &source, &request, stop)
}

/// What one worker run is asked to do.
pub(crate) struct Request<'a> {
    pub display_name: &'a str,
    pub extension: &'a str,
    pub operation: &'a str,
    pub max_dimension: Option<u32>,
    pub source_extension: Option<&'a str>,
}

/// Runs `worker` on a private copy of the open file `source`, returning its
/// answer and, for `explorerImage`, the PNG it drew.
pub(crate) fn run_file(
    worker: &[u8],
    mut source: &File,
    request: &Request,
    stop: &AtomicBool,
) -> Result<(Value, Option<Vec<u8>>), String> {
    let Request {
        display_name,
        extension,
        operation,
        max_dimension,
        source_extension,
    } = *request;
    if extension.len() > 16 || !extension.bytes().all(|c| c.is_ascii_alphanumeric()) {
        return Err("Invalid document extension.".into());
    }
    let metadata = source.metadata().map_err(|_| "Document unavailable.")?;
    if !metadata.is_file() {
        return Err("Choose a regular file.".into());
    }
    if metadata.len() > input_limit(operation) {
        return Err("Input exceeds this operation's size limit.".into());
    }
    let workspace = Workspace::new(CONTAINER)?;
    // The worker sees a private copy, never the person's own file.
    let mut staged = File::create(workspace.path().join(format!("input.{extension}")))
        .map_err(|_| "Could not stage document.")?;
    let copied = std::io::copy(
        &mut (&mut source).take(input_limit(operation) + 1),
        &mut staged,
    )
    .map_err(|_| "Could not stage document.")?;
    if copied > input_limit(operation) {
        return Err("Input exceeds this operation's size limit.".into());
    }
    staged.flush().map_err(|_| "Could not stage document.")?;
    drop(staged);
    let body = serde_json::to_vec(&json!({
        "protocol": PROTOCOL,
        "displayName": display_name,
        "extension": extension,
        "operation": operation,
        "maxDimension": max_dimension,
        "sourceExtension": source_extension,
    }))
    .map_err(|_| "Invalid document request.")?;
    let limits = Limits {
        memory_bytes: 1536 * 1024 * 1024,
        cpu: Duration::from_secs(300),
        wall: Duration::from_secs(120),
        output_bytes: MAX_RESPONSE,
        work_bytes: 2 * input_limit(operation) + 64 * 1024 * 1024,
        processes: 1,
    };
    let response = workspace.run(worker, &body, &limits, stop)?;
    let value: Value =
        serde_json::from_slice(&response).map_err(|_| "Invalid document processor response.")?;
    if value.get("protocol").and_then(Value::as_u64) != Some(u64::from(PROTOCOL)) {
        return Err("Incompatible document processor response.".into());
    }
    if let Some(error) = value.get("error").and_then(Value::as_str) {
        return Err(error.chars().take(2000).collect());
    }
    let image = if operation == "explorerImage" {
        Some(read_preview(workspace.path(), &value)?)
    } else {
        None
    };
    Ok((value, image))
}

/// The worker's PNG, checked against what it said it wrote. Its output is
/// still untrusted, so the read is bounded independently of its claim.
fn read_preview(folder: &Path, value: &Value) -> Result<Vec<u8>, String> {
    let length = value["image"]["byteLength"]
        .as_u64()
        .ok_or("Invalid PNG response.")?;
    if length > MAX_PREVIEW || value["image"]["mimeType"] != "image/png" {
        return Err("Invalid PNG output.".into());
    }
    let path = folder.join("preview.png");
    let metadata = std::fs::symlink_metadata(&path).map_err(|_| "Image output unavailable.")?;
    if !metadata.is_file() || metadata.len() != length {
        return Err("Invalid PNG output.".into());
    }
    let mut bytes = Vec::new();
    File::open(&path)
        .and_then(|file| file.take(MAX_PREVIEW + 1).read_to_end(&mut bytes))
        .map_err(|_| "Could not read PNG output.")?;
    if bytes.len() as u64 != length || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("Invalid PNG output.".into());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn documents_are_parsed_by_the_confined_worker() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("notes.txt");
        std::fs::write(&path, "Quarterly notes\nRevenue grew.").unwrap();
        let stop = AtomicBool::new(false);
        let (value, image) = process(&path, "document", None, &stop).unwrap();
        assert!(image.is_none());
        let text = value["document"]["sections"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|section| section["text"].as_str())
            .collect::<String>();
        assert!(text.contains("Revenue grew."), "{value}");
    }

    #[test]
    fn previews_come_back_as_checked_png() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("photo.png");
        image::RgbaImage::from_pixel(64, 48, image::Rgba([20, 40, 60, 255]))
            .save(&path)
            .unwrap();
        let stop = AtomicBool::new(false);
        let (_, image) = process(&path, "explorerImage", Some(32), &stop).unwrap();
        let png = image.unwrap();
        let decoded = image::load_from_memory(&png).unwrap();
        assert!(decoded.width() <= 32 && decoded.height() <= 32);
    }

    #[test]
    fn cancelled_runs_never_start() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("notes.txt");
        std::fs::write(&path, "text").unwrap();
        let stop = AtomicBool::new(true);
        assert!(process(&path, "document", None, &stop).is_err());
    }
}
