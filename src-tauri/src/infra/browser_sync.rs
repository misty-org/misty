//! Main-window IPC boundary for the native sync worker. Website views and agent
//! windows cannot unlock the vault or publish arbitrary credential payloads.
use std::{
    borrow::Cow,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        OnceLock,
    },
};

use misty_browser_sync::{
    crypto::{generate_sync_secret, DeviceKey, VaultRoot, VaultScope},
    document::{self, Change, Document, Payload, WorkspaceView},
    protocol::{Presence, Vault},
    secure_store,
    store::{BrowserProfileBinding, CachedVault, Store},
    transport::SyncApi,
    worker::{Phase, Status, Worker, WorkerHandle},
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager};
use tokio::{
    sync::{Mutex, RwLock, RwLockReadGuard},
    task::JoinHandle,
};
use zeroize::Zeroizing;

#[cfg(any(target_os = "macos", windows))]
mod capture;
#[cfg(any(target_os = "macos", windows))]
mod collect;
mod control_advertisement;
mod device_data;
#[cfg(any(target_os = "macos", windows))]
mod device_signin;
pub mod handoff;
mod history;
mod workspaces;

struct Session {
    id: String,
    scope: VaultScope,
    _database_lock: std::fs::File,
    cached_workspace: WorkspaceView,
    cached_pending: Vec<String>,
    workspace_projection: workspaces::WorkspaceProjection,
    device_id: String,
    api: SyncApi,
    handle: WorkerHandle,
    task: JoinHandle<misty_browser_sync::Result<()>>,
    notifications: JoinHandle<()>,
    credential_task: Option<JoinHandle<()>>,
    /// Browsing history sync (`history`).
    history_task: Option<JoinHandle<()>>,
    /// Authored diagnostics only; never platform errors or website data.
    credential_issue: Option<Cow<'static, str>>,
    /// Per device (workspace): what its website data synced and skipped.
    website_data: std::collections::BTreeMap<String, device_data::DeviceWebsiteData>,
    /// The native store holding the sign-in data of the device this session writes.
    device_browser: Option<device_data::DeviceBrowser>,
    /// Per device: its sign-in data as last published or restored here.
    baselines: std::collections::HashMap<String, device_data::Baseline>,
    /// Local data that could not sync; restores must not roll it back.
    held: super::browser_data_budget::Held,
    #[cfg(any(target_os = "macos", windows))]
    capture_view: Option<capture::CaptureView>,
    /// While the vault is open this device can admit and remove devices
    /// (docs/design/devices/BRIEF.md). Dropped, and zeroized, on lock.
    admission_root: VaultRoot,
}

static SESSION: OnceLock<Mutex<Option<Session>>> = OnceLock::new();
fn session() -> &'static Mutex<Option<Session>> {
    SESSION.get_or_init(|| Mutex::new(None))
}

/// The open vault's root, scope and this device's sync identity, for signing
/// device grants and lists. None while the vault is locked.
pub(crate) async fn device_admission_authority(
    account: &str,
) -> Option<(VaultRoot, VaultScope, String)> {
    session()
        .lock()
        .await
        .as_ref()
        .filter(|s| s.scope.account_id == account)
        .map(|s| {
            (
                s.admission_root.duplicate(),
                s.scope.clone(),
                s.device_id.clone(),
            )
        })
}

/// Opens the vault with a root sealed to this device by one already added
/// (approval from another device). The root was checked against the vault's
/// root public key before this is called.
pub(crate) async fn open_with_transferred_root(
    app: tauri::AppHandle,
    api_base: String,
    account_id: String,
    root: VaultRoot,
    remember: bool,
) -> Result<SyncView, String> {
    open_vault_with(
        app,
        api_base,
        account_id,
        None,
        None,
        Some(root),
        remember,
        false,
        false,
    )
    .await
}

/// Native extension settings share the encrypted account transport, independent
/// of whether this device shares its tabs or website sign-ins.
pub(crate) async fn extension_sync_handle(account: &str) -> Option<WorkerHandle> {
    session().lock().await.as_ref().filter(|s| s.scope.account_id == account).map(|s| s.handle.clone())
}

// A browser creation/import owns a read/write lease independently of worker
// commands. Account changes take the write side before SESSION, so callbacks
// cannot create a view after shutdown selected a different account.
static BROWSER_LIFECYCLE: OnceLock<RwLock<()>> = OnceLock::new();
static BROWSER_ACCOUNT_EPOCH: AtomicU64 = AtomicU64::new(0);
pub(super) fn browser_lifecycle() -> &'static RwLock<()> {
    BROWSER_LIFECYCLE.get_or_init(|| RwLock::new(()))
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct SelectedProfile {
    logical: String,
    physical: String,
}
// Non-secret native engine identity survives locking the vault, so opening a
// tab while locked cannot silently fall back to the unrelated legacy store.
// Account replacement clears it only after closing the previous browser views.
static SELECTED_PROFILE: OnceLock<std::sync::Mutex<Option<SelectedProfile>>> = OnceLock::new();
fn selected_profile() -> &'static std::sync::Mutex<Option<SelectedProfile>> {
    SELECTED_PROFILE.get_or_init(|| std::sync::Mutex::new(None))
}

fn select_bound_profile(
    logical: &str,
    binding: &BrowserProfileBinding,
    previous: Option<&SelectedProfile>,
) -> Result<Option<SelectedProfile>, String> {
    if binding.staged.is_some() && binding.active.is_none() {
        return Err(
            "Browser sign-in state is being restored. Wait before opening this page.".into(),
        );
    }
    if let Some(active) = &binding.active {
        if previous.is_some_and(|previous| {
            previous.logical != logical || previous.physical != active.physical_id
        }) {
            return Err("The browser profile changed. Its existing views must close before switching stores.".into());
        }
        return Ok(Some(SelectedProfile {
            logical: logical.into(),
            physical: active.physical_id.clone(),
        }));
    }
    if previous.is_some() || binding.revision != 0 {
        return Err("The browser profile needs recovery. Existing data has been preserved.".into());
    }
    // An unregistered legacy profile has not been migrated yet. Merely unlocking
    // sync must not select a new empty engine store and lose the user's sign-ins.
    Ok(None)
}

pub(super) struct BrowserProfileLease {
    _lifecycle: RwLockReadGuard<'static, ()>,
    pub profile_id: Option<String>,
    pub logical_profile_id: Option<String>,
    pub tab_session: Option<serde_json::Value>,
}

