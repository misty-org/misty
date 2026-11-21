//! The disk grant's two commands. Asking is a native prompt (`permissions::ensure_disk_grant`), so
//! a window can only ask, never answer.
use super::person_window;

/// Whether Files may open the whole disk, without asking.
#[tauri::command]
pub fn files_grant_status(app: tauri::AppHandle, webview: tauri::Webview) -> Result<bool, String> {
    person_window(&webview)?;
    Ok(permissions::disk_granted(&app))
}

/// Asks for the disk grant in a native prompt when it is off; true once it is on. A no leaves
/// Files on what Misty can already reach (linked folders, the Space drives).
#[tauri::command]
pub async fn files_grant(app: tauri::AppHandle, webview: tauri::Webview) -> Result<bool, String> {
    person_window(&webview)?;
    let granted = permissions::ensure_disk_grant_async(&app).await;
    if granted {
        super::search::start_indexing(&app);
    }
    Ok(granted)
}
