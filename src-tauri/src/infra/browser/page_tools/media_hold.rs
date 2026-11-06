//! Keeping a page quiet on a computer nobody is at: a tab that came from another computer, or
//! moved because of one, doesn't start playing here until the person looks at it.
use super::*;

/// In every frame of every page, and does nothing until told to.
pub(in crate::infra::browser) const MEDIA_HOLD_SCRIPT: &str =
    include_str!("../scripts/media_hold.js");

/// Tells a document whether it's held, at the start of the document or later.
pub(in crate::infra::browser) fn media_hold_state(held: bool) -> String {
    format!("window.__MISTY_HOLD_MEDIA__&&window.__MISTY_HOLD_MEDIA__({held});")
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserMediaHoldRequest {
    pub id: String,
    pub held: bool,
}

/// Holds or releases a page's media, for what it has open now and for every document after it,
/// so it's safe to navigate as soon as this returns. A later state runs after an earlier one at
/// the start of each document, so the last call is the one that counts.
#[tauri::command]
pub async fn browser_webview_set_media_hold(
    app: AppHandle,
    request: BrowserMediaHoldRequest,
) -> Result<(), String> {
    let webview = running_webview(&app, &request.id)?;
    let state = media_hold_state(request.held);
    at_document_start(&webview, state.clone()).await?;
    webview.eval(state).map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
async fn at_document_start(webview: &tauri::Webview, source: String) -> Result<(), String> {
    use objc2::{MainThreadMarker, MainThreadOnly};
    use objc2_foundation::NSString;
    use objc2_web_kit::{WKUserScript, WKUserScriptInjectionTime, WKWebView};
    let (sender, receiver) = tokio::sync::oneshot::channel::<()>();
    webview
        .with_webview(move |platform| unsafe {
            let view: &WKWebView = &*platform.inner().cast();
            if let Some(mtm) = MainThreadMarker::new() {
                let script = WKUserScript::initWithSource_injectionTime_forMainFrameOnly(
                    WKUserScript::alloc(mtm),
                    &NSString::from_str(&source),
                    WKUserScriptInjectionTime::AtDocumentStart,
                    false,
                );
                view.configuration()
                    .userContentController()
                    .addUserScript(&script);
            }
            let _ = sender.send(());
        })
        .map_err(|error| error.to_string())?;
    tokio::time::timeout(Duration::from_secs(2), receiver)
        .await
        .map_err(|_| "The page didn't answer.".to_owned())?
        .map_err(|_| "The page didn't answer.".to_owned())
}

#[cfg(windows)]
async fn at_document_start(webview: &tauri::Webview, source: String) -> Result<(), String> {
    use webview2_com::AddScriptToExecuteOnDocumentCreatedCompletedHandler;
    use windows::core::HSTRING;
    let (sender, receiver) = tokio::sync::oneshot::channel::<()>();
    crate::infra::webview2::with_core(webview, move |core, _| {
        let handler =
            AddScriptToExecuteOnDocumentCreatedCompletedHandler::create(Box::new(move |_, _| {
                let _ = sender.send(());
                Ok(())
            }));
        // SAFETY: a live view on its UI thread; the handler owns its state.
        unsafe {
            core.AddScriptToExecuteOnDocumentCreated(&HSTRING::from(source), &handler)
                .map_err(|_| crate::infra::webview2::CdpError::Unavailable)?;
        }
        Ok(())
    })
    .await
    .map_err(|error| error.message().to_owned())?;
    tokio::time::timeout(Duration::from_secs(2), receiver)
        .await
        .map_err(|_| "The page didn't answer.".to_owned())?
        .map_err(|_| "The page didn't answer.".to_owned())
}

#[cfg(not(any(target_os = "macos", windows)))]
async fn at_document_start(_webview: &tauri::Webview, _source: String) -> Result<(), String> {
    Ok(())
}
