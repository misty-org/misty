//! An extension's package as WebView2 runs it: the checks before install,
//! the copy holding only what the person granted, and what its manifest
//! says about its toolbar button.
use std::path::{Component, Path, PathBuf};

use base64::Engine;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::{short, Loaded, LIMITED, MAX_ICON_BYTES};

/// The manifest key Misty gives an extension: any stable bytes name it.
pub(super) fn key(origin: &str) -> Vec<u8> {
    Sha256::digest(format!("misty-webview2-extension:{origin}").as_bytes()).to_vec()
}

/// Chromium's extension ID for a key: the first 128 bits of its SHA-256,
/// one letter a–p per hex digit.
pub(super) fn crx_id(key: &[u8]) -> String {
    Sha256::digest(key)[..16]
        .iter()
        .flat_map(|byte| [byte >> 4, byte & 0xf])
        .map(|nibble| char::from(b'a' + nibble))
        .collect()
}

pub(super) fn read_manifest(runtime: &Path) -> Result<Value, String> {
    serde_json::from_slice(
        &std::fs::read(runtime.join("manifest.json"))
            .map_err(|_| "The extension has no manifest.")?,
    )
    .map_err(|_| "Invalid extension manifest JSON.".into())
}

pub(super) fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|v| v.as_str().map(str::to_owned))
        .collect()
}

pub(super) fn validate(runtime: &Path) -> Result<Value, String> {
    let manifest = read_manifest(runtime)?;
    let mut findings = Vec::new();
    let classic = manifest["manifest_version"] != 3
        || manifest["background"].get("scripts").is_some()
        || manifest["background"].get("page").is_some();
    if classic {
        findings.push("Windows runs Manifest V3 extensions only.".to_owned());
    }
    for permission in strings(&manifest["permissions"]) {
        if LIMITED.contains(&permission.as_str()) {
            findings.push(format!("May not work on Windows yet: {permission}."));
        }
    }
    let mut hosts = strings(&manifest["host_permissions"]);
    for script in manifest["content_scripts"].as_array().into_iter().flatten() {
        hosts.extend(strings(&script["matches"]));
    }
    hosts.sort();
    hosts.dedup();
    Ok(json!({
        "findings": findings,
        "blocked": classic,
        "platform": "Windows (WebView2)",
        "hosts": hosts,
    }))
}

/// The manifest WebView2 runs: only what the person granted, since WebView2
/// grants every permission and site an unpacked manifest declares and can't
/// ask later, and Misty's key, which fixes the extension's ID.
pub(super) fn granted_manifest(
    manifest: &Value,
    origin: &str,
    permissions: &[String],
    hosts: &[String],
) -> Value {
    let mut manifest = manifest.clone();
    // Only lists the manifest has: indexing a missing key would add a null,
    // which Chromium refuses.
    let keep = |value: Option<&mut Value>, allowed: &[String]| {
        if let Some(items) = value.and_then(Value::as_array_mut) {
            items.retain(|item| {
                item.as_str()
                    .is_some_and(|v| allowed.iter().any(|a| a == v))
            });
        }
    };
    keep(manifest.get_mut("permissions"), permissions);
    keep(manifest.get_mut("host_permissions"), hosts);
    if let Some(scripts) = manifest
        .get_mut("content_scripts")
        .and_then(Value::as_array_mut)
    {
        for script in scripts.iter_mut() {
            keep(script.get_mut("matches"), hosts);
        }
        scripts.retain(|script| script["matches"].as_array().is_some_and(|m| !m.is_empty()));
    }
    // Nor does it take an empty list of content scripts.
    if manifest["content_scripts"]
        .as_array()
        .is_some_and(Vec::is_empty)
    {
        manifest
            .as_object_mut()
            .map(|object| object.remove("content_scripts"));
    }
    if let Some(object) = manifest.as_object_mut() {
        object.remove("optional_permissions");
        object.remove("optional_host_permissions");
        object.remove("update_url");
        object.insert(
            "key".into(),
            json!(base64::engine::general_purpose::STANDARD.encode(key(origin))),
        );
    }
    manifest
}

