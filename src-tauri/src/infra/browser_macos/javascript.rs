//! Running scripts in a Browser page and returning their answer.

use tauri::Webview;

#[cfg(target_os = "macos")]
pub(crate) async fn evaluate_browser_async_javascript(
    webview: Webview,
    function_body: String,
) -> Result<String, String> {
    use block2::RcBlock;
    use objc2::{runtime::AnyObject, MainThreadMarker};
    use objc2_foundation::{NSError, NSString};
    use objc2_web_kit::{WKContentWorld, WKWebView};
    use std::sync::Mutex;
    use std::time::Duration;

    let (sender, receiver) = tokio::sync::oneshot::channel();
    let sender = Mutex::new(Some(sender));
    webview
        .with_webview(move |platform_webview| unsafe {
            let Some(mtm) = MainThreadMarker::new() else {
                if let Ok(mut sender) = sender.lock() {
                    if let Some(sender) = sender.take() {
                        let _ = sender.send(Err(
                            "Browser capture must run on the main thread.".to_owned()
                        ));
                    }
                }
                return;
            };
            let view: &WKWebView = &*platform_webview.inner().cast();
            let world = WKContentWorld::pageWorld(mtm);
            let handler = RcBlock::new(move |value: *mut AnyObject, error: *mut NSError| {
                let result = if !error.is_null() {
                    Err("The Browser page could not render that capture.".to_owned())
                } else if value.is_null() {
                    Err("The Browser page returned no capture.".to_owned())
                } else if let Some(value) = (&*value).downcast_ref::<NSString>() {
                    Ok(value.to_string())
                } else {
                    Err("The Browser page returned an invalid capture.".to_owned())
                };
                if let Ok(mut sender) = sender.lock() {
                    if let Some(sender) = sender.take() {
                        let _ = sender.send(result);
                    }
                }
            });
            view.callAsyncJavaScript_arguments_inFrame_inContentWorld_completionHandler(
                &NSString::from_str(&function_body),
                None,
                None,
                &world,
                Some(&*handler),
            );
        })
        .map_err(|error| error.to_string())?;

    tokio::time::timeout(Duration::from_secs(15), receiver)
        .await
        .map_err(|_| "Browser capture timed out.".to_owned())?
        .map_err(|_| "Browser capture was canceled.".to_owned())?
}

/// Runs `function_body` in Misty's page-state content world: it shares the
/// DOM with the page but not its JavaScript, so page scripts cannot observe
/// or tamper with it. The world is retained so its globals persist per page.
#[cfg(any(target_os = "macos", windows))]
pub(crate) async fn evaluate_isolated_javascript(
    webview: Webview,
    function_body: String,
) -> Result<String, String> {
    crate::infra::browser_content_world::evaluate_in_content_world(
        webview,
        "misty-page-state",
        function_body,
    )
    .await
}
/// Runs `function_body` as an async function in the page's own world and
/// returns the string it resolves to, as WebKit's callAsyncJavaScript does.
#[cfg(windows)]
pub(crate) async fn evaluate_browser_async_javascript(
    webview: Webview,
    function_body: String,
) -> Result<String, String> {
    let expression = format!(
        "(async () => {{
{function_body}
}})()"
    );
    match crate::infra::webview2::evaluate(&webview, expression, None).await {
        Ok(serde_json::Value::String(value)) => Ok(value),
        Ok(_) => Err("The Browser page returned an invalid answer.".to_owned()),
        Err(crate::infra::webview2::CdpError::Invalid) => {
            Err("The Browser page could not run that request.".to_owned())
        }
        Err(error) => Err(error.into()),
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
pub(in crate::infra) async fn evaluate_browser_async_javascript(
    _webview: Webview,
    _function_body: String,
) -> Result<String, String> {
    Err("This browser feature is not available on this platform yet.".to_owned())
}
