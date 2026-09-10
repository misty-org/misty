// SPDX-License-Identifier: MIT
//! Where extension packages come from: Firefox Add-ons and the Chrome Web
//! Store. People find extensions on the stores' own websites; Misty only asks
//! a store for the current package of one extension and downloads it from
//! that store's hosts.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

/// The store an extension installs from.
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Store {
    #[default]
    Firefox,
    Chrome,
}

impl Store {
    /// Firefox Add-ons IDs are numbers; Chrome Web Store IDs are 32 letters a–p.
    pub fn of(id: &str) -> Option<Self> {
        if is_chrome_id(id) {
            Some(Self::Chrome)
        } else if (1..=20).contains(&id.len())
            && !id.starts_with('0')
            && id.bytes().all(|b| b.is_ascii_digit())
            && id.parse::<u64>().is_ok()
        {
            Some(Self::Firefox)
        } else {
            None
        }
    }
}

pub fn is_chrome_id(value: &str) -> bool {
    value.len() == 32 && value.bytes().all(|b| (b'a'..=b'p').contains(&b))
}

/// Account settings written before Chrome Web Store support store Firefox
/// Add-ons IDs as numbers; both forms read as the same string.
pub fn extension_id<'de, D: serde::Deserializer<'de>>(value: D) -> Result<String, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Raw {
        Number(u64),
        Text(String),
    }
    Ok(match Raw::deserialize(value)? {
        Raw::Number(number) => number.to_string(),
        Raw::Text(text) => text,
    })
}

/// A store took the extension down. Misty stops running it and says so.
pub const REMOVED: &str =
    "This extension is no longer available from its store, so Misty stopped running it.";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    #[serde(deserialize_with = "extension_id")]
    pub id: String,
    #[serde(default)]
    pub store: Store,
    pub guid: String,
    pub slug: String,
    pub name: String,
    pub summary: String,
    pub description: String,
    pub authors: Vec<String>,
    pub icon_url: String,
    pub version: String,
    pub users: u64,
    pub rating: f64,
    pub source_url: String,
    pub download_url: String,
    pub digest: String,
}

pub fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("Misty/0.1 (native WebKit extensions)")
        .timeout(Duration::from_secs(45))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || !trusted_url(attempt.url()) {
                attempt.error("Extension download redirected outside its store")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|e| e.to_string())
}

/// Store hosts. Packages are also checked against the store's digest, and
/// Chrome packages against the store's signature, so a host alone is never
/// trusted with what runs.
pub fn trusted_url(url: &url::Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none_or(|p| p == 443)
        && url.host_str().is_some_and(|host| {
            matches!(
                host,
                "addons.mozilla.org"
                    | "addons.cdn.mozilla.net"
                    | "addons.mozilla.net"
                    | "clients2.google.com"
                    | "clients2.googleusercontent.com"
            ) || host.ends_with(".gvt1.com")
        })
}

