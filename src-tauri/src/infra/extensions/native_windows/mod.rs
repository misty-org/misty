// SPDX-License-Identifier: MIT
//! Extensions on Windows run in WebView2, which is Chromium. Each Space has its
//! own host, as on macOS: Misty installs each extension a Space loads into the
//! profile behind every open browser view of that Space (the Space's own data
//! folder), and reconciles a profile when one of its views opens, so a profile
//! runs exactly the extensions loaded for its Space.
//!
//! Each version runs from its own copy of the package, holding only the
//! granted permissions and sites, since WebView2 grants whatever a manifest
//! declares. The copy's manifest carries a key derived from the extension's
//! account origin, so its ID, page host and storage stay the same across
//! versions and launches: a new version installs over the old one.
//!
//! WebView2 deletes an extension's storage when it is removed, so turning an
//! extension off disables it and only removing it from Misty uninstalls it.

mod lifecycle;
mod package;
mod profile;
#[cfg(test)]
mod store_probe;
#[cfg(test)]
mod tests;
mod toolbar;

use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::OnceLock,
    time::Duration,
};

use serde_json::{json, Value};
use tauri::{Manager, Webview};
use tokio::sync::Mutex;

use lifecycle::{load, reconcile, remove_extension, unload, unload_all};
use package::{
    action_of, crx_id, granted_manifest, icon, inside, key, localized, prune, read_manifest, stage,
    staged_crx, strings, validate,
};
use profile::{add, inspect, remove, set_enabled};
use toolbar::{actions, invoke, options};

const TIMEOUT: Duration = Duration::from_secs(30);
const MAX_ICON_BYTES: u64 = 1024 * 1024;
/// APIs WebView2 does not offer extensions yet.
pub(super) const LIMITED: [&str; 10] = [
    "contextMenus",
    "notifications",
    "nativeMessaging",
    "sidePanel",
    "tabGroups",
    "downloads",
    "history",
    "bookmarks",
    "identity",
    "tabCapture",
];

struct Loaded {
    origin: String,
    folder: PathBuf,
    private_access: bool,
    manifest: Value,
}

#[derive(Default)]
struct Host {
    /// The Space's key; its views are the only ones this host touches.
    space: String,
    account: String,
    loaded: HashMap<String, Loaded>,
    private_tabs: HashSet<String>,
}

fn hosts() -> &'static Mutex<HashMap<String, Host>> {
    static HOSTS: OnceLock<Mutex<HashMap<String, Host>>> = OnceLock::new();
    HOSTS.get_or_init(Default::default)
}

pub(crate) fn page_host(origin: &str) -> Option<String> {
    Some(crx_id(&key(origin)))
}

fn app() -> Result<&'static tauri::AppHandle, String> {
    super::native::app().ok_or_else(|| "The extension runtime has not initialized.".into())
}

fn short(value: &str) -> String {
    super::identity(value)[..20].to_owned()
}

fn base(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("extensions")
        .join("webview2"))
}

/// A Space's staged copies of an extension. The personal Space keeps the
/// account's folder from before Spaces.
fn extension_root(host: &Host, id: &str) -> Result<PathBuf, String> {
    let name = if host.space == crate::infra::space_windows::PERSONAL {
        format!("{}:{id}", host.account)
    } else {
        format!("{}:{}:{id}", host.account, host.space)
    };
    Ok(base(app()?)?.join(short(&name)))
}

/// A removal waits per Space: the same extension may still run in another Space.
fn removal(space: &str, crx: &str) -> String {
    if space == crate::infra::space_windows::PERSONAL {
        crx.to_owned()
    } else {
        format!("{space}:{crx}")
    }
}

/// The extensions Misty installed into WebView2 profiles, across accounts,
/// and those removed from Misty while some profile that ran them was closed
/// (each is uninstalled when one of that profile's views opens). Profiles
/// also hold WebView2's own extensions, such as its PDF viewer; Misty never
/// touches an extension it didn't install.
#[derive(Default, serde::Serialize, serde::Deserialize)]
struct Ledger {
    managed: HashSet<String>,
    removed: HashSet<String>,
    /// Per profile path, the folder each extension was last installed from.
    /// Kept across launches: installing an extension again reruns its
    /// `onInstalled`, and some open tabs there on every start.
    #[serde(default)]
    applied: HashMap<String, HashMap<String, PathBuf>>,
}

fn ledger_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(base(app)?.join("ledger.json"))
}

