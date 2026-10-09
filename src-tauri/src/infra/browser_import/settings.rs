//! The settings Misty has an equivalent for: search engine, homepage, startup,
//! and camera and microphone decisions for sites.
use super::discover::Family;
use super::snapshot::Snapshot;
use serde::Serialize;
use serde_json::Value;
use std::path::Path;

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedSettings {
    /// The engine's name and search URL; the app matches it to its own list.
    pub search_engine: Option<SearchEngine>,
    pub homepage: Option<String>,
    /// Whether the browser reopens the last session at startup.
    pub restore_session: Option<bool>,
    pub site_permissions: Vec<SitePermission>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchEngine {
    pub name: String,
    pub url: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SitePermission {
    pub origin: String,
    /// `camera` or `microphone`.
    pub kind: &'static str,
    pub allow: bool,
}

impl ImportedSettings {
    pub fn summary(&self) -> Vec<&'static str> {
        let mut out = Vec::new();
        if self.search_engine.is_some() {
            out.push("searchEngine");
        }
        if self.homepage.is_some() {
            out.push("homepage");
        }
        if self.restore_session.is_some() {
            out.push("startup");
        }
        if !self.site_permissions.is_empty() {
            out.push("sitePermissions");
        }
        out
    }
}

pub fn read(family: Family, profile: &Path) -> ImportedSettings {
    match family {
        Family::Chromium => chromium(profile),
        Family::Firefox => firefox(profile),
        Family::Safari => ImportedSettings::default(),
    }
}

fn web(value: &str) -> Option<String> {
    super::model::web_address(value)
}

fn origin(value: &str) -> Option<String> {
    let url = url::Url::parse(value).ok()?;
    matches!(url.scheme(), "http" | "https").then(|| url.origin().ascii_serialization())
}

fn chromium(profile: &Path) -> ImportedSettings {
    let prefs: Value = std::fs::read(profile.join("Preferences"))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    let homepage = (!prefs["homepage_is_newtabpage"].as_bool().unwrap_or(true))
        .then(|| prefs["homepage"].as_str().and_then(web))
        .flatten()
        .or_else(|| {
            // "Open a specific page" at startup is the closer match to a homepage.
            (prefs["session"]["restore_on_startup"].as_i64() == Some(4))
                .then(|| prefs["session"]["startup_urls"][0].as_str().and_then(web))
                .flatten()
        });
    ImportedSettings {
        search_engine: chromium_search(profile, &prefs),
        homepage,
        restore_session: prefs["session"]["restore_on_startup"]
            .as_i64()
            .map(|value| value == 1),
        site_permissions: chromium_permissions(&prefs),
    }
}

fn chromium_search(profile: &Path, prefs: &Value) -> Option<SearchEngine> {
    let data = &prefs["default_search_provider_data"]["template_url_data"];
    if let (Some(name), Some(url)) = (data["short_name"].as_str(), data["url"].as_str()) {
        return Some(SearchEngine {
            name: name.to_owned(),
            url: url.to_owned(),
        });
    }
    let guid = prefs["default_search_provider"]["guid"].as_str()?;
    let snapshot = Snapshot::sqlite(&profile.join("Web Data")).ok()?;
    let db = snapshot.open().ok()?;
    db.query_row(
        "SELECT short_name, url FROM keywords WHERE sync_guid = ?1",
        [guid],
        |r| {
            Ok(SearchEngine {
                name: r.get(0)?,
                url: r.get(1)?,
            })
        },
    )
    .ok()
}

fn chromium_permissions(prefs: &Value) -> Vec<SitePermission> {
    let exceptions = &prefs["profile"]["content_settings"]["exceptions"];
    let mut out = Vec::new();
    for (setting, kind) in [
        ("media_stream_camera", "camera"),
        ("media_stream_mic", "microphone"),
    ] {
        for (pattern, entry) in exceptions[setting].as_object().into_iter().flatten() {
            // Patterns read "https://site:443,*"; only exact sites carry over.
            let site = pattern.split(',').next().unwrap_or_default();
            let (Some(origin), Some(value)) = (origin(site), entry["setting"].as_i64()) else {
                continue;
            };
            if site.contains("[*.]") || !matches!(value, 1 | 2) {
                continue;
            }
            out.push(SitePermission {
                origin,
                kind,
                allow: value == 1,
            });
        }
    }
    out
}

/// `user_pref("name", value);` lines from Firefox's prefs.js.
fn firefox_prefs(profile: &Path) -> std::collections::HashMap<String, Value> {
    let text = std::fs::read_to_string(profile.join("prefs.js")).unwrap_or_default();
    text.lines()
        .filter_map(|line| {
            let inner = line.trim().strip_prefix("user_pref(")?.strip_suffix(");")?;
            let parsed: Value = serde_json::from_str(&format!("[{inner}]")).ok()?;
            Some((parsed[0].as_str()?.to_owned(), parsed[1].clone()))
        })
        .collect()
}

fn firefox(profile: &Path) -> ImportedSettings {
    let prefs = firefox_prefs(profile);
    let homepage = prefs
        .get("browser.startup.homepage")
        .and_then(Value::as_str)
        .and_then(|value| value.split('|').find_map(web));
    ImportedSettings {
        search_engine: firefox_search(profile),
        homepage,
        restore_session: prefs
            .get("browser.startup.page")
            .and_then(Value::as_i64)
            .map(|v| v == 3),
        site_permissions: firefox_permissions(profile),
    }
}

/// `search.json.mozlz4`: an 8-byte magic, a 4-byte size and an LZ4 block.
fn firefox_search(profile: &Path) -> Option<SearchEngine> {
    let bytes = std::fs::read(profile.join("search.json.mozlz4")).ok()?;
    let body = bytes.strip_prefix(b"mozLz40\0")?;
    let size = u32::from_le_bytes(body.get(..4)?.try_into().ok()?) as usize;
    if size > 16 << 20 {
        return None;
    }
    let json = lz4_flex::block::decompress(body.get(4..)?, size).ok()?;
    let search: Value = serde_json::from_slice(&json).ok()?;
    let meta = &search["metaData"];
    let engines = search["engines"].as_array()?;
    let current = engines.iter().find(|engine| {
        meta["defaultEngineId"]
            .as_str()
            .is_some_and(|id| engine["id"].as_str() == Some(id))
            || meta["current"]
                .as_str()
                .is_some_and(|name| engine["_name"].as_str() == Some(name))
    });
    // Firefox omits the default engine when it is the region's built-in one.
    let Some(engine) = current else {
        return None;
    };
    let url = engine["_urls"]
        .as_array()?
        .iter()
        .find(|u| u["type"].as_str().is_none_or(|t| t == "text/html"))?["template"]
        .as_str()?
        .replace("{searchTerms}", "%s");
    Some(SearchEngine {
        name: engine["_name"].as_str()?.to_owned(),
        url,
    })
}

fn firefox_permissions(profile: &Path) -> Vec<SitePermission> {
    let Ok(snapshot) = Snapshot::sqlite(&profile.join("permissions.sqlite")) else {
        return Vec::new();
    };
    let Ok(db) = snapshot.open() else {
        return Vec::new();
    };
    let Ok(mut statement) = db.prepare(
        "SELECT origin, type, permission FROM moz_perms WHERE type IN ('camera', 'microphone') AND expireType = 0",
    ) else {
        return Vec::new();
    };
    let rows = statement.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, i64>(2)?,
        ))
    });
    rows.into_iter()
        .flatten()
        .flatten()
        .filter_map(|(site, kind, permission)| {
            Some(SitePermission {
                origin: origin(&site)?,
                kind: if kind == "camera" {
                    "camera"
                } else {
                    "microphone"
                },
                allow: match permission {
                    1 => true,
                    2 => false,
                    _ => return None,
                },
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_chromium_preferences() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("Preferences"),
            r#"{"homepage":"https://home.example/","homepage_is_newtabpage":false,
               "session":{"restore_on_startup":1},"bookmark_bar":{"show_on_all_tabs":true},
               "default_search_provider_data":{"template_url_data":{"short_name":"DuckDuckGo","url":"https://duckduckgo.com/?q={searchTerms}"}},
               "profile":{"content_settings":{"exceptions":{
                 "media_stream_camera":{"https://meet.example:443,*":{"setting":1},"[*.]wild.example,*":{"setting":1}},
                 "media_stream_mic":{"https://meet.example:443,*":{"setting":2}}}}}}"#,
        )
        .unwrap();
        let settings = read(Family::Chromium, dir.path());
        assert_eq!(settings.homepage.as_deref(), Some("https://home.example/"));
        assert_eq!(settings.restore_session, Some(true));
        assert_eq!(settings.search_engine.unwrap().name, "DuckDuckGo");
        assert_eq!(
            settings.site_permissions,
            vec![
                SitePermission {
                    origin: "https://meet.example".into(),
                    kind: "camera",
                    allow: true
                },
                SitePermission {
                    origin: "https://meet.example".into(),
                    kind: "microphone",
                    allow: false
                },
            ]
        );
    }

    #[test]
    fn reads_firefox_prefs_and_compressed_search_settings() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("prefs.js"),
            "// Mozilla User Preferences\nuser_pref(\"browser.startup.homepage\", \"about:home|https://news.example/\");\nuser_pref(\"browser.startup.page\", 3);\nuser_pref(\"browser.toolbars.bookmarks.visibility\", \"never\");\n",
        )
        .unwrap();
        let json = br#"{"metaData":{"defaultEngineId":"ddg"},"engines":[{"id":"ddg","_name":"DuckDuckGo","_urls":[{"template":"https://duckduckgo.com/?q={searchTerms}"}]}]}"#;
        let mut file = b"mozLz40\0".to_vec();
        file.extend((json.len() as u32).to_le_bytes());
        file.extend(lz4_flex::block::compress(json));
        std::fs::write(dir.path().join("search.json.mozlz4"), file).unwrap();
        let settings = read(Family::Firefox, dir.path());
        assert_eq!(settings.homepage.as_deref(), Some("https://news.example/"));
        assert_eq!(settings.restore_session, Some(true));
        assert_eq!(
            settings.search_engine,
            Some(SearchEngine {
                name: "DuckDuckGo".into(),
                url: "https://duckduckgo.com/?q=%s".into()
            })
        );
    }
}