/// Resolve logical/default workspace requests through the encrypted native
/// registry. No renderer may choose a physical generation for this resolution.
/// Keep the returned lease until native view creation/reuse has completed.
pub(super) async fn browser_profile_lease(
    app: Option<&tauri::AppHandle>,
    requested: Option<&str>,
    tab: Option<(&str, &str)>,
) -> Result<BrowserProfileLease, String> {
    let epoch = BROWSER_ACCOUNT_EPOCH.load(Ordering::Acquire);
    let lifecycle = browser_lifecycle().read().await;
    if BROWSER_ACCOUNT_EPOCH.load(Ordering::Acquire) != epoch {
        return Err("The browser account changed before this page could open.".into());
    }
    let mut current = session().lock().await;
    let previous_issue = current
        .as_ref()
        .and_then(|active| active.credential_issue.clone());
    let previous = selected_profile()
        .lock()
        .map_err(|_| "Browser profile state is unavailable")?
        .clone();
    let mut selected = previous.clone();
    if let Some(active) = current.as_mut() {
        let logical = default_profile_id(&active.scope)?;
        if requested.is_none() || requested == Some(logical.as_str()) {
            selected = if workspaces::workspace_mode(&active.handle.workspaces.borrow()) {
                resolve_device_profile(active, &logical, previous.as_ref()).await?
            } else {
                resolve_local_profile(active, &logical, previous.as_ref()).await?
            };
            // The authenticated binding selects local storage, not sync readiness.
            // Live cookies/storage can legitimately differ from an import receipt.
            // Background capture reports those failures through credential_issue;
            // only incoming restores need native read-back before activation.
            *selected_profile()
                .lock()
                .map_err(|_| "Browser profile state is unavailable")? = selected.clone();
            if selected.is_none() && requested.is_some() {
                return Err("The browser profile has not been migrated yet.".into());
            }
        }
    }
    let (profile_id, logical_profile_id) = match selected {
        Some(selected) if requested.is_none() || requested == Some(selected.logical.as_str()) => {
            (Some(selected.physical), Some(selected.logical))
        }
        _ => (requested.map(str::to_owned), None),
    };
    let mut tab_session = None;
    if let (Some(active), Some((view_id, url)), Some(logical)) = (
        current.as_mut().filter(|active| full_sync_enabled(active)),
        tab,
        logical_profile_id.as_ref(),
    ) {
        if let Ok(url) = url::Url::parse(url) {
            let area = document::credentials::Area::SessionStorage {
                origin: url.origin().ascii_serialization(),
                view_id: view_id.into(),
            };
            tab_session = local_tab_session(active, logical, &area).await;
        }
    }
    if let (Some(app), Some(active)) = (app, current.as_ref()) {
        if active.credential_issue != previous_issue {
            let _ = app.emit_to("main", "misty:browser-sync-changed", &active.scope.vault_id);
        }
    }
    Ok(BrowserProfileLease {
        tab_session,
        _lifecycle: lifecycle,
        profile_id,
        logical_profile_id,
    })
}

// A stopped transport may no longer answer worker commands. Reuse only the
// already selected identity for this account; never guess a different store.
async fn resolve_local_profile(
    active: &mut Session,
    logical: &str,
    previous: Option<&SelectedProfile>,
) -> Result<Option<SelectedProfile>, String> {
    match active.handle.browser_profile_binding(logical.into()).await {
        Ok(binding) => select_bound_profile(logical, &binding, previous),
        Err(error) => {
            if let Some(previous) = previous.filter(|previous| previous.logical == logical) {
                active.credential_issue = Some(
                    "Website sign-in sync is unavailable. You can keep browsing with this device's existing data.".into(),
                );
                Ok(Some(previous.clone()))
            } else {
                Err(issue(error))
            }
        }
    }
}

/// Workspaces: pages open in the store of the device this session drives.
/// Stores never switch under open pages; the capture loop closes them first.
async fn resolve_device_profile(
    active: &mut Session,
    logical: &str,
    previous: Option<&SelectedProfile>,
) -> Result<Option<SelectedProfile>, String> {
    match device_data::device_store(active, logical).await {
        Ok(selected) => {
            if previous.is_some_and(|previous| *previous != selected) {
                return Err("The browser profile changed. Its existing views must close before switching stores.".into());
            }
            Ok(Some(selected))
        }
        // A stopped worker cannot answer; keep using the store already open.
        Err(error) => match previous.filter(|previous| previous.logical == logical) {
            Some(previous)
                if active.handle.status.borrow().phase == Phase::Attention
                    || active.handle.status.borrow().phase == Phase::Stopped =>
            {
                active.credential_issue = Some(
                    "Website sign-in sync is unavailable. You can keep browsing with this device's existing data.".into(),
                );
                Ok(Some(previous.clone()))
            }
            _ => Err(error),
        },
    }
}

async fn local_tab_session(
    active: &mut Session,
    logical: &str,
    area: &document::credentials::Area,
) -> Option<serde_json::Value> {
    if workspaces::workspace_mode(&active.handle.workspaces.borrow()) {
        return device_data::tab_session(active, area);
    }
    let result = async {
        let document: Document =
            serde_json::from_slice(&active.handle.snapshot().await.map_err(issue)?)
                .map_err(|_| "Could not read tab session".to_string())?;
        Ok::<_, String>(
            document
                .credentials
                .get(&area.key(logical).map_err(issue)?)
                .map(|record| record.payload.clone()),
        )
    }
    .await;
    match result {
        Ok(value) => value,
        Err(_) => {
            // Session restoration is optional; a failed sync read must not
            // prevent a new local browsing session or clear persistent storage.
            active.credential_issue = Some(
                "Synced tab sessions could not be restored. You can keep browsing with this device's existing data.".into(),
            );
            None
        }
    }
}

/// WebKit requests popup creation synchronously on its UI thread. Never block
/// that thread behind account shutdown; decline and let the user retry.
#[cfg(target_os = "macos")]
pub(super) fn popup_lifecycle_lease() -> Option<RwLockReadGuard<'static, ()>> {
    browser_lifecycle().try_read().ok()
}

fn require_main(webview: &tauri::Webview) -> Result<(), String> {
    if webview.label() != "main" {
        return Err("Browser sync is available only in the main workspace".into());
    }
    Ok(())
}

