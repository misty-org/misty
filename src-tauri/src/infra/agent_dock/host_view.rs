//! Moving a page's view between windows: fill its host, then hand it back.
#[cfg(target_os = "macos")]
use super::{misty_agent_dock_fill, misty_agent_dock_page_returned};

/// Sizes a reparented page to its host window, leaving `top` points for a bar.
pub(in crate::infra) fn fill_host(webview: &tauri::Webview, top: f64) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return webview
        .with_webview(move |platform| unsafe { misty_agent_dock_fill(platform.inner(), top) })
        .map_err(|e| e.to_string());
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (webview, top);
        Ok(())
    }
}

/// The page is back in the person's window: WebKit may judge its visibility again.
pub(in crate::infra) fn page_returned(webview: &tauri::Webview) {
    #[cfg(target_os = "macos")]
    let _ = webview.with_webview(|platform| unsafe { misty_agent_dock_page_returned(platform.inner()) });
    #[cfg(not(target_os = "macos"))]
    let _ = webview;
}
