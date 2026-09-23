//! Portable cookie fields at the native WebView2/CDP boundary. No renderer IPC.
//! Partitioned cookies and unknown SameSite policies fail closed.
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

pub(crate) fn decode(value: Value) -> Result<Vec<Cookie>> {
    let raw = value
        .get("cookies")
        .and_then(Value::as_array)
        .ok_or(CookieStoreError::Invalid)?;
    if raw.len() > 20_000 {
        return Err(CookieStoreError::TooLarge);
    }
    raw.iter()
        .map(|raw| {
            let native: EngineCookie =
                serde_json::from_value(raw.clone()).map_err(|_| CookieStoreError::Invalid)?;
            if native.partition_key.is_some() || native.partition_key_opaque {
                return Err(CookieStoreError::Unsupported);
            }
            let same_site = match native.same_site.as_deref() {
                Some("Strict") => Some(SameSite::Strict),
                Some("Lax") => Some(SameSite::Lax),
                Some("None") => Some(SameSite::None),
                None => None, // Preserve unspecified; never guess an engine default.
                _ => return Err(CookieStoreError::Unsupported),
            };
            let expires_unix_seconds = if native.session {
                None
            } else {
                let seconds = native.expires.ok_or(CookieStoreError::Unsupported)?;
                if !seconds.is_finite() || seconds < 0. || seconds >= i64::MAX as f64 {
                    return Err(CookieStoreError::Unsupported);
                }
                Some(seconds.floor() as i64)
            };
            let cookie = Cookie {
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
            };
            cookie.validate().map_err(|_| CookieStoreError::Invalid)?;
            Ok(cookie)
        })
        .collect()
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
        let host = decode(json!({ "cookies": [engine()] })).unwrap().remove(0);
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
        let persistent = decode(json!({ "cookies": [raw] })).unwrap().remove(0);
        assert!(!persistent.host_only);
        assert_eq!(persistent.expires_unix_seconds, Some(1_900_000_000));
        assert!(persistent.same_site.is_none());
        assert!(encode(&persistent).unwrap().get("sameSite").is_none());
    }
    #[test]
    fn rejects_partitioned_or_incomplete_data_instead_of_reporting_logout() {
        assert!(decode(json!({})).is_err());
        assert!(decode(json!({ "cookies": [] })).unwrap().is_empty());
        for (key, value) in [
            (
                "partitionKey",
                json!({ "topLevelSite": "https://example.test", "hasCrossSiteAncestor": true }),
            ),
            ("partitionKeyOpaque", json!(true)),
            ("sameSite", json!("future-policy")),
        ] {
            let mut raw = engine();
            raw[key] = value;
            assert_eq!(
                decode(json!({ "cookies": [raw] })).err(),
                Some(CookieStoreError::Unsupported)
            );
        }
        let mut raw = engine();
        raw["session"] = json!(false);
        raw["expires"] = Value::Null;
        assert_eq!(
            decode(json!({ "cookies": [raw] })).err(),
            Some(CookieStoreError::Unsupported)
        );
    }
}
