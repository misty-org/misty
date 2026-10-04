// SPDX-License-Identifier: MIT
mod catalog;
mod compat;
pub(crate) mod install;
pub(crate) mod native;
mod package;
pub(crate) mod runtime;
mod sync;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::OnceLock,
};
use tauri::{Emitter, Manager};
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
        let code = if lower.contains("account changed") {
            "account-changed"
        } else if lower.contains("integrity") || lower.contains("identity") {
            "integrity"
        } else if lower.contains("archive") || lower.contains("manifest") {
            "package"
        } else if lower.contains("permission") || lower.contains("access") {
            "permission"
        } else if lower.contains("require macos") || lower.contains("unavailable browser") {
            "unsupported"
        } else if lower.contains("mozilla")
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
    pub id: u64,
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
    pub id: u64,
    pub status: String,
    pub version: Option<String>,
    pub detail: Option<String>,
    pub review: Option<package::Review>,
}

#[derive(Default)]
struct ExtensionService {
    account: String,
    desired: BTreeMap<u64, Installation>,
    states: BTreeMap<u64, InstalledState>,
    loaded: BTreeMap<u64, String>,
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
fn service() -> &'static Mutex<ExtensionService> {
    static STATE: OnceLock<Mutex<ExtensionService>> = OnceLock::new();
    STATE.get_or_init(Default::default)
}
// Serializes lifecycle work, while allowing callbacks to acquire the state lock.
fn lifecycle() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(Default::default)
}
fn identity(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}
fn origins() -> &'static std::sync::RwLock<std::collections::BTreeSet<String>> {
    static ORIGINS: OnceLock<std::sync::RwLock<std::collections::BTreeSet<String>>> =
        OnceLock::new();
    ORIGINS.get_or_init(Default::default)
}
pub(crate) fn is_extension_url(url: &url::Url) -> bool {
    url.scheme() == "webkit-extension"
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url
            .host_str()
            .is_some_and(|host| origins().read().is_ok_and(|o| o.contains(host)))
}
fn uuid_for(value: &str) -> String {
    let hash = Sha256::digest(value.as_bytes());
    uuid::Uuid::from_bytes(hash[..16].try_into().unwrap()).to_string()
}
fn root(app: &tauri::AppHandle, account: &str) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("extensions")
        .join(identity(account)))
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
    value.id > 0
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

#[tauri::command]
pub async fn extensions_search(
    caller: tauri::Webview,
    query: String,
    category: Option<String>,
    page: u32,
    sort: String,
) -> Result<catalog::CatalogPage, ExtensionFailure> {
    let result: Result<_, String> = async {
        native::trusted(&caller)?;
        catalog::search(query, category, page, sort).await
    }
    .await;
    result.map_err(ExtensionFailure::from)
}
#[tauri::command]
pub async fn extensions_detail(
    caller: tauri::Webview,
    id: u64,
) -> Result<catalog::CatalogEntry, ExtensionFailure> {
    let result: Result<_, String> = async {
        native::trusted(&caller)?;
        catalog::detail(id).await
    }
    .await;
    result.map_err(ExtensionFailure::from)
}

pub async fn close_account() {
    CLOSING.store(true, std::sync::atomic::Ordering::Release);
    advance_epoch();
    let _guard = lifecycle().lock().await;
    sync::reset();
    for path in service().lock().await.prepared.values() {
        let _ = std::fs::remove_dir_all(path);
    }
    *service().lock().await = ExtensionService::default();
    if let Ok(mut origins) = origins().write() {
        origins.clear();
    }
    let _ = native::request(json!({"operation":"configure", "account":"", "controllerId":uuid::Uuid::new_v4().to_string()})).await;
    CLOSING.store(false, std::sync::atomic::Ordering::Release);
}

