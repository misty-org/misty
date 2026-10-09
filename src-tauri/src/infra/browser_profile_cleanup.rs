use super::*;

/// The SDK host derives this identity from the caller; package code cannot select a store.
pub(super) async fn remove(app: AppHandle, profile_id: String) -> Result<(), String> {
    let identifier = browser_profile_identifier(Some(&profile_id))?;
    if browser_requires_ephemeral_store() {
        return Err("Website accounts require macOS 14 or later.".into());
    }
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
        browser_webview_close(
            app.clone(),
            app.state::<BrowserSessionState>(),
            BrowserWebviewIdRequest { id },
        )?;
    }
    #[cfg(target_os = "macos")]
    super::super::browser_macos::remove_browser_data_store(&app, identifier).await?;
    #[cfg(not(target_os = "macos"))]
    let _ = identifier;
    let directory = browser_data_directory(&app, Some(&profile_id))?;
    // A profile that never opened a page has no folder; that is already clean.
    match std::fs::remove_dir_all(directory) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.to_string()),
        _ => Ok(()),
    }
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
