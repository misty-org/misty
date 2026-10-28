//! Native cookie transport, deliberately unavailable through renderer IPC.
//! The sync coordinator must serialize imports per profile and hold its account
//! lease until completion. Never call this on Misty's own authentication webview.
#![allow(dead_code)] // Coordinator integration follows the adapter verification.

use super::coverage::{site, CookieRead, SkipReason};
use block2::RcBlock;
use misty_browser_sync::document::credentials::{Cookie, SameSite};
use objc2::{rc::Retained, runtime::AnyObject};
use objc2_foundation::{
    ns_string, NSDate, NSHTTPCookie, NSHTTPCookieDiscard, NSHTTPCookieDomain, NSHTTPCookieExpires,
    NSHTTPCookieName, NSHTTPCookiePath, NSHTTPCookiePropertyKey, NSHTTPCookieSameSitePolicy,
    NSHTTPCookieSecure, NSHTTPCookieValue, NSHTTPCookieVersion, NSMutableDictionary, NSProcessInfo,
    NSString, NSUUID,
};
use objc2_web_kit::{WKHTTPCookieStore, WKWebView};
use std::{sync::Mutex, time::Duration};
use tauri::Webview;

mod convert;
#[cfg(test)]
use convert::equal;
use convert::{export_cookie, skip};
pub(crate) use convert::{import_cookie, representable};

const COOKIE_LIMIT: usize = 20_000;
/// Foundation drops an explicit SameSite=None and reports nil, which WebKit
/// enforces as None. The two are indistinguishable in this engine.
pub(crate) const SAME_SITE_NONE_IS_UNSPECIFIED: bool = true;
const TIMEOUT: Duration = Duration::from_secs(15);

// Do not include platform errors or cookie values in diagnostics.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CookieStoreError {
    Unavailable,
    Profile,
    Unsupported,
    Invalid,
    TooLarge,
    Timeout,
}
type Result<T> = std::result::Result<T, CookieStoreError>;

fn expected_profile(label: &str, profile_id: &str) -> Result<[u8; 16]> {
    if !label.starts_with("misty-browser-") {
        return Err(CookieStoreError::Profile);
    }
    super::super::browser_profile::data_store_identifier(Some(profile_id))
        .map_err(|_| CookieStoreError::Profile)
}

unsafe fn cookie_store(
    view: &WKWebView,
    expected: [u8; 16],
) -> Result<Retained<WKHTTPCookieStore>> {
    // Never fall back to Misty's default store or the ephemeral pre-macOS-14
    // compatibility mode. Check the real engine store, not renderer metadata.
    if NSProcessInfo::processInfo()
        .operatingSystemVersion()
        .majorVersion
        < 14
    {
        return Err(CookieStoreError::Unsupported);
    }
    let store = view.configuration().websiteDataStore();
    let identifier = store.identifier().ok_or(CookieStoreError::Profile)?;
    if identifier.UUIDString().to_string() != NSUUID::from_bytes(expected).UUIDString().to_string()
    {
        return Err(CookieStoreError::Profile);
    }
    Ok(store.httpCookieStore())
}

/// Reads raw engine cookies without leaking them into JS, events, or logs.
/// A cookie that cannot be represented exactly is skipped and reported, never
/// broadened; `partition_key` coverage is not claimed by this adapter.
pub(crate) async fn read(webview: &Webview, profile_id: &str) -> Result<CookieRead> {
    let expected = expected_profile(webview.label(), profile_id)?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let sender = Mutex::new(Some(sender));
    webview
        .with_webview(move |platform| unsafe {
            let view: &WKWebView = &*platform.inner().cast();
            let store = match cookie_store(view, expected) {
                Ok(store) => store,
                Err(error) => {
                    if let Ok(mut sender) = sender.lock() {
                        if let Some(sender) = sender.take() {
                            let _ = sender.send(Err(error));
                        }
                    }
                    return;
                }
            };
            let handler = RcBlock::new(
                move |cookies: std::ptr::NonNull<objc2_foundation::NSArray<NSHTTPCookie>>| {
                    let cookies = cookies.as_ref();
                    let result = Ok(CookieRead::accept(
                        cookies.iter().map(|cookie| {
                            export_cookie(&cookie).map_err(|error| skip(&cookie, error))
                        }),
                        COOKIE_LIMIT,
                    ));
                    if let Ok(mut sender) = sender.lock() {
                        if let Some(sender) = sender.take() {
                            let _ = sender.send(result);
                        }
                    }
                },
            );
            store.getAllCookies(&handler);
        })
        .map_err(|_| CookieStoreError::Unavailable)?;
    tokio::time::timeout(TIMEOUT, receiver)
        .await
        .map_err(|_| CookieStoreError::Timeout)?
        .map_err(|_| CookieStoreError::Unavailable)?
}

