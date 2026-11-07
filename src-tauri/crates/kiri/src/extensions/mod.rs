// SPDX-License-Identifier: MIT
//! Kiri for extension contexts: installs the WebExtension compatibility
//! layer into an unpacked package.
//!
//! The system WebKit runtime omits several Firefox and Chrome APIs. The layer's scripts
//! run before an extension's own background scripts and pages and define only
//! what WebKit lacks. Applying it is idempotent, so packages installed before
//! the layer existed pick it up the next time they load.
//!
//! Extension pages run in views WebKit's extension controller creates, where
//! Tauri's IPC (and so `plugin:kiri|call`) does not exist, and the layer's
//! requests need answers. `compat/host.js` relays them over Kiri's extension
//! transport (`bridge`, macOS), which the embedder's extension host answers.
#[cfg(all(target_os = "macos", feature = "tauri"))]
pub mod bridge;
mod pages;
#[cfg(test)]
mod tests;

use pages::inject_pages;

use serde_json::{json, Value};
use std::{fs, path::Path};

pub const DIRECTORY: &str = "__misty_compat__";
const SCRIPTS: [&str; 9] = [
    "core.js",
    "shims.js",
    "chrome.js",
    "declarative.js",
    "userscripts.js",
    "capture.js",
    "blocking.js",
    "native.js",
    // Last: binds every API function, the layer's own included.
    "detached.js",
];
const WORKER: &str = "__misty_compat__/worker.js";
const MAX_PAGE_BYTES: u64 = 4 * 1024 * 1024;

const ASSETS: [(&str, &str); 13] = [
    ("core.js", include_str!("compat/core.js")),
    ("shims.js", include_str!("compat/shims.js")),
    ("chrome.js", include_str!("compat/chrome.js")),
    ("declarative.js", include_str!("compat/declarative.js")),
    ("userscripts.js", include_str!("compat/userscripts.js")),
    ("capture.js", include_str!("compat/capture.js")),
    ("blocking.js", include_str!("compat/blocking.js")),
    ("native.js", include_str!("compat/native.js")),
    ("detached.js", include_str!("compat/detached.js")),
    ("host.html", include_str!("compat/host.html")),
    ("host.js", include_str!("compat/host.js")),
    ("identity.html", include_str!("compat/identity.html")),
    ("identity.js", include_str!("compat/identity.js")),
];

/// Permissions the layer itself needs, granted through the install review.
/// Learned blocking enforces a webRequestBlocking extension's decisions as
/// declarativeNetRequest rules.
pub fn added_permissions(permissions: &[String]) -> Vec<String> {
    let mut added = Vec::new();
    if permissions.iter().any(|p| p == "webRequestBlocking")
        && !permissions.iter().any(|p| p == "declarativeNetRequest")
    {
        added.push("declarativeNetRequest".to_owned());
    }
    added
}

/// Install findings for permissions the layer covers only in part.
pub fn limitation(permission: &str) -> Option<&'static str> {
    Some(match permission {
        "webRequestBlocking" => "Blocks repeat requests only: Misty learns each blocking decision as a rule, so the first matching request can get through.",
        "identity" => "Sign-in works only with services that allow Misty's redirect address.",
        "management" => "Can read only its own extension details.",
        "tabHide" => "Tab hiding is not available; tabs stay visible.",
        "contextualIdentities" => "Firefox containers are not available.",
        "tabGroups" => "Tab groups work in the current window, and tabs don't report their group yet.",
        "declarativeContent" => "Page rules check page addresses; rules about a page's contents always count as met.",
        "contentSettings" => "Site settings can be read but not changed; Misty keeps them in Settings.",
        "fontSettings" => "Font settings can be read but not changed.",
        "power" => "Keeping the computer awake is not available; requests are ignored.",
        "userScripts" => "User scripts run as content scripts: include and exclude globs are ignored, and USER_SCRIPT worlds run isolated.",
        "tabCapture" | "desktopCapture" => "Capture uses macOS screen sharing, which asks what to share each time, and starts from the extension's own pages.",
        "privacy" => "Privacy settings can be read but not changed.",
        "offscreen" => "Its offscreen document runs in a hidden extension page, without audio or clipboard access of its own.",
        _ => return None,
    })
}

