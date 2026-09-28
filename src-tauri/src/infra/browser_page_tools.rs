//! Everyday page tools for the focused browser page: stop loading, find in
//! page, print, save the page and open Web Inspector.

use super::*;
use std::sync::Mutex;
use std::time::Duration;

const FIND_SCRIPT: &str = include_str!("browser_find.js");
const MAX_FIND_QUERY: usize = 1_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserFindRequest {
    pub id: String,
    pub query: String,
    /// "next", "previous" or "clear".
    pub direction: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct BrowserFindResult {
    pub current: u32,
    pub total: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSavePageRequest {
    pub id: String,
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserDeveloperToolsResult {
    /// False when the inspector could not be opened in place and the user has
    /// to attach from Safari's Develop menu instead.
    pub opened: bool,
}

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
pub fn browser_webview_stop(app: AppHandle, request: BrowserWebviewIdRequest) -> Result<(), String> {
    let webview = running_webview(&app, &request.id)?;
    #[cfg(target_os = "macos")]
    webview
        .with_webview(|platform_webview| unsafe {
            let view: &objc2::runtime::AnyObject = &*platform_webview.inner().cast();
            let _: () = objc2::msg_send![view, stopLoading];
        })
        .map_err(|error| error.to_string())?;
    #[cfg(not(target_os = "macos"))]
    webview.eval("window.stop();").map_err(|error| error.to_string())?;
    // A cancelled load never reports that it finished.
    let _ = webview.eval(browser_status_update_script(&json!({ "loading": false })));
    Ok(())
}

#[tauri::command]
pub async fn browser_webview_find(
    app: AppHandle,
    request: BrowserFindRequest,
) -> Result<BrowserFindResult, String> {
    let webview = running_webview(&app, &request.id)?;
    let direction = match request.direction.as_str() {
        "next" | "previous" | "clear" => request.direction.as_str(),
        _ => return Err("Unknown find direction.".to_owned()),
    };
    let query: String = request.query.chars().take(MAX_FIND_QUERY).collect();
    let script = FIND_SCRIPT
        .replace("__MISTY_FIND_QUERY__", &serde_json::to_string(&query).map_err(|e| e.to_string())?)
        .replace("__MISTY_FIND_DIRECTION__", &serde_json::to_string(direction).map_err(|e| e.to_string())?);
    let value = eval_json(&webview, script).await?;
    Ok(serde_json::from_str::<Option<BrowserFindResult>>(&value)
        .ok()
        .flatten()
        .unwrap_or_default())
}

#[tauri::command]
pub fn browser_webview_print(app: AppHandle, request: BrowserWebviewIdRequest) -> Result<(), String> {
    let webview = running_webview(&app, &request.id)?;
    #[cfg(target_os = "macos")]
    return webview
            .with_webview(|platform_webview| unsafe {
                use objc2::runtime::{AnyObject, Sel};
                use objc2_foundation::NSRect;
                let view: &AnyObject = &*platform_webview.inner().cast();
                let info: *mut AnyObject = objc2::msg_send![objc2::class!(NSPrintInfo), sharedPrintInfo];
                let operation: *mut AnyObject = objc2::msg_send![view, printOperationWithPrintInfo: info];
                let Some(operation) = operation.as_ref() else { return };
                let _: () = objc2::msg_send![operation, setShowsPrintPanel: true];
                let _: () = objc2::msg_send![operation, setShowsProgressPanel: true];
                // WebKit's print view prints blank pages until it has a frame.
                let print_view: *mut AnyObject = objc2::msg_send![operation, view];
                let bounds: NSRect = objc2::msg_send![view, bounds];
                if let Some(print_view) = print_view.as_ref() {
                    let _: () = objc2::msg_send![print_view, setFrame: bounds];
                }
                let window: *mut AnyObject = objc2::msg_send![view, window];
                let _: () = objc2::msg_send![
                    operation,
                    runOperationModalForWindow: window,
                    delegate: std::ptr::null_mut::<AnyObject>(),
                    didRunSelector: None::<Sel>,
                    contextInfo: std::ptr::null_mut::<std::ffi::c_void>()
                ];
            })
            .map_err(|error| error.to_string());
    #[cfg(not(target_os = "macos"))]
    return webview.eval("window.print();").map_err(|error| error.to_string());
}

#[tauri::command]
pub async fn browser_webview_save_page(
    app: AppHandle,
    request: BrowserSavePageRequest,
) -> Result<(), String> {
    let webview = running_webview(&app, &request.id)?;
    let path = PathBuf::from(&request.path);
    if !path.is_absolute() {
        return Err("Choose where to save the page.".to_owned());
    }
    #[cfg(target_os = "macos")]
    if path.extension().and_then(|value| value.to_str()) == Some("webarchive") {
        let bytes = web_archive(&webview).await?;
        return std::fs::write(&path, bytes).map_err(|error| error.to_string());
    }
    let value = eval_json(&webview, "document.documentElement.outerHTML".to_owned()).await?;
    let html = serde_json::from_str::<Option<String>>(&value)
        .ok()
        .flatten()
        .ok_or_else(|| "The page could not be saved.".to_owned())?;
    std::fs::write(&path, format!("<!DOCTYPE html>\n{html}")).map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
async fn web_archive(webview: &Webview) -> Result<Vec<u8>, String> {
    use block2::RcBlock;
    use objc2::runtime::AnyObject;
    use objc2_foundation::{NSData, NSError};
    let (sender, receiver) = tokio::sync::oneshot::channel::<Result<Vec<u8>, String>>();
    let sender = Mutex::new(Some(sender));
    webview
        .with_webview(move |platform_webview| unsafe {
            let view: &AnyObject = &*platform_webview.inner().cast();
            let handler = RcBlock::new(move |data: *mut NSData, error: *mut NSError| {
                let result = match data.as_ref() {
                    Some(data) if error.is_null() => Ok(data.to_vec()),
                    _ => Err("The page could not be archived.".to_owned()),
                };
                if let Some(sender) = sender.lock().ok().and_then(|mut sender| sender.take()) {
                    let _ = sender.send(result);
                }
            });
            let _: () = objc2::msg_send![view, createWebArchiveDataWithCompletionHandler: &*handler];
        })
        .map_err(|error| error.to_string())?;
    tokio::time::timeout(Duration::from_secs(30), receiver)
        .await
        .map_err(|_| "Saving the page timed out.".to_owned())?
        .map_err(|_| "Saving the page was cancelled.".to_owned())?
}

#[tauri::command]
pub fn browser_webview_developer_tools(
    app: AppHandle,
    request: BrowserWebviewIdRequest,
) -> Result<BrowserDeveloperToolsResult, String> {
    let webview = running_webview(&app, &request.id)?;
    // Make the page inspectable from Safari's Develop menu (macOS 13.3+) in
    // every build; development builds can also open the inspector directly.
    #[cfg(target_os = "macos")]
    webview
        .with_webview(|platform_webview| unsafe {
            let view: &objc2::runtime::AnyObject = &*platform_webview.inner().cast();
            let supported: bool = objc2::msg_send![view, respondsToSelector: objc2::sel!(setInspectable:)];
            if supported {
                let _: () = objc2::msg_send![view, setInspectable: true];
            }
        })
        .map_err(|error| error.to_string())?;
    #[cfg(debug_assertions)]
    webview.open_devtools();
    Ok(BrowserDeveloperToolsResult { opened: cfg!(debug_assertions) })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserClearDataRequest {
    pub profile_id: Option<String>,
    /// Any of "cookies" (cookies and site storage) and "cache".
    pub kinds: Vec<String>,
    /// Data changed at or after this time (ms).
    pub since: i64,
}

#[tauri::command]
pub async fn browser_clear_website_data(
    app: AppHandle,
    request: BrowserClearDataRequest,
) -> Result<(), String> {
    let mut data_types = Vec::new();
    for kind in &request.kinds {
        match kind.as_str() {
            "cookies" => data_types.extend([
                "WKWebsiteDataTypeCookies",
                "WKWebsiteDataTypeLocalStorage",
                "WKWebsiteDataTypeSessionStorage",
                "WKWebsiteDataTypeIndexedDBDatabases",
                "WKWebsiteDataTypeWebSQLDatabases",
                "WKWebsiteDataTypeServiceWorkerRegistrations",
                "WKWebsiteDataTypeFileSystem",
            ]),
            "cache" => data_types.extend([
                "WKWebsiteDataTypeDiskCache",
                "WKWebsiteDataTypeMemoryCache",
                "WKWebsiteDataTypeOfflineWebApplicationCache",
                "WKWebsiteDataTypeFetchCache",
            ]),
            _ => return Err("Unknown kind of website data.".to_owned()),
        }
    }
    if data_types.is_empty() {
        return Ok(());
    }
    let identifier = browser_profile_identifier(request.profile_id.as_deref())?;
    // Older macOS tabs use temporary stores that are discarded anyway.
    #[cfg(target_os = "macos")]
    if browser_requires_ephemeral_store() {
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    return super::super::browser_macos::clear_browser_website_data(
        &app,
        identifier,
        data_types,
        request.since,
    )
    .await;
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, identifier, data_types);
        Err("Clearing website data requires Misty on a Mac.".to_owned())
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserMuteRequest {
    pub id: String,
    pub muted: bool,
}

const MUTE_MEDIA_SCRIPT: &str = "document.querySelectorAll('audio, video').forEach((media) => { media.muted = __MUTED__; });";

/// Mutes or unmutes everything a page plays. On macOS WebKit mutes the whole
/// page, including Web Audio, and keeps it muted across navigations.
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
    webview
        .eval(MUTE_MEDIA_SCRIPT.replace("__MUTED__", if request.muted { "true" } else { "false" }))
        .map_err(|error| error.to_string())
}