// Avoid propagating SQLite paths, input values, or payload decoding details to UI.
fn issue(error: misty_browser_sync::Error) -> String {
    use misty_browser_sync::Error;
    match error {
        Error::InactiveDevice => {
            "This device is following sync. Make it active to publish changes."
        }
        Error::Unlock => "Could not unlock sync. Check the password and sync secret.",
        Error::Identity => "Sync identity did not match. Local data has been preserved.",
        Error::Authentication => "Sign in again to reconnect sync.",
        Error::DeviceForbidden => "This device does not have permission to sync this account. Check its sync access, then retry.",
        Error::Network => "Could not reach the sync server.",
        Error::SecureStorage => "The operating system could not store the sync key.",
        Error::Recovery => "Sync needs a recovery step. Local data has been preserved.",
        Error::Sequence => "Sync ordering could not be verified. Local data has been preserved.",
        Error::TooLarge => "This change exceeds the sync size limit.",
        Error::Storage(_) => "Local sync storage is unavailable.",
        Error::Invalid | Error::Encoding(_) => "The workspace change is invalid.",
    }
    .into()
}

async fn stop(active: Option<Session>) {
    if let Some(mut active) = active {
        if let Some(task) = active.credential_task.take() {
            task.abort();
            let _ = task.await;
        }
        if let Some(task) = active.history_task.take() {
            task.abort();
            let _ = task.await;
        }
        #[cfg(any(target_os = "macos", windows))]
        {
            active.capture_view = None;
        }
        active.handle.stop();
        // Notifications cannot race a replacement account's view.
        active.notifications.abort();
        let _ = active.notifications.await;
        let _ = active.task.await;
    }
}

/// Account-cookie selection calls this before swapping jars. Returning means the
/// previous socket and its decrypted vault/signing keys have been dropped.
pub(super) async fn change_account<T>(
    app: Option<&tauri::AppHandle>,
    action: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    change_account_if(app, |_| true, action).await
}

/// Forgetting an inactive saved account must not stop the current workspace.
/// Evaluate the condition after acquiring the same account-change barrier.
pub(super) async fn change_account_if<T>(
    app: Option<&tauri::AppHandle>,
    changes_active: impl FnOnce(Option<&VaultScope>) -> bool,
    action: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let _lifecycle = browser_lifecycle().write().await;
    let mut current = session().lock().await;
    if !changes_active(current.as_ref().map(|active| &active.scope)) {
        return action();
    }
    BROWSER_ACCOUNT_EPOCH.fetch_add(1, Ordering::AcqRel);
    super::extensions::close_account().await;
    super::workspace_recovery::close_account()?;
    stop(current.take()).await;
    #[cfg(desktop)]
    if let Some(app) = app {
        super::agent_workspace::stop_account_tasks(app)?;
        super::browser::close_account_views(app)?;
    }
    #[cfg(not(desktop))]
    let _ = app;
    *selected_profile()
        .lock()
        .map_err(|_| "Browser profile state is unavailable")? = None;
    // Keep the registry lock through jar replacement. Otherwise a concurrent
    // unlock can capture the old account between shutdown and activation.
    action()
}

fn database_path(
    app: &tauri::AppHandle,
    deployment: &str,
    account_id: &str,
) -> Result<PathBuf, String> {
    let hash = Sha256::digest(
        serde_json::to_vec(&(deployment, account_id))
            .map_err(|_| "Could not identify sync storage")?,
    );
    let identity: String = hash.iter().map(|byte| format!("{byte:02x}")).collect();
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Local application storage is unavailable")?
        .join("browser-sync");
    let directory = base.join(identity);
    let path = directory.join("workspace.sqlite");
    if path.is_file() {
        return Ok(path);
    }
    // Reuse earlier workspace-scoped databases in place. Moving/copying a live
    // WAL or reenrolling would risk losing pending edits or cloning counters.
    let mut previous = None;
    if base.is_dir() {
        let entries = std::fs::read_dir(&base).map_err(|_| "Could not inspect sync storage")?;
        for (index, entry) in entries.enumerate() {
            if index >= 1024 {
                return Err("Too many local vaults to select safely".into());
            }
            let entry = entry.map_err(|_| "Could not inspect sync storage")?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                continue;
            };
            if name.len() != 64 || !name.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                continue;
            }
            let candidate = entry.path().join("workspace.sqlite");
            if Store::belongs_to_account(&candidate, deployment, account_id).map_err(issue)? {
                if previous.is_some() {
                    return Err(
                        "Multiple older vaults need recovery before sync can select one.".into(),
                    );
                }
                previous = Some(candidate);
            }
        }
    }
    if let Some(path) = previous {
        return Ok(path);
    }
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder
        .create(&directory)
        .map_err(|_| "Could not create sync storage")?;
    Ok(directory.join("workspace.sqlite"))
}

pub(super) fn lock_database(path: &std::path::Path) -> Result<std::fs::File, String> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options
        .open(path.with_extension("lock"))
        .map_err(|_| "Could not lock sync storage")?;
    file.try_lock()
        .map_err(|_| "Another Misty process owns this device's sync storage")?;
    Ok(file)
}

/// What the renderer sees of sync. Records inside are rewritten to renderer
/// names (see `document::renderer`) when this is serialized.
pub struct SyncView(SyncViewData);

impl Serialize for SyncView {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut value = serde_json::to_value(&self.0).map_err(serde::ser::Error::custom)?;
        misty_browser_sync::document::renderer::to_renderer(&mut value);
        value.serialize(serializer)
    }
}

#[derive(Serialize)]
struct SyncViewData {
    session_id: String,
    deployment: String,
    account_id: String,
    vault_id: String,
    device_id: String,
    profile_id: String,
    supports_cookie_handoff: bool,
    browser_profile_ready: bool,
    browser_profile_issue: Option<Cow<'static, str>>,
    website_data: Vec<device_data::DeviceWebsiteData>,
    status: Status,
    presence: Vec<Presence>,
    devices: Vec<misty_browser_sync::protocol::Device>,
    full_sync: bool,
    traffic: misty_browser_sync::transport::TrafficSnapshot,
    workspace: WorkspaceView,
    pending_operation_ids: Vec<String>,
    /// Workspaces (roster, lease, pending). `None` before workspace mode.
    sync: Option<misty_browser_sync::workspace::sync::SyncState>,
}

