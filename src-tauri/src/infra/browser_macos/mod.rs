//! Native WebKit and WebView2 hooks for Browser pages.

#[cfg(target_os = "macos")]
mod capture;
mod javascript;
mod webview;
#[cfg(target_os = "macos")]
mod website_data;

#[cfg(target_os = "macos")]
pub(crate) use capture::{
    __cmd__host_webview_capture_region, __tauri_command_name_host_webview_capture_region,
};
#[cfg(target_os = "macos")]
pub use capture::host_webview_capture_region;
#[cfg(target_os = "macos")]
pub(crate) use capture::{capture_webview_region, capture_webview_region_sized};
pub(crate) use javascript::*;
pub(super) use webview::*;
#[cfg(target_os = "macos")]
pub(super) use website_data::{clear_browser_website_data, remove_browser_data_store};

use tauri::Webview;

#[cfg(target_os = "macos")]
use super::browser_frame_rate_macos as frame_rate;

pub(super) fn configure_browser_frame_rate(webview: &Webview) -> Result<(), String> {
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
/// Asks where to save a download with the system save panel. WebKit asks for
/// the destination on the main thread, so the modal panel can run in place.
#[cfg(target_os = "macos")]
pub(super) fn ask_download_destination(suggested: &std::path::Path) -> Option<std::path::PathBuf> {
    use objc2::runtime::AnyObject;
    use objc2_foundation::{NSString, NSURL};
    unsafe {
        let panel: *mut AnyObject = objc2::msg_send![objc2::class!(NSSavePanel), savePanel];
        let panel = panel.as_ref()?;
        if let Some(name) = suggested.file_name().and_then(|name| name.to_str()) {
            let _: () =
                objc2::msg_send![panel, setNameFieldStringValue: &*NSString::from_str(name)];
        }
        if let Some(directory) = suggested.parent() {
            let url = NSURL::fileURLWithPath_isDirectory(
                &NSString::from_str(&directory.to_string_lossy()),
                true,
            );
            let _: () = objc2::msg_send![panel, setDirectoryURL: &*url];
        }
        // NSModalResponseOK
        let response: isize = objc2::msg_send![panel, runModal];
        if response != 1 {
            return None;
        }
        let url: *mut NSURL = objc2::msg_send![panel, URL];
        let path = url.as_ref()?.path()?;
        Some(std::path::PathBuf::from(path.to_string()))
    }
}

/// Asks where to save a download with the system Save dialog. WebView2 asks
/// for the destination on the UI thread, so the modal dialog can run in place.
#[cfg(windows)]
pub(super) fn ask_download_destination(suggested: &std::path::Path) -> Option<std::path::PathBuf> {
    let mut dialog = rfd::FileDialog::new().set_title("Save");
    if let Some(name) = suggested.file_name().and_then(|name| name.to_str()) {
        dialog = dialog.set_file_name(name);
    }
    if let Some(directory) = suggested.parent() {
        dialog = dialog.set_directory(directory);
    }
    dialog.save_file()
}
