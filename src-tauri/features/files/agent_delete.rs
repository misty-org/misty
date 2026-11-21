//! "Let agents delete files": off unless the person turns it on through the native warning
//! (`permissions::allow_agent_delete`). A window can turn it off, never on by itself. While it is
//! off, no agent is offered `files.delete`, and `tool_policy.rs` refuses any delete-like tool.
use super::person_window;

#[tauri::command]
pub fn files_agent_delete_status(
    app: tauri::AppHandle,
    webview: tauri::Webview,
) -> Result<bool, String> {
    person_window(&webview)?;
    Ok(permissions::agent_delete_on(&app))
}

/// Shows the warning; true only if the person chose "Let agents delete".
#[tauri::command]
pub async fn files_agent_delete_allow(
    app: tauri::AppHandle,
    webview: tauri::Webview,
) -> Result<bool, String> {
    person_window(&webview)?;
    Ok(permissions::allow_agent_delete_async(&app).await)
}

#[tauri::command]
pub fn files_agent_delete_stop(app: tauri::AppHandle, webview: tauri::Webview) -> Result<(), String> {
    person_window(&webview)?;
    permissions::stop_agent_delete(&app);
    Ok(())
}
