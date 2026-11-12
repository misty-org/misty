//! Reloading, showing and hiding a page.
use super::*;

#[tauri::command]
pub async fn browser_webview_reload(
    app: AppHandle,
    request: BrowserWebviewIdRequest,
) -> Result<(), String> {
    with_webview(&app, &request.id, |webview| {
        reload_browser_webview(&webview)
    })
}

#[tauri::command]
pub fn browser_webview_show(
    app: AppHandle,
    request: BrowserWebviewIdRequest,
) -> Result<(), String> {
    with_webview(&app, &request.id, |webview| present_macos_webview(&webview))
}

#[tauri::command]
pub fn browser_webview_hide(
    app: AppHandle,
    request: BrowserWebviewHideRequest,
) -> Result<(), String> {
    let Some(webview) = app.get_webview(&webview_label(&request.id)?) else {
        return Ok(());
    };
    // Switching tabs on Windows keeps the page in place beneath the renderer
    // (see `stacked_pages`). WebView2 drops its render surface when hidden and
    // paints its default color until the first new frame, and a page moved
    // offscreen redraws when it comes back; either one flashes.
    #[cfg(windows)]
    if request.keep_live {
        park_windows_webview(&webview)?;
    } else {
        stack_windows_webview(&app, &webview)?;
    }
    #[cfg(not(windows))]
    {
        if request.keep_live {
            // A hidden view has no window for the system to return a floating video to. Out of
            // sight, but still in the window, it keeps one. Reconciling its bounds brings it back.
            webview
                .set_position(tauri::LogicalPosition::new(-32_000.0, -32_000.0))
                .map_err(|error| error.to_string())?;
        } else {
            webview.hide().map_err(|error| error.to_string())?;
        }
    }
    refresh_browser_cursor_ownership(&webview)
}
