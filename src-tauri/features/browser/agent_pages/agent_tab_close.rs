//! Agent tabs: sleeping one, waiting for its first load and a small picture of its page.
use crate::browser::*;

/// Puts an agent's tab to sleep: reads where its
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

#[derive(serde::Deserialize)]
pub struct BrowserWebviewPictureRequest {
    id: String,
    /// How wide to make it, for a reader who needs the page's words. Small otherwise.
    #[serde(default)]
    width: Option<f64>,
}

const PICTURE_WIDTH: f64 = 480.0;
const LARGEST_PICTURE_WIDTH: f64 = 1280.0;

/// A picture of a page. Small for an agent's tab, which the PiP and the view
/// switcher show instead of a second live page; live subtitles ask for one they can read.
#[tauri::command]
pub async fn browser_webview_picture(
    app: AppHandle,
    request: BrowserWebviewPictureRequest,
) -> Result<Value, String> {
    let width = request
        .width
        .filter(|width| width.is_finite())
        .map_or(PICTURE_WIDTH, |width| {
            width.clamp(PICTURE_WIDTH, LARGEST_PICTURE_WIDTH)
        });
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
        crate::browser::pages::macos::capture_webview_region_sized(
            webview,
            0.0,
            0.0,
            size.width,
            size.height,
            width,
        )
        .await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (webview, width);
        Err("Pictures of pages are not available here yet.".into())
    }
}
