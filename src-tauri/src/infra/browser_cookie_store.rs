//! Native cookie transport, deliberately unavailable through renderer IPC.
//! The sync coordinator must serialize imports per profile and hold its account
//! lease until completion. Never call this on Misty's own authentication webview.
#![allow(dead_code)] // Coordinator integration follows the adapter verification.

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

const COOKIE_LIMIT: usize = 20_000;
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
    super::browser_profile::data_store_identifier(Some(profile_id))
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

fn export_cookie(native: &NSHTTPCookie) -> Result<Cookie> {
    // WebKit's Cocoa bridge may include partition metadata in the public
    // properties dictionary even though no portable partition API is exposed.
    // Refuse such a cookie; never silently broaden it to an unpartitioned one.
    // Absence is not proof of complete partition coverage on every OS release.
    if native.properties().is_some_and(|properties| {
        properties
            .objectForKey(ns_string!("StoragePartition"))
            .is_some()
    }) || native.portList().is_some_and(|ports| !ports.is_empty())
    {
        return Err(CookieStoreError::Unsupported);
    }
    let domain = native.domain().to_string();
    let same_site = match native.sameSitePolicy().map(|value| value.to_string()) {
        // WebKit's Cocoa conversion treats nil as effective SameSite=None on
        // older systems. Newer systems expose the explicit "none" string.
        // This captures effective engine policy, not original Set-Cookie syntax.
        None => Some(SameSite::None),
        Some(value) if value.eq_ignore_ascii_case("lax") => Some(SameSite::Lax),
        Some(value) if value.eq_ignore_ascii_case("strict") => Some(SameSite::Strict),
        Some(value) if value.eq_ignore_ascii_case("none") => Some(SameSite::None),
        _ => return Err(CookieStoreError::Unsupported),
    };
    let expires_unix_seconds = if native.isSessionOnly() {
        None
    } else {
        native
            .expiresDate()
            .map(|date| date.timeIntervalSince1970() as i64)
    };
    let cookie = Cookie {
        name: native.name().to_string(),
        value: native.value().to_string(),
        host_only: !domain.starts_with('.'),
        domain,
        path: native.path().to_string(),
        secure: native.isSecure(),
        http_only: native.isHTTPOnly(),
        same_site,
        expires_unix_seconds,
        // This API does not expose a portable partition key. The coordinator
        // must report partitioned credentials as unsupported, never flatten them.
        partition_key: None,
    };
    cookie.validate().map_err(|_| CookieStoreError::Invalid)?;
    Ok(cookie)
}

fn import_cookie(cookie: &Cookie) -> Result<Retained<NSHTTPCookie>> {
    cookie.validate().map_err(|_| CookieStoreError::Invalid)?;
    if cookie.partition_key.is_some() || cookie.same_site.is_none() {
        return Err(CookieStoreError::Unsupported);
    }
    // The engine domain representation carries host-only semantics. It must not
    // pass through cookie::Cookie::domain(), which strips the leading dot.
    unsafe {
        let name = NSString::from_str(&cookie.name);
        let value = NSString::from_str(&cookie.value);
        let domain = NSString::from_str(&if cookie.host_only || cookie.domain.starts_with('.') {
            cookie.domain.clone()
        } else {
            format!(".{}", cookie.domain)
        });
        let path = NSString::from_str(&cookie.path);
        let properties: Retained<NSMutableDictionary<NSHTTPCookiePropertyKey, AnyObject>> =
            NSMutableDictionary::from_slices(
                &[
                    NSHTTPCookieName,
                    NSHTTPCookieValue,
                    NSHTTPCookieDomain,
                    NSHTTPCookiePath,
                ],
                &[&name, &value, &domain, &path],
            );
        if cookie.secure {
            properties.insert(NSHTTPCookieSecure, ns_string!("TRUE"));
        }
        if cookie.http_only {
            properties.insert(ns_string!("HttpOnly"), ns_string!("TRUE"));
        }
        properties.insert(NSHTTPCookieVersion, ns_string!("0"));
        if cookie.expires_unix_seconds.is_none() {
            properties.insert(NSHTTPCookieDiscard, ns_string!("TRUE"));
        }
        if let Some(expires) = cookie.expires_unix_seconds {
            let date = NSDate::dateWithTimeIntervalSince1970(expires as f64);
            properties.insert(NSHTTPCookieExpires, &*date);
        }
        if let Some(policy) = &cookie.same_site {
            let value = match policy {
                SameSite::Lax => ns_string!("lax"),
                SameSite::Strict => ns_string!("strict"),
                SameSite::None => ns_string!("none"),
            };
            properties.insert(NSHTTPCookieSameSitePolicy, value);
        }
        let native =
            NSHTTPCookie::cookieWithProperties(&properties).ok_or(CookieStoreError::Invalid)?;
        // Reject a lossy platform conversion before touching the live store.
        let exported = export_cookie(&native)?;
        if !equal(cookie, &exported)? {
            return Err(CookieStoreError::Unsupported);
        }
        Ok(native)
    }
}

