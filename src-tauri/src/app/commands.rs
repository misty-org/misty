use serde::Serialize;
use tauri::State;

use crate::app::runtime::MistyRuntime;
use crate::domain::explorer::{DirectoryListing, ListDirectoryRequest};
use crate::error::{ApiError, ApiResult};
use crate::infra::agents::PrepareScopedAgentDocumentRequest;
use crate::infra::autostart::LaunchOnLoginSnapshot;
use crate::infra::default_browser::DefaultBrowserSnapshot;
use crate::infra::documents::PreparedAgentDocument;
use crate::infra::drives::DeviceSnapshot;
use crate::infra::environment::AppEnvironmentSnapshot;
use crate::infra::settings::{SaveSettingsRequest, SettingsSnapshot};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    app_name: &'static str,
    version: &'static str,
    migration_stage: &'static str,
    environment: AppEnvironmentSnapshot,
}

#[tauri::command]
pub async fn app_snapshot(state: State<'_, MistyRuntime>) -> ApiResult<AppSnapshot> {
    Ok(AppSnapshot {
        app_name: "Misty",
        version: env!("CARGO_PKG_VERSION"),
        migration_stage: "desktop",
        environment: state.environment.snapshot(),
    })
}

#[tauri::command]
pub async fn agents_device_snapshot(
    state: State<'_, MistyRuntime>,
) -> ApiResult<serde_json::Value> {
    state.agents.device_snapshot().await
}

#[tauri::command]
pub async fn agents_list_scoped_files(
    webview: tauri::Webview,
    request: crate::infra::agents::ListScopedFilesRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<serde_json::Value> {
    if !crate::infra::space_windows::is_space_window(webview.label()) {
        return Err(crate::error::ApiError::Message(
            "Only the Host can process approved device scopes.".into(),
        ));
    }
    state.agents.list_scoped_files(request).await
}

/// The document is parsed in the bundled worker, confined by the operating
/// system; the shared folder's file is copied in, never opened in place.
#[cfg(any(windows, target_os = "macos"))]
#[tauri::command]
pub async fn agents_prepare_scoped_document(
    webview: tauri::Webview,
    request: PrepareScopedAgentDocumentRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<PreparedAgentDocument> {
    if !crate::infra::space_windows::is_space_window(webview.label()) {
        return Err(crate::error::ApiError::Message(
            "Only the Host can process approved device scopes.".into(),
        ));
    }
    let target = state.agents.scoped_document_path(request).await?;
    crate::infra::documents::prepare_document(target).await
}

#[tauri::command]
pub async fn explorer_list_directory(
    request: ListDirectoryRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<DirectoryListing> {
    state.explorer.list_directory(request).await
}

#[tauri::command]
pub async fn settings_snapshot(state: State<'_, MistyRuntime>) -> ApiResult<SettingsSnapshot> {
    state.settings.snapshot().await
}

#[tauri::command]
pub async fn settings_save(
    request: SaveSettingsRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<SettingsSnapshot> {
    state.settings.save(request).await
}

#[tauri::command]
pub fn settings_launch_on_login_snapshot() -> ApiResult<LaunchOnLoginSnapshot> {
    Ok(crate::infra::autostart::snapshot())
}

#[tauri::command]
pub fn settings_apply_launch_on_login(enabled: bool) -> ApiResult<LaunchOnLoginSnapshot> {
    crate::infra::autostart::apply(enabled).map_err(ApiError::Message)
}

#[tauri::command]
pub fn settings_default_browser_snapshot() -> ApiResult<DefaultBrowserSnapshot> {
    Ok(crate::infra::default_browser::snapshot())
}

#[tauri::command]
pub fn settings_request_default_browser() -> ApiResult<DefaultBrowserSnapshot> {
    Ok(crate::infra::default_browser::request())
}

#[tauri::command]
pub async fn devices_snapshot(state: State<'_, MistyRuntime>) -> ApiResult<DeviceSnapshot> {
    let devices = state.devices.clone();
    tokio::task::spawn_blocking(move || devices.snapshot())
        .await
        .map_err(|err| ApiError::Message(format!("Device scan failed: {err}")))
}

#[tauri::command]
pub async fn navigation_names_snapshot(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
) -> Result<crate::infra::navigation_names::NavigationSnapshot, String> {
    if !crate::infra::space_windows::is_space_window(webview.label()) {
        return Err("Only the trusted Misty shell can read navigation names.".into());
    }
    Ok(state.navigation_names.snapshot(&account).await)
}
#[tauri::command]
pub async fn navigation_names_update(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    key: String,
    name: Option<String>,
) -> Result<crate::infra::navigation_names::NavigationSnapshot, String> {
    if !crate::infra::space_windows::is_space_window(webview.label()) {
        return Err("Only the trusted Misty shell can rename navigation.".into());
    }
    state.navigation_names.update(account, key, name).await
}

/// Agent chats kept on this device (docs/design/agent-browser/BRIEF.md, local chats).
#[tauri::command]
pub async fn agent_chats_list(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    kind: String,
) -> Result<Vec<String>, String> {
    if !crate::infra::space_windows::is_space_window(webview.label()) {
        return Err("Only the trusted Misty shell can read agent chats.".into());
    }
    state.agent_chats.list(account, kind).await
}

#[tauri::command]
pub async fn agent_chats_put(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    kind: String,
    id: String,
    document: String,
) -> Result<(), String> {
    if !crate::infra::space_windows::is_space_window(webview.label()) {
        return Err("Only the trusted Misty shell can save agent chats.".into());
    }
    state.agent_chats.put(account, kind, id, document).await
}

#[tauri::command]
pub async fn agent_chats_delete(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    kind: String,
    id: String,
) -> Result<(), String> {
    if !crate::infra::space_windows::is_space_window(webview.label()) {
        return Err("Only the trusted Misty shell can delete agent chats.".into());
    }
    state.agent_chats.delete(account, kind, id).await
}

#[tauri::command]
pub async fn settings_profile_state(
    webview: tauri::Webview,
    scope: String,
    state: State<'_, MistyRuntime>,
) -> ApiResult<crate::infra::settings::profile_store::ProfileStateSnapshot> {
    if !crate::infra::space_windows::is_space_window(webview.label()) {
        return Err(ApiError::Unavailable(
            "Only the trusted Misty shell can read settings profiles.".into(),
        ));
    }
    state.settings.profile_state(scope, None).await
}

#[tauri::command]
pub async fn settings_profile_commit(
    webview: tauri::Webview,
    scope: String,
    revision: i64,
    document: serde_json::Value,
    state: State<'_, MistyRuntime>,
) -> ApiResult<crate::infra::settings::profile_store::ProfileStateSnapshot> {
    if !crate::infra::space_windows::is_space_window(webview.label()) {
        return Err(ApiError::Unavailable(
            "Only the trusted Misty shell can save settings profiles.".into(),
        ));
    }
    state
        .settings
        .profile_state(scope, Some((revision, document)))
        .await
}
