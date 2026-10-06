//! Device admission, approval, removal, names and policy commands
//! (docs/design/devices/BRIEF.md). Each runs only in the main window.
#![cfg(desktop)]

use tauri::{AppHandle, State};

use crate::app::device_commands::{context, require_main, shared_folders, view, DevicesView};
use crate::app::runtime::MistyRuntime;
use crate::infra::{
    device_admission as admission, device_approval, device_approval::AdmissionView,
    device_approval_approver as approver, device_approval_approver::PendingRequestView,
    device_channel, device_records::DevicePolicy, device_trust,
};

#[tauri::command]
pub async fn devices_admit_self(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    api_base: String,
    account_id: String,
) -> Result<DevicesView, String> {
    require_main(&webview)?;
    let context = context(&state, &api_base, &account_id).await?;
    admission::admit_self(&context).await?;
    Ok(view(&state, &account_id).await)
}

#[tauri::command]
pub async fn devices_request_approval(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    api_base: String,
    account_id: String,
) -> Result<AdmissionView, String> {
    require_main(&webview)?;
    let context = context(&state, &api_base, &account_id).await?;
    device_approval::start_request(&context).await
}

#[tauri::command]
pub async fn devices_approval_status(
    webview: tauri::Webview,
    app: AppHandle,
    state: State<'_, MistyRuntime>,
    api_base: String,
    account_id: String,
    request_id: String,
) -> Result<AdmissionView, String> {
    require_main(&webview)?;
    let context = context(&state, &api_base, &account_id).await?;
    device_approval::poll_request(&context, app, &api_base, &request_id).await
}

#[tauri::command]
pub async fn devices_pending_requests(
    state: State<'_, MistyRuntime>,
    api_base: String,
    account_id: String,
) -> Result<Vec<PendingRequestView>, String> {
    let context = context(&state, &api_base, &account_id).await?;
    approver::list_requests(&context).await
}

#[tauri::command]
pub async fn devices_approve_start(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    api_base: String,
    account_id: String,
    request_id: String,
) -> Result<AdmissionView, String> {
    require_main(&webview)?;
    let context = context(&state, &api_base, &account_id).await?;
    approver::challenge(&context, &request_id).await
}

#[tauri::command]
pub async fn devices_approve_status(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    api_base: String,
    account_id: String,
    request_id: String,
) -> Result<AdmissionView, String> {
    require_main(&webview)?;
    let context = context(&state, &api_base, &account_id).await?;
    approver::approver_poll(&context, &request_id).await
}

#[tauri::command]
pub async fn devices_approve_confirm(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    api_base: String,
    account_id: String,
    request_id: String,
) -> Result<(), String> {
    require_main(&webview)?;
    let context = context(&state, &api_base, &account_id).await?;
    approver::approve(&context, &request_id).await
}

#[tauri::command]
pub async fn devices_deny(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    api_base: String,
    account_id: String,
    request_id: String,
) -> Result<(), String> {
    require_main(&webview)?;
    let context = context(&state, &api_base, &account_id).await?;
    approver::deny(&context, &request_id).await
}

#[tauri::command]
pub async fn devices_remove(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    api_base: String,
    account_id: String,
    device_id: String,
) -> Result<DevicesView, String> {
    require_main(&webview)?;
    let context = context(&state, &api_base, &account_id).await?;
    admission::remove(&context, &device_id).await?;
    state.connected_devices.close_untrusted();
    Ok(view(&state, &account_id).await)
}

#[tauri::command]
pub async fn devices_rename(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    api_base: String,
    account_id: String,
    device_id: String,
    name: String,
) -> Result<(), String> {
    require_main(&webview)?;
    let name = name.trim().to_owned();
    if name.is_empty() || name.chars().count() > 64 || name.chars().any(char::is_control) {
        return Err("Use a name of 1 to 64 characters.".into());
    }
    let context = context(&state, &api_base, &account_id).await?;
    admission::rename(&context, &device_id, &name).await
}

#[tauri::command]
pub async fn devices_set_policy(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    api_base: String,
    account_id: String,
    files: String,
    clipboard: bool,
    agent_surfaces: Vec<String>,
) -> Result<DevicePolicy, String> {
    require_main(&webview)?;
    let context = context(&state, &api_base, &account_id).await?;
    let folders = shared_folders(&state).await;
    admission::publish_policy(&context, &files, clipboard, agent_surfaces, folders).await
}

/// Re-publishes the policy after shared folders change, keeping its settings.
#[tauri::command]
pub async fn devices_publish_folders(
    state: State<'_, MistyRuntime>,
    api_base: String,
    account_id: String,
) -> Result<(), String> {
    let context = context(&state, &api_base, &account_id).await?;
    let current = device_trust::effective_policy();
    let folders = shared_folders(&state).await;
    if device_trust::own_policy().is_some_and(|(policy, _)| policy.shared_folders == folders) {
        return Ok(());
    }
    admission::publish_policy(
        &context,
        &current.files,
        current.clipboard,
        current.agent_surfaces,
        folders,
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn devices_connect(
    state: State<'_, MistyRuntime>,
    device_id: String,
) -> Result<bool, String> {
    if state
        .connected_devices
        .connected_device_ids()
        .contains(&device_id)
    {
        return Ok(true);
    }
    let endpoint = device_trust::current_list().and_then(|list| {
        list.admitted_key(&device_id)
            .and_then(crate::infra::device_records::endpoint_of)
    });
    let cached = device_trust::known_addresses(&device_id);
    if let (Some(endpoint), false) = (endpoint, cached.is_empty()) {
        if state
            .connected_devices
            .connect_device(&device_id, &endpoint, cached)
            .await
            .is_ok()
        {
            return Ok(true);
        }
    }
    Ok(device_channel::request_connect(&device_id))
}
