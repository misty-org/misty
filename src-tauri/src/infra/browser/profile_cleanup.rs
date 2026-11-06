//! Erasing a profile's website data store once the profile is deleted.
use super::*;
use crate::infra::file_access::fs;

/// Closes the store's pages and erases its data. The caller picks the store natively.
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
    let home =
        super::super::paths::misty_home_dir().ok_or("Misty's data folder is unavailable.")?;
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
        match fs::remove_dir_all(directory) {
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

/// Erases a deleted profile's website data. Its windows are already closed; WebKit holds a
/// store briefly after its last view goes, so this runs a moment later.
pub(crate) async fn remove_profile_data(
    app: AppHandle,
    key: String,
    store: String,
) -> Result<(), String> {
    tokio::time::sleep(Duration::from_secs(3)).await;
    if !crate::infra::profile_windows::windows_for_profile(&app, &key).is_empty() {
        return Err("The profile was opened again before its data could be removed.".into());
    }
    remove(app, store).await
}
