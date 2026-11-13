//! Device job commands: signing run grants natively, and checking a job's grant before acting.
#![cfg(desktop)]

use file_access::fs;
use serde::Deserialize;
use serde_json::Value;
use tauri::State;

use crate::app::runtime::MistyRuntime;
use crate::devices::agent_grants::{self, GrantRequest};
use crate::devices::agent_jobs;
use crate::devices::commands::{local_device_id, require_device_window};
use crate::devices::records::SignedRecord;

/// The largest file a `folder.send` job hands to the Space's Library, the
/// same limit as any upload from the app.
const MAX_SENT_FILE_BYTES: u64 = 128 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunGrantRequest {
    #[serde(default)]
    pub agent_id: String,
    /// The chat or scheduled run. A grant with no chat can't run commands.
    #[serde(default)]
    pub chat_key: String,
    pub capabilities: Vec<String>,
    pub scopes: Vec<String>,
}

/// Signs run grants for an agent chat. They need no account: an agent works on this computer.
#[tauri::command]
pub async fn device_sign_run_grants(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    grants: Vec<RunGrantRequest>,
) -> Result<Vec<SignedRecord>, String> {
    require_device_window(&webview)?;
    sign_run_grants(&state, grants).await
}

/// One signing path for chats and for the debug-only eval bridge.
pub(crate) async fn sign_run_grants(
    state: &MistyRuntime,
    grants: Vec<RunGrantRequest>,
) -> Result<Vec<SignedRecord>, String> {
    if grants.len() > 16 {
        return Err("Too many devices in one request.".into());
    }
    let device = local_device_id(state).await?;
    grants
        .into_iter()
        .map(|grant| {
            agent_grants::sign(
                &device,
                GrantRequest {
                    agent_id: grant.agent_id,
                    chat_key: grant.chat_key,
                    capabilities: grant.capabilities,
                    scopes: grant.scopes,
                },
            )
        })
        .collect()
}

/// Checks a device job's grant before this device acts on it.
#[tauri::command]
pub async fn device_verify_job(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    operation: String,
    scope_id: String,
    config: Value,
) -> Result<(), String> {
    require_device_window(&webview)?;
    if !agent_jobs::is_agent_job(&operation) {
        return Err("device_job_not_allowed".to_owned());
    }
    let grant: SignedRecord = serde_json::from_value(config["runGrant"].clone())
        .map_err(|_| "device_grant_invalid".to_owned())?;
    let device = local_device_id(&state)
        .await
        .map_err(|_| "device_grant_invalid".to_owned())?;
    agent_grants::verify(&device, &grant, &scope_id, &operation).map(|_| ())
}

/// Reads the file a `folder.send` job names: checks its grant and resolves the
/// file inside the shared folder. The app then saves it to the conversation's
/// Space Library, where the person's other devices open it.
#[tauri::command]
pub async fn device_read_shared_file(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    scope_id: String,
    input: Value,
    config: Value,
) -> Result<tauri::ipc::Response, String> {
    require_device_window(&webview)?;
    let grant: SignedRecord = serde_json::from_value(config["runGrant"].clone())
        .map_err(|_| "device_grant_invalid".to_owned())?;
    let device = local_device_id(&state)
        .await
        .map_err(|_| "device_grant_invalid".to_owned())?;
    agent_grants::verify(&device, &grant, &scope_id, "folder.send")?;
    if input["scopeId"].as_str() != Some(scope_id.as_str()) {
        return Err("invalid_scope".into());
    }
    let relative = input["relativePath"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    let path = state
        .agents
        .scoped_document_path(crate::agents::PrepareScopedAgentDocumentRequest {
            scope_id,
            relative_path: relative,
        })
        .await
        .map_err(|_| "invalid_scope".to_owned())?;
    let bytes = tokio::task::spawn_blocking(move || -> Result<Vec<u8>, String> {
        use std::io::Read;
        let file = fs::File::open(&path).map_err(|_| "file_unavailable".to_owned())?;
        let metadata = file.metadata().map_err(|_| "file_unavailable".to_owned())?;
        if !metadata.is_file() {
            return Err("not_a_file".into());
        }
        if metadata.len() > MAX_SENT_FILE_BYTES {
            return Err("file_too_large".into());
        }
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        file.take(MAX_SENT_FILE_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "file_unavailable".to_owned())?;
        if bytes.len() as u64 > MAX_SENT_FILE_BYTES {
            return Err("file_too_large".into());
        }
        Ok(bytes)
    })
    .await
    .map_err(|error| error.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}
