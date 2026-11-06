//! Native cookie transport, deliberately unavailable through renderer IPC. A profile's WebKit
//! store is opened by its identifier, so no page or helper view has to exist to reach it, and
//! nothing can be left behind when a window closes. Never call this on Misty's own
//! authentication store.

use super::coverage::{site, CookieRead, SkipReason};
use block2::RcBlock;
use misty_browser_sync::document::credentials::{Cookie, SameSite};
use objc2::{rc::Retained, runtime::AnyObject, MainThreadMarker};
use objc2_foundation::{
    ns_string, NSArray, NSDate, NSHTTPCookie, NSHTTPCookieDiscard, NSHTTPCookieDomain,
    NSHTTPCookieExpires, NSHTTPCookieName, NSHTTPCookiePath, NSHTTPCookiePropertyKey,
    NSHTTPCookieSameSitePolicy, NSHTTPCookieSecure, NSHTTPCookieValue, NSHTTPCookieVersion,
    NSMutableDictionary, NSProcessInfo, NSString, NSUUID,
};
use objc2_web_kit::{WKHTTPCookieStore, WKWebView, WKWebsiteDataStore};
use std::{sync::Mutex, time::Duration};
use tauri::{AppHandle, Webview};

mod convert;
#[cfg(test)]
use convert::equal;
pub(crate) use convert::import_cookie;
use convert::{clamped_cookie, export_cookie, skip};

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

/// A store identifier, on systems that have per-identifier stores. Never falls back to Misty's
/// default store or an ephemeral one.
fn store_identifier(profile_id: &str) -> Result<[u8; 16]> {
    if NSProcessInfo::processInfo()
        .operatingSystemVersion()
        .majorVersion
        < 14
    {
        return Err(CookieStoreError::Unsupported);
    }
    super::super::browser_profile::data_store_identifier(Some(profile_id))
        .map_err(|_| CookieStoreError::Profile)
}

unsafe fn view_cookie_store(
    view: &WKWebView,
    expected: [u8; 16],
) -> Result<Retained<WKHTTPCookieStore>> {
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

/// Reads raw engine cookies without leaking them into JS, events, or logs. A cookie that cannot
/// be represented exactly is skipped and reported, never broadened; partitioned cookies are
/// never claimed. WebKit answers on the main thread, but only retains there: converting runs on
/// a worker, since a large store takes long enough to be felt.
pub(crate) async fn read(app: &AppHandle, profile_id: &str) -> Result<CookieRead> {
    let identifier = store_identifier(profile_id)?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let sender = Mutex::new(Some(sender));
    app.run_on_main_thread(move || unsafe {
        let finish = |natives: Result<Vec<Retained<NSHTTPCookie>>>| {
            if let Some(sender) = sender.lock().ok().and_then(|mut sender| sender.take()) {
                let _ = sender.send(natives);
            }
        };
        let Some(mtm) = MainThreadMarker::new() else {
            finish(Err(CookieStoreError::Unavailable));
            return;
        };
        let store =
            WKWebsiteDataStore::dataStoreForIdentifier(&NSUUID::from_bytes(identifier), mtm);
        let keep = store.clone();
        let handler = RcBlock::new(move |cookies: std::ptr::NonNull<NSArray<NSHTTPCookie>>| {
            // The store has to outlive the request.
            let _store = &keep;
            let natives = cookies.as_ref().iter().collect();
            if let Some(sender) = sender.lock().ok().and_then(|mut sender| sender.take()) {
                let _ = sender.send(Ok(natives));
            }
        });
        store.httpCookieStore().getAllCookies(&handler);
    })
    .map_err(|_| CookieStoreError::Unavailable)?;
    let natives = tokio::time::timeout(TIMEOUT, receiver)
        .await
        .map_err(|_| CookieStoreError::Timeout)?
        .map_err(|_| CookieStoreError::Unavailable)??;
    tokio::task::spawn_blocking(move || {
        objc2::rc::autoreleasepool(|_| {
            CookieRead::accept(
                natives
                    .iter()
                    .map(|cookie| export_cookie(cookie).map_err(|error| skip(cookie, error))),
                COOKIE_LIMIT,
            )
        })
    })
    .await
    .map_err(|_| CookieStoreError::Unavailable)
}

/// Verify the native profile of a page or inert view that website storage runs in.
pub(crate) async fn verify_storage_profile(webview: &Webview, profile_id: &str) -> Result<()> {
    let expected = expected_profile(webview.label(), profile_id)?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    webview
        .with_webview(move |platform| unsafe {
            let view: &WKWebView = &*platform.inner().cast();
            let _ = sender.send(view_cookie_store(view, expected).map(|_| ()));
        })
        .map_err(|_| CookieStoreError::Unavailable)?;
    tokio::time::timeout(TIMEOUT, receiver)
        .await
        .map_err(|_| CookieStoreError::Timeout)?
        .map_err(|_| CookieStoreError::Unavailable)?
}

/// Sets or deletes one cookie, without touching any page, and waits for the engine's completion
/// callback: returning from the main thread only schedules the change. The cookie is built on
/// the caller's thread. The engine may clamp a long expiry.
pub(crate) async fn write(
    app: &AppHandle,
    profile_id: &str,
    cookie: Cookie,
    delete: bool,
) -> Result<()> {
    let identifier = store_identifier(profile_id)?;
    let native = objc2::rc::autoreleasepool(|_| clamped_cookie(&cookie))?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let sender = Mutex::new(Some(sender));
    app.run_on_main_thread(move || unsafe {
        let Some(mtm) = MainThreadMarker::new() else {
            if let Some(sender) = sender.lock().ok().and_then(|mut sender| sender.take()) {
                let _ = sender.send(Err(CookieStoreError::Unavailable));
            }
            return;
        };
        let store =
            WKWebsiteDataStore::dataStoreForIdentifier(&NSUUID::from_bytes(identifier), mtm);
        let keep = store.clone();
        let handler = RcBlock::new(move || {
            let _store = &keep;
            if let Some(sender) = sender.lock().ok().and_then(|mut sender| sender.take()) {
                let _ = sender.send(Ok(()));
            }
        });
        let cookies = store.httpCookieStore();
        if delete {
            cookies.deleteCookie_completionHandler(&native, Some(&handler));
        } else {
            cookies.setCookie_completionHandler(&native, Some(&handler));
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
