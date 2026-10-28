//! Clearing a profile's website data.
use super::*;

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
    super::super::super::browser_macos::clear_browser_website_data(
        app, identifier, data_types, since,
    )
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