// Called only after the browser service has validated the agent's live grant.
pub(crate) async fn agent_action(
    operation: &str,
    id: Option<u64>,
    tab: &str,
    script: Option<String>,
) -> Result<Value, String> {
    let state = service().lock().await;
    if !state.agent_access {
        return Err("Agent access to extensions is disabled.".into());
    }
    let allowed = state
        .desired
        .values()
        .filter(|v| v.installed && v.enabled && v.agent_access)
        .map(|v| v.id)
        .collect::<Vec<_>>();
    if id.is_some_and(|id| !allowed.contains(&id)) {
        return Err("Agent access to this extension is disabled.".into());
    }
    let account = state.account.clone();
    drop(state);
    let mut value=native::request(json!({"operation":operation,"account":account,"id":id.map(|v|v.to_string()),"tabId":tab,"script":script})).await?;
    let state = service().lock().await;
    if state.account != account
        || !state.agent_access
        || id.is_some_and(|id| {
            !state
                .desired
                .get(&id)
                .is_some_and(|v| v.installed && v.enabled && v.agent_access)
        })
    {
        return Err("Agent extension access was revoked.".into());
    }
    if let Some(actions) = value["actions"].as_array_mut() {
        actions.retain(|action| {
            action["id"]
                .as_str()
                .and_then(|v| v.parse::<u64>().ok())
                .is_some_and(|id| {
                    state
                        .desired
                        .get(&id)
                        .is_some_and(|v| v.installed && v.enabled && v.agent_access)
                })
        });
    }
    Ok(value)
}
pub(crate) async fn authorize_agent_url(url: &url::Url) -> Result<(), String> {
    if url.scheme() != "webkit-extension" {
        return Ok(());
    }
    let state = service().lock().await;
    if state.agent_access
        && state.desired.values().any(|v| {
            v.installed
                && v.enabled
                && v.agent_access
                && url.host_str() == Some(&uuid_for(&format!("{}:{}", state.account, v.guid)))
        })
    {
        Ok(())
    } else {
        Err("Agent access to this extension is disabled.".into())
    }
}

pub(crate) async fn pending_navigation(tab: &str) -> bool {
    let account = service().lock().await.account.clone();
    native::request(json!({"operation":"pending-navigation","account":account,"tabId":tab}))
        .await
        .is_ok_and(|v| v["pending"] == true)
}

pub(crate) fn has_extensions() -> bool {
    origins().read().is_ok_and(|v| !v.is_empty())
}
pub(crate) async fn context_menu(tab: &str, agent: bool) -> Result<Value, String> {
    let state = service().lock().await;
    let account = state.account.clone();
    let allowed: Vec<String> = state
        .desired
        .values()
        .filter(|v| v.installed && v.enabled && (!agent || (state.agent_access && v.agent_access)))
        .map(|v| v.id.to_string())
        .collect();
    drop(state);
    native::request(
        json!({"operation":"context-menu","account":account,"tabId":tab,"allowedIds":allowed}),
    )
    .await
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
        native::trusted(&caller)?;
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
        let account = service().lock().await.account.clone();
        if account.is_empty() {
            return Ok(());
        }
        native::request(json!({"operation":"layout","account":account,"tabs":tabs})).await?;
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
        native::trusted(&caller)?;
        if !["compat-reply", "compat-event"].contains(&operation.as_str())
            || !payload.is_object()
            || payload.to_string().len() > 8 * 1024 * 1024
        {
            return Err("Invalid extension compatibility message.".into());
        }
        let account = service().lock().await.account.clone();
        if account.is_empty() {
            return Ok(Value::Null);
        }
        let mut request = payload;
        request["operation"] = json!(operation);
        request["account"] = json!(account);
        native::request(request).await
    }
    .await;
    result.map_err(ExtensionFailure::from)
}

#[tauri::command]
pub async fn extensions_categories(
    caller: tauri::Webview,
) -> Result<Vec<catalog::Category>, ExtensionFailure> {
    native::trusted(&caller).map_err(ExtensionFailure::from)?;
    catalog::categories().await.map_err(ExtensionFailure::from)
}
