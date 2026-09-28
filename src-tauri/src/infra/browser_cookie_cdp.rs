//! Portable cookie fields at the native WebView2/CDP boundary. No renderer IPC.
//! Partitioned cookies and unknown SameSite policies are skipped and reported,
//! never broadened or guessed.
use super::browser_data_coverage::{site, CookieRead, SkipReason};
use misty_browser_sync::document::credentials::{Cookie, SameSite};
use serde::Deserialize;
use serde_json::{json, Value};

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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EngineCookie {
    name: String,
    value: String,
    domain: String,
    path: String,
    expires: Option<f64>,
    http_only: bool,
    secure: bool,
    session: bool,
    same_site: Option<String>,
    partition_key: Option<Value>,
    #[serde(default)]
    partition_key_opaque: bool,
}

pub(crate) fn decode(value: Value) -> Result<CookieRead> {
    let raw = value
        .get("cookies")
        .and_then(Value::as_array)
        .ok_or(CookieStoreError::Invalid)?;
    Ok(CookieRead::accept(
        raw.iter().map(|raw| {
            let skip = |reason| (site(raw["domain"].as_str().unwrap_or_default()), reason);
            decode_one(raw).map_err(skip)
        }),
        20_000,
    ))
}

fn decode_one(raw: &Value) -> std::result::Result<Cookie, SkipReason> {
    let native: EngineCookie =
        serde_json::from_value(raw.clone()).map_err(|_| SkipReason::Malformed)?;
    if native.partition_key.is_some() || native.partition_key_opaque {
        return Err(SkipReason::Partitioned);
    }
    let same_site = match native.same_site.as_deref() {
        Some("Strict") => Some(SameSite::Strict),
        Some("Lax") => Some(SameSite::Lax),
        Some("None") => Some(SameSite::None),
        None => None, // Preserve unspecified; never guess an engine default.
        _ => return Err(SkipReason::UnsupportedAttributes),
    };
    let expires_unix_seconds = if native.session {
        None
    } else {
        let seconds = native.expires.ok_or(SkipReason::UnsupportedAttributes)?;
        if !seconds.is_finite() || seconds < 0. || seconds >= i64::MAX as f64 {
            return Err(SkipReason::UnsupportedAttributes);
        }
        Some(seconds.floor() as i64)
    };
    Ok(Cookie {
        name: native.name,
        value: native.value,
        host_only: !native.domain.starts_with('.'),
        domain: native.domain,
        path: native.path,
        secure: native.secure,
        http_only: native.http_only,
        same_site,
        expires_unix_seconds,
        partition_key: None,
    })
}

/// Whether Storage.setCookies can store the cookie exactly.
pub(crate) fn representable(cookie: &Cookie) -> bool {
    encode(cookie).is_ok()
}

pub(crate) fn encode(cookie: &Cookie) -> Result<Value> {
    cookie.validate().map_err(|_| CookieStoreError::Invalid)?;
    if cookie.partition_key.is_some() {
        return Err(CookieStoreError::Unsupported);
    }
    let mut result = json!({
        "name": cookie.name, "value": cookie.value, "path": cookie.path,
        "secure": cookie.secure, "httpOnly": cookie.http_only,
    });
    if cookie.host_only {
        // URL + no domain is how Chromium distinguishes host-only cookies from
        // domain cookies. Explicitly specifying a domain can broaden the scope.
        let scheme = if cookie.secure { "https" } else { "http" };
        let url = url::Url::parse(&format!("{scheme}://{}/", cookie.domain))
            .map_err(|_| CookieStoreError::Invalid)?;
        if url.host_str() != Some(cookie.domain.as_str())
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err(CookieStoreError::Invalid);
        }
        result["url"] = json!(url.as_str());
    } else {
        result["domain"] = json!(format!(".{}", cookie.domain.trim_start_matches('.')));
    }
    if let Some(expires) = cookie.expires_unix_seconds {
        result["expires"] = json!(expires);
    }
    if let Some(same_site) = &cookie.same_site {
        result["sameSite"] = json!(match same_site {
            SameSite::Strict => "Strict",
            SameSite::Lax => "Lax",
            SameSite::None => "None",
        });
    }
    Ok(result)
}

pub(crate) fn deletion(cookie: &Cookie) -> Result<Value> {
    encode(cookie)?;
    // Exact domain/path deletion preserves a host cookie and a domain cookie
    // sharing the same name. URL-based deletion would match both.
    Ok(json!({ "name": cookie.name, "path": cookie.path,
        "domain": if cookie.host_only { cookie.domain.clone() } else { format!(".{}", cookie.domain.trim_start_matches('.')) } }))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn engine() -> Value {
        json!({ "name": "session", "value": "synthetic", "domain": "example.test", "path": "/",
            "expires": -1, "httpOnly": true, "secure": true, "session": true, "sameSite": "Lax" })
    }
    #[test]
    fn preserves_host_domain_session_expiry_and_same_site_distinctions() {
        let host = decode(json!({ "cookies": [engine()] }))
            .unwrap()
            .cookies
            .remove(0);
        let mut domain = host.clone();
        domain.host_only = false;
        assert_eq!(encode(&host).unwrap()["url"], "https://example.test/");
        assert!(encode(&host).unwrap().get("domain").is_none());
        assert!(encode(&host).unwrap().get("expires").is_none());
        assert_eq!(encode(&domain).unwrap()["domain"], ".example.test");
        assert!(encode(&domain).unwrap().get("url").is_none());
        assert_ne!(deletion(&host).unwrap(), deletion(&domain).unwrap());
        let mut raw = engine();
        raw["domain"] = json!(".example.test");
        raw["session"] = json!(false);
        raw["expires"] = json!(1_900_000_000.75);
        raw.as_object_mut().unwrap().remove("sameSite");
        let persistent = decode(json!({ "cookies": [raw] }))
            .unwrap()
            .cookies
            .remove(0);
        assert!(!persistent.host_only);
        assert_eq!(persistent.expires_unix_seconds, Some(1_900_000_000));
        assert!(persistent.same_site.is_none());
        assert!(encode(&persistent).unwrap().get("sameSite").is_none());
    }
    #[test]
    fn skips_partitioned_or_incomplete_cookies_and_keeps_the_rest() {
        assert!(decode(json!({})).is_err());
        assert!(decode(json!({ "cookies": [] })).unwrap().cookies.is_empty());
        let mut incomplete = engine();
        incomplete["session"] = json!(false);
        incomplete["expires"] = Value::Null;
        for (key, value, reason) in [
            (
                "partitionKey",
                json!({ "topLevelSite": "https://example.test", "hasCrossSiteAncestor": true }),
                SkipReason::Partitioned,
            ),
            ("partitionKeyOpaque", json!(true), SkipReason::Partitioned),
            (
                "sameSite",
                json!("future-policy"),
                SkipReason::UnsupportedAttributes,
            ),
        ] {
            let mut raw = engine();
            raw[key] = value;
            let mut other = engine();
            other["name"] = json!("kept");
            let read = decode(json!({ "cookies": [raw, other, incomplete.clone()] })).unwrap();
            assert_eq!(read.cookies.len(), 1);
            assert_eq!(read.cookies[0].name, "kept");
            assert_eq!(
                read.skipped,
                vec![
                    ("example.test".into(), reason),
                    ("example.test".into(), SkipReason::UnsupportedAttributes)
                ]
            );
        }
    }
}