async fn view(active: &mut Session) -> Result<SyncView, String> {
    match active.handle.pending_snapshot().await {
        Ok(pending) => {
            let document: Document = serde_json::from_slice(&pending.snapshot)
                .map_err(|_| "Could not read the local workspace")?;
            let mut workspace = document.workspace_view().map_err(issue)?;
            let committed: Document =
                serde_json::from_slice(&active.handle.snapshot().await.map_err(issue)?)
                    .map_err(|_| "Could not read the active device")?;
            workspace.active_device = committed.active_device;
            // Tentative reducer versions must never become a replay/import cursor.
            workspace.sequence = pending.committed_sequence;
            active.cached_workspace = workspace;
            active.cached_pending = pending.operation_ids;
        }
        Err(_)
            if matches!(
                active.handle.status.borrow().phase,
                misty_browser_sync::worker::Phase::Attention
                    | misty_browser_sync::worker::Phase::Stopped
            ) =>
        {
            // A stopped worker cannot service commands, but its actionable status
            // and last safe projection must remain visible to the user.
        }
        Err(error) => return Err(issue(error)),
    }
    // Workspace mode: project the driven workspace plus the shared workspace instead of the
    // legacy shared workspace, which now only carries credentials.
    let sync_state = active.handle.workspaces.borrow().clone();
    let workspace_mode = workspaces::workspace_mode(&sync_state);
    if workspace_mode {
        active.cached_workspace = workspaces::synthesize(
            &mut active.workspace_projection,
            &active.device_id,
            &sync_state,
        );
        active.cached_pending = Vec::new();
    }
    // A local website-storage failure does not stop workspace transport.
    let status = active.handle.status.borrow().clone();
    let profile = default_profile_id(&active.scope)?;
    let driving = workspace_mode
        .then(|| active.handle.workspaces.borrow().on_workspace.clone())
        .flatten();
    let browser_profile_ready = active.credential_issue.is_none()
        && if workspace_mode {
            active
                .device_browser
                .as_ref()
                .is_some_and(|browser| Some(&browser.workspace) == driving.as_ref())
        } else {
            match active.handle.browser_profile_binding(profile.clone()).await {
                Ok(binding) => match active.handle.browser_import_journal(profile).await {
                    Ok(journal) => {
                        binding.active.is_some()
                            && binding.staged.is_none()
                            && journal.pending.is_none()
                            && !journal.quarantined
                    }
                    Err(_) => false,
                },
                Err(_) => false,
            }
        };
    Ok(SyncView(SyncViewData {
        browser_profile_ready,
        browser_profile_issue: active.credential_issue.clone(),
        website_data: active.website_data.values().cloned().collect(),
        session_id: active.id.clone(),
        deployment: active.scope.deployment.clone(),
        account_id: active.scope.account_id.clone(),
        vault_id: active.scope.vault_id.clone(),
        device_id: active.device_id.clone(),
        profile_id: default_profile_id(&active.scope)?,
        supports_cookie_handoff: handoff::supported(),
        status,
        presence: active.handle.presence.borrow().clone(),
        devices: active.handle.devices.borrow().clone(),
        full_sync: full_sync_enabled(active),
        traffic: active.handle.traffic.snapshot(),
        workspace: active.cached_workspace.clone(),
        pending_operation_ids: active.cached_pending.clone(),
        sync: workspace_mode.then_some(sync_state),
    }))
}

