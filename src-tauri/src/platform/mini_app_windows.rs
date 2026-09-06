//! Native WebView2 adapter for untrusted App content.
#[path = "mini_app_windows_policy.rs"]
mod policy;

pub async fn configure(view: &tauri::Webview) -> Result<(), String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    view.with_webview(move |platform| {
        let result = unsafe { policy::install(platform.controller()) };
        let _ = sender.send(result);
    })
    .map_err(|error| error.to_string())?;
    receiver
        .await
        .map_err(|_| "App permission configuration failed.".to_string())?
}
