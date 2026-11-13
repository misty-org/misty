//! Erasing a website data store no profile uses any more.
use crate::browser::*;
use file_access::fs;

/// Closes the store's pages and erases its data. The caller picks the store natively.
pub(in crate::browser) async fn remove(app: AppHandle, store: String) -> Result<(), String> {
    let identifier = data_store_identifier(Some(&store))?;
    let ids = {
        let state = app.state::<BrowserSessionState>();
        let sessions = state
            .sessions
            .lock()
            .map_err(|_| "Browser state is unavailable.")?;
        sessions
            .iter()
            .filter(|(_, session)| session.store_id.as_deref() == Some(&store))
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
    crate::browser::pages::macos::remove_browser_data_store(&app, identifier).await?;
    #[cfg(not(target_os = "macos"))]
    let _ = identifier;
    // The store's whole folder under `~/.misty/profiles`. On macOS its `webview` is a link
    // that is removed without following it (WebKit's own store was erased above).
    let home = file_access::paths::misty_home_dir().ok_or("Misty's data folder is unavailable.")?;
    let directory = crate::browser::site_data::profile_store::store_home(&home, Some(&store))?;
    let folder = directory.parent().ok_or("Invalid store folder.")?;
    remove_store_directory(folder).await
}

/// Deletes a store's folder. A store that never opened a page has no
/// folder; that is already clean. On Windows the WebView2 browser process can
/// hold the folder for a few seconds after its last page closes, so locked
/// files are retried until it exits.
async fn remove_store_directory(directory: &std::path::Path) -> Result<(), String> {
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
