//! Settings, launch on login and the default browser.
use tauri::State;

use crate::app::autostart::LaunchOnLoginSnapshot;
use crate::app::error::{ApiError, ApiResult};
use crate::app::runtime::MistyRuntime;
use crate::browser::default_browser::DefaultBrowserSnapshot;
use settings::{SaveSettingsRequest, SettingsSnapshot};

mod shortcuts;
pub(crate) use shortcuts::{
    __cmd__shortcuts_replace, __cmd__shortcuts_snapshot, __tauri_command_name_shortcuts_replace,
    __tauri_command_name_shortcuts_snapshot, shortcuts_replace, shortcuts_snapshot,
};

#[tauri::command]
pub async fn settings_snapshot(state: State<'_, MistyRuntime>) -> ApiResult<SettingsSnapshot> {
    Ok(state.settings.snapshot().await?)
}

#[tauri::command]
pub async fn settings_save(
    request: SaveSettingsRequest,
    state: State<'_, MistyRuntime>,
) -> ApiResult<SettingsSnapshot> {
    let saved = state.settings.save(request).await;
    // Model choices are settings; the next account request rebuilds its header.
    crate::agents::models::invalidate();
    Ok(saved?)
}

#[tauri::command]
pub fn settings_launch_on_login_snapshot() -> ApiResult<LaunchOnLoginSnapshot> {
    Ok(crate::app::autostart::snapshot())
}

#[tauri::command]
pub fn settings_apply_launch_on_login(enabled: bool) -> ApiResult<LaunchOnLoginSnapshot> {
    crate::app::autostart::apply(enabled).map_err(ApiError::Message)
}

#[tauri::command]
pub fn settings_default_browser_snapshot() -> ApiResult<DefaultBrowserSnapshot> {
    Ok(crate::browser::default_browser::snapshot())
}

#[tauri::command]
pub fn settings_request_default_browser() -> ApiResult<DefaultBrowserSnapshot> {
    Ok(crate::browser::default_browser::request())
}

#[tauri::command]
pub async fn settings_session_state(
    webview: tauri::Webview,
    scope: String,
    state: State<'_, MistyRuntime>,
) -> ApiResult<settings::profile_store::ProfileStateSnapshot> {
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Err(ApiError::Unavailable(
            "Only the trusted Misty shell can read settings.".into(),
        ));
    }
    Ok(state.settings.profile_state(scope, None).await?)
}

#[tauri::command]
pub async fn settings_session_commit(
    webview: tauri::Webview,
    scope: String,
    revision: i64,
    document: serde_json::Value,
    state: State<'_, MistyRuntime>,
) -> ApiResult<settings::profile_store::ProfileStateSnapshot> {
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Err(ApiError::Unavailable(
            "Only the trusted Misty shell can save settings.".into(),
        ));
    }
    Ok(state
        .settings
        .profile_state(scope, Some((revision, document)))
        .await?)
}
