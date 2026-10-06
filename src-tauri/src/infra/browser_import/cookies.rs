//! Signed-in sites: another browser's saved cookies, decrypted in this process
//! and written straight into a Misty browser profile. Values are never logged,
//! returned to the renderer or kept after the import.
use super::discover::{Browser, Family};
use super::model::chromium_time_ms;
use super::snapshot::Snapshot;
use misty_browser_sync::document::credentials::{Cookie, SameSite};
use rusqlite::Connection;
use std::path::Path;
use zeroize::Zeroizing;

/// Matches the native cookie store's limit for one profile.
pub const MAX_COOKIES: usize = 20_000;

/// Why a browser's sign-ins cannot come across, in the person's words.
pub fn unavailable(browser: Browser) -> Option<&'static str> {
    match browser.family() {
        Family::Safari => Some("Safari keeps sign-ins where other apps can't read them."),
        Family::Firefox => None,
        Family::Chromium if cfg!(target_os = "macos") || cfg!(windows) => None,
        Family::Chromium => Some("Sign-ins from this browser can't be imported on Linux yet."),
    }
}

pub struct ReadCookies {
    pub cookies: Vec<Cookie>,
    /// Sites whose cookies this browser locks to itself (Chrome's app-bound encryption).
    pub locked: usize,
}

fn now_seconds() -> i64 {
    super::super::browser_library::now_ms() / 1000
}

fn host_only(domain: &str) -> bool {
    !domain.starts_with('.')
}

fn finish(mut cookie: Cookie) -> Option<Cookie> {
    // A Secure-only policy without Secure is refused by every engine.
    if matches!(cookie.same_site, Some(SameSite::None)) && !cookie.secure {
        cookie.same_site = None;
    }
    cookie.validate().ok()?;
    Some(cookie)
}

pub fn read(browser: Browser, profile: &Path) -> Result<ReadCookies, String> {
    if let Some(reason) = unavailable(browser) {
        return Err(reason.into());
    }
    match browser.family() {
        Family::Firefox => {
            let snapshot = Snapshot::sqlite(&profile.join("cookies.sqlite"))?;
            Ok(ReadCookies {
                cookies: firefox(&snapshot.open()?)?,
                locked: 0,
            })
        }
        _ => {
            // Newer Chrome keeps cookies under Network/.
            let file = [profile.join("Network/Cookies"), profile.join("Cookies")]
                .into_iter()
                .find(|path| path.is_file())
                .ok_or_else(|| "That browser has no saved sign-ins.".to_owned())?;
            let snapshot = Snapshot::sqlite(&file)?;
            let key = super::chromium_key::key(browser, profile)?;
            chromium(&snapshot.open()?, &key)
        }
    }
}

pub fn count(browser: Browser, profile: &Path) -> Result<usize, String> {
    if let Some(reason) = unavailable(browser) {
        return Err(reason.into());
    }
    let (file, query) = match browser.family() {
        Family::Firefox => (
            profile.join("cookies.sqlite"),
            "SELECT COUNT(DISTINCT host) FROM moz_cookies",
        ),
        _ => (
            [profile.join("Network/Cookies"), profile.join("Cookies")]
                .into_iter()
                .find(|path| path.is_file())
                .ok_or_else(|| "That browser has no saved sign-ins.".to_owned())?,
            "SELECT COUNT(DISTINCT host_key) FROM cookies WHERE is_persistent = 1",
        ),
    };
    let snapshot = Snapshot::sqlite(&file)?;
    snapshot
        .open()?
        .query_row(query, [], |r| r.get::<_, i64>(0))
        .map(|n| n.max(0) as usize)
        .map_err(|_| "That browser's sign-ins could not be read.".to_owned())
}

pub fn firefox(db: &Connection) -> Result<Vec<Cookie>, String> {
    let now = now_seconds();
    let mut statement = db
        .prepare(
            "SELECT name, value, host, path, expiry, isSecure, isHttpOnly, sameSite
             FROM moz_cookies WHERE originAttributes = '' LIMIT ?1",
        )
        .map_err(|_| "Firefox's sign-ins could not be read.".to_owned())?;
    let rows = statement
        .query_map([MAX_COOKIES as i64], |r| {
            Ok((
                r.get::<_, String>(0)?,
                Zeroizing::new(r.get::<_, String>(1)?),
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, bool>(5)?,
                r.get::<_, bool>(6)?,
                r.get::<_, i64>(7)?,
            ))
        })
        .map_err(|_| "Firefox's sign-ins could not be read.".to_owned())?;
    Ok(rows
        .flatten()
        .filter_map(
            |(name, value, host, path, expiry, secure, http_only, same_site)| {
                // Older Firefox stored seconds, newer milliseconds.
                let expires = if expiry > 100_000_000_000 {
                    expiry / 1000
                } else {
                    expiry
                };
                if expires <= now {
                    return None;
                }
                finish(Cookie {
                    name,
                    value: value.to_string(),
                    host_only: host_only(&host),
                    domain: host,
                    path,
                    secure,
                    http_only,
                    same_site: match same_site {
                        0 => Some(SameSite::None),
                        1 => Some(SameSite::Lax),
                        2 => Some(SameSite::Strict),
                        _ => None,
                    },
                    expires_unix_seconds: Some(expires),
                    partition_key: None,
                })
            },
        )
        .collect())
}

