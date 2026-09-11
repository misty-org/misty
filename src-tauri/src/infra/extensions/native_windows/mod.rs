// SPDX-License-Identifier: MIT
//! Extensions on Windows run in WebView2, which is Chromium. Misty installs
//! each loaded extension into the profile behind every open browser view, and
//! reconciles a profile when one of its views opens, so a profile runs exactly
//! the extensions loaded for the account.
//!
//! Each version runs from its own copy of the package, holding only the
//! granted permissions and sites, since WebView2 grants whatever a manifest
//! declares. The copy's manifest carries a key derived from the extension's
//! account origin, so its ID, page host and storage stay the same across
//! versions and launches: a new version installs over the old one.
//!
//! WebView2 deletes an extension's storage when it is removed, so turning an
//! extension off disables it and only removing it from Misty uninstalls it.

mod package;
mod profile;
#[cfg(test)]
mod tests;

use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::OnceLock,
    time::Duration,
};

use serde_json::{json, Value};
use tauri::{Emitter, Manager, Webview};
use tokio::sync::Mutex;

use package::{
    action_of, crx_id, granted_manifest, icon, inside, key, localized, prune, read_manifest, stage,
    staged_crx, strings, validate,
};
use profile::{add, inspect, remove, set_enabled};

const TIMEOUT: Duration = Duration::from_secs(30);
const MAX_ICON_BYTES: u64 = 1024 * 1024;
/// APIs WebView2 does not offer extensions yet.
const LIMITED: [&str; 10] = [
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
    account: String,
    loaded: HashMap<String, Loaded>,
    /// Per profile path, the folder each extension was last installed from.
    applied: HashMap<String, HashMap<String, PathBuf>>,
    private_tabs: HashSet<String>,
}

fn host() -> &'static Mutex<Host> {
    static HOST: OnceLock<Mutex<Host>> = OnceLock::new();
    HOST.get_or_init(Default::default)
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

