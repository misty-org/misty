//! Commands for a page's context menu.

use super::*;

#[tauri::command]
pub fn browser_context_menu_select(
    app: AppHandle,
    webview: Webview,
    key: String,
    action: String,
) -> Result<(), String> {
    context_menu::select(&app, &webview, &key, &action)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserContextMenuAtRequest {
    pub id: String,
    /// Fractions of the page's width and height.
    pub x: f64,
    pub y: f64,
}

/// Replays a right-click that landed on the renderer while it covered a page.
#[tauri::command]
pub fn browser_webview_context_menu_at(
    caller: Webview,
    app: AppHandle,
    request: BrowserContextMenuAtRequest,
) -> Result<(), String> {
    if caller.label().starts_with("misty-browser-")
        || !request.x.is_finite()
        || !request.y.is_finite()
    {
        return Err("Browser menu is unavailable".into());
    }
    with_webview(&app, &request.id, |webview| {
        if webview.window().label() != caller.window().label() {
            return Err("Browser menu is unavailable".into());
        }
        context_menu::right_click(&webview, request.x, request.y)
    })
}
