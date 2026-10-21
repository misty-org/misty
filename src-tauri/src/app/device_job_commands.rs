//! Device job commands (docs/design/devices/BRIEF.md): signing this device's
//! requests and run grants natively, and checking a job's grant before acting.
#![cfg(desktop)]

use serde::Deserialize;
use serde_json::Value;
use tauri::State;

use crate::app::device_commands::{context, require_device_window};
use crate::app::runtime::MistyRuntime;
use crate::infra::{
    device_admission as admission, device_identity::canonical_request,
    device_records::SignedRecord, device_trust,
};

/// The largest file a `folder.send` job hands to the Space's Library, the
/// same limit as any upload from the app.
const MAX_SENT_FILE_BYTES: u64 = 128 * 1024 * 1024;

/// Signs one of this device's HTTP requests. The private key never leaves
/// native code; the domain prefix is added here, never by the caller.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn device_sign_request(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    api_base: String,
    account_id: String,
    method: String,
    path: String,
    timestamp: String,
    nonce: String,
    body_digest: String,
) -> Result<String, String> {
    require_device_window(&webview)?;
    if !path.starts_with('/')
        || path.contains(['?', '#'])
        || body_digest.len() != 64
        || nonce.len() > 200
        || timestamp.len() > 20
    {
        return Err("That request can't be signed.".into());
    }
    let context = context(&state, &api_base, &account_id).await?;
    Ok(context.identity.sign_request(&canonical_request(
        &method,
        &path,
        &timestamp,
        &nonce,
        &body_digest,
    )))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunGrantRequest {
    pub target_device_id: String,
    #[serde(default)]
    pub agent_id: String,
    pub capabilities: Vec<String>,
    pub scopes: Vec<String>,
}

/// Signs run grants for an agent chat, one per target device.
#[tauri::command]
pub async fn device_sign_run_grants(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    api_base: String,
    account_id: String,
    grants: Vec<RunGrantRequest>,
) -> Result<Vec<SignedRecord>, String> {
    require_device_window(&webview)?;
    sign_run_grants(&state, &api_base, &account_id, grants).await
}

/// One signing path for chats and for the debug-only eval bridge.
pub(crate) async fn sign_run_grants(
    state: &MistyRuntime,
    api_base: &str,
    account_id: &str,
    grants: Vec<RunGrantRequest>,
) -> Result<Vec<SignedRecord>, String> {
    if grants.len() > 16 {
        return Err("Too many devices in one request.".into());
    }
    let context = context(state, api_base, account_id).await?;
    grants
        .into_iter()
        .map(|grant| {
            admission::sign_run_grant(
                &context,
                &grant.target_device_id,
                &grant.agent_id,
                grant.capabilities,
                grant.scopes,
                6 * 3600,
            )
        })
        .collect()
}

/// Checks a device job's grant before this device acts on it.
#[tauri::command]
pub async fn device_verify_job(
    webview: tauri::Webview,
    operation: String,
    scope_id: String,
    config: Value,
) -> Result<(), String> {
    require_device_window(&webview)?;
    let grant: SignedRecord = serde_json::from_value(config["runGrant"].clone())
        .map_err(|_| "device_grant_invalid".to_owned())?;
    device_trust::verify_job_grant(&grant, &scope_id, &operation)
        .map(|_| ())
        .map_err(|_| "device_grant_invalid".to_owned())
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
    device_trust::verify_job_grant(&grant, &scope_id, "folder.send")
        .map_err(|_| "device_grant_invalid".to_owned())?;
    if input["scopeId"].as_str() != Some(scope_id.as_str()) {
        return Err("invalid_scope".into());
    }
    let relative = input["relativePath"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    let path = state
        .agents
        .scoped_document_path(crate::infra::agents::PrepareScopedAgentDocumentRequest {
            scope_id,
            relative_path: relative,
        })
        .await
        .map_err(|_| "invalid_scope".to_owned())?;
    let bytes = tokio::task::spawn_blocking(move || -> Result<Vec<u8>, String> {
        use std::io::Read;
        let file = std::fs::File::open(&path).map_err(|_| "file_unavailable".to_owned())?;
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
