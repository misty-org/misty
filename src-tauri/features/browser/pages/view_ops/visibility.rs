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
    #[cfg(windows)]
    if request.keep_live {
        park_windows_webview(&webview)?;
    } else {
        stack_windows_webview(&app, &webview)?;
    }
    #[cfg(not(windows))]
    {
        if request.keep_live {
            webview
                .set_position(tauri::LogicalPosition::new(-32_000.0, -32_000.0))
                .map_err(|error| error.to_string())?;
        } else {
            webview.hide().map_err(|error| error.to_string())?;
        }
    }
    refresh_browser_cursor_ownership(&webview)
}
