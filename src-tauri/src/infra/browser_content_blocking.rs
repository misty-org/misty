//! Built-in ad and tracker blocking. The account setting is pushed here; Kiri
//! applies the filter in each engine (see `kiri::content_filter`).

use tauri::{AppHandle, Manager};

/// Turns blocking on or off and sets the sites it skips, starts building the
/// filter, then updates every open browser page. New pages pick the filter up
/// when they are created.
#[tauri::command]
pub fn browser_set_content_blocking(
    app: AppHandle,
    enabled: bool,
    allowed_sites: Vec<String>,
) -> Result<(), String> {
    if allowed_sites.len() > 1000 {
        return Err("Too many sites are excluded from blocking.".into());
    }
    if !kiri::content_filter::configure(enabled, allowed_sites) {
        return Ok(());
    }
    kiri::engine::prepare_content_filter(&app)?;
    for (label, webview) in app.webviews() {
        if label.starts_with("misty-browser-") {
            let _ = kiri::engine::install_content_filter(&webview);
        }
    }
    Ok(())
}
