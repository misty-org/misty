// SPDX-License-Identifier: MIT
//! Installs Misty's WebExtension compatibility layer into an unpacked package.
//!
//! The system WebKit runtime omits several Firefox APIs. The layer's scripts
//! run before an extension's own background scripts and pages and define only
//! what WebKit lacks. Applying it is idempotent, so packages installed before
//! the layer existed pick it up the next time they load.
use serde_json::{json, Value};
use std::{fs, path::Path};

pub const DIRECTORY: &str = "__misty_compat__";
const SCRIPTS: [&str; 4] = ["core.js", "shims.js", "blocking.js", "native.js"];
const WORKER: &str = "__misty_compat__/worker.js";
const MAX_PAGE_BYTES: u64 = 4 * 1024 * 1024;

const ASSETS: [(&str, &str); 8] = [
    ("core.js", include_str!("compat/core.js")),
    ("shims.js", include_str!("compat/shims.js")),
    ("blocking.js", include_str!("compat/blocking.js")),
    ("native.js", include_str!("compat/native.js")),
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
        "bookmarks" => "Bookmarks are not shared with extensions yet.",
        "privacy" => "Privacy settings can be read but not changed.",
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
        .map(|values| values.iter().filter_map(|v| v.as_str().map(str::to_owned)).collect())
        .unwrap_or_default();
    if let Some(permissions) = manifest["permissions"].as_array_mut() {
        permissions.extend(added_permissions(&declared).into_iter().map(Value::from));
    }
    inject_background(runtime, &mut manifest)?;
    add_toolbar_action(&mut manifest);
    if manifest != original {
        fs::write(&path, serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?)
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
    let Some(background) = manifest.get_mut("background").and_then(Value::as_object_mut) else {
        return Ok(());
    };
    if let Some(scripts) = background.get_mut("scripts").and_then(Value::as_array_mut) {
        if !scripts.iter().any(|s| s.as_str() == Some(&script_paths()[0])) {
            for (index, path) in script_paths().into_iter().enumerate() {
                scripts.insert(index, json!(path));
            }
        }
        return Ok(());
    }
    if let Some(worker) = background.get("service_worker").and_then(Value::as_str) {
        if worker == WORKER {
            return Ok(());
        }
        let worker = format!("/{}", worker.trim_start_matches('/'));
        let module = background.get("type").and_then(Value::as_str) == Some("module");
        let mut imports: Vec<String> = script_paths().iter().map(|p| format!("/{p}")).collect();
        imports.push(worker);
        let quoted: Vec<String> = imports.iter().map(|p| serde_json::to_string(p).unwrap()).collect();
        let source = if module {
            quoted.iter().map(|p| format!("import {p};\n")).collect::<String>()
        } else {
            format!("importScripts({});\n", quoted.join(", "))
        };
        fs::write(runtime.join(WORKER), source).map_err(|e| e.to_string())?;
        background.insert("service_worker".into(), json!(WORKER));
    }
    Ok(())
}

/// Firefox sidebar panels and address-bar page actions have no host surface in
/// Misty. When an extension has no toolbar button, either one becomes its popup.
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

fn inject_pages(runtime: &Path, directory: &Path) -> Result<(), String> {
    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_dir() {
            let name = entry.file_name();
            if directory == runtime && (name == DIRECTORY || name == "__misty_sync__") {
                continue;
            }
            inject_pages(runtime, &path)?;
            continue;
        }
        let is_page = path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("html") || e.eq_ignore_ascii_case("htm"));
        if !kind.is_file() || !is_page || entry.metadata().map_or(true, |m| m.len() > MAX_PAGE_BYTES) {
            continue;
        }
        let Ok(page) = fs::read_to_string(&path) else {
            continue;
        };
        if let Some(updated) = inject_page(&page) {
            fs::write(&path, updated).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Places the layer before the page's first script. Returns `None` when the
/// page already loads it.
fn inject_page(page: &str) -> Option<String> {
    let first = format!("/{}", script_paths()[0]);
    if page.contains(&first) {
        return None;
    }
    let tags: String = script_paths()
        .iter()
        .map(|p| format!("<script src=\"/{p}\"></script>"))
        .collect();
    let lower = page.to_ascii_lowercase();
    let after_tag = |name: &str| {
        let start = lower.find(&format!("<{name}"))?;
        let next = lower.as_bytes().get(start + name.len() + 1)?;
        (*next == b'>' || next.is_ascii_whitespace())
            .then(|| lower[start..].find('>').map(|end| start + end + 1))
            .flatten()
    };
    let at = after_tag("head")
        .or_else(|| after_tag("html"))
        .or_else(|| lower.find("<!doctype").and_then(|s| lower[s..].find('>').map(|e| s + e + 1)))
        .unwrap_or(0);
    Some(format!("{}{}{}", &page[..at], tags, &page[at..]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_injection_runs_before_page_scripts_and_is_idempotent() {
        let page = "<!doctype html><html><HEAD><script src=\"popup.js\"></script></head></html>";
        let updated = inject_page(page).unwrap();
        let compat = updated.find("/__misty_compat__/core.js").unwrap();
        assert!(compat < updated.find("popup.js").unwrap());
        assert!(updated.find("<HEAD>").unwrap() < compat);
        assert!(inject_page(&updated).is_none());
        assert!(inject_page("<header>").unwrap().starts_with("<script"));
    }

    #[test]
    fn background_scripts_and_workers_load_the_layer_first() {
        let root = tempfile::tempdir().unwrap();
        let mut manifest = json!({"background":{"scripts":["bg.js"]}});
        inject_background(root.path(), &mut manifest).unwrap();
        assert_eq!(manifest["background"]["scripts"][0], "__misty_compat__/core.js");
        assert_eq!(manifest["background"]["scripts"][4], "bg.js");
        inject_background(root.path(), &mut manifest).unwrap();
        assert_eq!(manifest["background"]["scripts"].as_array().unwrap().len(), 5);

        fs::create_dir(root.path().join(DIRECTORY)).unwrap();
        let mut manifest = json!({"background":{"service_worker":"sw.js"}});
        inject_background(root.path(), &mut manifest).unwrap();
        assert_eq!(manifest["background"]["service_worker"], WORKER);
        let worker = fs::read_to_string(root.path().join(WORKER)).unwrap();
        assert!(worker.starts_with("importScripts(\"/__misty_compat__/core.js\""));
        assert!(worker.contains("\"/sw.js\""));
    }

    #[test]
    fn sidebar_and_page_actions_become_toolbar_popups() {
        let mut manifest = json!({"manifest_version":2,"sidebar_action":{"default_panel":"panel.html","default_title":"Panel"}});
        add_toolbar_action(&mut manifest);
        assert_eq!(manifest["browser_action"]["default_popup"], "panel.html");
        let mut manifest = json!({"manifest_version":2,"browser_action":{},"page_action":{"default_popup":"p.html"}});
        add_toolbar_action(&mut manifest);
        assert_eq!(manifest["browser_action"], json!({}));
    }
}
