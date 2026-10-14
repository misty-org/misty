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
    #[serde(default)]
    pub highlight_all: bool,
    #[serde(default)]
    pub match_case: bool,
    #[serde(default)]
    pub match_diacritics: bool,
    #[serde(default)]
    pub whole_words: bool,
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
        .replace(
            "__MISTY_FIND_QUERY__",
            &serde_json::to_string(&query).map_err(|e| e.to_string())?,
        )
        .replace(
            "__MISTY_FIND_DIRECTION__",
            &serde_json::to_string(direction).map_err(|e| e.to_string())?,
        )
        .replace(
            "__MISTY_FIND_OPTIONS__",
            &json!({
                "highlightAll": request.highlight_all,
                "matchCase": request.match_case,
                "matchDiacritics": request.match_diacritics,
                "wholeWords": request.whole_words,
            })
            .to_string(),
        );
    let value = eval_json(&webview, script).await?;
    Ok(serde_json::from_str::<Option<BrowserFindResult>>(&value)
        .ok()
        .flatten()
        .unwrap_or_default())
}

#[tauri::command]
pub fn browser_webview_print(
    app: AppHandle,
    request: BrowserWebviewIdRequest,
) -> Result<(), String> {
    let webview = running_webview(&app, &request.id)?;
    #[cfg(target_os = "macos")]
    return webview
        .with_webview(|platform_webview| unsafe {
            use objc2::runtime::{AnyObject, Sel};
            use objc2_foundation::NSRect;
            let view: &AnyObject = &*platform_webview.inner().cast();
            let info: *mut AnyObject =
                objc2::msg_send![objc2::class!(NSPrintInfo), sharedPrintInfo];
            let operation: *mut AnyObject =
                objc2::msg_send![view, printOperationWithPrintInfo: info];
            let Some(operation) = operation.as_ref() else {
                return;
            };
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
    return webview
        .eval("window.print();")
        .map_err(|error| error.to_string());
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
    // A single-file web page with its images and styles, as Chromium saves it.
    #[cfg(windows)]
    if path.extension().and_then(|value| value.to_str()) == Some("mhtml") {
        let snapshot = crate::infra::webview2::cdp(
            &webview,
            "Page.captureSnapshot",
            &serde_json::json!({ "format": "mhtml" }),
        )
        .await?;
        let data = snapshot["data"]
            .as_str()
            .ok_or_else(|| "The page could not be saved.".to_owned())?;
        return std::fs::write(&path, data).map_err(|error| error.to_string());
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
            let _: () =
                objc2::msg_send![view, createWebArchiveDataWithCompletionHandler: &*handler];
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
    // Websites can always be inspected, like in any browser. Only this page's
    // view turns developer tools on; Misty's own windows keep them off.
    #[cfg(windows)]
    webview
        .with_webview(|platform| {
            // SAFETY: the controller is live during this UI-thread callback.
            let _ = unsafe {
                platform.controller().CoreWebView2().and_then(|core| {
                    core.Settings()?.SetAreDevToolsEnabled(true)?;
                    core.OpenDevToolsWindow()
                })
            };
        })
        .map_err(|error| error.to_string())?;
    #[cfg(windows)]
    return Ok(BrowserDeveloperToolsResult { opened: true });
    // Make the page inspectable from Safari's Develop menu (macOS 13.3+) in
    // every build; development builds can also open the inspector directly.
    #[cfg(target_os = "macos")]
    webview
        .with_webview(|platform_webview| unsafe {
            let view: &objc2::runtime::AnyObject = &*platform_webview.inner().cast();
            let supported: bool =
                objc2::msg_send![view, respondsToSelector: objc2::sel!(setInspectable:)];
            if supported {
                let _: () = objc2::msg_send![view, setInspectable: true];
            }
        })
        .map_err(|error| error.to_string())?;
    #[cfg(not(windows))]
    {
        #[cfg(debug_assertions)]
        webview.open_devtools();
        Ok(BrowserDeveloperToolsResult {
            opened: cfg!(debug_assertions),
        })
    }
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

/// Which website data to clear.
#[derive(Clone, Copy, Default)]
struct ClearKinds {
    /// Cookies and every kind of site storage.
    cookies: bool,
    cache: bool,
}

#[tauri::command]
pub async fn browser_clear_website_data(
    app: AppHandle,
    request: BrowserClearDataRequest,
) -> Result<(), String> {
    let mut kinds = ClearKinds::default();
    for kind in &request.kinds {
        match kind.as_str() {
            "cookies" => kinds.cookies = true,
            "cache" => kinds.cache = true,
            _ => return Err("Unknown kind of website data.".to_owned()),
        }
    }
    if !kinds.cookies && !kinds.cache {
        return Ok(());
    }
    let identifier = browser_profile_identifier(request.profile_id.as_deref())?;
    #[cfg(target_os = "macos")]
    return clear_webkit_website_data(&app, identifier, kinds, request.since).await;
    #[cfg(windows)]
    {
        let _ = identifier;
        clear_webview2_website_data(&app, request.profile_id.as_deref(), kinds, request.since).await
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = (app, identifier);
        Err("Clearing website data is not available on this platform.".to_owned())
    }
}

#[cfg(target_os = "macos")]
async fn clear_webkit_website_data(
    app: &AppHandle,
    identifier: [u8; 16],
    kinds: ClearKinds,
    since: i64,
) -> Result<(), String> {
    let mut data_types = Vec::new();
    if kinds.cookies {
        data_types.extend([
            "WKWebsiteDataTypeCookies",
            "WKWebsiteDataTypeLocalStorage",
            "WKWebsiteDataTypeSessionStorage",
            "WKWebsiteDataTypeIndexedDBDatabases",
            "WKWebsiteDataTypeWebSQLDatabases",
            "WKWebsiteDataTypeServiceWorkerRegistrations",
            "WKWebsiteDataTypeFileSystem",
        ]);
    }
    if kinds.cache {
        data_types.extend([
            "WKWebsiteDataTypeDiskCache",
            "WKWebsiteDataTypeMemoryCache",
            "WKWebsiteDataTypeOfflineWebApplicationCache",
            "WKWebsiteDataTypeFetchCache",
        ]);
    }
    // Older macOS tabs use temporary stores that are discarded anyway.
    if browser_requires_ephemeral_store() {
        return Ok(());
    }
    super::super::browser_macos::clear_browser_website_data(app, identifier, data_types, since)
        .await
}

/// Clears through a hidden page in the profile: WebView2 removes data only
/// through a live view's profile.
#[cfg(windows)]
async fn clear_webview2_website_data(
    app: &AppHandle,
    profile: Option<&str>,
    kinds: ClearKinds,
    since: i64,
) -> Result<(), String> {
    use crate::infra::webview2::{with_core, CdpError};
    use webview2_com::{
        ClearBrowsingDataCompletedHandler,
        Microsoft::Web::WebView2::Win32::{
            ICoreWebView2Profile2, ICoreWebView2_13, COREWEBVIEW2_BROWSING_DATA_KINDS,
            COREWEBVIEW2_BROWSING_DATA_KINDS_ALL_DOM_STORAGE,
            COREWEBVIEW2_BROWSING_DATA_KINDS_CACHE_STORAGE,
            COREWEBVIEW2_BROWSING_DATA_KINDS_COOKIES, COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE,
        },
    };
    use windows::core::Interface;

    let mut flags = 0;
    if kinds.cookies {
        flags |= COREWEBVIEW2_BROWSING_DATA_KINDS_COOKIES.0
            | COREWEBVIEW2_BROWSING_DATA_KINDS_ALL_DOM_STORAGE.0;
    }
    if kinds.cache {
        flags |= COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE.0
            | COREWEBVIEW2_BROWSING_DATA_KINDS_CACHE_STORAGE.0;
    }
    let start = since.max(0) as f64 / 1000.0;
    let end = Utc::now().timestamp_millis() as f64 / 1000.0 + 60.0;
    let view = crate::infra::browser_profile_view::ProfileView::open(app, profile)?;
    let (send, receive) = tokio::sync::oneshot::channel();
    let send = Mutex::new(Some(send));
    with_core(&view, move |core, _| {
        let handler = ClearBrowsingDataCompletedHandler::create(Box::new(move |status| {
            if let Some(send) = send.lock().ok().and_then(|mut slot| slot.take()) {
                let _ = send.send(status.is_ok());
            }
            Ok(())
        }));
        // SAFETY: a live view on its UI thread; the handler owns its state.
        unsafe {
            core.cast::<ICoreWebView2_13>()
                .and_then(|core| core.Profile())
                .and_then(|profile| profile.cast::<ICoreWebView2Profile2>())
                .and_then(|profile| {
                    profile.ClearBrowsingDataInTimeRange(
                        COREWEBVIEW2_BROWSING_DATA_KINDS(flags),
                        start,
                        end,
                        &handler,
                    )
                })
        }
        .map_err(|_| CdpError::Unavailable)
    })
    .await?;
    match tokio::time::timeout(Duration::from_secs(60), receive).await {
        Ok(Ok(true)) => Ok(()),
        Ok(_) => Err("Windows could not clear that website data.".to_owned()),
        Err(_) => Err("Clearing website data timed out.".to_owned()),
    }
}

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

// Media and reading tools live beside the everyday ones to keep both readable.
#[path = "browser_media_tools.rs"]
pub(crate) mod media_tools;
