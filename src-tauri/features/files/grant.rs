use super::{blocking, person_window};

#[tauri::command]
pub async fn files_grant_status(
    app: tauri::AppHandle,
    webview: tauri::Webview,
) -> Result<bool, String> {
    person_window(&webview)?;
    blocking(move || Ok(permissions::disk_granted(&app))).await
}

#[tauri::command]
pub async fn files_grant(app: tauri::AppHandle, webview: tauri::Webview) -> Result<bool, String> {
    person_window(&webview)?;
    let granted = permissions::ensure_disk_grant_async(&app).await;
    if granted {
        super::search::start_indexing(&app);
    }
    Ok(granted)
}
