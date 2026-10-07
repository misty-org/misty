//! Extensions the person installed themselves, by ID and name, so the app can
//! offer the same ones from Misty's extension catalog.
use super::discover::Family;
use serde::Serialize;
use serde_json::Value;
use std::path::Path;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ImportedExtension {
    /// The store ID (Chrome Web Store) or add-on ID (Firefox).
    pub id: String,
    pub name: String,
}

pub fn read(family: Family, profile: &Path) -> Vec<ImportedExtension> {
    let mut out = match family {
        Family::Chromium => chromium(profile),
        Family::Firefox => firefox(profile),
        Family::Safari => Vec::new(),
    };
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out.dedup_by(|a, b| a.id == b.id);
    out.truncate(200);
    out
}

fn json(path: &Path) -> Value {
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

/// Resolves `__MSG_name__` from the extension's default locale.
fn localized(
    profile: &Path,
    id: &str,
    version: &str,
    manifest: &Value,
    name: &str,
) -> Option<String> {
    let key = name
        .strip_prefix("__MSG_")?
        .strip_suffix("__")?
        .to_lowercase();
    let locale = manifest["default_locale"].as_str().unwrap_or("en");
    let messages = json(
        &profile
            .join("Extensions")
            .join(id)
            .join(version)
            .join("_locales")
            .join(locale)
            .join("messages.json"),
    );
    messages
        .as_object()?
        .iter()
        .find(|(k, _)| k.to_lowercase() == key)
        .and_then(|(_, v)| v["message"].as_str().map(str::to_owned))
}

fn chromium(profile: &Path) -> Vec<ImportedExtension> {
    let mut out = Vec::new();
    for file in ["Secure Preferences", "Preferences"] {
        let prefs = json(&profile.join(file));
        for (id, entry) in prefs["extensions"]["settings"]
            .as_object()
            .into_iter()
            .flatten()
        {
            // Location 1 is a Web Store install; built-in and policy ones are left out.
            if entry["location"].as_i64() != Some(1)
                || entry["was_installed_by_default"].as_bool() == Some(true)
                || id.len() != 32
            {
                continue;
            }
            let manifest = &entry["manifest"];
            let version = manifest["version"].as_str().unwrap_or_default();
            let raw = manifest["name"].as_str().map(str::to_owned).or_else(|| {
                // Newer versions keep the manifest beside the extension, not in preferences.
                std::fs::read_dir(profile.join("Extensions").join(id))
                    .ok()?
                    .flatten()
                    .find_map(|dir| {
                        json(&dir.path().join("manifest.json"))["name"]
                            .as_str()
                            .map(str::to_owned)
                    })
            });
            let Some(raw) = raw else { continue };
            let name = localized(profile, id, version, manifest, &raw).unwrap_or(raw);
            if !name.starts_with("__MSG_") {
                out.push(ImportedExtension {
                    id: id.clone(),
                    name,
                });
            }
        }
    }
    out
}

fn firefox(profile: &Path) -> Vec<ImportedExtension> {
    json(&profile.join("extensions.json"))["addons"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|addon| addon["type"] == "extension" && addon["location"] == "app-profile")
        .filter_map(|addon| {
            Some(ImportedExtension {
                id: addon["id"].as_str()?.to_owned(),
                name: addon["defaultLocale"]["name"].as_str()?.to_owned(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_extensions_the_person_installed() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("extensions.json"),
            r#"{"addons":[
              {"id":"uBlock0@raymondhill.net","type":"extension","location":"app-profile","defaultLocale":{"name":"uBlock Origin"}},
              {"id":"formautofill@mozilla.org","type":"extension","location":"app-system-defaults","defaultLocale":{"name":"Form Autofill"}},
              {"id":"de@dictionaries","type":"dictionary","location":"app-profile","defaultLocale":{"name":"German"}}]}"#,
        )
        .unwrap();
        assert_eq!(
            read(Family::Firefox, dir.path()),
            vec![ImportedExtension {
                id: "uBlock0@raymondhill.net".into(),
                name: "uBlock Origin".into()
            }]
        );
        std::fs::write(
            dir.path().join("Preferences"),
            r#"{"extensions":{"settings":{
              "cjpalhdlnbpafiamejdnhcphjbkeiagm":{"location":1,"manifest":{"name":"uBlock Origin","version":"1"}},
              "nmmhkkegccagdldgiimedpiccmgmieda":{"location":10,"manifest":{"name":"Chrome Web Store Payments"}}}}}"#,
        )
        .unwrap();
        assert_eq!(
            read(Family::Chromium, dir.path()),
            vec![ImportedExtension {
                id: "cjpalhdlnbpafiamejdnhcphjbkeiagm".into(),
                name: "uBlock Origin".into()
            }]
        );
    }
}
