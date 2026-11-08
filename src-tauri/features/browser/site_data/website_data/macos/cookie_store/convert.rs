//! Converting cookies between the sync document and Foundation's NSHTTPCookie.
use super::*;

// WebKit's Cocoa bridge may include partition metadata in the public
// properties dictionary even though no portable partition API is exposed.
// Absence is not proof of complete partition coverage on every OS release.
fn partitioned(native: &NSHTTPCookie) -> bool {
    native.properties().is_some_and(|properties| {
        properties
            .objectForKey(ns_string!("StoragePartition"))
            .is_some()
    })
}

pub(super) fn export_cookie(native: &NSHTTPCookie) -> Result<Cookie> {
    // Refuse a partitioned cookie; never silently broaden it to an
    // unpartitioned one. Ports have no portable representation either.
    if partitioned(native) || native.portList().is_some_and(|ports| !ports.is_empty()) {
        return Err(CookieStoreError::Unsupported);
    }
    let domain = native.domain().to_string();
    let same_site = match native.sameSitePolicy().map(|value| value.to_string()) {
        // nil is a cookie set without a SameSite attribute (Foundation reports
        // nil even for insecure cookies). Keep it unspecified, as WebView2
        // does, so the engine applies its own default after a restore.
        None => None,
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

/// A cookie exactly as given: refused if Foundation would change anything about it.
pub(crate) fn import_cookie(cookie: &Cookie) -> Result<Retained<NSHTTPCookie>> {
    let native = native_cookie(cookie)?;
    let exported = aligned_export(cookie, &native)?;
    if !equal(cookie, &exported)? {
        return Err(CookieStoreError::Unsupported);
    }
    Ok(native)
}

/// A cookie as close as this engine holds it: Foundation may shorten a long expiry, and anything
/// else it would change is refused.
pub(super) fn clamped_cookie(cookie: &Cookie) -> Result<Retained<NSHTTPCookie>> {
    let native = native_cookie(cookie)?;
    let mut exported = aligned_export(cookie, &native)?;
    if exported.expires_unix_seconds.is_some() {
        exported.expires_unix_seconds = cookie.expires_unix_seconds;
    }
    if !equal(cookie, &exported)? {
        return Err(CookieStoreError::Unsupported);
    }
    Ok(native)
}

/// What Foundation made of a cookie, with the explicit `SameSite=None` it never reports.
fn aligned_export(cookie: &Cookie, native: &NSHTTPCookie) -> Result<Cookie> {
    let mut exported = export_cookie(native)?;
    if matches!(cookie.same_site, Some(SameSite::None)) && exported.same_site.is_none() {
        exported.same_site = Some(SameSite::None);
    }
    Ok(exported)
}

fn native_cookie(cookie: &Cookie) -> Result<Retained<NSHTTPCookie>> {
    cookie.validate().map_err(|_| CookieStoreError::Invalid)?;
    if cookie.partition_key.is_some() {
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
        NSHTTPCookie::cookieWithProperties(&properties).ok_or(CookieStoreError::Invalid)
    }
}

pub(super) fn equal(a: &Cookie, b: &Cookie) -> Result<bool> {
    let normalized = |cookie: &Cookie| -> Result<serde_json::Value> {
        let mut value = serde_json::to_value(cookie).map_err(|_| CookieStoreError::Invalid)?;
        value["domain"] = serde_json::Value::String(cookie.domain.trim_start_matches('.').into());
        Ok(value)
    };
    Ok(normalized(a)? == normalized(b)?)
}

pub(super) fn skip(native: &NSHTTPCookie, error: CookieStoreError) -> (String, SkipReason) {
    let reason = if partitioned(native) {
        SkipReason::Partitioned
    } else if error == CookieStoreError::Invalid {
        SkipReason::Malformed
    } else {
        SkipReason::UnsupportedAttributes
    };
    (site(&native.domain().to_string()), reason)
}