fn default_profile_id(scope: &VaultScope) -> Result<String, String> {
    let bytes = serde_json::to_vec(&(
        "misty.default-browser-profile.v1",
        &scope.deployment,
        &scope.account_id,
        &scope.vault_id,
    ))
    .map_err(|_| "Invalid sync scope")?;
    Ok(Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn require_session(active: &Session, expected: &str) -> Result<(), String> {
    if active.id != expected {
        return Err("The sync session changed. Refresh the workspace before editing.".into());
    }
    Ok(())
}

#[derive(Serialize)]
pub struct VaultAvailability {
    local: bool,
    remote: Option<bool>,
}

/// Local metadata can be inspected without fetching or decrypting credentials.
#[tauri::command]
pub async fn browser_sync_availability(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    api_base: String,
    account_id: String,
) -> Result<VaultAvailability, String> {
    require_main(&webview)?;
    let current = session().lock().await;
    let api = account_api(&api_base, &account_id)?;
    if current.as_ref().is_some_and(|active| {
        active.scope.deployment == api.deployment() && active.scope.account_id == account_id
    }) {
        return Ok(VaultAvailability {
            local: true,
            remote: None,
        });
    }
    let path = database_path(&app, &api.deployment(), &account_id)?;
    let _lock = lock_database(&path)?;
    if Store::read_cached_vault(&path, &api.deployment(), &account_id)
        .map_err(issue)?
        .is_some()
    {
        return Ok(VaultAvailability {
            local: true,
            remote: None,
        });
    }
    Ok(VaultAvailability {
        local: false,
        remote: Some(api.vault().await.map_err(issue)?.is_some()),
    })
}

#[tauri::command]
pub fn browser_sync_generate_secret(webview: tauri::Webview) -> Result<String, String> {
    require_main(&webview)?;
    // This secret is shown to the user before setup, so a lost setup response
    // cannot leave them with a vault whose second unlock secret they never saw.
    Ok(generate_sync_secret().to_string())
}

pub(super) fn account_api(api_base: &str, account_id: &str) -> Result<SyncApi, String> {
    let url = super::auth_cookies::server(api_base)?;
    let client = super::auth_cookies::current(&url)?;
    client.require_account(&url, account_id)?;
    let refresh_client = client.clone();
    let refresh_url = url.clone();
    let refresh_lock = client.refresh_lock.clone();
    SyncApi::new(api_base, client.http.clone())
        .map(|api| {
            api.with_refresh_lock(refresh_lock)
                .with_refresh_hook(move || {
                    refresh_client
                        .persist(&refresh_url)
                        .map(|_| ())
                        .map_err(|_| misty_browser_sync::Error::SecureStorage)
                })
        })
        .map_err(issue)
}

#[tauri::command]
pub async fn browser_sync_setup(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    api_base: String,
    account_id: String,
    password: String,
    sync_secret: String,
    remember: bool,
) -> Result<SyncView, String> {
    let password = Zeroizing::new(password);
    let secret = Zeroizing::new(sync_secret);
    require_main(&webview)?;
    open_vault(
        app,
        api_base,
        account_id,
        Some(password),
        Some(secret),
        remember,
        true,
        false,
    )
    .await
}

#[tauri::command]
pub async fn browser_sync_connect(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    api_base: String,
    account_id: String,
    password: Option<String>,
    sync_secret: Option<String>,
    remember: bool,
    reenroll: Option<bool>,
) -> Result<SyncView, String> {
    let password = password.map(Zeroizing::new);
    let secret = sync_secret.map(Zeroizing::new);
    require_main(&webview)?;
    open_vault(
        app,
        api_base,
        account_id,
        password,
        secret,
        remember,
        false,
        reenroll.unwrap_or(false),
    )
    .await
}

/// Keep a rejected device's database beside the new one instead of deleting
/// it: its outbox is signed by the revoked identity and cannot be replayed, but
/// it may still hold edits worth recovering by hand.
fn retire_database(path: &std::path::Path) -> misty_browser_sync::Result<()> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or_default();
    let retired = path.with_file_name(format!("workspace.retired-{stamp}.sqlite"));
    let storage = || misty_browser_sync::Error::Storage(rusqlite::Error::InvalidPath(path.into()));
    for suffix in ["", "-wal", "-shm"] {
        let from = std::path::PathBuf::from(format!("{}{suffix}", path.display()));
        if from.exists() {
            let to = format!("{}{suffix}", retired.display());
            std::fs::rename(&from, to).map_err(|_| storage())?;
        }
    }
    Ok(())
}

async fn open_vault(
    app: tauri::AppHandle,
    api_base: String,
    account_id: String,
    password: Option<Zeroizing<String>>,
    secret: Option<Zeroizing<String>>,
    remember: bool,
    create: bool,
    reenroll: bool,
) -> Result<SyncView, String> {
    open_vault_with(
        app, api_base, account_id, password, secret, None, remember, create, reenroll,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn open_vault_with(
    app: tauri::AppHandle,
    api_base: String,
    account_id: String,
    password: Option<Zeroizing<String>>,
    secret: Option<Zeroizing<String>>,
    provided_root: Option<VaultRoot>,
    remember: bool,
    create: bool,
    reenroll: bool,
) -> Result<SyncView, String> {
    // Re-enrolling registers a new device identity, so it must be authorized by
    // the vault password and sync secret, never by a remembered key alone.
    let reenroll = reenroll && !create;
    if reenroll && (password.is_none() || secret.is_none()) {
        return Err("Enter your sync password and secret to reconnect this device.".into());
    }
    let _lifecycle = browser_lifecycle().write().await;
    let mut current = session().lock().await;
    let api = account_api(&api_base, &account_id)?;
    // Background retries can overlap a manual unlock. Reuse the worker that
    // won that race instead of stopping it and reading the key a second time.
    if !create
        && password.is_none()
        && secret.is_none()
        && provided_root.is_none()
        && current.as_ref().is_some_and(|active| {
            active.scope.deployment == api.deployment()
                && active.scope.account_id == account_id
                && !active.task.is_finished()
        })
    {
        return view(current.as_mut().expect("live session exists")).await;
    }
    stop(current.take()).await;
    let path = database_path(&app, &api.deployment(), &account_id)?;
    let database_lock = lock_database(&path)?;
    let previous = Store::read_cached_vault(&path, &api.deployment(), &account_id);
    // A re-enrolling device ignores its rejected local identity and joins the
    // server's current vault as if it were new.
    let (cached, retired_scope) = if reenroll {
        let retired = previous.ok().flatten().map(|vault| VaultScope {
            deployment: api.deployment(),
            account_id: account_id.clone(),
            vault_id: vault.vault.vault_id,
        });
        (None, retired)
    } else {
        (previous.map_err(issue)?, None)
    };

    // Retrying setup after a lost response reopens the persisted root using the
    // same credentials. It must never generate a replacement root or device.
    let create = create && cached.is_none();
    // Cached vaults can unlock without a network request. Authorization and remote
    // identity are checked when the reconnecting worker obtains a fresh ticket.
    let remote = if cached.is_none() {
        api.vault().await.map_err(issue)?
    } else {
        None
    };
    if create && remote.is_some() {
        return Err("This account already has browser sync. Unlock the existing vault.".into());
    }
    if !create && cached.is_none() && remote.is_none() {
        return Err("Set up browser sync before connecting this device.".into());
    }
    let scope = VaultScope {
        deployment: api.deployment(),
        account_id,
        vault_id: cached
            .as_ref()
            .map(|v| &v.vault)
            .or(remote.as_ref())
            .map(|w| w.vault_id.clone())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
    };
    scope.validate().map_err(issue)?;
    let logical = default_profile_id(&scope)?;
    if selected_profile()
        .lock()
        .map_err(|_| "Browser profile state is unavailable")?
        .as_ref()
        .is_some_and(|selected| selected.logical != logical)
    {
        return Err("Switch the active browser account before opening a different vault.".into());
    }
    let existing_identity = !reenroll
        && Store::belongs_to_account(&path, &scope.deployment, &scope.account_id).map_err(issue)?;
    if create && existing_identity {
        return Err("The server vault is missing, but local encrypted data still exists. Recovery is required.".into());
    }
    let native_scope = scope.clone();
    let (root, store, device, database_lock) = tokio::task::spawn_blocking(move || {
        let database_lock = database_lock;
        let (root, vault) = if create {
            let password = password.ok_or(misty_browser_sync::Error::Invalid)?;
            let secret = secret.ok_or(misty_browser_sync::Error::Invalid)?;
            let root = VaultRoot::generate();
            let wrapper = root.wrap(&native_scope, &password, &secret)?;
            let server = Vault {
                vault_id: native_scope.vault_id.clone(),
                key_epoch: 1,
                head_sequence: 0,
                root_public_key: root.public_key()?,
                key_envelope: wrapper,
            };
            (
                root,
                CachedVault {
                    vault: server,
                    bootstrap_pending: true,
                    enrollment_pending: true,
                },
            )
        } else {
            let vault = match cached.clone() {
                Some(vault) => vault,
                None => CachedVault {
                    vault: remote.ok_or(misty_browser_sync::Error::Recovery)?,
                    bootstrap_pending: false,
                    enrollment_pending: true,
                },
            };
            let server = &vault.vault;
            let root = match (password, secret, provided_root) {
                (Some(password), Some(secret), None) => VaultRoot::unlock(
                    &native_scope,
                    &server.key_envelope,
                    &password,
                    &secret,
                    &server.root_public_key,
                )?,
                // Sealed to this device by an approving one; it must match the
                // vault the server names before anything is opened with it.
                (None, None, Some(root)) => {
                    if root.public_key()? != server.root_public_key {
                        return Err(misty_browser_sync::Error::Identity);
                    }
                    root
                }
                (None, None, None) => secure_store::recall(&native_scope, &server.root_public_key)?
                    .ok_or(misty_browser_sync::Error::Unlock)?,
                _ => return Err(misty_browser_sync::Error::Invalid),
            };
            // Only retire the old identity once the password has proven access
            // to the server's vault; a typo must leave this device untouched.
            if reenroll {
                if let Some(retired) = &retired_scope {
                    secure_store::forget(retired)?;
                }
                retire_database(&path)?;
            }
            (root, vault)
        };
        let (store, device) = if existing_identity {
            let (mut store, device) = Store::unlock(&path, native_scope.clone(), &root)?;
            store.cache_verified_vault(&root, &vault)?;
            (store, device)
        } else {
            let device = DeviceKey::generate();
            let grant = root.grant(
                &native_scope,
                &uuid::Uuid::new_v4().to_string(),
                vault.vault.key_epoch,
                &device,
            )?;
            let store = Store::initialize_vault(
                &path,
                native_scope.clone(),
                grant,
                &root,
                &device,
                &Document::default().encode()?,
                Some(&vault),
            )?;
            (store, device)
        };
        store.pending_snapshot(&root, document::reduce)?;
        if remember {
            secure_store::remember(&native_scope, &root)?;
        }
        Ok::<_, misty_browser_sync::Error>((root, store, device, database_lock))
    })
    .await
    .map_err(|_| "Could not unlock the native sync vault")?
    .map_err(issue)?;
    let pending = store
        .pending_snapshot(&root, document::reduce)
        .map_err(issue)?;
    let document: Document = serde_json::from_slice(&pending.snapshot)
        .map_err(|_| "Could not read the local workspace")?;
    let mut cached_workspace = document.workspace_view().map_err(issue)?;
    let committed: Document =
        serde_json::from_slice(&store.committed_snapshot(&root).map_err(issue)?)
            .map_err(|_| "Could not read the active device")?;
    cached_workspace.active_device = committed.active_device;
    cached_workspace.sequence = pending.committed_sequence;
    let device_id = store.grant().device_id.clone();
    let admission_root = root.duplicate();
    let (worker, handle) = Worker::new(
        api.clone(),
        scope.clone(),
        root,
        device,
        store,
        document::reduce,
    )
    .map_err(issue)?;
    let advertise_api = api.clone();
    let advertise_device = device_id.clone();
    let advertise_os = tokio::task::spawn_blocking(os_version)
        .await
        .unwrap_or_default();
    let advertise_status = handle.status.clone();
    let task = tokio::spawn(worker.run());
    let mut status = handle.status.clone();
    let mut presence = handle.presence.clone();
    let mut devices = handle.devices.clone();
    let mut workspace_changes = handle.workspaces.clone();
    let notify_workspace = scope.vault_id.clone();
    let notify_app = app.clone();
    // The sync socket already carries this account's content-free invalidations.
    // The main window uses them instead of opening its own event stream while
    // this connection is up (see `browser_sync_account_feed`).
    let mut account_events = handle.account_events();
    let feed_account = scope.account_id.clone();
    let notifications = tokio::spawn(async move {
        let advertisement = control_advertisement::advertise(
            advertise_status,
            || advertise_api.advertise_controls(&advertise_device, &advertise_os),
            std::time::Duration::from_secs(30),
        );
        tokio::pin!(advertisement);
        let mut advertised = false;
        loop {
            let alive = tokio::select! {
                _ = &mut advertisement, if !advertised => { advertised = true; continue; },
                result = status.changed() => result.is_ok(),
                result = presence.changed() => result.is_ok(),
                result = devices.changed() => result.is_ok(),
                result = workspace_changes.changed() => result.is_ok(),
                event = account_events.recv() => {
                    let (topic, id) = match event {
                        Ok(event) => (event.topic, event.id),
                        // Dropped invalidations: the page re-reads everything.
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => ("reset".to_owned(), None),
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    };
                    let _ = notify_app.emit_to(
                        "main",
                        "misty:account-event",
                        serde_json::json!({ "accountId": feed_account, "topic": topic, "id": id }),
                    );
                    continue;
                },
            };
            if !alive {
                break;
            }
            let _ = notify_app.emit_to("main", "misty:browser-sync-changed", &notify_workspace);
        }
    });
    let session_id = uuid::Uuid::new_v4().to_string();
    #[cfg(any(target_os = "macos", windows))]
    let credential_task = Some(capture::spawn(app.clone(), session_id.clone()));
    #[cfg(not(any(target_os = "macos", windows)))]
    let credential_task = None;
    let history_task = Some(history::spawn(app.clone(), session_id.clone()));
    *current = Some(Session {
        id: session_id,
        _database_lock: database_lock,
        cached_workspace,
        cached_pending: pending.operation_ids,
        workspace_projection: Default::default(),
        scope,
        device_id,
        api,
        handle,
        task,
        notifications,
        credential_task,
        history_task,
        credential_issue: None,
        website_data: Default::default(),
        device_browser: None,
        baselines: Default::default(),
        held: Default::default(),
        #[cfg(any(target_os = "macos", windows))]
        capture_view: None,
        admission_root,
    });
    let _ = app.emit_to("main", "misty:browser-sync-changed", "");
    view(current.as_mut().expect("session was installed")).await
}

/// Whether the sync socket currently delivers this account's invalidations to
/// the main window. The page re-asks on `misty:browser-sync-changed`.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountFeed {
    account_id: String,
    connected: bool,
}

#[tauri::command]
pub async fn browser_sync_account_feed(
    webview: tauri::Webview,
) -> Result<Option<AccountFeed>, String> {
    require_main(&webview)?;
    let current = session().lock().await;
    Ok(current.as_ref().map(|active| AccountFeed {
        account_id: active.scope.account_id.clone(),
        // A live socket is insufficient if its renderer event forwarder has
        // exited. Let consumers fall back to the authenticated event stream.
        connected: !active.notifications.is_finished() && matches!(
            active.handle.status.borrow().phase,
            misty_browser_sync::worker::Phase::CatchingUp
                | misty_browser_sync::worker::Phase::Ready
        ),
    }))
}

#[tauri::command]
pub async fn browser_sync_state(webview: tauri::Webview) -> Result<Option<SyncView>, String> {
    require_main(&webview)?;
    let mut current = session().lock().await;
    match current.as_mut() {
        Some(active) => view(active).await.map(Some),
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn browser_sync_edit(
    webview: tauri::Webview,
    session_id: String,
    operation_id: String,
    changes: Vec<serde_json::Value>,
    active_epoch: String,
) -> Result<String, String> {
    require_main(&webview)?;
    let changes = changes
        .into_iter()
        .map(|mut change| {
            misty_browser_sync::document::renderer::from_renderer(&mut change);
            serde_json::from_value::<Change>(change)
        })
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "The workspace change is invalid.")?;
    if changes.iter().any(|change| {
        let (Change::Create { kind, .. } | Change::Patch { kind, .. } | Change::Delete { kind, .. }) = change;
        matches!(kind, document::entities::Kind::ExtensionSyncKey | document::entities::Kind::ExtensionRemoval)
    }) {
        return Err("Extension storage is managed by the native extension runtime.".into());
    }
    if let Some(result) = workspace_edit(
        &session_id,
        &active_epoch,
        WorkspaceEdit::Changes(changes.clone()),
    )
    .await
    {
        return result.map(|()| operation_id);
    }
    enqueue(
        &session_id,
        operation_id,
        Payload::Workspace {
            version: 1,
            changes,
        }
        .published(active_epoch),
    )
    .await
}

enum WorkspaceEdit {
    Changes(Vec<Change>),
}

/// Routes a renderer edit to the workspace this machine is on. `None` means the
/// workspace is not in workspace mode yet and the legacy path applies. An edit
/// captured on a workspace this machine has since left is refused, never applied
/// to a different workspace.
async fn workspace_edit(
    session_id: &str,
    epoch: &str,
    edit: WorkspaceEdit,
) -> Option<Result<(), String>> {
    let current = session().lock().await;
    let active = match current.as_ref() {
        Some(active) => active,
        None => return Some(Err("Unlock browser sync first.".into())),
    };
    let view = active.handle.workspaces.borrow().clone();
    if !workspaces::workspace_mode(&view) {
        return None;
    }
    let result = async {
        require_session(active, session_id)?;
        if !full_sync_enabled(active) {
            return Err("Full sync is off for this device.".to_string());
        }
        if workspaces::writer_epoch(&view) != Some(epoch) {
            return Err("This edit was made in another workspace.".to_string());
        }
        match edit {
            WorkspaceEdit::Changes(changes) => active.handle.workspace_changes(changes).await,
        }
        .map_err(issue)
    }
    .await;
    Some(result)
}

/// Opens `workspace_id` on this machine: its tabs, editable here while any other
/// machine keeps editing them too. Nobody is displaced; the device's sign-in
/// lease follows `workspaces::lease_to_claim`.
#[tauri::command]
pub async fn browser_sync_claim(
    webview: tauri::Webview,
    session_id: String,
    workspace_id: String,
) -> Result<(), String> {
    require_main(&webview)?;
    let handle = {
        let current = session().lock().await;
        let active = current.as_ref().ok_or("Connect device sync first.")?;
        require_session(active, &session_id)?;
        if !full_sync_enabled(active) {
            return Err("Enable Full sync before switching devices.".into());
        }
        let view = active.handle.workspaces.borrow().clone();
        if !view
            .workspaces
            .iter()
            .any(|t| t.workspace_id == workspace_id && !t.shared)
        {
            return Err("That device's workspace is not available.".into());
        }
        active.handle.clone()
    };
    handle.open_workspace(workspace_id).await.map_err(issue)
}

#[tauri::command]
pub async fn browser_sync_activate(
    webview: tauri::Webview,
    session_id: String,
) -> Result<String, String> {
    require_main(&webview)?;
    let current = session().lock().await;
    let session = current.as_ref().ok_or("Connect device sync first.")?;
    require_session(session, &session_id)?;
    if !full_sync_enabled(session) {
        return Err("Enable Full sync before switching to this device.".into());
    }
    // Workspace mode: back to this device's own tabs, and its own sign-in lease.
    if workspaces::workspace_mode(&session.handle.workspaces.borrow()) {
        let handle = session.handle.clone();
        let workspace = session.device_id.clone();
        drop(current);
        handle
            .open_workspace(workspace.clone())
            .await
            .map_err(issue)?;
        // Offline, the lease is claimed on reconnect by the capture pass.
        let _ = handle.claim_workspace(workspace).await;
        return Ok(uuid::Uuid::new_v4().to_string());
    }
    let status = session.handle.status.borrow().clone();
    if !matches!(status.phase, Phase::Ready | Phase::CatchingUp) {
        return Err("Waiting for a sync connection. Try waking Misty again in a moment.".into());
    }
    let document: Document =
        serde_json::from_slice(&session.handle.snapshot().await.map_err(issue)?)
            .map_err(|_| "Could not read the active device")?;
    let payload = Payload::ActiveDevice {
        version: 1,
        active: true,
        previous_epoch: document.active_device.map(|v| v.epoch),
    };
    let bytes =
        Zeroizing::new(serde_json::to_vec(&payload).map_err(|_| "Could not encode active device")?);
    session.handle.enqueue(bytes).await.map_err(issue)
}

/// Names a device on the account. Names are shown to the user only.
#[tauri::command]
pub async fn browser_sync_rename_device(
    webview: tauri::Webview,
    session_id: String,
    device_id: String,
    name: String,
) -> Result<(), String> {
    require_main(&webview)?;
    let name = name.trim().to_owned();
    if name.is_empty() || name.chars().count() > 60 || name.chars().any(char::is_control) {
        return Err("Use a name of 1 to 60 characters.".into());
    }
    let api = {
        let current = session().lock().await;
        let active = current.as_ref().ok_or("Connect device sync first.")?;
        require_session(active, &session_id)?;
        if !active
            .handle
            .devices
            .borrow()
            .iter()
            .any(|d| d.grant.device_id == device_id && d.revoked_at.is_none())
        {
            return Err("That device is not on this account.".into());
        }
        active.api.clone()
    };
    api.rename_device(&device_id, &name).await.map_err(issue)
}

/// Best-effort OS version for the device list; empty when unknown.
fn os_version() -> String {
    #[cfg(target_os = "macos")]
    {
        let mut buffer = [0u8; 64];
        let mut size = buffer.len();
        let name = b"kern.osproductversion\0";
        // SAFETY: the name is NUL-terminated and size bounds the buffer.
        let ok = unsafe {
            libc::sysctlbyname(
                name.as_ptr().cast(),
                buffer.as_mut_ptr().cast(),
                &mut size,
                std::ptr::null_mut(),
                0,
            )
        } == 0;
        if ok {
            let end = buffer[..size].iter().position(|b| *b == 0).unwrap_or(size);
            return String::from_utf8_lossy(&buffer[..end]).into_owned();
        }
        String::new()
    }
    #[cfg(target_os = "linux")]
    {
        std::fs::read_to_string("/etc/os-release")
            .ok()
            .and_then(|text| {
                text.lines()
                    .find_map(|line| line.strip_prefix("PRETTY_NAME="))
                    .map(|v| v.trim_matches('"').to_owned())
            })
            .unwrap_or_default()
    }
    #[cfg(windows)]
    {
        // `ver` prints "Microsoft Windows [Version 10.0.22631.4317]"; build
        // 22000 and later is Windows 11 despite the 10.0 kernel version.
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let output = std::process::Command::new("cmd")
            .args(["/C", "ver"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        let text = output
            .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
            .unwrap_or_default();
        let version = text
            .split("Version")
            .nth(1)
            .map(|rest| rest.trim_matches(|c: char| c == ' ' || c == ']' || c == '\r' || c == '\n'))
            .unwrap_or("");
        let build = version
            .split('.')
            .nth(2)
            .and_then(|b| b.parse::<u32>().ok());
        match build {
            Some(build) if build >= 22000 => format!("11 ({version})"),
            Some(_) => format!("10 ({version})"),
            None => String::new(),
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
    {
        String::new()
    }
}

/// Worker handle for page-state writes: slots belong to the workspace this
/// machine is on, and any machine on it may write them.
pub(crate) async fn page_state_worker() -> Result<WorkerHandle, String> {
    page_state_reader().await.map(|(handle, _)| handle)
}

/// Worker handle and the workspace this machine is on, for page-state reads.
pub(crate) async fn page_state_reader() -> Result<(WorkerHandle, String), String> {
    let current = session().lock().await;
    let active = current.as_ref().ok_or("Device sync is locked.")?;
    if !full_sync_enabled(active) {
        return Err("Full sync is off for this device.".into());
    }
    let workspace = active
        .handle
        .workspaces
        .borrow()
        .on_workspace
        .clone()
        .ok_or("This device is not using a workspace right now.")?;
    Ok((active.handle.clone(), workspace))
}

/// Which device captures website sign-ins. Legacy: the single active device.
/// Workspace mode: a device whose seat the server confirmed on this connection. A
/// seat remembered from before a disconnect may already belong to another
/// device, and two writers must never publish at once.
fn may_capture(document: &Document, active: &Session) -> bool {
    if document.workspace_mode {
        let workspaces = active.handle.workspaces.borrow();
        workspaces.seat_confirmed && workspaces.driving_workspace.is_some()
    } else {
        document.is_active(&active.device_id)
    }
}

fn full_sync_enabled(active: &Session) -> bool {
    active
        .handle
        .devices
        .borrow()
        .iter()
        .find(|d| d.grant.device_id == active.device_id)
        .is_some_and(|d| d.full_sync)
}

#[tauri::command]
pub async fn browser_sync_control_device(
    webview: tauri::Webview,
    session_id: String,
    device_id: String,
    full_sync: Option<bool>,
    activate: bool,
    workspace_id: Option<String>,
) -> Result<String, String> {
    require_main(&webview)?;
    if activate == full_sync.is_some() || (workspace_id.is_some() && !activate) {
        return Err("Choose one device action.".into());
    }
    let current = session().lock().await;
    let active = current.as_ref().ok_or("Connect device sync first.")?;
    require_session(active, &session_id)?;
    if !active
        .handle
        .devices
        .borrow()
        .iter()
        .any(|d| d.grant.device_id == device_id && d.revoked_at.is_none() && d.control_version >= 1)
    {
        return Err("Update Misty on this device before using device controls.".into());
    }
    active
        .api
        .control_device(&device_id, full_sync, activate, workspace_id.as_deref())
        .await
        .map_err(issue)
}

async fn enqueue(
    session_id: &str,
    operation_id: String,
    payload: Payload,
) -> Result<String, String> {
    payload.validate().map_err(issue)?;
    let current = session().lock().await;
    let active = current.as_ref().ok_or("Unlock browser sync first.")?;
    require_session(active, session_id)?;
    if !full_sync_enabled(active) {
        return Err("Full sync is off for this device.".into());
    }
    let bytes = Zeroizing::new(
        serde_json::to_vec(&payload).map_err(|_| "Could not encode workspace change")?,
    );
    active
        .handle
        .enqueue_identified(operation_id, bytes)
        .await
        .map_err(issue)
}

#[tauri::command]
pub async fn browser_sync_lock(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    session_id: String,
    forget: bool,
) -> Result<(), String> {
    require_main(&webview)?;
    let _lifecycle = browser_lifecycle().write().await;
    let mut current = session().lock().await;
    let scope = if let Some(active) = current.as_ref() {
        require_session(active, &session_id)?;
        Some(active.scope.clone())
    } else if forget {
        return Err("Unlock this vault before removing its remembered key.".into());
    } else {
        None
    };
    stop(current.take()).await;
    let _ = app.emit_to("main", "misty:browser-sync-changed", "");
    if forget {
        if let Some(scope) = scope {
            tokio::task::spawn_blocking(move || secure_store::forget(&scope))
                .await
                .map_err(|_| "Could not remove the remembered sync key")?
                .map_err(issue)?;
        }
    }
    Ok(())
}

/// Remove OS remembering even while the vault is locked. Encrypted local data
/// remains available for a later password + sync-secret unlock.
#[tauri::command]
pub async fn browser_sync_forget_key(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    api_base: String,
    account_id: String,
) -> Result<(), String> {
    require_main(&webview)?;
    let _lifecycle = browser_lifecycle().write().await;
    let mut current = session().lock().await;
    let api = account_api(&api_base, &account_id)?;
    if current.as_ref().is_some_and(|active| {
        active.scope.deployment == api.deployment() && active.scope.account_id == account_id
    }) {
        stop(current.take()).await;
        let _ = app.emit_to("main", "misty:browser-sync-changed", "");
    }
    let path = database_path(&app, &api.deployment(), &account_id)?;
    let database_lock = lock_database(&path)?;
    let deployment = api.deployment();
    tokio::task::spawn_blocking(move || {
        let _database_lock = database_lock;
        if let Some(cached) = Store::read_cached_vault(&path, &deployment, &account_id)? {
            let scope = VaultScope {
                deployment,
                account_id,
                vault_id: cached.vault.vault_id,
            };
            secure_store::forget(&scope)?;
        }
        Ok::<_, misty_browser_sync::Error>(())
    })
    .await
    .map_err(|_| "Could not remove the remembered sync key")?
    .map_err(issue)
}

#[cfg(test)]
mod tests;
