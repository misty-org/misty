use serde::Deserialize;
use serde_json::Value;
use url::Url;

use super::manifest::{AppManifest, McpKind, Permission, Platform};

#[derive(Debug, Clone, Deserialize)]
pub struct MediaCheck {
    #[serde(default)]
    pub drm: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SiteEntry {
    pub id: String,
    pub name: String,
    pub version: String,
    pub address: String,
    pub origins: Vec<String>,
    #[serde(default)]
    pub platforms: Vec<Platform>,
    #[serde(default)]
    pub permissions: Vec<Permission>,
    #[serde(default)]
    pub media: std::collections::HashMap<Platform, MediaCheck>,
    #[serde(default)]
    pub adapter_source: Option<String>,
}

impl SiteEntry {
    pub fn runs_here(&self) -> bool {
        let Some(here) = Platform::current() else {
            return false;
        };
        (self.platforms.is_empty() || self.platforms.contains(&here))
            && self.media.get(&here).is_some_and(|check| !check.drm)
    }

    pub fn address(&self) -> Option<Url> {
        Url::parse(&self.address)
            .ok()
            .filter(|url| url.scheme() == "https" && self.allows(url))
    }

    pub fn allows(&self, url: &Url) -> bool {
        self.origins.iter().any(|origin| origin_allows(origin, url))
    }

    pub fn has_space_features(&self) -> bool {
        cfg!(target_os = "macos") && self.adapter_source.is_some()
    }

    pub fn manifest(&self) -> Result<AppManifest, String> {
        serde_json::from_value(serde_json::json!({
            "id": self.id,
            "name": self.name,
            "version": self.version,
            "logo": "",
            "entry": "",
            "permissions": self.permissions,
            "mcp": self.adapter_source.as_ref().map(|_| McpKind::Adapter),
            "platforms": self.platforms,
        }))
        .map_err(|error| error.to_string())
    }
}

pub fn origin_allows(origin: &str, url: &Url) -> bool {
    if url.scheme() != "https" || url.port().is_some() || !url.username().is_empty() {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    let Some(allowed) = origin.strip_prefix("https://") else {
        return false;
    };
    match allowed.strip_prefix("*.") {
        Some(domain) => {
            host.len() > domain.len()
                && host.ends_with(domain)
                && host[..host.len() - domain.len()].ends_with('.')
        }
        None => host == allowed,
    }
}

fn entry_in(apps: &str, id: &str) -> Option<SiteEntry> {
    let document: Value = serde_json::from_str(apps).ok()?;
    document
        .get("apps")?
        .as_array()?
        .iter()
        .find(|app| {
            app.get("kind").and_then(Value::as_str) == Some("site")
                && app.get("id").and_then(Value::as_str) == Some(id)
        })
        .and_then(|app| serde_json::from_value(app.clone()).ok())
}

pub fn site_entry(id: &str) -> Option<SiteEntry> {
    entry_in(&crate::registry::current().apps_json(), id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(value: &str) -> Url {
        Url::parse(value).unwrap()
    }

    #[test]
    fn origins_hold_a_site_to_its_own_hosts() {
        assert!(origin_allows(
            "https://music.youtube.com",
            &url("https://music.youtube.com/watch?v=1")
        ));
        assert!(!origin_allows(
            "https://music.youtube.com",
            &url("http://music.youtube.com/")
        ));
        assert!(origin_allows(
            "https://*.google.com",
            &url("https://accounts.google.com/x")
        ));
        assert!(!origin_allows(
            "https://*.google.com",
            &url("https://google.com/")
        ));
        assert!(!origin_allows(
            "https://*.google.com",
            &url("https://evilgoogle.com/")
        ));
        assert!(!origin_allows(
            "https://music.youtube.com",
            &url("https://music.youtube.com:8443/")
        ));
    }

    #[test]
    fn a_site_entry_is_read_from_the_registry() {
        let apps = r#"{"apps":[{"id":"draw","url":"x"},{"kind":"site","id":"tunes","name":"Tunes","version":"1.0.0",
            "address":"https://tunes.example.com/","origins":["https://tunes.example.com"],"platforms":["macos"],
            "media":{"macos":{"drm":false}},"permissions":["rooms"],"adapter_source":"1"}]}"#;
        let site = entry_in(apps, "tunes").unwrap();
        assert_eq!(
            site.address().unwrap().as_str(),
            "https://tunes.example.com/"
        );
        assert!(entry_in(apps, "draw").is_none());
        let manifest = site.manifest().unwrap();
        assert_eq!(manifest.mcp, Some(McpKind::Adapter));
        assert_eq!(manifest.permissions, vec![Permission::Rooms]);
    }
}