fn ledger() -> Ledger {
    app()
        .and_then(ledger_file)
        .ok()
        .and_then(|path| std::fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn update_ledger(change: impl FnOnce(&mut Ledger)) {
    let mut ledger = ledger();
    change(&mut ledger);
    if let (Ok(app), Ok(bytes)) = (app(), serde_json::to_vec(&ledger)) {
        if let Ok(path) = ledger_file(app) {
            let _ = std::fs::create_dir_all(path.parent().unwrap_or(&path));
            let _ = std::fs::write(path, bytes);
        }
    }
}

fn emit(host: &Host, kind: &str, mut data: Value) {
    data["kind"] = json!(kind);
    data["account"] = json!(host.account);
    data["space"] = json!(host.space);
    if let Ok(app) = app() {
        crate::infra::space_windows::emit_to_space(app, &host.space, "misty://extensions", data);
    }
}

pub async fn request(value: Value) -> Result<Value, String> {
    let operation = value["operation"].as_str().unwrap_or_default();
    let account = value["account"].as_str().unwrap_or_default();
    let space = value["space"].as_str().unwrap_or_default();
    if operation == "validate" {
        return validate(Path::new(value["runtimePath"].as_str().unwrap_or_default()));
    }
    let mut hosts = hosts().lock().await;
    if operation == "configure" && account.is_empty() {
        // Signing out stops every Space's host.
        for host in hosts.values_mut() {
            unload_all(host).await;
        }
        hosts.clear();
        return Ok(json!({"supported": true}));
    }
    if space.is_empty() {
        return Err("Extensions run in a Space.".into());
    }
    if operation == "release-space" || operation == "remove-space" {
        // The Space's views are gone; a removed Space's profile folder, with its
        // extensions' storage, goes with its website data.
        hosts.remove(space);
        return Ok(json!({}));
    }
    if operation == "configure" {
        let host = hosts.entry(space.to_owned()).or_insert_with(|| Host {
            space: space.to_owned(),
            ..Default::default()
        });
        if account != host.account {
            unload_all(host).await;
            host.account = account.to_owned();
        }
        return Ok(json!({"supported": true}));
    }
    let host = match hosts.get_mut(space) {
        Some(host) if !host.account.is_empty() && host.account == account => host,
        _ => return Err("The extension account changed.".into()),
    };
    let id = value["id"].as_str().unwrap_or_default();
    match operation {
        "diagnostics" => Ok(diagnostics(host)),
        "layout" => {
            host.private_tabs = value["tabs"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|tab| tab["private"] == true)
                .filter_map(|tab| tab["id"].as_str().map(str::to_owned))
                .collect();
            Ok(json!({}))
        }
        "permission-response"
        | "tab-created"
        | "sync-restored"
        | "context-menu"
        | "compat-reply"
        | "compat-event" => Ok(json!({})),
        "pending-navigation" => Ok(json!({"pending": false})),
        "load" => load(host, &value).await,
        "unload" => {
            unload(host, id).await;
            Ok(json!({}))
        }
        "remove" => {
            remove_extension(host, id).await;
            Ok(json!({}))
        }
        "actions" => Ok(actions(host, value["tabId"].as_str())),
        "invoke" => invoke(host, id, value["tabId"].as_str()),
        "options" => options(host, id),
        "popup-evaluate" => {
            Err("Inspecting extension popups is not available on Windows yet.".into())
        }
        "sync-apply" => Err("Extension sync is not available on Windows yet.".into()),
        _ => Err("Unknown extension operation.".into()),
    }
}

/// The Space a browser view belongs to, from the window that holds it.
fn view_space(view: &Webview) -> Option<String> {
    crate::infra::space_windows::space_for_owner(view.window().label())
}

/// Reconciles the profile behind a newly opened browser view, for its Space.
pub fn register(view: &Webview) {
    let view = view.clone();
    tauri::async_runtime::spawn(async move {
        let Some(space) = view_space(&view) else {
            return;
        };
        let mut hosts = hosts().lock().await;
        if let Some(host) = hosts
            .get_mut(&space)
            .filter(|host| !host.account.is_empty())
        {
            let _ = reconcile(host, &view).await;
        }
    });
}

fn diagnostics(host: &Host) -> Value {
    json!({
        "runtimeCount": host.loaded.len(),
        "platform": "Windows (WebView2)",
        "manifestVersions": [3],
        "compatibility": "Version-specific testing required",
        "acquisition": ["chrome-web-store"],
        "knownUnavailable": ["debugger", "proxy"],
        "limited": LIMITED,
        "compatibilityLayer": [],
        "hostLimitations": [
            "dynamic toolbar badges",
            "extension context menus",
            "permission requests after install",
            "extension tabs and windows APIs",
        ],
    })
}
