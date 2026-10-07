//! Finds the browsers installed for this user and their profiles. The renderer
//! only ever names a browser and a profile ID from this list; paths stay here.
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Browser {
    Chrome,
    Edge,
    Brave,
    Arc,
    Vivaldi,
    Opera,
    Chromium,
    Firefox,
    /// A Firefox fork with the same profile format.
    Zen,
    Safari,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Family {
    Chromium,
    Firefox,
    Safari,
}

impl Browser {
    pub const ALL: [Browser; 10] = [
        Browser::Chrome,
        Browser::Edge,
        Browser::Brave,
        Browser::Arc,
        Browser::Vivaldi,
        Browser::Opera,
        Browser::Chromium,
        Browser::Firefox,
        Browser::Zen,
        Browser::Safari,
    ];

    pub fn family(self) -> Family {
        match self {
            Browser::Firefox | Browser::Zen => Family::Firefox,
            Browser::Safari => Family::Safari,
            _ => Family::Chromium,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Browser::Chrome => "Google Chrome",
            Browser::Edge => "Microsoft Edge",
            Browser::Brave => "Brave",
            Browser::Arc => "Arc",
            Browser::Vivaldi => "Vivaldi",
            Browser::Opera => "Opera",
            Browser::Chromium => "Chromium",
            Browser::Firefox => "Firefox",
            Browser::Zen => "Zen",
            Browser::Safari => "Safari",
        }
    }

    /// The Keychain item (macOS) that holds this browser's cookie key.
    pub fn safe_storage(self) -> Option<(&'static str, &'static str)> {
        Some(match self {
            Browser::Chrome => ("Chrome Safe Storage", "Chrome"),
            Browser::Edge => ("Microsoft Edge Safe Storage", "Microsoft Edge"),
            Browser::Brave => ("Brave Safe Storage", "Brave"),
            Browser::Arc => ("Arc Safe Storage", "Arc"),
            Browser::Vivaldi => ("Vivaldi Safe Storage", "Vivaldi"),
            Browser::Opera => ("Opera Safe Storage", "Opera"),
            Browser::Chromium => ("Chromium Safe Storage", "Chromium"),
            Browser::Firefox | Browser::Zen | Browser::Safari => return None,
        })
    }

    /// Where the browser keeps its profiles (Chromium's "User Data" folder,
    /// Firefox's folder holding profiles.ini, Safari's library folder).
    fn data_dir(self) -> Option<PathBuf> {
        let home = dirs::home_dir()?;
        #[cfg(target_os = "macos")]
        {
            let support = home.join("Library/Application Support");
            return Some(match self {
                Browser::Chrome => support.join("Google/Chrome"),
                Browser::Edge => support.join("Microsoft Edge"),
                Browser::Brave => support.join("BraveSoftware/Brave-Browser"),
                Browser::Arc => support.join("Arc/User Data"),
                Browser::Vivaldi => support.join("Vivaldi"),
                Browser::Opera => support.join("com.operasoftware.Opera"),
                Browser::Chromium => support.join("Chromium"),
                Browser::Firefox => support.join("Firefox"),
                Browser::Zen => support.join("zen"),
                Browser::Safari => home.join("Library/Safari"),
            });
        }
        #[cfg(windows)]
        {
            let local = dirs::data_local_dir()?;
            let roaming = dirs::data_dir()?;
            return match self {
                Browser::Chrome => Some(local.join("Google/Chrome/User Data")),
                Browser::Edge => Some(local.join("Microsoft/Edge/User Data")),
                Browser::Brave => Some(local.join("BraveSoftware/Brave-Browser/User Data")),
                Browser::Vivaldi => Some(local.join("Vivaldi/User Data")),
                Browser::Chromium => Some(local.join("Chromium/User Data")),
                Browser::Opera => Some(roaming.join("Opera Software/Opera Stable")),
                Browser::Firefox => Some(roaming.join("Mozilla/Firefox")),
                Browser::Zen => Some(roaming.join("zen")),
                // Arc for Windows is a packaged app with a versioned folder name.
                Browser::Arc => std::fs::read_dir(local.join("Packages"))
                    .ok()?
                    .flatten()
                    .find(|entry| {
                        entry
                            .file_name()
                            .to_string_lossy()
                            .starts_with("TheBrowserCompany.Arc_")
                    })
                    .map(|entry| entry.path().join("LocalCache/Local/Arc/User Data")),
                Browser::Safari => None,
            };
        }
        #[cfg(all(unix, not(target_os = "macos")))]
        {
            let config = dirs::config_dir()?;
            return match self {
                Browser::Chrome => Some(config.join("google-chrome")),
                Browser::Edge => Some(config.join("microsoft-edge")),
                Browser::Brave => Some(config.join("BraveSoftware/Brave-Browser")),
                Browser::Vivaldi => Some(config.join("vivaldi")),
                Browser::Opera => Some(config.join("opera")),
                Browser::Chromium => Some(config.join("chromium")),
                Browser::Firefox => [".mozilla/firefox", "snap/firefox/common/.mozilla/firefox"]
                    .into_iter()
                    .map(|path| home.join(path))
                    .find(|path| path.join("profiles.ini").is_file()),
                Browser::Zen => [".zen", ".var/app/app.zen_browser.zen/.zen"]
                    .into_iter()
                    .map(|path| home.join(path))
                    .find(|path| path.join("profiles.ini").is_file()),
                Browser::Arc | Browser::Safari => None,
            };
        }
        #[allow(unreachable_code)]
        None
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct BrowserProfile {
    pub id: String,
    pub name: String,
    #[serde(skip)]
    pub path: PathBuf,
    /// When the profile's browsing data last changed (ms), as a sign of use.
    #[serde(rename = "lastUsed")]
    pub last_used: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct BrowserSource {
    pub browser: Browser,
    pub name: &'static str,
    pub profiles: Vec<BrowserProfile>,
}

/// Installed browsers, the one used most recently first, each with its most
/// recently used profile first.
pub fn discover() -> Vec<BrowserSource> {
    let mut sources: Vec<BrowserSource> = Browser::ALL
        .into_iter()
        .filter_map(|browser| {
            let dir = browser.data_dir()?;
            let found = match browser.family() {
                Family::Chromium => chromium_profiles(&dir),
                Family::Firefox => firefox_profiles(&dir),
                Family::Safari => safari_profile(&dir),
            };
            let mut profiles: Vec<BrowserProfile> = found
                .into_iter()
                .map(|profile| BrowserProfile {
                    last_used: last_used(browser.family(), &profile.path),
                    ..profile
                })
                .collect();
            profiles.sort_by_key(|profile| std::cmp::Reverse(profile.last_used));
            (!profiles.is_empty()).then_some(BrowserSource {
                browser,
                name: browser.name(),
                profiles,
            })
        })
        .collect();
    sources.sort_by_key(|source| {
        std::cmp::Reverse(
            source
                .profiles
                .first()
                .and_then(|profile| profile.last_used),
        )
    });
    sources
}

/// The newest change to the profile's browsing data, write-ahead logs included.
fn last_used(family: Family, profile: &Path) -> Option<i64> {
    let files: &[&str] = match family {
        Family::Chromium => &["History", "History-journal", "Bookmarks"],
        Family::Firefox => &["places.sqlite", "places.sqlite-wal"],
        Family::Safari => &["History.db", "History.db-wal"],
    };
    files
        .iter()
        .filter_map(|file| std::fs::metadata(profile.join(file)).ok()?.modified().ok())
        .max()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|elapsed| elapsed.as_millis() as i64)
}

/// The profile the renderer chose, looked up again here.
pub fn resolve(browser: Browser, profile: &str) -> Result<BrowserProfile, String> {
    discover()
        .into_iter()
        .find(|source| source.browser == browser)
        .and_then(|source| source.profiles.into_iter().find(|p| p.id == profile))
        .ok_or_else(|| {
            format!(
                "{} or that profile is no longer on this computer.",
                browser.name()
            )
        })
}

fn has_data(dir: &Path) -> bool {
    ["Bookmarks", "History", "Preferences"]
        .iter()
        .any(|file| dir.join(file).is_file())
}

fn chromium_profiles(user_data: &Path) -> Vec<BrowserProfile> {
    let state: serde_json::Value = std::fs::read(user_data.join("Local State"))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    let mut profiles: Vec<BrowserProfile> = state["profile"]["info_cache"]
        .as_object()
        .into_iter()
        .flatten()
        .filter(|(dir, _)| !dir.contains(['/', '\\']) && *dir != ".." && *dir != ".")
        .map(|(dir, info)| BrowserProfile {
            last_used: None,
            id: dir.clone(),
            name: info["name"].as_str().unwrap_or(dir).to_owned(),
            path: user_data.join(dir),
        })
        .filter(|profile| has_data(&profile.path))
        .collect();
    if profiles.is_empty() && has_data(&user_data.join("Default")) {
        profiles.push(BrowserProfile {
            last_used: None,
            id: "Default".into(),
            name: "Default".into(),
            path: user_data.join("Default"),
        });
    }
    // Opera keeps its one profile in the data folder itself.
    if profiles.is_empty() && has_data(user_data) {
        profiles.push(BrowserProfile {
            last_used: None,
            id: String::new(),
            name: "Default".into(),
            path: user_data.to_path_buf(),
        });
    }
    profiles.sort_by(|a, b| {
        (a.id != "Default")
            .cmp(&(b.id != "Default"))
            .then(a.name.cmp(&b.name))
    });
    profiles
}

fn firefox_profiles(dir: &Path) -> Vec<BrowserProfile> {
    let Ok(ini) = std::fs::read_to_string(dir.join("profiles.ini")) else {
        return Vec::new();
    };
    let mut profiles = Vec::new();
    let mut defaults = Vec::new();
    let mut section = String::new();
    let mut current: (Option<String>, Option<String>, bool) = (None, None, true);
    let mut flush = |section: &str, current: &mut (Option<String>, Option<String>, bool)| {
        if section.starts_with("Profile") {
            if let (Some(name), Some(path)) = (current.0.take(), current.1.take()) {
                let full = if current.2 {
                    dir.join(&path)
                } else {
                    PathBuf::from(&path)
                };
                if full.join("places.sqlite").is_file() {
                    profiles.push(BrowserProfile {
                        last_used: None,
                        id: path,
                        name,
                        path: full,
                    });
                }
            }
        }
        *current = (None, None, true);
    };
    for line in ini.lines().map(str::trim) {
        if let Some(name) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
            flush(&section, &mut current);
            section = name.to_owned();
        } else if let Some((key, value)) = line.split_once('=') {
            match (key, section.starts_with("Install")) {
                ("Default", true) => defaults.push(value.to_owned()),
                ("Name", false) => current.0 = Some(value.to_owned()),
                ("Path", false) => current.1 = Some(value.to_owned()),
                ("IsRelative", false) => current.2 = value != "0",
                _ => {}
            }
        }
    }
    flush(&section, &mut current);
    // The profile the installed Firefox opens comes first.
    profiles.sort_by_key(|p| !defaults.contains(&p.id));
    profiles
}

fn safari_profile(dir: &Path) -> Vec<BrowserProfile> {
    if !dir.is_dir() {
        return Vec::new();
    }
    vec![BrowserProfile {
        last_used: None,
        id: "Safari".into(),
        name: "Safari".into(),
        path: dir.to_path_buf(),
    }]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_firefox_profiles_with_the_installed_default_first() {
        let dir = tempfile::tempdir().unwrap();
        for profile in ["Profiles/a.default", "Profiles/b.default-release"] {
            std::fs::create_dir_all(dir.path().join(profile)).unwrap();
            std::fs::write(dir.path().join(profile).join("places.sqlite"), b"").unwrap();
        }
        std::fs::write(
            dir.path().join("profiles.ini"),
            "[Profile1]\nName=default\nIsRelative=1\nPath=Profiles/a.default\n\n\
             [Profile0]\nName=default-release\nIsRelative=1\nPath=Profiles/b.default-release\n\n\
             [Install4F96D1932A9F858E]\nDefault=Profiles/b.default-release\nLocked=1\n",
        )
        .unwrap();
        let profiles = firefox_profiles(dir.path());
        assert_eq!(
            profiles.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(),
            ["default-release", "default"]
        );
    }

    #[test]
    fn reads_chromium_profiles_from_local_state() {
        let dir = tempfile::tempdir().unwrap();
        for profile in ["Default", "Profile 1", "Empty"] {
            std::fs::create_dir_all(dir.path().join(profile)).unwrap();
        }
        std::fs::write(dir.path().join("Default/Bookmarks"), b"{}").unwrap();
        std::fs::write(dir.path().join("Profile 1/History"), b"").unwrap();
        std::fs::write(
            dir.path().join("Local State"),
            r#"{"profile":{"info_cache":{"Default":{"name":"Personal"},"Profile 1":{"name":"Work"},"Empty":{"name":"Empty"},"../x":{"name":"Bad"}}}}"#,
        )
        .unwrap();
        let profiles = chromium_profiles(dir.path());
        assert_eq!(
            profiles
                .iter()
                .map(|p| (p.id.as_str(), p.name.as_str()))
                .collect::<Vec<_>>(),
            [("Default", "Personal"), ("Profile 1", "Work")]
        );
    }
}
