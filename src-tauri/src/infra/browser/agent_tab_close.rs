//! Agent tabs: sleeping one, waiting for its first load and a small picture of its page.
use super::*;

/// Puts an agent's tab to sleep (docs/agents/browser.md, "Memory"): reads where its
/// page is, then closes the page through the one close path, so its page process goes too. The
/// tab wakes later from what this returns.
#[tauri::command]
pub async fn browser_webview_sleep(
    app: AppHandle,
    state: State<'_, BrowserSessionState>,
    request: BrowserWebviewIdRequest,
) -> Result<Value, String> {
    let Some(webview) = app.get_webview(&webview_label(&request.id)?) else {
        return Ok(json!({ "closed": false }));
    };
    let url = webview.url().map(|url| url.to_string()).unwrap_or_default();
    let title = page_title(&webview).await;
    close_browser_webview(app.clone(), state, request)?;
    Ok(json!({ "closed": true, "url": url, "title": title }))
}

/// Waits for a new agent tab's first page to load before the agent reads it
/// (browser_page/mod.rs, `first_load`). True once it loaded; false after the wait ran out.
#[tauri::command]
pub async fn browser_webview_await_load(
    app: AppHandle,
    request: BrowserWebviewIdRequest,
) -> Result<bool, String> {
    Ok(super::page_agent::first_load(&app, &request.id).await)
}

/// A small picture of an agent's page (docs/agents/browser.md): the PiP and the view
/// switcher show it instead of a second live page.
#[tauri::command]
pub async fn browser_webview_picture(
    app: AppHandle,
    request: BrowserWebviewIdRequest,
) -> Result<Value, String> {
    let webview = app
        .get_webview(&webview_label(&request.id)?)
        .ok_or_else(|| "Browser page is unavailable.".to_owned())?;
    #[cfg(target_os = "macos")]
    {
        let scale = webview
            .window()
            .scale_factor()
            .map_err(|error| error.to_string())?;
        let size = webview
            .size()
            .map_err(|error| error.to_string())?
            .to_logical::<f64>(scale);
        super::super::browser_macos::capture_webview_region_sized(
            webview,
            0.0,
            0.0,
            size.width,
            size.height,
            480.0,
        )
        .await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = webview;
        Err("Pictures of pages are not available here yet.".into())
    }
}