/// Downloads a store resource. `Ok(None)` means the store answered 404.
pub async fn fetch(url: &str, limit: usize) -> Result<Option<Vec<u8>>, String> {
    let url = url::Url::parse(url).map_err(|_| "Invalid store URL")?;
    if !trusted_url(&url) {
        return Err("Extension resources must come from their store.".into());
    }
    let response = client()?
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    let mut response = response.error_for_status().map_err(|e| e.to_string())?;
    if response.content_length().is_some_and(|n| n > limit as u64) {
        return Err("Extension resource is too large.".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len().saturating_add(chunk.len()) > limit {
            return Err("Extension resource is too large.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(Some(bytes))
}

pub async fn bytes(url: &str, limit: usize) -> Result<Vec<u8>, String> {
    fetch(url, limit)
        .await?
        .ok_or_else(|| "The store could not find this extension download.".to_owned())
}

/// The current package of an extension. `key` is an extension ID, or a
/// Firefox Add-ons slug read from the add-on's page.
pub async fn latest(key: &str) -> Result<CatalogEntry, String> {
    match Store::of(key) {
        Some(Store::Chrome) => super::chrome_store::latest(key).await,
        _ if is_slug(key) => detail(key).await,
        _ => Err("Invalid extension ID.".into()),
    }
}

fn is_slug(value: &str) -> bool {
    (1..=200).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.~@{}".contains(&b))
}

fn localized(value: &Value) -> String {
    value
        .as_str()
        .or_else(|| value.get("en-US").and_then(Value::as_str))
        .or_else(|| {
            value
                .as_object()
                .and_then(|v| v.values().find_map(Value::as_str))
        })
        .unwrap_or_default()
        .to_owned()
}

fn entry(value: &Value) -> Result<CatalogEntry, String> {
    let file = &value["current_version"]["file"];
    if value["is_disabled"] == true {
        return Err(REMOVED.into());
    }
    if value["type"] != "extension" || file["status"] != "public" {
        return Err("This extension is not publicly available.".into());
    }
    let string = |v: &Value| v.as_str().unwrap_or_default().to_owned();
    let entry = CatalogEntry {
        id: value["id"]
            .as_u64()
            .filter(|id| *id > 0)
            .ok_or("Mozilla returned an invalid extension ID.")?
            .to_string(),
        store: Store::Firefox,
        guid: string(&value["guid"]),
        slug: string(&value["slug"]),
        name: localized(&value["name"]),
        summary: localized(&value["summary"]),
        description: localized(&value["description"]),
        authors: value["authors"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|a| a["name"].as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default(),
        icon_url: string(&value["icon_url"]),
        version: string(&value["current_version"]["version"]),
        users: value["average_daily_users"].as_u64().unwrap_or(0),
        rating: value["ratings"]["average"].as_f64().unwrap_or(0.0),
        source_url: string(&value["url"]),
        download_url: string(&file["url"]),
        digest: string(&file["hash"]),
    };
    if entry.guid.is_empty() || entry.download_url.is_empty() {
        return Err("Mozilla returned incomplete package metadata.".into());
    }
    // Chrome IDs name Chrome extensions only, in approvals and extension origins.
    if is_chrome_id(&entry.guid) {
        return Err("Mozilla returned an invalid extension identity.".into());
    }
    Ok(entry)
}

/// A Firefox add-on by numeric ID or slug.
async fn detail(key: &str) -> Result<CatalogEntry, String> {
    let mut url = url::Url::parse("https://addons.mozilla.org/api/v5/addons/addon/").unwrap();
    url.path_segments_mut()
        .map_err(|_| "Invalid store URL")?
        .pop_if_empty()
        .push(key)
        .push("");
    let data = fetch(url.as_str(), 2 * 1024 * 1024)
        .await?
        .ok_or(REMOVED)?;
    entry(&serde_json::from_slice(&data).map_err(|_| "Mozilla returned invalid JSON.")?)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restricts_resources_to_store_origins() {
        for value in [
            "https://addons.mozilla.org/file.xpi",
            "https://addons.cdn.mozilla.net/x",
            "https://clients2.google.com/service/update2/crx",
            "https://clients2.googleusercontent.com/crx/blobs/x.crx",
            "https://edgedl.me.gvt1.com/edgedl/x.crx",
        ] {
            assert!(trusted_url(&url::Url::parse(value).unwrap()), "{value}");
        }
        for value in [
            "http://addons.mozilla.org/x",
            "https://addons.mozilla.org.evil.test/x",
            "https://user@addons.mozilla.org/x",
            "https://addons.mozilla.org:8443/x",
            "https://gvt1.com.evil.test/x",
            "https://evilgvt1.com/x",
            "https://googleusercontent.com/x",
        ] {
            assert!(!trusted_url(&url::Url::parse(value).unwrap()), "{value}");
        }
    }

    #[test]
    fn extension_ids_name_their_store() {
        assert_eq!(Store::of("607454"), Some(Store::Firefox));
        assert_eq!(
            Store::of("ddkjiahejlhfcafbddmgiahcphecmpfh"),
            Some(Store::Chrome)
        );
        for id in [
            "",
            "0",
            "0123",
            "ublock-origin",
            "ddkjiahejlhfcafbddmgiahcphecmpfz",
            "99999999999999999999999",
        ] {
            assert_eq!(Store::of(id), None, "{id}");
        }
        assert!(is_slug("ublock-origin") && is_slug("{abc-123}") && !is_slug("a/b"));
    }
}

#[cfg(test)]
mod live_tests {
    use super::*;
    #[tokio::test]
    #[ignore = "Downloads current public store packages; run explicitly for compatibility intake"]
    async fn store_package_intake() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        for key in [
            "darkreader",
            "bitwarden-password-manager",
            "single-file",
            "clearurls",
            // uBlock Origin Lite, Dark Reader and Bitwarden on the Chrome Web Store.
            "ddkjiahejlhfcafbddmgiahcphecmpfh",
            "eimadpbcbfnmbkopoojfekhnkhdbieeh",
            "nngceckbapebfimnlniiiahkandclblb",
        ] {
            let detail = latest(key).await.unwrap();
            let bytes = bytes(&detail.download_url, 64 * 1024 * 1024).await.unwrap();
            let root = tempfile::tempdir().unwrap();
            let review =
                super::super::package::extract(&bytes, detail, root.path(), "intake".into())
                    .unwrap();
            println!("{} {}: integrity/identity verified; {} required APIs, {} site patterns; blocked={}; runtime compatibility remains unverified",review.entry.name,review.entry.version,review.permissions.len(),review.hosts.len(),review.blocked);
        }
    }
}
