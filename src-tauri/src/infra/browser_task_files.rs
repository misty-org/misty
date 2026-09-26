//! Reuse a verified download across websites within one live agent task.
//! Model-visible IDs select receipts, never arbitrary filesystem paths.
use super::{BrowserAgentExecuteRequest, BrowserDownload, BrowserSessionState};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs::OpenOptions, io::Read, path::Path};
use tauri::AppHandle;

const MAX_FILE_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DownloadFile {
    byte_size: u64,
    sha256: String,
    mime_type: String,
}

fn read_file(path: &Path) -> Result<Vec<u8>, String> {
    let metadata = std::fs::symlink_metadata(path).map_err(|_| "task_download_unavailable")?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_FILE_BYTES {
        return Err("task_download_unsupported: expected a file between 1 byte and 10 MB".into());
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options
        .open(path)
        .map_err(|_| "task_download_unavailable")?;
    if !file
        .metadata()
        .map_err(|_| "task_download_unavailable")?
        .is_file()
    {
        return Err("task_download_unavailable".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "task_download_unavailable")?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("task_download_unsupported: expected a file between 1 byte and 10 MB".into());
    }
    Ok(bytes)
}

fn mime_type(bytes: &[u8]) -> Result<&'static str, String> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Ok("image/png");
    }
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return Ok("image/jpeg");
    }
    if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        return Ok("image/webp");
    }
    if bytes.starts_with(b"%PDF-") {
        return Ok("application/pdf");
    }
    Err("task_download_unsupported: use PNG, JPEG, WebP or PDF".into())
}

pub(super) fn fingerprint(path: &Path) -> Result<DownloadFile, String> {
    let bytes = read_file(path)?;
    Ok(DownloadFile {
        byte_size: bytes.len() as u64,
        sha256: hex::encode(Sha256::digest(&bytes)),
        mime_type: mime_type(&bytes)?.to_owned(),
    })
}

fn upload_file(download: &BrowserDownload, agent: &str, task: &str) -> Result<Value, String> {
    if task.is_empty()
        || download.task_id.as_deref() != Some(task)
        || download.agent_id.as_deref() != Some(agent)
        || download.initiator != "agent"
        || download.state != "finished"
        || !download.success
    {
        return Err("task_download_forbidden: use a completed download from this task".into());
    }
    let receipt = download
        .file
        .as_ref()
        .ok_or("task_download_unsupported: use PNG, JPEG, WebP or PDF up to 10 MB")?;
    let path = Path::new(&download.path);
    let bytes = read_file(path)?;
    if bytes.len() as u64 != receipt.byte_size
        || hex::encode(Sha256::digest(&bytes)) != receipt.sha256
    {
        return Err("task_download_changed: download the file again before uploading".into());
    }
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| name.len() <= 255)
        .ok_or("task_download_name_invalid")?;
    Ok(
        json!({"name": name, "mimeType": receipt.mime_type, "byteSize": receipt.byte_size,
        "sha256": receipt.sha256, "base64": STANDARD.encode(bytes)}),
    )
}

pub(super) fn prepare_upload(
    app: &AppHandle,
    state: &BrowserSessionState,
    request: &BrowserAgentExecuteRequest,
) -> Result<Value, String> {
    let source = request
        .input
        .get("sourceScopeId")
        .and_then(Value::as_str)
        .ok_or("task_download_source_required")?;
    let id = request
        .input
        .get("downloadId")
        .and_then(Value::as_str)
        .ok_or("task_download_id_required")?;
    let task = request
        .input
        .get("__mistyTaskId")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or("task_download_forbidden")?;
    if request
        .input
        .get("attachmentId")
        .is_some_and(|value| value.as_str().is_some_and(|id| !id.is_empty()))
    {
        return Err("task_download_ambiguous".into());
    }
    super::super::agent_workspace::authorize_scope(app, source, &request.agent_id, task)?;
    let download = {
        let sessions = state
            .sessions
            .lock()
            .map_err(|_| "browser_state_unavailable")?;
        let session = sessions
            .values()
            .find(|session| session.scope_id == source)
            .ok_or("task_download_source_closed")?;
        session
            .downloads
            .iter()
            .find(|item| item.download_id == id)
            .cloned()
            .ok_or("task_download_not_found")?
    };
    upload_file(&download, &request.agent_id, task)
}