pub fn chromium(
    db: &Connection,
    key: &super::chromium_key::CookieKey,
) -> Result<ReadCookies, String> {
    let now = now_seconds();
    // Version 24 and later prefix each value with a hash of its domain.
    let version: i64 = db
        .query_row("SELECT value FROM meta WHERE key = 'version'", [], |r| {
            r.get::<_, String>(0).map(|v| v.parse().unwrap_or(0))
        })
        .unwrap_or(0);
    let partitioned = db
        .prepare("SELECT top_frame_site_key FROM cookies LIMIT 0")
        .is_ok();
    let query = format!(
        "SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite
         FROM cookies WHERE is_persistent = 1 {} LIMIT ?1",
        if partitioned { "AND top_frame_site_key = ''" } else { "" }
    );
    let mut statement = db
        .prepare(&query)
        .map_err(|_| "That browser's sign-ins could not be read.".to_owned())?;
    let rows = statement
        .query_map([MAX_COOKIES as i64], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                Zeroizing::new(r.get::<_, String>(2)?),
                Zeroizing::new(r.get::<_, Vec<u8>>(3)?),
                r.get::<_, String>(4)?,
                r.get::<_, i64>(5)?,
                r.get::<_, bool>(6)?,
                r.get::<_, bool>(7)?,
                r.get::<_, i64>(8)?,
            ))
        })
        .map_err(|_| "That browser's sign-ins could not be read.".to_owned())?;
    let mut out = ReadCookies {
        cookies: Vec::new(),
        locked: 0,
    };
    for (host, name, plain, encrypted, path, expires_utc, secure, http_only, same_site) in
        rows.flatten()
    {
        let Some(expires) = chromium_time_ms(expires_utc).map(|ms| ms / 1000) else {
            continue;
        };
        if expires <= now {
            continue;
        }
        let value = if encrypted.is_empty() {
            plain
        } else {
            match key.decrypt(&encrypted) {
                super::chromium_key::Decrypted::Value(mut bytes) => {
                    if version >= 24 && bytes.len() >= 32 {
                        bytes.drain(..32);
                    }
                    match String::from_utf8(bytes.to_vec()) {
                        Ok(text) => Zeroizing::new(text),
                        Err(_) => continue,
                    }
                }
                super::chromium_key::Decrypted::Locked => {
                    out.locked += 1;
                    continue;
                }
                super::chromium_key::Decrypted::Failed => continue,
            }
        };
        if let Some(cookie) = finish(Cookie {
            name,
            value: value.to_string(),
            host_only: host_only(&host),
            domain: host,
            path,
            secure,
            http_only,
            same_site: match same_site {
                0 => Some(SameSite::None),
                1 => Some(SameSite::Lax),
                2 => Some(SameSite::Strict),
                _ => None,
            },
            expires_unix_seconds: Some(expires),
            partition_key: None,
        }) {
            out.cookies.push(cookie);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_live_firefox_cookies_and_leaves_containers_and_expired_ones() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE moz_cookies (name TEXT, value TEXT, host TEXT, path TEXT, expiry INTEGER,
               isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER, originAttributes TEXT);
             INSERT INTO moz_cookies VALUES
               ('sid', 'abc', '.example.com', '/', 4102444800, 1, 1, 1, ''),
               ('ms', 'def', 'app.example.com', '/', 4102444800000, 1, 0, 0, ''),
               ('old', 'x', 'example.com', '/', 1, 0, 0, 0, ''),
               ('box', 'y', 'example.com', '/', 4102444800, 0, 0, 0, '^userContextId=1');",
        )
        .unwrap();
        let cookies = firefox(&db).unwrap();
        assert_eq!(cookies.len(), 2);
        assert!(!cookies[0].host_only && cookies[1].host_only);
        assert_eq!(cookies[1].expires_unix_seconds, Some(4_102_444_800));
        assert!(matches!(cookies[1].same_site, Some(SameSite::None)));
    }
}
