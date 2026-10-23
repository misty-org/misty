//! Untrusted documents are parsed on Windows by the same bundled
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

use crate::platform::shared_windows::sandbox::{Limits, Workspace};

const PROTOCOL: u32 = 6;
const CONTAINER: &str = "Misty.DocumentWorker";
/// The largest response the worker returns.
const MAX_RESPONSE: u64 = 4 * 1024 * 1024;

fn worker() -> Result<&'static [u8], String> {
    builtin_worker("document-processing", PROTOCOL)
}

fn builtin_worker(service: &str, protocol: u32) -> Result<&'static [u8], String> {
    // Executable bytes are part of the signed Misty binary, never downloaded or
    // resolved from a user-controlled directory.
    include!(concat!(env!("OUT_DIR"), "/builtin_workers.rs"))
}

/// The largest document the worker accepts, as on macOS.
const INPUT_LIMIT: u64 = crate::infra::documents::MAX_AGENT_DOCUMENT_BYTES;

/// Parses the document at `path` in the confined worker. `stop` cancels it.
pub(crate) fn process(path: &Path, stop: &AtomicBool) -> Result<Value, String> {
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
    let mut source = File::open(path).map_err(|_| "Selected document is unavailable.")?;
    if extension.len() > 16 || !extension.bytes().all(|c| c.is_ascii_alphanumeric()) {
        return Err("Invalid document extension.".into());
    }
    let metadata = source.metadata().map_err(|_| "Document unavailable.")?;
    if !metadata.is_file() {
        return Err("Choose a regular file.".into());
    }
    if metadata.len() > INPUT_LIMIT {
        return Err("Input exceeds this operation's size limit.".into());
    }
    let workspace = Workspace::new(CONTAINER)?;
    // The worker sees a private copy, never the person's own file.
    let mut staged = File::create(workspace.path().join(format!("input.{extension}")))
        .map_err(|_| "Could not stage document.")?;
    let copied = std::io::copy(&mut (&mut source).take(INPUT_LIMIT + 1), &mut staged)
        .map_err(|_| "Could not stage document.")?;
    if copied > INPUT_LIMIT {
        return Err("Input exceeds this operation's size limit.".into());
    }
    staged.flush().map_err(|_| "Could not stage document.")?;
    drop(staged);
    let body = serde_json::to_vec(&json!({
        "protocol": PROTOCOL,
        "displayName": display_name,
        "extension": extension,
        "operation": "document",
    }))
    .map_err(|_| "Invalid document request.")?;
    let limits = Limits {
        memory_bytes: 1536 * 1024 * 1024,
        cpu: Duration::from_secs(300),
        wall: Duration::from_secs(120),
        output_bytes: MAX_RESPONSE,
        work_bytes: 2 * INPUT_LIMIT + 64 * 1024 * 1024,
        processes: 1,
    };
    let response = workspace.run(worker()?, &body, &limits, stop)?;
    let value: Value =
        serde_json::from_slice(&response).map_err(|_| "Invalid document processor response.")?;
    if value.get("protocol").and_then(Value::as_u64) != Some(u64::from(PROTOCOL)) {
        return Err("Incompatible document processor response.".into());
    }
    if let Some(error) = value.get("error").and_then(Value::as_str) {
        return Err(error.chars().take(2000).collect());
    }
    Ok(value)
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
        let value = process(&path, &stop).unwrap();
        let text = value["document"]["sections"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|section| section["text"].as_str())
            .collect::<String>();
        assert!(text.contains("Revenue grew."), "{value}");
    }

    #[test]
    fn cancelled_runs_never_start() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("notes.txt");
        std::fs::write(&path, "text").unwrap();
        let stop = AtomicBool::new(true);
        assert!(process(&path, &stop).is_err());
    }
}
