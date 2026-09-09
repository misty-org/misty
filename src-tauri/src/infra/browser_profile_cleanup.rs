use super::*;

/// The SDK host derives this identity from the caller; package code cannot select a store.
pub(super) async fn remove(app: AppHandle, profile_id: String) -> Result<(), String> {
    let identifier = browser_profile_identifier(Some(&profile_id))?;
    if browser_requires_ephemeral_store() { return Err("Website accounts require macOS 14 or later.".into()); }
    let ids = {
        let state = app.state::<BrowserSessionState>();
        let sessions = state.sessions.lock().map_err(|_| "Browser state is unavailable.")?;
        sessions.iter().filter(|(_, session)| session.profile_id.as_deref() == Some(&profile_id)).map(|(id, _)| id.clone()).collect::<Vec<_>>()
    };
    for id in ids { browser_webview_close(app.clone(), app.state::<BrowserSessionState>(), BrowserWebviewIdRequest { id })?; }
    super::super::browser_macos::remove_browser_data_store(&app, identifier).await?;
    let directory = browser_data_directory(&app, Some(&profile_id))?;
    std::fs::remove_dir_all(directory).map_err(|error| error.to_string())?;
    Ok(())
}