/// Copies a package's runtime, skipping links: packages never contain them.
pub(super) fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        let target = to.join(entry.file_name());
        if kind.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else if kind.is_file() {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

/// Copies one version of the package for WebView2, unless that exact
/// version is already in place. WebView2 drops an extension whose files
/// change while it is installed, so a version's folder is never rewritten.
pub(super) fn stage(root: &Path, runtime: &Path, manifest: &Value) -> Result<PathBuf, String> {
    let bytes = serde_json::to_vec_pretty(manifest).map_err(|e| e.to_string())?;
    let version = short(&format!(
        "{}:{}",
        runtime.display(),
        hex::encode(Sha256::digest(&bytes))
    ));
    let folder = root.join(version);
    if folder.join("manifest.json").is_file() {
        return Ok(folder);
    }
    let staging = root.join(format!(".staging-{}", uuid::Uuid::new_v4()));
    let staged = copy_tree(runtime, &staging)
        .and_then(|_| std::fs::write(staging.join("manifest.json"), &bytes))
        .and_then(|_| std::fs::rename(&staging, &folder));
    if staged.is_err() {
        let _ = std::fs::remove_dir_all(&staging);
        return Err("Misty could not prepare this extension's files.".into());
    }
    Ok(folder)
}

/// Removes every version folder but `current`.
pub(super) fn prune(root: &Path, current: &Path) {
    for entry in std::fs::read_dir(root).into_iter().flatten().flatten() {
        if entry.path() != current {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

/// A manifest string, with `__MSG_name__` resolved from the default locale.
pub(super) fn localized(loaded: &Loaded, text: &str) -> String {
    let Some(key) = text
        .strip_prefix("__MSG_")
        .and_then(|t| t.strip_suffix("__"))
    else {
        return text.to_owned();
    };
    let Some(locale) = loaded.manifest["default_locale"].as_str() else {
        return text.to_owned();
    };
    let messages: Value = std::fs::read(
        loaded
            .folder
            .join("_locales")
            .join(locale)
            .join("messages.json"),
    )
    .ok()
    .and_then(|bytes| serde_json::from_slice(&bytes).ok())
    .unwrap_or_default();
    messages
        .as_object()
        .and_then(|all| all.iter().find(|(name, _)| name.eq_ignore_ascii_case(key)))
        .and_then(|(_, message)| message["message"].as_str())
        .unwrap_or(text)
        .to_owned()
}

/// A path inside the extension's folder, from its manifest.
pub(super) fn inside(folder: &Path, relative: &str) -> Option<PathBuf> {
    let relative = Path::new(relative.trim_start_matches('/'));
    relative
        .components()
        .all(|part| matches!(part, Component::Normal(_)))
        .then(|| folder.join(relative))
}

/// The toolbar icon closest to 32 pixels, as a data URL.
pub(super) fn icon(loaded: &Loaded) -> String {
    let action = action_of(&loaded.manifest);
    let sources = [&action["default_icon"], &loaded.manifest["icons"]];
    let path = sources.iter().find_map(|source| match source {
        Value::String(path) => Some(path.clone()),
        Value::Object(sizes) => sizes
            .iter()
            .filter_map(|(size, path)| Some((size.parse::<u32>().ok()?, path.as_str()?)))
            .min_by_key(|(size, _)| {
                if *size >= 32 {
                    *size - 32
                } else {
                    1000 + 32 - *size
                }
            })
            .map(|(_, path)| path.to_owned()),
        _ => None,
    });
    let Some(file) = path.and_then(|path| inside(&loaded.folder, &path)) else {
        return String::new();
    };
    let mime = match file
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
    {
        Some(e) if e == "png" => "image/png",
        Some(e) if e == "jpg" || e == "jpeg" => "image/jpeg",
        _ => return String::new(),
    };
    match std::fs::metadata(&file) {
        Ok(meta) if meta.len() <= MAX_ICON_BYTES => {}
        _ => return String::new(),
    }
    std::fs::read(&file)
        .map(|bytes| {
            format!(
                "data:{mime};base64,{}",
                base64::engine::general_purpose::STANDARD.encode(bytes)
            )
        })
        .unwrap_or_default()
}

pub(super) fn action_of(manifest: &Value) -> &Value {
    ["action", "browser_action"]
        .iter()
        .map(|key| &manifest[*key])
        .find(|value| value.is_object())
        .unwrap_or(&Value::Null)
}

/// The ID of an extension staged under `root`, from any staged manifest.
pub(super) fn staged_crx(root: &Path) -> Option<String> {
    std::fs::read_dir(root).ok()?.flatten().find_map(|entry| {
        let manifest = read_manifest(&entry.path()).ok()?;
        let key = base64::engine::general_purpose::STANDARD
            .decode(manifest["key"].as_str()?)
            .ok()?;
        Some(crx_id(&key))
    })
}
