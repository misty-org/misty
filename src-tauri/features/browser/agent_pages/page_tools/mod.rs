//! Page tools for a running page: stop loading, mute, hold media and clear website data.

use crate::browser::*;
use std::sync::Mutex;
use std::time::Duration;

fn running_webview(app: &AppHandle, id: &str) -> Result<Webview, String> {
    app.get_webview(&webview_label(id)?)
        .ok_or_else(|| "Browser tab is not running.".to_owned())
}

/// Evaluates an expression and waits for its JSON-encoded result.
async fn eval_json(webview: &Webview, script: String) -> Result<String, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let sender = Mutex::new(Some(sender));
    webview
        .eval_with_callback(script, move |value| {
            if let Some(sender) = sender.lock().ok().and_then(|mut sender| sender.take()) {
                let _ = sender.send(value);
            }
        })
        .map_err(|error| error.to_string())?;
    tokio::time::timeout(Duration::from_secs(5), receiver)
        .await
        .map_err(|_| "The page did not respond.".to_owned())?
        .map_err(|_| "The page closed before it responded.".to_owned())
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
mod media_hold;
pub use media_hold::*;
mod mute;
pub use mute::*;

// Media and reading tools live beside the everyday ones to keep both readable.
pub(crate) mod media_tools;
