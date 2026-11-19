//! Misty's own folder of language servers, in the app's local data folder (which the file gate
//! always allows), and `installed.json`, which says which version of each is in use.
//!
//! Layout:
//! - `servers/<language>/<version>-<n>/`: one install. A newer one goes beside it, so a server
//!   that is running keeps its files until it ends.
//! - `node/<version>-<n>/`: Misty's own Node.js, only when the computer has none new enough.
//! - `.staging/<n>/`: an install being made, renamed into place only once it is whole.

use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use tauri::Manager;

use super::catalog::Language;

const FOLDER: &str = "language-servers";
const RECORD: &str = "installed.json";
const STAGING: &str = ".staging";
/// A staging folder this old was left by an install that never finished.
const STALE_STAGING: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Installed {
    #[serde(default)]
    pub(super) node: Option<NodeRecord>,
    /// By language id.
    #[serde(default)]
    pub(super) servers: BTreeMap<String, ServerRecord>,
    /// When each language last asked for a newer version, in seconds since 1970.
    #[serde(default)]
    pub(super) checked: BTreeMap<String, i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ServerRecord {
    /// The server's own version, as the status row shows it.
    pub(super) version: String,
    /// Every npm package's version, for the servers installed from npm.
    #[serde(default)]
    pub(super) packages: BTreeMap<String, String>,
    /// The install's folder, relative to Misty's folder of servers.
    pub(super) dir: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct NodeRecord {
    pub(super) version: String,
    pub(super) dir: String,
}

/// installed.json is read, changed and written whole, one change at a time.
static RECORD_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

/// Misty's folder of language servers, made if it isn't there.
pub(super) fn base(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let folder = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Misty has no folder for language servers on this computer.".to_string())?
        .join(FOLDER);
    file_access::fs::create_dir_all(&folder)
        .map_err(|error| format!("Misty couldn't make its language server folder: {error}"))?;
    Ok(folder)
}

pub(super) fn read(base: &Path) -> Installed {
    let _held = RECORD_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    read_unlocked(base)
}

fn read_unlocked(base: &Path) -> Installed {
    file_access::fs::read_to_string(base.join(RECORD))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Changes installed.json, writing it beside itself first so a crash never leaves half a file.
pub(super) fn update(base: &Path, change: impl FnOnce(&mut Installed)) -> Result<(), String> {
    let _held = RECORD_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut installed = read_unlocked(base);
    change(&mut installed);
    let text = serde_json::to_string_pretty(&installed).map_err(|error| error.to_string())?;
    let partial = base.join(format!("{RECORD}.partial"));
    file_access::fs::write(&partial, text).map_err(|error| error.to_string())?;
    file_access::fs::rename(&partial, base.join(RECORD)).map_err(|error| error.to_string())
}

/// A record's folder, refused if it would reach outside Misty's folder.
pub(super) fn resolve(base: &Path, dir: &str) -> Option<PathBuf> {
    let relative = Path::new(dir);
    let plain = !dir.is_empty()
        && relative
            .components()
            .all(|part| matches!(part, Component::Normal(_)));
    plain.then(|| base.join(relative))
}

/// A new, empty folder for an install being made.
pub(super) fn staging(base: &Path) -> Result<PathBuf, String> {
    let folder = base
        .join(STAGING)
        .join(uuid::Uuid::new_v4().simple().to_string());
    file_access::fs::create_dir_all(&folder).map_err(|error| error.to_string())?;
    Ok(folder)
}

/// Where a finished install of `language` at `version` goes, relative to Misty's folder. The
/// suffix keeps a reinstall of the same version from landing on a folder a server still uses.
pub(super) fn server_dir(language: Language, version: &str) -> String {
    format!("servers/{}/{}", language.id(), unique_name(version))
}

pub(super) fn node_dir(version: &str) -> String {
    format!("node/{}", unique_name(version))
}

fn unique_name(version: &str) -> String {
    let safe: String = version
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                c
            } else {
                '_'
            }
        })
        .take(48)
        .collect();
    let suffix = &uuid::Uuid::new_v4().simple().to_string()[..8];
    format!("{}-{suffix}", safe.trim_matches('.'))
}

/// Moves a finished install from staging into place.
pub(super) fn settle(base: &Path, made: &Path, dir: &str) -> Result<PathBuf, String> {
    let target = resolve(base, dir).ok_or("That install has no place in Misty's folder.")?;
    if let Some(parent) = target.parent() {
        file_access::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    file_access::fs::rename(made, &target)
        .map_err(|error| format!("Misty couldn't put the new install in place: {error}"))?;
    Ok(target)
}

/// Removes a language's old installs: everything but the current one and those a running
/// server still uses.
pub(super) fn prune_servers(base: &Path, language: Language, keep: &[PathBuf]) {
    let folder = base.join("servers").join(language.id());
    let current = read(base)
        .servers
        .get(language.id())
        .and_then(|record| resolve(base, &record.dir));
    let Ok(entries) = file_access::fs::read_dir(&folder) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if current.as_ref() == Some(&path) || keep.contains(&path) {
            continue;
        }
        let _ = file_access::fs::remove_dir_all(&path);
    }
}

/// Removes staging folders left by installs that never finished.
pub(super) fn prune_staging(base: &Path) {
    let Ok(entries) = file_access::fs::read_dir(base.join(STAGING)) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let path = entry.path();
        let old = file_access::fs::metadata(&path)
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age > STALE_STAGING);
        if old {
            let _ = file_access::fs::remove_dir_all(&path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_record_never_reaches_outside_the_folder() {
        let base = Path::new("/misty/language-servers");
        assert_eq!(
            resolve(base, "servers/rust/1-ab"),
            Some(base.join("servers/rust/1-ab"))
        );
        assert_eq!(resolve(base, "../elsewhere"), None);
        assert_eq!(resolve(base, "/etc"), None);
        assert_eq!(resolve(base, ""), None);
    }

    #[test]
    fn install_folders_are_plain_names() {
        let dir = server_dir(Language::Go, "v0.20.0/../x");
        assert!(dir.starts_with("servers/go/v0.20.0_.._x-"));
        assert!(resolve(Path::new("/b"), &dir).is_some());
    }
}