/// Verify the native profile without requiring an idle about:blank document.
/// Website storage lives on an HTTP(S) origin, including our inert import pages.
/// Cookie replacement retains its separate, stricter preflight below.
pub(crate) async fn verify_storage_profile(webview: &Webview, profile_id: &str) -> Result<()> {
    let expected = expected_profile(webview.label(), profile_id)?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    webview
        .with_webview(move |platform| unsafe {
            let view: &WKWebView = &*platform.inner().cast();
            let _ = sender.send(cookie_store(view, expected).map(|_| ()));
        })
        .map_err(|_| CookieStoreError::Unavailable)?;
    tokio::time::timeout(TIMEOUT, receiver)
        .await
        .map_err(|_| CookieStoreError::Timeout)?
        .map_err(|_| CookieStoreError::Unavailable)?
}

/// Check native representability for the complete target without changing any
/// cookie. This catches engine expiry clamping before a partial restore begins.
pub(crate) async fn preflight(
    webview: &Webview,
    profile_id: &str,
    target: Vec<Cookie>,
) -> Result<()> {
    let expected = expected_profile(webview.label(), profile_id)?;
    if target.len() > COOKIE_LIMIT {
        return Err(CookieStoreError::TooLarge);
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    webview
        .with_webview(move |platform| unsafe {
            let result = (|| {
                let view: &WKWebView = &*platform.inner().cast();
                cookie_store(view, expected)?;
                // WKWebView.URL is nil before its first navigation. Wry's URL
                // wrapper unwraps it, so use the nullable native API here.
                if view.isLoading()
                    || view.URL().is_some_and(|url| {
                        url.absoluteString()
                            .is_none_or(|value| value.to_string() != "about:blank")
                    })
                {
                    return Err(CookieStoreError::Unavailable);
                }
                for cookie in &target {
                    import_cookie(cookie)?;
                }
                Ok(())
            })();
            let _ = sender.send(result);
        })
        .map_err(|_| CookieStoreError::Unavailable)?;
    tokio::time::timeout(TIMEOUT, receiver)
        .await
        .map_err(|_| CookieStoreError::Timeout)?
        .map_err(|_| CookieStoreError::Unavailable)?
}

/// Await the engine's completion callback. Returning from with_webview only
/// schedules the change; it is not evidence that navigation may safely start.
pub(crate) async fn write(
    webview: &Webview,
    profile_id: &str,
    cookie: Cookie,
    delete: bool,
) -> Result<()> {
    let expected = expected_profile(webview.label(), profile_id)?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let sender = Mutex::new(Some(sender));
    webview
        .with_webview(move |platform| unsafe {
            let view: &WKWebView = &*platform.inner().cast();
            let store = match cookie_store(view, expected) {
                Ok(store) => store,
                Err(error) => {
                    if let Ok(mut sender) = sender.lock() {
                        if let Some(sender) = sender.take() {
                            let _ = sender.send(Err(error));
                        }
                    }
                    return;
                }
            };
            let native = match import_cookie(&cookie) {
                Ok(native) => native,
                Err(error) => {
                    if let Ok(mut sender) = sender.lock() {
                        if let Some(sender) = sender.take() {
                            let _ = sender.send(Err(error));
                        }
                    }
                    return;
                }
            };
            let handler = RcBlock::new(move || {
                if let Ok(mut sender) = sender.lock() {
                    if let Some(sender) = sender.take() {
                        let _ = sender.send(Ok(()));
                    }
                }
            });
            if delete {
                store.deleteCookie_completionHandler(&native, Some(&handler));
            } else {
                store.setCookie_completionHandler(&native, Some(&handler));
            }
        })
        .map_err(|_| CookieStoreError::Unavailable)?;
    tokio::time::timeout(TIMEOUT, receiver)
        .await
        .map_err(|_| CookieStoreError::Timeout)?
        .map_err(|_| CookieStoreError::Unavailable)?
}

#[cfg(test)]
mod tests;