pub(super) fn resume_downloads(
    downloads: &mut [BrowserDownload],
    agent: &str,
    previous: &str,
    next: &str,
) {
    for item in downloads {
        if item.agent_id.as_deref() == Some(agent)
            && item.task_id.as_deref() == Some(previous)
            && item.state == "finished"
            && item.success
            && item.file.is_some()
        {
            item.task_id = Some(next.to_owned());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(path: &Path) -> BrowserDownload {
        BrowserDownload {
            download_id: "download-one".into(),
            tab_id: "source".into(),
            url: "https://example.test/file".into(),
            path: path.to_string_lossy().into_owned(),
            state: "finished".into(),
            success: true,
            initiator: "agent".into(),
            agent_id: Some("agent-one".into()),
            grant_id: Some("grant".into()),
            task_id: Some("task-one".into()),
            file: Some(fingerprint(path).unwrap()),
            error: None,
        }
    }

    #[test]
    fn reuses_verified_bytes_and_rejects_replacement() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("catalog.pdf");
        std::fs::write(&path, b"%PDF-1.7\noriginal").unwrap();
        let receipt = fixture(&path);
        let file = upload_file(&receipt, "agent-one", "task-one").unwrap();
        assert_eq!(file["mimeType"], "application/pdf");
        assert_eq!(
            STANDARD.decode(file["base64"].as_str().unwrap()).unwrap(),
            b"%PDF-1.7\noriginal"
        );
        std::fs::write(&path, b"%PDF-1.7\nmodified").unwrap();
        assert!(upload_file(&receipt, "agent-one", "task-one")
            .unwrap_err()
            .contains("changed"));
    }

    #[test]
    fn rejects_other_tasks_agents_incomplete_and_human_downloads() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("mockup.png");
        std::fs::write(&path, b"\x89PNG\r\n\x1a\nimage").unwrap();
        let mut receipt = fixture(&path);
        assert!(upload_file(&receipt, "agent-one", "task-two").is_err());
        assert!(upload_file(&receipt, "agent-two", "task-one").is_err());
        assert!(upload_file(&receipt, "agent-one", "").is_err());
        receipt.state = "requested".into();
        assert!(upload_file(&receipt, "agent-one", "task-one").is_err());
        receipt.state = "finished".into();
        receipt.initiator = "human".into();
        assert!(upload_file(&receipt, "agent-one", "task-one").is_err());
    }

    #[test]
    fn rejects_unsupported_oversized_and_symlink_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("file.png");
        std::fs::write(&path, b"not an image").unwrap();
        assert!(fingerprint(&path).is_err());
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(MAX_FILE_BYTES + 1).unwrap();
        assert!(fingerprint(&path).is_err());
        #[cfg(unix)]
        {
            let link = dir.path().join("link.png");
            std::os::unix::fs::symlink(&path, &link).unwrap();
            assert!(fingerprint(&link).is_err());
        }
    }

    #[test]
    fn resume_preserves_only_completed_files_and_retires_old_authority() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("mockup.png");
        std::fs::write(&path, b"\x89PNG\r\n\x1a\nimage").unwrap();
        let mut downloads = vec![fixture(&path), fixture(&path), fixture(&path)];
        downloads[1].state = "requested".into();
        downloads[2].agent_id = Some("another-agent".into());
        resume_downloads(&mut downloads, "agent-one", "task-one", "resumed-task");
        assert!(upload_file(&downloads[0], "agent-one", "resumed-task").is_ok());
        assert!(upload_file(&downloads[0], "agent-one", "task-one").is_err());
        assert_eq!(downloads[1].task_id.as_deref(), Some("task-one"));
        assert_eq!(downloads[2].task_id.as_deref(), Some("task-one"));
    }
}
