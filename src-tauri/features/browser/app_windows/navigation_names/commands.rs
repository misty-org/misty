//! Names the person gave navigation items.
use tauri::State;

use crate::app::runtime::MistyRuntime;

#[tauri::command]
pub async fn navigation_names_snapshot(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
) -> Result<crate::browser::app_windows::navigation_names::NavigationSnapshot, String> {
    if !crate::browser::app_windows::is_person_window(webview.label()) {
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
) -> Result<crate::browser::app_windows::navigation_names::NavigationSnapshot, String> {
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Err("Only the trusted Misty shell can rename navigation.".into());
    }
    state.navigation_names.update(account, key, name).await
}
