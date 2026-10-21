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
    /// The Space's key; its views are the only ones this host touches.
    space: String,
    account: String,
    loaded: HashMap<String, Loaded>,
    /// Per profile path, the folder each extension was last installed from.
    applied: HashMap<String, HashMap<String, PathBuf>>,
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
    let _ = app;
    let root = extension_root(host, id)?;
    let folder = stage(&root, &runtime, &granted)?;
    let crx = page_host(origin).unwrap_or_default();
    let removed = removal(&host.space, &crx);
    update_ledger(|ledger| {
        ledger.removed.remove(&removed);
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
    emit(host, "changed", json!({"id": id}));
    Ok(json!({"loaded": true, "errors": errors}))
}

/// Stops the extension in every open profile, keeping its data.
async fn unload(host: &mut Host, id: &str) -> Option<String> {
    let loaded = host.loaded.remove(id)?;
    let crx = page_host(&loaded.origin)?;
    for applied in host.applied.values_mut() {
        applied.remove(&crx);
    }
    for view in browser_views(&host.space) {
        let _ = set_enabled(&view, crx.clone(), false).await;
    }
    Some(crx)
}

/// Uninstalls the extension, with its data, from every profile.
async fn remove_extension(host: &mut Host, id: &str) {
    let crx = match unload(host, id).await {
        Some(crx) => crx,
        None => match extension_root(host, id) {
            // Not running: its ID is in any staged manifest.
            Ok(root) => match staged_crx(&root) {
                Some(crx) => crx,
                None => return,
            },
            Err(_) => return,
        },
    };
    for view in browser_views(&host.space) {
        let _ = remove(&view, crx.clone()).await;
    }
    let removed = removal(&host.space, &crx);
    update_ledger(|ledger| {
        ledger.removed.insert(removed);
    });
    if let Ok(root) = extension_root(host, id) {
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

/// The open browser views of one Space.
fn browser_views(space: &str) -> Vec<Webview> {
    let Ok(app) = app() else {
        return Vec::new();
    };
    app.webviews()
        .into_iter()
        .filter(|(label, _)| {
            label.starts_with("misty-browser-") && !label.starts_with("misty-browser-capture-")
        })
        .map(|(_, view)| view)
        .filter(|view| view_space(view).as_deref() == Some(space))
        .collect()
}

async fn reconcile_open(host: &mut Host) -> Vec<String> {
    let mut errors = Vec::new();
    for view in browser_views(&host.space) {
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
        if ledger.removed.contains(&removal(&host.space, crx)) {
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
        host,
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
    emit(host, "open-tab", json!({"url": url, "private": false}));
    Ok(json!({}))
}
