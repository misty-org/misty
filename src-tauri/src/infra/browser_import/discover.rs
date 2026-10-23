//! Finds the browsers installed for this user and their profiles. The renderer
//! only ever names a browser and a profile ID from this list; paths stay here.
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

mod profiles;
use profiles::*;

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
    #[cfg(target_os = "macos")]
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
        #[cfg(target_os = "macos")]
        {
            let home = dirs::home_dir()?;
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

#[cfg(test)]
mod tests;
