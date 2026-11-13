//! Page tools for a running page: stop loading and clear website data.

use crate::browser::*;
// Clearing website data waits on WebView2 with these.
#[cfg(windows)]
use std::sync::Mutex;
#[cfg(windows)]
use std::time::Duration;

fn running_webview(app: &AppHandle, id: &str) -> Result<Webview, String> {
    app.get_webview(&webview_label(id)?)
        .ok_or_else(|| "Browser tab is not running.".to_owned())
}

#[tauri::command]
pub fn browser_webview_stop(
    app: AppHandle,
    request: BrowserWebviewIdRequest,
) -> Result<(), String> {
    let webview = running_webview(&app, &request.id)?;
    #[cfg(target_os = "macos")]
    webview
        .with_webview(|platform_webview| unsafe {
            let view: &objc2::runtime::AnyObject = &*platform_webview.inner().cast();
            let _: () = objc2::msg_send![view, stopLoading];
        })
        .map_err(|error| error.to_string())?;
    #[cfg(not(target_os = "macos"))]
    webview
        .eval("window.stop();")
        .map_err(|error| error.to_string())?;
    // A cancelled load never reports that it finished.
    let _ = webview.eval(browser_status_update_script(&json!({ "loading": false })));
    Ok(())
}

mod clear_data;
pub use clear_data::*;