pub fn apply(runtime: &Path) -> Result<(), String> {
    let directory = runtime.join(DIRECTORY);
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    for (name, contents) in ASSETS {
        fs::write(directory.join(name), contents).map_err(|e| e.to_string())?;
    }
    let path = runtime.join("manifest.json");
    let mut manifest: Value = serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
        .map_err(|_| "Invalid extension manifest JSON.")?;
    let original = manifest.clone();
    let declared: Vec<String> = manifest["permissions"]
        .as_array()
        .map(|values| {
            values
                .iter()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default();
    if let Some(permissions) = manifest["permissions"].as_array_mut() {
        permissions.extend(added_permissions(&declared).into_iter().map(Value::from));
    }
    inject_background(runtime, &mut manifest)?;
    add_toolbar_action(&mut manifest);
    if manifest != original {
        fs::write(
            &path,
            serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    }
    inject_pages(runtime, runtime)
}

fn script_paths() -> Vec<String> {
    SCRIPTS
        .iter()
        .map(|name| format!("{DIRECTORY}/{name}"))
        .collect()
}

fn inject_background(runtime: &Path, manifest: &mut Value) -> Result<(), String> {
    let Some(background) = manifest
        .get_mut("background")
        .and_then(Value::as_object_mut)
    else {
        return Ok(());
    };
    // A package from an older layer gets the current script list, in order.
    if let Some(scripts) = background.get_mut("scripts").and_then(Value::as_array_mut) {
        scripts.retain(|s| {
            !s.as_str()
                .is_some_and(|s| s.starts_with(&format!("{DIRECTORY}/")))
        });
        for (index, path) in script_paths().into_iter().enumerate() {
            scripts.insert(index, json!(path));
        }
        return Ok(());
    }
    if let Some(worker) = background.get("service_worker").and_then(Value::as_str) {
        let worker = if worker == WORKER {
            // Ours already: the extension's own worker is its last import.
            let ours = fs::read_to_string(runtime.join(WORKER)).map_err(|e| e.to_string())?;
            ours.split('"')
                .skip(1)
                .step_by(2)
                .filter(|path| !path.starts_with(&format!("/{DIRECTORY}/")))
                .last()
                .ok_or("The extension's background worker is missing.")?
                .to_owned()
        } else {
            format!("/{}", worker.trim_start_matches('/'))
        };
        let module = background.get("type").and_then(Value::as_str) == Some("module");
        let mut imports: Vec<String> = script_paths().iter().map(|p| format!("/{p}")).collect();
        imports.push(worker);
        let quoted: Vec<String> = imports
            .iter()
            .map(|p| serde_json::to_string(p).unwrap())
            .collect();
        let source = if module {
            quoted
                .iter()
                .map(|p| format!("import {p};\n"))
                .collect::<String>()
        } else {
            format!("importScripts({});\n", quoted.join(", "))
        };
        fs::write(runtime.join(WORKER), source).map_err(|e| e.to_string())?;
        background.insert("service_worker".into(), json!(WORKER));
    }
    Ok(())
}

/// Firefox sidebar panels, Chrome side panels and address-bar page actions have
/// no host surface in Misty. When an extension has no toolbar button, one of
/// them becomes its popup.
fn add_toolbar_action(manifest: &mut Value) {
    let key = if manifest["manifest_version"].as_u64() == Some(3) {
        "action"
    } else {
        "browser_action"
    };
    if manifest.get(key).is_some() {
        return;
    }
    let source = if let Some(page) = manifest.get("page_action") {
        page.clone()
    } else if let Some(sidebar) = manifest.get("sidebar_action") {
        json!({
            "default_popup": sidebar["default_panel"],
            "default_title": sidebar["default_title"],
            "default_icon": sidebar["default_icon"],
        })
    } else if let Some(panel) = manifest.get("side_panel") {
        json!({ "default_popup": panel["default_path"], "default_icon": manifest["icons"] })
    } else {
        return;
    };
    let mut action = serde_json::Map::new();
    for field in ["default_popup", "default_title", "default_icon"] {
        if let Some(value) = source.get(field).filter(|v| !v.is_null()) {
            action.insert(field.into(), value.clone());
        }
    }
    manifest[key] = Value::Object(action);
}