fn extension_root(app: &tauri::AppHandle, account: &str, id: &str) -> Result<PathBuf, String> {
    Ok(base(app)?.join(short(&format!("{account}:{id}"))))
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

fn emit(account: &str, kind: &str, mut data: Value) {
    data["kind"] = json!(kind);
    data["account"] = json!(account);
    if let Ok(app) = app() {
        let _ = app.emit_to("main", "misty://extensions", data);
    }
}

pub async fn request(value: Value) -> Result<Value, String> {
    let operation = value["operation"].as_str().unwrap_or_default();
    let account = value["account"].as_str().unwrap_or_default();
    let mut host = host().lock().await;
    if operation == "configure" {
        if account != host.account {
            unload_all(&mut host).await;
            host.account = account.to_owned();
        }
        return Ok(json!({"supported": true}));
    }
    if host.account.is_empty() || account != host.account {
        return Err("The extension account changed.".into());
    }
    let id = value["id"].as_str().unwrap_or_default();
    match operation {
        "diagnostics" => Ok(diagnostics(&host)),
        "validate" => validate(Path::new(value["runtimePath"].as_str().unwrap_or_default())),
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
        "load" => load(&mut host, &value).await,
        "unload" => {
            unload(&mut host, id).await;
            Ok(json!({}))
        }
        "remove" => {
            remove_extension(&mut host, id).await;
            Ok(json!({}))
        }
        "actions" => Ok(actions(&host, value["tabId"].as_str())),
        "invoke" => invoke(&host, id, value["tabId"].as_str()),
        "options" => options(&host, id),
        "popup-evaluate" => {
            Err("Inspecting extension popups is not available on Windows yet.".into())
        }
        "sync-apply" => Err("Extension sync is not available on Windows yet.".into()),
        _ => Err("Unknown extension operation.".into()),
    }
}

/// Reconciles the profile behind a newly opened browser view.
pub fn register(view: &Webview) {
    let view = view.clone();
    tauri::async_runtime::spawn(async move {
        let mut host = host().lock().await;
        if !host.account.is_empty() {
            let _ = reconcile(&mut host, &view).await;
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

async fn load(host: &mut Host, request: &Value) -> Result<Value, String> {
    let app = app()?;
    let id = request["id"].as_str().ok_or("Invalid extension ID.")?;
    let origin = request["origin"]
        .as_str()
        .ok_or("Invalid extension origin.")?;
    let runtime = PathBuf::from(request["runtimePath"].as_str().unwrap_or_default());
    let granted = granted_manifest(
        &read_manifest(&runtime)?,
        origin,
        &strings(&request["permissions"]),
        &strings(&request["hosts"]),
    );
    let root = extension_root(app, &host.account, id)?;
    let folder = stage(&root, &runtime, &granted)?;
    let crx = page_host(origin).unwrap_or_default();
    update_ledger(|ledger| {
        ledger.removed.remove(&crx);
        ledger.managed.insert(crx);
    });
    host.loaded.insert(
        id.to_owned(),
        Loaded {
            origin: origin.to_owned(),
            folder: folder.clone(),
            private_access: request["privateAccess"] == true,
            manifest: granted,
        },
    );
    let errors = reconcile_open(host).await;
    prune(&root, &folder);
    let account = host.account.clone();
    emit(&account, "changed", json!({"id": id}));
    Ok(json!({"loaded": true, "errors": errors}))
}

/// Stops the extension in every open profile, keeping its data.
async fn unload(host: &mut Host, id: &str) -> Option<String> {
    let loaded = host.loaded.remove(id)?;
    let crx = page_host(&loaded.origin)?;
    for applied in host.applied.values_mut() {
        applied.remove(&crx);
    }
    for view in browser_views() {
        let _ = set_enabled(&view, crx.clone(), false).await;
    }
    Some(crx)
}

/// Uninstalls the extension, with its data, from every profile.
async fn remove_extension(host: &mut Host, id: &str) {
    let crx = match unload(host, id).await {
        Some(crx) => crx,
        None => match app().and_then(|app| extension_root(app, &host.account, id)) {
            // Not running: its ID is in any staged manifest.
            Ok(root) => match staged_crx(&root) {
                Some(crx) => crx,
                None => return,
            },
            Err(_) => return,
        },
    };
    for view in browser_views() {
        let _ = remove(&view, crx.clone()).await;
    }
    update_ledger(|ledger| {
        ledger.removed.insert(crx);
    });
    if let Ok(root) = app().and_then(|app| extension_root(app, &host.account, id)) {
        let _ = std::fs::remove_dir_all(root);
    }
}

async fn unload_all(host: &mut Host) {
    let ids: Vec<String> = host.loaded.keys().cloned().collect();
    for id in ids {
        unload(host, &id).await;
    }
    host.applied.clear();
    host.private_tabs.clear();
}

/// The open browser views.
fn browser_views() -> Vec<Webview> {
    let Ok(app) = app() else {
        return Vec::new();
    };
    app.webviews()
        .into_iter()
        .filter(|(label, _)| {
            label.starts_with("misty-browser-") && !label.starts_with("misty-browser-capture-")
        })
        .map(|(_, view)| view)
        .collect()
}

async fn reconcile_open(host: &mut Host) -> Vec<String> {
    let mut errors = Vec::new();
    for view in browser_views() {
        if let Err(error) = reconcile(host, &view).await {
            errors.push(error);
        }
    }
    errors.dedup();
    errors
}

/// Makes the view's profile run exactly the loaded extensions it may run:
/// Misty's others are disabled, or uninstalled once removed from Misty.
async fn reconcile(host: &mut Host, view: &Webview) -> Result<(), String> {
    let profile = inspect(view).await?;
    let wanted: HashMap<String, PathBuf> = host
        .loaded
        .values()
        .filter(|loaded| !profile.private || loaded.private_access)
        .filter_map(|loaded| Some((page_host(&loaded.origin)?, loaded.folder.clone())))
        .collect();
    let ledger = ledger();
    for (crx, enabled) in &profile.installed {
        if !ledger.managed.contains(crx) {
            continue;
        }
        if ledger.removed.contains(crx) {
            remove(view, crx.clone()).await?;
        } else if *enabled && !wanted.contains_key(crx) {
            set_enabled(view, crx.clone(), false).await?;
        }
    }
    let applied = host.applied.entry(profile.path).or_default();
    for (crx, folder) in wanted {
        let installed = profile.installed.iter().any(|(id, on)| *id == crx && *on);
        if installed && applied.get(&crx) == Some(&folder) {
            continue;
        }
        add(view, folder.clone()).await?;
        applied.insert(crx, folder);
    }
    Ok(())
}

fn may_use(host: &Host, loaded: &Loaded, tab: Option<&str>) -> bool {
    loaded.private_access || !tab.is_some_and(|tab| host.private_tabs.contains(tab))
}

fn actions(host: &Host, tab: Option<&str>) -> Value {
    let actions: Vec<Value> = host
        .loaded
        .iter()
        .map(|(id, loaded)| {
            let action = action_of(&loaded.manifest);
            let title = action["default_title"]
                .as_str()
                .or_else(|| loaded.manifest["name"].as_str())
                .unwrap_or_default();
            json!({
                "id": id,
                "title": localized(loaded, title),
                "badge": "",
                "enabled": may_use(host, loaded, tab) && page_host(&loaded.origin).is_some(),
                "icon": icon(loaded),
            })
        })
        .collect();
    json!({"actions": actions})
}

fn page_url(loaded: &Loaded, page: &str) -> Result<String, String> {
    let crx = page_host(&loaded.origin).ok_or("Open a browser tab, then try again.")?;
    inside(&loaded.folder, page).ok_or("This extension's page is invalid.")?;
    Ok(format!(
        "{}://{crx}/{}",
        super::EXTENSION_SCHEME,
        page.trim_start_matches('/')
    ))
}

fn invoke(host: &Host, id: &str, tab: Option<&str>) -> Result<Value, String> {
    let loaded = host
        .loaded
        .get(id)
        .ok_or("This extension is not running.")?;
    if !may_use(host, loaded, tab) {
        return Err("This extension cannot access the current tab.".into());
    }
    let popup = action_of(&loaded.manifest)["default_popup"]
        .as_str()
        .filter(|page| !page.is_empty())
        .ok_or(
            "This extension's button has no popup, and Windows can't run its click action yet.",
        )?;
    let url = page_url(loaded, popup)?;
    emit(
        &host.account,
        "open-window",
        json!({"urls": [url], "popup": true, "focused": true, "private": false}),
    );
    Ok(json!({}))
}

fn options(host: &Host, id: &str) -> Result<Value, String> {
    let loaded = host
        .loaded
        .get(id)
        .ok_or("This extension is not running.")?;
    let page = loaded.manifest["options_ui"]["page"]
        .as_str()
        .or_else(|| loaded.manifest["options_page"].as_str())
        .ok_or("This extension has no options page.")?;
    let url = page_url(loaded, page)?;
    emit(
        &host.account,
        "open-tab",
        json!({"url": url, "private": false}),
    );
    Ok(json!({}))
}
