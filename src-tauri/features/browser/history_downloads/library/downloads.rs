//! Removing downloads from the list this computer keeps.
use super::*;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserDownloadsRemoveRequest {
    /// Specific entries, or every finished entry when empty.
    #[serde(default)]
    pub ids: Vec<String>,
    /// With no ids: only entries started at or after this time (ms).
    pub since: Option<i64>,
}

/// Removes entries from the list, here and in the window's profile. Files
/// already saved stay on disk.
#[tauri::command]
pub async fn browser_downloads_remove(
    webview: tauri::Webview,
    app: AppHandle,
    request: BrowserDownloadsRemoveRequest,
) -> Result<(), String> {
    remove_local(&app, &request)?;
    profile::remove(webview.window().label(), &request.ids, request.since).await;
    Ok(())
}

pub(super) fn remove_local(
    app: &AppHandle,
    request: &BrowserDownloadsRemoveRequest,
) -> Result<(), String> {
    let connection = library(app)?;
    if request.ids.is_empty() {
        connection
            .execute(
                "DELETE FROM downloads WHERE state != 'in_progress' AND started_at >= ?1",
                params![request.since.unwrap_or(0)],
            )
            .map_err(|error| error.to_string())?;
    } else {
        for id in &request.ids {
            connection
                .execute(
                    "DELETE FROM downloads WHERE id = ?1 AND state != 'in_progress'",
                    params![id],
                )
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}
