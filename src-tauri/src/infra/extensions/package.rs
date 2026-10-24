// SPDX-License-Identifier: MIT
use super::catalog::{is_chrome_id, CatalogEntry, Store};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    io::{Cursor, Read},
    path::{Component, Path},
};

const MAX_EXPANDED: u64 = 256 * 1024 * 1024;
const MAX_FILES: usize = 20_000;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    pub token: String,
    pub entry: CatalogEntry,
    pub permissions: Vec<String>,
    pub hosts: Vec<String>,
    pub optional_permissions: Vec<String>,
    pub optional_hosts: Vec<String>,
    pub findings: Vec<String>,
    pub blocked: bool,
    pub private_allowed: bool,
    pub has_options: bool,
    pub manifest_version: u64,
}

fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|v| {
            v.iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}
fn is_host(value: &str) -> bool {
    value.contains("://") || value == "<all_urls>"
}

pub fn inspect(manifest: &Value, entry: CatalogEntry, token: String) -> Result<Review, String> {
    let version = manifest["manifest_version"]
        .as_u64()
        .ok_or("Missing manifest_version.")?;
    if !matches!(version, 2 | 3) {
        return Err("Only manifest versions 2 and 3 are supported.".into());
    }
    if manifest["version"].as_str() != Some(&entry.version) {
        return Err("Package version does not match the store's metadata.".into());
    }
    match entry.store {
        Store::Firefox => {
            if is_chrome_id(&entry.guid) {
                return Err("Package identity is not a Firefox add-on identity.".into());
            }
            if let Some(guid) = manifest
                .pointer("/browser_specific_settings/gecko/id")
                .or_else(|| manifest.pointer("/applications/gecko/id"))
                .and_then(Value::as_str)
            {
                if guid != entry.guid {
                    return Err("Package identity does not match the store's metadata.".into());
                }
            }
        }
        // The signature check already bound the package to this ID.
        Store::Chrome => {
            if entry.guid != entry.id || !is_chrome_id(&entry.id) {
                return Err("Package identity does not match the store's metadata.".into());
            }
            if manifest.get("theme").is_some() || manifest.get("app").is_some() {
                return Err("This is a Chrome theme or app, not an extension.".into());
            }
        }
    }
    let all = strings(&manifest["permissions"]);
    let optional = strings(&manifest["optional_permissions"]);
    if !manifest["name"]
        .as_str()
        .is_some_and(|name| !name.trim().is_empty())
    {
        return Err("The manifest has no extension name.".into());
    }
    let mut hosts = strings(&manifest["host_permissions"]);
    if let Some(scripts) = manifest["content_scripts"].as_array() {
        for script in scripts {
            hosts.extend(strings(&script["matches"]));
        }
    }
    hosts.extend(all.iter().filter(|p| is_host(p)).cloned());
    hosts.sort();
    hosts.dedup();
    let mut permissions: Vec<_> = all.into_iter().filter(|p| !is_host(p)).collect();
    permissions.extend(super::compat::added_permissions(&permissions));
    let mut optional_hosts = strings(&manifest["optional_host_permissions"]);
    optional_hosts.extend(optional.iter().filter(|p| is_host(p)).cloned());
    let unsupported = ["debugger", "proxy"];
    let mut findings: Vec<String> = permissions
        .iter()
        .filter(|p| unsupported.contains(&p.as_str()))
        .map(|p| format!("Required API is unavailable in Misty's native runtime: {p}."))
        .collect();
    let blocked = !findings.is_empty();
    for permission in &optional {
        if unsupported.contains(&permission.as_str()) {
            findings.push(format!(
                "Optional functionality is unavailable: {permission}."
            ));
        }
    }
    findings.extend(
        permissions
            .iter()
            .chain(&optional)
            .filter_map(|p| super::compat::limitation(p))
            .map(str::to_owned),
    );
    findings.dedup();
    let has_action = manifest.get("browser_action").is_some() || manifest.get("action").is_some();
    if manifest.get("sidebar_action").is_some() {
        findings.push(if has_action {
            "Its Firefox sidebar opens in a tab.".into()
        } else {
            "Its Firefox sidebar opens from its toolbar button.".into()
        });
    }
    if manifest.get("side_panel").is_some() {
        findings.push(if has_action {
            "Its Chrome side panel opens in a tab.".into()
        } else {
            "Its Chrome side panel opens from its toolbar button.".into()
        });
    }
    if manifest.pointer("/chrome_url_overrides/newtab").is_some() {
        findings.push("New tabs open its page while it's turned on.".into());
    }
    if ["bookmarks", "history"].iter().any(|page| {
        manifest
            .pointer(&format!("/chrome_url_overrides/{page}"))
            .is_some()
    }) {
        findings.push("Its replacement bookmarks or history page isn't used in Misty.".into());
    }
    findings.push(
        "Not verified with Misty. Some browser-specific functionality may be unavailable.".into(),
    );
    Ok(Review {
        token,
        entry,
        permissions,
        hosts,
        optional_permissions: optional.into_iter().filter(|p| !is_host(p)).collect(),
        optional_hosts,
        findings,
        blocked,
        private_allowed: manifest["incognito"] != "not_allowed",
        has_options: manifest.get("options_ui").is_some() || manifest.get("options_page").is_some(),
        manifest_version: version,
    })
}

