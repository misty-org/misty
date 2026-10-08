use super::*;

/// The SDK host derives this identity from the caller; package code cannot select a store.
pub(super) async fn remove(app: AppHandle, profile_id: String) -> Result<(), String> {
    let identifier = browser_profile_identifier(Some(&profile_id))?;
    let ids = {
        let state = app.state::<BrowserSessionState>();
        let sessions = state
            .sessions
            .lock()
            .map_err(|_| "Browser state is unavailable.")?;
        sessions
            .iter()
            .filter(|(_, session)| session.profile_id.as_deref() == Some(&profile_id))
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>()
    };
    for id in ids {
        close_browser_webview(
            app.clone(),
            app.state::<BrowserSessionState>(),
            BrowserWebviewIdRequest { id },
        )?;
    }
    #[cfg(target_os = "macos")]
    super::super::browser_macos::remove_browser_data_store(&app, identifier).await?;
    #[cfg(not(target_os = "macos"))]
    let _ = identifier;
    // The profile's whole folder under `~/.misty/profiles`. On macOS its `webview` is a link
    // that is removed without following it (WebKit's own store was erased above).
    let home = super::super::paths::misty_home_dir().ok_or("Misty's data folder is unavailable.")?;
    let directory = super::super::browser_profile::webview_home(&home, Some(&profile_id))?;
    let profile_folder = directory.parent().ok_or("Invalid profile folder.")?;
    remove_profile_directory(profile_folder).await
}

/// Deletes a profile's folder. A profile that never opened a page has no
/// folder; that is already clean. On Windows the WebView2 browser process can
/// hold the folder for a few seconds after its last page closes, so locked
/// files are retried until it exits.
async fn remove_profile_directory(directory: &std::path::Path) -> Result<(), String> {
    const ATTEMPTS: u32 = if cfg!(windows) { 20 } else { 1 };
    let mut attempt = 0;
    loop {
        attempt += 1;
        match std::fs::remove_dir_all(directory) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) if attempt < ATTEMPTS && is_locked(&error) => {
                tokio::time::sleep(Duration::from_millis(250 * u64::from(attempt.min(4)))).await;
            }
            Err(error) if is_locked(&error) => {
                return Err(
                    "Some of this profile's website data is still in use. Try again in a moment."
                        .to_owned(),
                )
            }
            Err(error) => return Err(error.to_string()),
            Ok(()) => return Ok(()),
        }
    }
}

/// Whether a delete failed because another process still has a file open.
fn is_locked(error: &std::io::Error) -> bool {
    // ERROR_ACCESS_DENIED, ERROR_SHARING_VIOLATION, ERROR_LOCK_VIOLATION, ERROR_DIR_NOT_EMPTY
    cfg!(windows) && matches!(error.raw_os_error(), Some(5 | 32 | 33 | 145))
}

/// Erases a deleted device profile's website data. The default account profile
/// is never a device profile, so it cannot be removed this way.
#[tauri::command]
pub async fn browser_device_profile_delete(
    webview: Webview,
    app: AppHandle,
    profile_id: String,
) -> Result<(), String> {
    if webview.label() != "main" {
        return Err("Only Misty's trusted shell can remove browser profiles.".into());
    }
    if super::super::browser_sync::is_account_browser_profile(&profile_id).await {
        return Err("The account's own browser profile can't be removed.".into());
    }
    remove(app, profile_id).await
}
