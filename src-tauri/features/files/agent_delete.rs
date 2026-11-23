use super::person_window;

#[tauri::command]
pub fn files_agent_delete_status(
    app: tauri::AppHandle,
    webview: tauri::Webview,
) -> Result<bool, String> {
    person_window(&webview)?;
    Ok(permissions::agent_delete_on(&app))
}

#[tauri::command]
pub async fn files_agent_delete_allow(
    app: tauri::AppHandle,
    webview: tauri::Webview,
) -> Result<bool, String> {
    person_window(&webview)?;
    Ok(permissions::allow_agent_delete_async(&app).await)
}

#[tauri::command]
pub fn files_agent_delete_stop(
    app: tauri::AppHandle,
    webview: tauri::Webview,
) -> Result<(), String> {
    person_window(&webview)?;
    permissions::stop_agent_delete(&app);
    Ok(())
}
