pub mod popup;

// SPDX-License-Identifier: MIT
mod catalog;
mod chrome_store;
mod compat;
mod crx;
pub(crate) mod install;
pub(crate) mod native;
pub(crate) use native::{page_host, EXTENSION_SCHEME};
#[cfg(windows)]
mod native_windows;
mod package;
pub(crate) mod runtime;
pub(crate) mod space;
mod spaces;
mod sync;
mod tabs;
pub(crate) use spaces::{release_space, remove_space};
pub(crate) use tabs::{
    agent_action, agent_extension_id, authorize_agent_url, context_menu, has_extensions,
    is_chrome_store_id, pending_navigation, request_store_install, request_store_remove,
    store_installation,
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::OnceLock,
};
use tauri::Manager;
use tokio::sync::Mutex;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionFailure {
    code: &'static str,
    message: String,
    retryable: bool,
}
impl From<String> for ExtensionFailure {
    fn from(message: String) -> Self {
        let lower = message.to_lowercase();
        let code = if message == catalog::REMOVED {
            "removed"
        } else if lower.contains("account changed") {
            "account-changed"
        } else if lower.contains("integrity")
            || lower.contains("identity")
            || lower.contains("signature")
            || lower.contains("not signed")
        {
            "integrity"
        } else if lower.contains("archive")
            || lower.contains("manifest")
            || lower.contains("package is invalid")
            || lower.contains("crx3")
        {
            "package"
        } else if lower.contains("permission") || lower.contains("access") {
            "permission"
        } else if lower.contains("require macos") || lower.contains("unavailable browser") {
            "unsupported"
        } else if lower.contains("mozilla")
            || lower.contains("chrome web store")
            || lower.contains("request")
            || lower.contains("download")
        {
            "network"
        } else {
            "runtime"
        };
        Self {
            code,
            retryable: matches!(code, "network" | "runtime"),
            message,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Installation {
    #[serde(deserialize_with = "catalog::extension_id")]
    pub id: String,
    pub guid: String,
    pub generation: String,
    pub name: String,
    pub installed: bool,
    pub enabled: bool,
    pub private_access: bool,
    pub agent_access: bool,
    pub permissions: Vec<String>,
    pub hosts: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledState {
    pub id: String,
    pub status: String,
    pub version: Option<String>,
    pub detail: Option<String>,
    pub review: Option<package::Review>,
    /// The page new tabs open while this extension runs, if it replaces it.
    pub new_tab: Option<String>,
}

#[derive(Default)]
struct ExtensionService {
    account: String,
    desired: BTreeMap<String, Installation>,
    states: BTreeMap<String, InstalledState>,
    loaded: BTreeMap<String, String>,
    /// Extensions their store took down, as found by the last update check.
    removed: std::collections::BTreeSet<String>,
    prepared: BTreeMap<String, PathBuf>,
    agent_access: bool,
}
static ACCOUNT_EPOCH: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static CLOSING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
fn account_changes() -> &'static tokio::sync::watch::Sender<u64> {
    static CHANGES: OnceLock<tokio::sync::watch::Sender<u64>> = OnceLock::new();
    CHANGES.get_or_init(|| tokio::sync::watch::channel(0).0)
}
fn advance_epoch() {
    let epoch = ACCOUNT_EPOCH.fetch_add(1, std::sync::atomic::Ordering::AcqRel) + 1;
    account_changes().send_replace(epoch);
}
async fn cancellable<T>(
    epoch: u64,
    future: impl std::future::Future<Output = Result<T, String>>,
) -> Result<T, String> {
    let mut changed = account_changes().subscribe();
    if *changed.borrow() != epoch || CLOSING.load(std::sync::atomic::Ordering::Acquire) {
        return Err("The extension account changed.".into());
    }
    tokio::select! { result=future=>result, _=changed.changed()=>Err("The extension account changed.".into()) }
}
/// Each Space keeps its own installations, states and loaded packages, as each
/// has its own extension host. A Space's entry lives for the process (there are
/// few); freeing a Space resets it.
fn service(space: &str) -> &'static Mutex<ExtensionService> {
    static SPACES: OnceLock<std::sync::Mutex<BTreeMap<String, &'static Mutex<ExtensionService>>>> =
        OnceLock::new();
    let mut spaces = SPACES
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    spaces
        .entry(space.to_owned())
        .or_insert_with(|| &*Box::leak(Box::<Mutex<ExtensionService>>::default()))
}
/// The account whose extensions run; empty while signed out.
fn current_account() -> &'static std::sync::Mutex<String> {
    static ACCOUNT: OnceLock<std::sync::Mutex<String>> = OnceLock::new();
    ACCOUNT.get_or_init(Default::default)
}
/// Spaces whose extensions this process has started.
fn running_spaces() -> &'static std::sync::Mutex<std::collections::BTreeSet<String>> {
    static RUNNING: OnceLock<std::sync::Mutex<std::collections::BTreeSet<String>>> =
        OnceLock::new();
    RUNNING.get_or_init(Default::default)
}
fn spaces_running() -> Vec<String> {
    running_spaces()
        .lock()
        .map(|spaces| spaces.iter().cloned().collect())
        .unwrap_or_default()
}
// Serializes lifecycle work, while allowing callbacks to acquire the state lock.
fn lifecycle() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(Default::default)
}
fn identity(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}
/// Extension page hosts, with the Spaces that run each extension. The same
/// extension keeps one host in every Space; each Space's controller serves it.
fn origins() -> &'static std::sync::RwLock<BTreeMap<String, std::collections::BTreeSet<String>>> {
    static ORIGINS: OnceLock<
        std::sync::RwLock<BTreeMap<String, std::collections::BTreeSet<String>>>,
    > = OnceLock::new();
    ORIGINS.get_or_init(Default::default)
}
fn allow_origin(space: &str, host: String) {
    if let Ok(mut origins) = origins().write() {
        origins.entry(host).or_default().insert(space.to_owned());
    }
}
fn drop_origin(space: &str, host: &str) {
    if let Ok(mut origins) = origins().write() {
        if let Some(spaces) = origins.get_mut(host) {
            spaces.remove(space);
            if spaces.is_empty() {
                origins.remove(host);
            }
        }
    }
}
fn drop_space_origins(space: &str) {
    if let Ok(mut origins) = origins().write() {
        origins.retain(|_, spaces| {
            spaces.remove(space);
            !spaces.is_empty()
        });
    }
}
/// An installation's extension page host, for its account origin.
fn installation_origin(account: &str, guid: &str) -> String {
    uuid_for(&format!("{account}:{guid}"))
}
pub(crate) fn is_extension_url(url: &url::Url) -> bool {
    url.scheme() == EXTENSION_SCHEME
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url
            .host_str()
            .is_some_and(|host| origins().read().is_ok_and(|o| o.contains_key(host)))
}
fn uuid_for(value: &str) -> String {
    let hash = Sha256::digest(value.as_bytes());
    uuid::Uuid::from_bytes(hash[..16].try_into().unwrap()).to_string()
}
/// The extension controller a Space's host uses. The personal Space keeps the
/// account's controller from before Spaces, and with it every extension's storage.
fn controller_id(account: &str, space: &str) -> String {
    if space == crate::infra::space_windows::PERSONAL {
        uuid_for(account)
    } else {
        uuid_for(&format!("{account}:space:{space}"))
    }
}
fn account_root(app: &tauri::AppHandle, account: &str) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("extensions")
        .join(identity(account)))
}
/// A Space's packages: `extensions/<account>/<space>`.
fn root(app: &tauri::AppHandle, account: &str, space: &str) -> Result<PathBuf, String> {
    if !crate::infra::space_windows::valid_key(space) {
        return Err("Unknown Space.".into());
    }
    Ok(account_root(app, account)?.join(space))
}
#[derive(Default, Serialize, Deserialize)]
struct PackageSelection {
    current: String,
    previous: Option<String>,
}
fn selected_package(root: &Path, previous: bool) -> Result<PathBuf, String> {
    let selection: PackageSelection = serde_json::from_slice(
        &std::fs::read(root.join("selection.json")).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let version = if previous {
        selection
            .previous
            .ok_or("No previous package is available.")?
    } else {
        selection.current
    };
    if version.len() != 64 || !version.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Invalid package selection.".into());
    }
    Ok(root.join("versions").join(version))
}
fn read_review(root: &Path) -> Result<package::Review, String> {
    serde_json::from_slice(&std::fs::read(root.join("review.json")).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

fn prune_versions(root: &Path) {
    let Ok(current) = selected_package(root, false) else {
        return;
    };
    let previous = selected_package(root, true).ok();
    let Ok(entries) = std::fs::read_dir(root.join("versions")) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if path != current
            && previous.as_ref() != Some(&path)
            && name.len() == 64
            && name.bytes().all(|v| v.is_ascii_hexdigit())
            && entry.file_type().is_ok_and(|v| v.is_dir())
        {
            let _ = std::fs::remove_dir_all(path);
        }
    }
}

fn valid_installation(value: &Installation) -> bool {
    let identity = match catalog::Store::of(&value.id) {
        Some(catalog::Store::Chrome) => value.guid == value.id,
        Some(catalog::Store::Firefox) => !catalog::is_chrome_id(&value.guid),
        None => false,
    };
    identity
        && !value.guid.is_empty()
        && value.guid.len() <= 256
        && value.name.len() <= 512
        && uuid::Uuid::parse_str(&value.generation).is_ok()
        && value.permissions.len() <= 256
        && value.hosts.len() <= 2048
        && value
            .permissions
            .iter()
            .chain(&value.hosts)
            .all(|v| !v.contains('\0') && v.len() <= 8192)
}

pub async fn close_account() {
    CLOSING.store(true, std::sync::atomic::Ordering::Release);
    advance_epoch();
    let _guard = lifecycle().lock().await;
    sync::reset();
    for space in spaces_running() {
        let mut state = service(&space).lock().await;
        for path in state.prepared.values() {
            let _ = std::fs::remove_dir_all(path);
        }
        *state = ExtensionService::default();
    }
    if let Ok(mut running) = running_spaces().lock() {
        running.clear();
    }
    if let Ok(mut account) = current_account().lock() {
        account.clear();
    }
    if let Ok(mut origins) = origins().write() {
        origins.clear();
    }
    // An empty account stops every Space's host.
    let _ = native::request(json!({"operation":"configure", "account":""})).await;
    CLOSING.store(false, std::sync::atomic::Ordering::Release);
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LayoutTab {
    id: String,
    window_id: String,
    index: u32,
    url: String,
    title: String,
    private: bool,
    active: bool,
    focused: bool,
    #[serde(default)]
    muted: bool,
    #[serde(default)]
    audible: bool,
}
#[tauri::command]
pub async fn extensions_layout(
    caller: tauri::Webview,
    tabs: Vec<LayoutTab>,
) -> Result<(), ExtensionFailure> {
    let result: Result<_, String> = async {
        let space = native::caller_space(&caller)?;
        if tabs.len() > 10000
            || tabs.iter().any(|t| {
                t.id.len() > 256
                    || t.window_id.len() > 256
                    || t.url.len() > 16384
                    || t.title.len() > 4096
            })
        {
            return Err("Invalid extension tab layout.".into());
        }
        let account = service(&space).lock().await.account.clone();
        if account.is_empty() {
            return Ok(());
        }
        native::request(json!({"operation":"layout","account":account,"space":space,"tabs":tabs}))
            .await?;
        Ok(())
    }
    .await;
    result.map_err(ExtensionFailure::from)
}

/// Answers an extension's compatibility request, or delivers an event to the
/// extensions whose granted permissions allow it.
#[tauri::command]
pub async fn extensions_compat(
    caller: tauri::Webview,
    operation: String,
    payload: Value,
) -> Result<Value, ExtensionFailure> {
    let result: Result<_, String> = async {
        let space = native::caller_space(&caller)?;
        if !["compat-reply", "compat-event"].contains(&operation.as_str())
            || !payload.is_object()
            || payload.to_string().len() > 8 * 1024 * 1024
        {
            return Err("Invalid extension compatibility message.".into());
        }
        let account = service(&space).lock().await.account.clone();
        if account.is_empty() {
            return Ok(Value::Null);
        }
        let mut request = payload;
        request["operation"] = json!(operation);
        request["account"] = json!(account);
        request["space"] = json!(space);
        native::request(request).await
    }
    .await;
    result.map_err(ExtensionFailure::from)
}
