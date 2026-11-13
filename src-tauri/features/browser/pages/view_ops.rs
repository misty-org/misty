//! Per-page commands: bounds, navigation, zoom, overlay, companion and hide.

use crate::browser::*;

mod visibility;
pub use visibility::*;

#[tauri::command]
pub fn browser_webview_set_bounds(
    app: AppHandle,
    request: BrowserWebviewBoundsRequest,
) -> Result<(), String> {
    let webview = app
        .get_webview(&webview_label(&request.id)?)
        .ok_or_else(|| "Browser tab is not running.".to_owned())?;
    let (position, size) = logical_bounds(request.x, request.y, request.width, request.height);
    configure_browser_webview(&webview, request.native_live_resize)?;
    set_webview_bounds_if_changed(&app, &webview, position, size)
}

/// `#rrggbb` as its channels.
#[cfg(windows)]
fn hex_color(value: &str) -> Option<[u8; 3]> {
    let hex = value.strip_prefix('#')?;
    if hex.len() != 6 || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    let channel = |start: usize| u8::from_str_radix(&hex[start..start + 2], 16).ok();
    Some([channel(0)?, channel(2)?, channel(4)?])
}

#[tauri::command]
pub fn browser_webview_reconcile(
    app: AppHandle,
    request: BrowserWebviewBoundsRequest,
) -> Result<bool, String> {
    let Some(webview) = app.get_webview(&webview_label(&request.id)?) else {
        return Ok(false);
    };
    let (position, size) = logical_bounds(request.x, request.y, request.width, request.height);
    configure_browser_webview(&webview, request.native_live_resize)?;
    set_webview_bounds_if_changed(&app, &webview, position, size)?;
    #[cfg(target_os = "macos")]
    round_macos_webview_corners(&webview, request.corner_radii.unwrap_or_default())?;
    #[cfg(windows)]
    crate::browser::pages::windows::page_frame::set_corners(
        &webview,
        request.corner_radii.unwrap_or_default(),
        request.corner_color.as_deref().and_then(hex_color),
    )?;
    // Reconciliation owns geometry, visibility, and sibling order so a stale
    // frontend cache cannot leave the page detached from its Browser host.
    present_macos_webview(&webview)?;
    // A reloaded shell forgot the page's color; the page will not resend it.
    #[cfg(target_os = "macos")]
    crate::browser::kiri_link::host_messages::replay_page_background(&app, &request.id);
    Ok(true)
}

#[tauri::command]
pub async fn browser_webview_navigate(
    app: AppHandle,
    request: BrowserNavigateRequest,
) -> Result<(), String> {
    let url = external_url(&request.url)?;
    with_webview(&app, &request.id, |webview| {
        webview.navigate(url).map_err(|e| e.to_string())
    })
}

pub(in crate::browser) fn with_webview(
    app: &AppHandle,
    id: &str,
    action: impl FnOnce(Webview) -> Result<(), String>,
) -> Result<(), String> {
    let webview = app
        .get_webview(&webview_label(id)?)
        .ok_or_else(|| "Browser tab is not running.".to_owned())?;
    action(webview)
}

#[tauri::command]
pub fn browser_webview_back(
    app: AppHandle,
    request: BrowserWebviewIdRequest,
) -> Result<(), String> {
    with_webview(&app, &request.id, |webview| {
        webview.eval("history.back()").map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn browser_webview_forward(
    app: AppHandle,
    request: BrowserWebviewIdRequest,
) -> Result<(), String> {
    with_webview(&app, &request.id, |webview| {
        webview.eval("history.forward()").map_err(|e| e.to_string())
    })
}