pub fn extract(
    bytes: &[u8],
    mut entry: CatalogEntry,
    root: &Path,
    token: String,
) -> Result<Review, String> {
    let expected = entry
        .digest
        .strip_prefix("sha256:")
        .ok_or("The store did not provide a SHA-256 digest.")?;
    if hex::encode(Sha256::digest(bytes)) != expected.to_ascii_lowercase() {
        return Err("Extension package integrity check failed.".into());
    }
    let contents = match entry.store {
        Store::Firefox => bytes,
        Store::Chrome => super::crx::verify(bytes, &entry.id)?,
    };
    let mut archive =
        zip::ZipArchive::new(Cursor::new(contents)).map_err(|_| "Invalid extension archive.")?;
    if archive.len() > MAX_FILES {
        return Err("The extension contains too many files.".into());
    }
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let runtime = root.join("runtime");
    fs::create_dir(&runtime).map_err(|e| e.to_string())?;
    let mut total = 0u64;
    let mut seen = HashSet::new();
    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(|e| e.to_string())?;
        let name = file.name();
        let relative = Path::new(name);
        if name.contains('\\')
            || name.contains('\0')
            || relative
                .components()
                .any(|p| !matches!(p, Component::Normal(_)))
            || !seen.insert(name.to_lowercase())
            || name.to_ascii_lowercase().starts_with("__misty_sync__")
            || name
                .to_ascii_lowercase()
                .starts_with("__misty_user_scripts__")
            || name
                .to_ascii_lowercase()
                .starts_with(super::compat::DIRECTORY)
            || file
                .unix_mode()
                .is_some_and(|m| !matches!(m & 0o170000, 0 | 0o100000 | 0o040000))
        {
            return Err("The extension archive contains an unsafe path.".into());
        }
        total = total
            .checked_add(file.size())
            .ok_or("Extension archive is too large.")?;
        if total > MAX_EXPANDED {
            return Err("Expanded extension exceeds 256 MiB.".into());
        }
        let output = runtime.join(relative);
        if file.is_dir() {
            fs::create_dir_all(output).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut target = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(output)
            .map_err(|e| e.to_string())?;
        let copied = std::io::copy(&mut (&mut file).take(MAX_EXPANDED + 1), &mut target)
            .map_err(|e| e.to_string())?;
        if copied != file.size() {
            return Err("Invalid extension resource length.".into());
        }
    }
    let manifest_bytes =
        fs::read(runtime.join("manifest.json")).map_err(|_| "The archive has no manifest.json.")?;
    if manifest_bytes.len() > 1024 * 1024 {
        return Err("Extension manifest is too large.".into());
    }
    let manifest =
        serde_json::from_slice(&manifest_bytes).map_err(|_| "Invalid extension manifest JSON.")?;
    if entry.store == Store::Chrome {
        super::chrome_store::describe(&mut entry, &manifest, &runtime);
    }
    let original = match entry.store {
        Store::Firefox => "original.xpi",
        Store::Chrome => "original.crx",
    };
    let review = inspect(&manifest, entry, token)?;
    fs::write(root.join(original), bytes).map_err(|e| e.to_string())?;
    fs::write(
        root.join("review.json"),
        serde_json::to_vec(&review).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let bridge = runtime.join("__misty_sync__");
    fs::create_dir(&bridge).map_err(|e| e.to_string())?;
    fs::write(bridge.join("bridge.html"), include_str!("bridge.html"))
        .map_err(|e| e.to_string())?;
    fs::write(bridge.join("bridge.js"), include_str!("bridge.js")).map_err(|e| e.to_string())?;
    super::compat::apply(&runtime)?;
    Ok(review)
}

#[cfg(test)]
mod tests;
