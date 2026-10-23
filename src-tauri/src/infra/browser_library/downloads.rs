//! Commands on single downloads: progress, cancel, open, reveal and removal from the list.
use super::*;

pub(super) fn download_path(app: &AppHandle, id: &str) -> Result<(PathBuf, String), String> {
    let connection = library(app)?;
    connection
        .query_row(
            "SELECT path, state FROM downloads WHERE id = ?1",
            params![id],
            |row| {
                Ok((
                    PathBuf::from(row.get::<_, String>(0)?),
                    row.get::<_, String>(1)?,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "That download is no longer in the list.".to_owned())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserDownloadProgress {
    pub(super) id: String,
    pub(super) received: i64,
    pub(super) total: i64,
}

/// Bytes received so far for every download still in progress.
#[tauri::command]
pub async fn browser_downloads_progress(
    app: AppHandle,
) -> Result<Vec<BrowserDownloadProgress>, String> {
    let active = {
        let connection = library(&app)?;
        let mut statement = connection
            .prepare("SELECT id, path FROM downloads WHERE state = 'in_progress'")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|error| error.to_string())?
            .filter_map(Result::ok)
            .collect::<Vec<_>>();
        rows
    };
    if active.is_empty() {
        return Ok(Vec::new());
    }
    let progress = native_progress(&app, active).await?;
    if let Ok(connection) = library(&app) {
        for item in &progress {
            let _ = connection.execute(
                "UPDATE downloads SET received = ?2, total = ?3 WHERE id = ?1 AND state = 'in_progress'",
                params![item.id, item.received, item.total],
            );
        }
    }
    Ok(progress)
}

#[cfg(any(target_os = "macos", windows))]
pub(super) async fn native_progress(
    app: &AppHandle,
    active: Vec<(String, String)>,
) -> Result<Vec<BrowserDownloadProgress>, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let progress = active
            .into_iter()
            .map(|(id, path)| {
                let (received, total) = wry::download_progress(&path).unwrap_or_else(|| {
                    (
                        std::fs::metadata(&path)
                            .map(|meta| meta.len() as i64)
                            .unwrap_or(0),
                        -1,
                    )
                });
                BrowserDownloadProgress {
                    id,
                    received,
                    total,
                }
            })
            .collect::<Vec<_>>();
        let _ = sender.send(progress);
    })
    .map_err(|error| error.to_string())?;
    receiver
        .await
        .map_err(|_| "Download progress is unavailable.".to_owned())
}

#[cfg(not(any(target_os = "macos", windows)))]
pub(super) async fn native_progress(
    _app: &AppHandle,
    active: Vec<(String, String)>,
) -> Result<Vec<BrowserDownloadProgress>, String> {
    Ok(active
        .into_iter()
        .map(|(id, path)| BrowserDownloadProgress {
            id,
            received: std::fs::metadata(&path)
                .map(|meta| meta.len() as i64)
                .unwrap_or(0),
            total: -1,
        })
        .collect())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserDownloadIdRequest {
    pub id: String,
}

#[tauri::command]
pub async fn browser_download_cancel(
    app: AppHandle,
    request: BrowserDownloadIdRequest,
) -> Result<(), String> {
    let (path, state) = download_path(&app, &request.id)?;
    if state != "in_progress" {
        return Ok(());
    }
    library(&app)?
        .execute(
            "UPDATE downloads SET state = 'cancelled', finished_at = ?2 WHERE id = ?1",
            params![request.id, now_ms()],
        )
        .map_err(|error| error.to_string())?;
    #[cfg(any(target_os = "macos", windows))]
    {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let destination = path.to_string_lossy().into_owned();
        app.run_on_main_thread(move || {
            let _ = sender.send(wry::cancel_download(&destination));
        })
        .map_err(|error| error.to_string())?;
        let _ = receiver.await;
    }
    // The engine removes its partial file; clean up anything left behind.
    if path.is_file() {
        let _ = std::fs::remove_file(&path);
    }
    Ok(())
}

#[tauri::command]
pub fn browser_download_open(
    app: AppHandle,
    request: BrowserDownloadIdRequest,
) -> Result<(), String> {
    let (path, _) = download_path(&app, &request.id)?;
    if !path.is_file() {
        return Err("The file was moved or deleted.".to_owned());
    }
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn browser_download_reveal(
    app: AppHandle,
    request: BrowserDownloadIdRequest,
) -> Result<(), String> {
    let (path, _) = download_path(&app, &request.id)?;
    if !path.exists() {
        return Err("The file was moved or deleted.".to_owned());
    }
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|error| error.to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserDownloadsRemoveRequest {
    /// Specific entries, or every finished entry when empty.
    #[serde(default)]
    pub ids: Vec<String>,
    /// With no ids: only entries started at or after this time (ms).
    pub since: Option<i64>,
}

/// Removes entries from the list, here and in the window's Space. Files
/// already saved stay on disk.
#[tauri::command]
pub async fn browser_downloads_remove(
    webview: tauri::Webview,
    app: AppHandle,
    request: BrowserDownloadsRemoveRequest,
) -> Result<(), String> {
    remove_local(&app, &request)?;
    let space = crate::infra::browser_sync::window_space(webview.window().label());
    space::remove(space.as_deref(), &request.ids, request.since).await;
    Ok(())
}

pub(super) fn remove_local(app: &AppHandle, request: &BrowserDownloadsRemoveRequest) -> Result<(), String> {
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