fn equal(a: &Cookie, b: &Cookie) -> Result<bool> {
    let normalized = |cookie: &Cookie| -> Result<serde_json::Value> {
        let mut value = serde_json::to_value(cookie).map_err(|_| CookieStoreError::Invalid)?;
        value["domain"] = serde_json::Value::String(cookie.domain.trim_start_matches('.').into());
        Ok(value)
    };
    Ok(normalized(a)? == normalized(b)?)
}

/// Reads raw engine cookies without leaking them into JS, events, or logs.
/// `partition_key` coverage is intentionally not claimed by this adapter.
pub(crate) async fn read(webview: &Webview, profile_id: &str) -> Result<Vec<Cookie>> {
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
                    let result = if cookies.len() > COOKIE_LIMIT {
                        Err(CookieStoreError::TooLarge)
                    } else {
                        cookies
                            .iter()
                            .map(|cookie| export_cookie(&cookie))
                            .collect()
                    };
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
mod tests {
    use super::*;

    fn fixture() -> Cookie {
        Cookie {
            name: "session".into(),
            value: "synthetic-only".into(),
            domain: "example.test".into(),
            path: "/".into(),
            host_only: true,
            secure: true,
            http_only: true,
            same_site: Some(SameSite::Lax),
            expires_unix_seconds: None,
            partition_key: None,
        }
    }

    fn tomorrow() -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64
            + 86_400
    }

    #[test]
    fn refuses_host_authentication_views_and_invalid_profile_handles() {
        assert_eq!(
            expected_profile("main", &"a".repeat(64)),
            Err(CookieStoreError::Profile)
        );
        assert_eq!(
            expected_profile("misty-browser-test", "../profile"),
            Err(CookieStoreError::Profile)
        );
        assert_eq!(
            expected_profile("misty-browser-test", &"a".repeat(64)),
            Ok([0xaa; 16])
        );
    }

    #[test]
    fn foundation_round_trip_preserves_domain_and_session_security() {
        objc2::rc::autoreleasepool(|_| {
            for domain in ["example.test", ".example.test"] {
                for expires in [None, Some(tomorrow())] {
                    for policy in [SameSite::Lax, SameSite::Strict, SameSite::None] {
                        for secure in [true, false] {
                            if !secure && matches!(policy, SameSite::None) {
                                continue;
                            }
                            for http_only in [true, false] {
                                let mut cookie = fixture();
                                cookie.domain = domain.into();
                                cookie.host_only = !domain.starts_with('.');
                                cookie.expires_unix_seconds = expires;
                                cookie.same_site = Some(policy.clone());
                                cookie.secure = secure;
                                cookie.http_only = http_only;
                                let native =
                                    import_cookie(&cookie).expect("lossless cookie import");
                                assert!(equal(&cookie, &export_cookie(&native).unwrap()).unwrap());
                            }
                        }
                    }
                }
            }
        });
    }

    #[test]
    fn rejects_silent_expiry_shortening_and_unknown_same_site_semantics() {
        let mut cookie = fixture();
        cookie.expires_unix_seconds = Some(tomorrow() + 10 * 365 * 86_400);
        assert!(matches!(
            import_cookie(&cookie),
            Err(CookieStoreError::Unsupported)
        ));
        cookie.expires_unix_seconds = None;
        cookie.same_site = None;
        assert!(matches!(
            import_cookie(&cookie),
            Err(CookieStoreError::Unsupported)
        ));
    }

    #[test]
    fn refuses_to_drop_native_partition_and_port_restrictions() {
        for (key, value) in [
            (
                ns_string!("StoragePartition"),
                ns_string!("https://top.example.test"),
            ),
            (
                unsafe { objc2_foundation::NSHTTPCookiePort },
                ns_string!("443"),
            ),
        ] {
            let native = import_cookie(&fixture()).unwrap();
            let properties =
                NSMutableDictionary::dictionaryWithDictionary(&native.properties().unwrap());
            properties.insert(key, value);
            unsafe {
                properties.insert(NSHTTPCookieVersion, ns_string!("1"));
            }
            let native = unsafe { NSHTTPCookie::cookieWithProperties(&properties) }.unwrap();
            assert!(matches!(
                export_cookie(&native),
                Err(CookieStoreError::Unsupported)
            ));
        }
    }

    #[test]
    fn rejects_partitioned_and_invalid_cookies_before_mutating_the_store() {
        let mut cookie = fixture();
        cookie.partition_key = Some(misty_browser_sync::document::credentials::PartitionKey {
            top_level_site: "https://example.test".into(),
            has_cross_site_ancestor: false,
        });
        assert!(matches!(
            import_cookie(&cookie),
            Err(CookieStoreError::Unsupported)
        ));
        cookie.partition_key = None;
        cookie.name = "bad\r\nname".into();
        assert!(matches!(
            import_cookie(&cookie),
            Err(CookieStoreError::Invalid)
        ));
    }
}
