//! Muting everything a page plays.
use super::*;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserMuteRequest {
    pub id: String,
    pub muted: bool,
}

const MUTE_MEDIA_SCRIPT: &str =
    "document.querySelectorAll('audio, video').forEach((media) => { media.muted = __MUTED__; });";

/// Mutes or unmutes everything a page plays. The engine mutes the whole page,
/// including Web Audio, and keeps it muted across navigations.
#[tauri::command]
pub async fn browser_webview_set_muted(
    app: AppHandle,
    request: BrowserMuteRequest,
) -> Result<(), String> {
    let webview = running_webview(&app, &request.id)?;
    #[cfg(target_os = "macos")]
    {
        let muted = request.muted;
        let (sender, receiver) = tokio::sync::oneshot::channel::<bool>();
        let sender = Mutex::new(Some(sender));
        webview
            .with_webview(move |platform_webview| unsafe {
                let view: &objc2::runtime::AnyObject = &*platform_webview.inner().cast();
                let supported: bool =
                    objc2::msg_send![view, respondsToSelector: objc2::sel!(_setPageMuted:)];
                if supported {
                    // _WKMediaAudioMuted
                    let state: usize = if muted { 1 } else { 0 };
                    let _: () = objc2::msg_send![view, _setPageMuted: state];
                }
                if let Some(sender) = sender.lock().ok().and_then(|mut sender| sender.take()) {
                    let _ = sender.send(supported);
                }
            })
            .map_err(|error| error.to_string())?;
        let native = tokio::time::timeout(Duration::from_secs(2), receiver).await;
        if matches!(native, Ok(Ok(true))) {
            return Ok(());
        }
    }
    #[cfg(windows)]
    {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_8;
        use windows::core::Interface;
        let muted = request.muted;
        let native = crate::infra::webview2::with_core(&webview, move |core, _| {
            // SAFETY: a live view on its UI thread.
            unsafe { core.cast::<ICoreWebView2_8>()?.SetIsMuted(muted)? };
            Ok(())
        })
        .await;
        if native.is_ok() {
            return Ok(());
        }
    }
    webview
        .eval(MUTE_MEDIA_SCRIPT.replace("__MUTED__", if request.muted { "true" } else { "false" }))
        .map_err(|error| error.to_string())
}
