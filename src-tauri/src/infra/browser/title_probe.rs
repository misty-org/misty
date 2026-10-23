//! Reads the title a page's own webview reports.
use super::*;

#[cfg(target_os = "macos")]
pub(super) async fn page_title(webview: &Webview) -> String {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let _ = webview.with_webview(move |platform_webview| unsafe {
        let view: &objc2::runtime::AnyObject = &*platform_webview.inner().cast();
        let title: *mut objc2::runtime::AnyObject = objc2::msg_send![view, title];
        let text = if title.is_null() {
            String::new()
        } else {
            let raw: *const std::ffi::c_char = objc2::msg_send![title, UTF8String];
            if raw.is_null() {
                String::new()
            } else {
                std::ffi::CStr::from_ptr(raw).to_string_lossy().into_owned()
            }
        };
        let _ = sender.send(text);
    });
    tokio::time::timeout(std::time::Duration::from_secs(1), receiver)
        .await
        .ok()
        .and_then(Result::ok)
        .unwrap_or_default()
}

#[cfg(not(target_os = "macos"))]
pub(super) async fn page_title(_webview: &Webview) -> String {
    String::new()
}
