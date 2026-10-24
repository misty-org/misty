//! Listing a browser's profiles from its data folder.
use super::*;

pub(super) fn has_data(dir: &Path) -> bool {
    ["Bookmarks", "History", "Preferences"]
        .iter()
        .any(|file| dir.join(file).is_file())
}

pub(super) fn chromium_profiles(user_data: &Path) -> Vec<BrowserProfile> {
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

pub(super) fn firefox_profiles(dir: &Path) -> Vec<BrowserProfile> {
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

pub(super) fn safari_profile(dir: &Path) -> Vec<BrowserProfile> {
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
