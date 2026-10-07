//! Device job commands (docs/design/devices/BRIEF.md): signing this device's
//! requests and run grants natively, and checking a job's grant before acting.
#![cfg(desktop)]

use serde::Deserialize;
use serde_json::Value;
use tauri::State;

use crate::app::device_commands::{context, require_device_window};
use crate::app::runtime::MistyRuntime;
use crate::infra::{
    connected_devices::DeliveryReceipt, device_admission as admission,
    device_identity::canonical_request, device_records::SignedRecord, device_trust,
};

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
    if grants.len() > 16 {
        return Err("Too many devices in one request.".into());
    }
    let context = context(&state, &api_base, &account_id).await?;
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

fn surface_for(operation: &str, scope_id: &str) -> &'static str {
    if scope_id.starts_with("inbox:") {
        "inbox"
    } else if operation.starts_with("files.") || operation == "read_content" {
        "folders"
    } else if operation.starts_with("terminal.") {
        "terminal"
    } else {
        "browser"
    }
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
    device_trust::verify_job_grant(
        &grant,
        &scope_id,
        &operation,
        surface_for(&operation, &scope_id),
    )
    .map(|_| ())
    .map_err(|_| "device_grant_invalid".to_owned())
}

/// Runs a `files.send` job: checks its grant, resolves the file inside the
/// shared folder, and delivers it to the destination device over the LAN.
#[tauri::command]
pub async fn device_send_file(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    scope_id: String,
    input: Value,
    config: Value,
) -> Result<DeliveryReceipt, String> {
    require_device_window(&webview)?;
    let grant: SignedRecord = serde_json::from_value(config["runGrant"].clone())
        .map_err(|_| "device_grant_invalid".to_owned())?;
    device_trust::verify_job_grant(&grant, &scope_id, "files.send", "folders")
        .map_err(|_| "device_grant_invalid".to_owned())?;
    let relative = input["relativePath"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    let destination = input["destinationDeviceId"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    let inbox = input["destinationScopeId"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    if input["scopeId"].as_str() != Some(scope_id.as_str())
        || inbox != format!("inbox:{destination}")
    {
        return Err("invalid_scope".into());
    }
    let receive_grant: SignedRecord = serde_json::from_value(input["receiveGrant"].clone())
        .map_err(|_| "device_grant_invalid".to_owned())?;
    let path = state
        .agents
        .scoped_document_path(crate::infra::agents::PrepareScopedAgentDocumentRequest {
            scope_id: scope_id.clone(),
            relative_path: relative,
        })
        .await
        .map_err(|_| "invalid_scope".to_owned())?;
    state
        .connected_devices
        .deliver_file(&destination, &path, receive_grant, &inbox)
        .await
        .map_err(|error| error.to_string())
}
