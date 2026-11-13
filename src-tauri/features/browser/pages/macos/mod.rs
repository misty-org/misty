//! Native WebKit and WebView2 hooks for Browser pages.

#[cfg(target_os = "macos")]
mod capture;
#[cfg(target_os = "macos")]
pub(crate) mod frame_rate;
#[cfg(target_os = "macos")]
pub(crate) mod pointer_guard;
#[cfg(target_os = "macos")]
mod website_data;
mod webview;

#[cfg(target_os = "macos")]
pub(crate) use capture::{capture_webview_region, capture_webview_region_sized};
#[cfg(target_os = "macos")]
pub(crate) use website_data::clear_browser_website_data;
pub(crate) use webview::*;

use tauri::Webview;

pub(crate) fn configure_browser_frame_rate(webview: &Webview) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return webview
        .with_webview(|platform| unsafe {
            let view: &objc2_web_kit::WKWebView = &*platform.inner().cast();
            frame_rate::prefer_display_refresh_rate(view);
        })
        .map_err(|error| error.to_string());
    #[cfg(not(target_os = "macos"))]
    {
        let _ = webview;
        Ok(())
    }
}
