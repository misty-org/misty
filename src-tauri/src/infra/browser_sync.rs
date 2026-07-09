//! Main-window IPC boundary for the native sync worker. Website views and agent
//! windows cannot unlock the vault or publish arbitrary credential payloads.
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        OnceLock,
    },
};

use misty_browser_sync::{
    crypto::{generate_sync_secret, DeviceKey, VaultRoot, VaultScope},
    document::{self, Change, Document, Payload, Resume, WorkspaceView},
    protocol::{Presence, Workspace},
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
mod control_advertisement;
pub mod handoff;

struct Session {
    id: String,
    scope: VaultScope,
    _database_lock: std::fs::File,
    cached_workspace: WorkspaceView,
    cached_pending: Vec<String>,
    device_id: String,
    api: SyncApi,
    handle: WorkerHandle,
    task: JoinHandle<misty_browser_sync::Result<()>>,
    notifications: JoinHandle<()>,
    credential_task: Option<JoinHandle<()>>,
    credential_issue: Option<&'static str>,
    #[cfg(any(target_os = "macos", windows))]
    capture_view: Option<capture::CaptureView>,
}

static SESSION: OnceLock<Mutex<Option<Session>>> = OnceLock::new();
fn session() -> &'static Mutex<Option<Session>> {
    SESSION.get_or_init(|| Mutex::new(None))
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
    let previous_issue = current.as_ref().and_then(|active| active.credential_issue);
    let previous = selected_profile()
        .lock()
        .map_err(|_| "Browser profile state is unavailable")?
        .clone();
    let mut selected = previous.clone();
    if let Some(active) = current.as_mut() {
        let logical = default_profile_id(&active.scope)?;
        if requested.is_none() || requested == Some(logical.as_str()) {
            selected = resolve_local_profile(active, &logical, previous.as_ref()).await?;
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
    if let (Some(active), Some((tab_id, url)), Some(logical)) = (
        current.as_mut().filter(|active| full_sync_enabled(active)),
        tab,
        logical_profile_id.as_ref(),
    ) {
        if let Ok(url) = url::Url::parse(url) {
            let area = document::credentials::Area::SessionStorage {
                origin: url.origin().ascii_serialization(),
                tab_id: tab_id.into(),
            };
            tab_session = local_tab_session(active, logical, &area).await;
        }
    }
    if let (Some(app), Some(active)) = (app, current.as_ref()) {
        if active.credential_issue != previous_issue {
            let _ = app.emit_to(
                "main",
                "misty:browser-sync-changed",
                &active.scope.workspace_id,
            );
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
                    "Website sign-in sync is unavailable. You can keep browsing with this device's existing data.",
                );
                Ok(Some(previous.clone()))
            } else {
                Err(issue(error))
            }
        }
    }
}

async fn local_tab_session(
    active: &mut Session,
    logical: &str,
    area: &document::credentials::Area,
) -> Option<serde_json::Value> {
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
                "Synced tab sessions could not be restored. You can keep browsing with this device's existing data.",
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

#[derive(Serialize)]
pub struct SyncView {
    session_id: String,
    deployment: String,
    account_id: String,
    workspace_id: String,
    device_id: String,
    profile_id: String,
    supports_cookie_handoff: bool,
    browser_profile_ready: bool,
    browser_profile_issue: Option<&'static str>,
    status: Status,
    presence: Vec<Presence>,
    devices: Vec<misty_browser_sync::protocol::Device>,
    full_sync: bool,
    traffic: misty_browser_sync::transport::TrafficSnapshot,
    workspace: WorkspaceView,
    pending_operation_ids: Vec<String>,
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
    // A local website-storage failure does not stop workspace transport.
    let status = active.handle.status.borrow().clone();
    let profile = default_profile_id(&active.scope)?;
    let browser_profile_ready = active.credential_issue.is_none()
        && match active.handle.browser_profile_binding(profile.clone()).await {
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
        };
    Ok(SyncView {
        browser_profile_ready,
        browser_profile_issue: active.credential_issue,
        session_id: active.id.clone(),
        deployment: active.scope.deployment.clone(),
        account_id: active.scope.account_id.clone(),
        workspace_id: active.scope.workspace_id.clone(),
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
    })
}

fn default_profile_id(scope: &VaultScope) -> Result<String, String> {
    let bytes = serde_json::to_vec(&(
        "misty.default-browser-profile.v1",
        &scope.deployment,
        &scope.account_id,
        &scope.workspace_id,
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
        remote: Some(api.workspace().await.map_err(issue)?.is_some()),
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
    SyncApi::new(api_base, client.http.clone())
        .map(|api| {
            api.with_refresh_hook(move || {
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
) -> Result<SyncView, String> {
    let password = password.map(Zeroizing::new);
    let secret = sync_secret.map(Zeroizing::new);
    require_main(&webview)?;
    open_vault(app, api_base, account_id, password, secret, remember, false).await
}

async fn open_vault(
    app: tauri::AppHandle,
    api_base: String,
    account_id: String,
    password: Option<Zeroizing<String>>,
    secret: Option<Zeroizing<String>>,
    remember: bool,
    create: bool,
) -> Result<SyncView, String> {
    let _lifecycle = browser_lifecycle().write().await;
    let mut current = session().lock().await;
    let api = account_api(&api_base, &account_id)?;
    // Background retries can overlap a manual unlock. Reuse the worker that
    // won that race instead of stopping it and reading the key a second time.
    if !create
        && password.is_none()
        && secret.is_none()
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
    let cached = Store::read_cached_vault(&path, &api.deployment(), &account_id).map_err(issue)?;

    // Retrying setup after a lost response reopens the persisted root using the
    // same credentials. It must never generate a replacement root or device.
    let create = create && cached.is_none();
    // Cached vaults can unlock without a network request. Authorization and remote
    // identity are checked when the reconnecting worker obtains a fresh ticket.
    let remote = if cached.is_none() {
        api.workspace().await.map_err(issue)?
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
        workspace_id: cached
            .as_ref()
            .map(|v| &v.workspace)
            .or(remote.as_ref())
            .map(|w| w.workspace_id.clone())
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
    let existing_identity =
        Store::belongs_to_account(&path, &scope.deployment, &scope.account_id).map_err(issue)?;
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
            let workspace = Workspace {
                workspace_id: native_scope.workspace_id.clone(),
                key_epoch: 1,
                head_sequence: 0,
                root_public_key: root.public_key()?,
                key_envelope: wrapper,
            };
            (
                root,
                CachedVault {
                    workspace,
                    bootstrap_pending: true,
                    enrollment_pending: true,
                },
            )
        } else {
            let vault = match cached.clone() {
                Some(vault) => vault,
                None => CachedVault {
                    workspace: remote.ok_or(misty_browser_sync::Error::Recovery)?,
                    bootstrap_pending: false,
                    enrollment_pending: true,
                },
            };
            let workspace = &vault.workspace;
            let root = match (password, secret) {
                (Some(password), Some(secret)) => VaultRoot::unlock(
                    &native_scope,
                    &workspace.key_envelope,
                    &password,
                    &secret,
                    &workspace.root_public_key,
                )?,
                (None, None) => secure_store::recall(&native_scope, &workspace.root_public_key)?
                    .ok_or(misty_browser_sync::Error::Unlock)?,
                _ => return Err(misty_browser_sync::Error::Invalid),
            };
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
                vault.workspace.key_epoch,
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
    let advertise_name = control_device_name(&device_id);
    let advertise_status = handle.status.clone();
    let task = tokio::spawn(worker.run());
    let mut status = handle.status.clone();
    let mut presence = handle.presence.clone();
    let mut devices = handle.devices.clone();
    let notify_workspace = scope.workspace_id.clone();
    let notify_app = app.clone();
    let notifications = tokio::spawn(async move {
        let advertisement = control_advertisement::advertise(
            advertise_status,
            || advertise_api.advertise_controls(&advertise_device, &advertise_name),
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
    *current = Some(Session {
        id: session_id,
        _database_lock: database_lock,
        cached_workspace,
        cached_pending: pending.operation_ids,
        scope,
        device_id,
        api,
        handle,
        task,
        notifications,
        credential_task,
        credential_issue: None,
        #[cfg(any(target_os = "macos", windows))]
        capture_view: None,
    });
    let _ = app.emit_to("main", "misty:browser-sync-changed", "");
    view(current.as_mut().expect("session was installed")).await
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
    changes: Vec<Change>,
    active_epoch: String,
) -> Result<String, String> {
    require_main(&webview)?;
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

#[tauri::command]
pub async fn browser_sync_resume(
    webview: tauri::Webview,
    session_id: String,
    operation_id: String,
    resume: Resume,
    active_epoch: String,
) -> Result<String, String> {
    require_main(&webview)?;
    enqueue(
        &session_id,
        operation_id,
        Payload::Resume { version: 1, resume }.published(active_epoch),
    )
    .await
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

fn control_device_name(device_id: &str) -> String {
    #[cfg(unix)]
    let host = {
        let mut bytes = [0u8; 256];
        // gethostname writes at most the supplied length. Reserve a terminator.
        let ok = unsafe { libc::gethostname(bytes.as_mut_ptr().cast(), bytes.len() - 1) } == 0;
        ok.then(|| {
            String::from_utf8_lossy(
                &bytes[..bytes.iter().position(|b| *b == 0).unwrap_or(bytes.len())],
            )
            .into_owned()
        })
    };
    #[cfg(not(unix))]
    let host = std::env::var("COMPUTERNAME").ok();
    let host = host
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| std::env::consts::OS.into());
    // Development profiles are separate sync devices on the same computer.
    // Advertise their launcher names so the control panel can distinguish them.
    #[cfg(debug_assertions)]
    let host = std::env::var("MISTY_DESKTOP_PROFILE")
        .ok()
        .filter(|profile| !profile.is_empty())
        .map(|profile| format!("{profile} · {host}"))
        .unwrap_or(host);
    format!(
        "{} · {}",
        host.chars().take(32).collect::<String>(),
        device_id.chars().take(8).collect::<String>()
    )
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
) -> Result<String, String> {
    require_main(&webview)?;
    if activate == full_sync.is_some() {
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
        .control_device(&device_id, full_sync, activate)
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
                workspace_id: cached.workspace.workspace_id,
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
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn encrypted_binding_selects_only_activated_native_generations() {
        use misty_browser_sync::store::BrowserGeneration;
        let logical = "a".repeat(64);
        let physical = "b".repeat(64);
        let generation = BrowserGeneration {
            id: uuid::Uuid::new_v4().to_string(),
            physical_id: physical.clone(),
        };
        let mut binding = BrowserProfileBinding::default();
        assert_eq!(
            select_bound_profile(&logical, &binding, None).unwrap(),
            None
        );
        binding.revision = 1;
        binding.staged = Some(generation.clone());
        assert!(select_bound_profile(&logical, &binding, None).is_err());
        binding.staged = None;
        binding.active = Some(generation.clone());
        let selected = select_bound_profile(&logical, &binding, None)
            .unwrap()
            .unwrap();
        assert_eq!(selected.logical, logical);
        assert_eq!(selected.physical, physical);
        assert!(select_bound_profile(&"d".repeat(64), &binding, Some(&selected)).is_err());
        let mut replacement = binding.clone();
        replacement.active.as_mut().unwrap().physical_id = "e".repeat(64);
        assert!(select_bound_profile(&logical, &replacement, Some(&selected)).is_err());
        // Incomplete recovery cannot fall back to a different, empty store.
        assert!(
            select_bound_profile(&logical, &BrowserProfileBinding::default(), Some(&selected))
                .is_err()
        );
        binding.staged = Some(BrowserGeneration {
            id: uuid::Uuid::new_v4().to_string(),
            physical_id: "c".repeat(64),
        });
        // A failed incoming staging attempt must not block the authenticated
        // active local store or select the incomplete incoming generation.
        assert_eq!(select_bound_profile(&logical, &binding, Some(&selected)).unwrap(), Some(selected.clone()));
        assert_eq!(select_bound_profile(&logical, &binding, None).unwrap(), Some(selected));
    }

    #[tokio::test]
    async fn local_profile_survives_failed_sync_verification_and_stopped_worker() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("workspace.sqlite");
        let _ = rustls::crypto::ring::default_provider().install_default();
        let api = SyncApi::new("http://127.0.0.1:9", reqwest::Client::new()).unwrap();
        let scope = VaultScope {
            deployment: api.deployment(),
            account_id: "local-browser-fixture".into(),
            workspace_id: uuid::Uuid::new_v4().to_string(),
        };
        let logical = default_profile_id(&scope).unwrap();
        let root = VaultRoot::generate();
        let device = DeviceKey::generate();
        let device_id = uuid::Uuid::new_v4().to_string();
        let grant = root.grant(&scope, &device_id, 1, &device).unwrap();
        let mut store = Store::initialize(
            &path,
            scope.clone(),
            grant.clone(),
            &root,
            &device,
            &Document::default().encode().unwrap(),
        )
        .unwrap();
        let payload = serde_json::to_vec(&serde_json::json!({
            "kind": "credentials", "version": 1,
            "batch": {"profile_id": logical, "updates": [{
                "area": {"kind": "cookies"}, "base_sequence": 0, "payload": []
            }]}
        }))
        .unwrap();
        let mutation = store.enqueue(&root, &device, &payload).unwrap();
        store
            .apply_events(
                &root,
                &[(
                    misty_browser_sync::protocol::Event {
                        mutation,
                        sequence: 1,
                    },
                    grant,
                )],
                document::reduce,
            )
            .unwrap();
        let generation = uuid::Uuid::new_v4().to_string();
        let binding = store
            .stage_browser_profile(&root, &logical, 0, &generation)
            .unwrap();
        let physical = binding.staged.as_ref().unwrap().physical_id.clone();
        let journal = store
            .begin_browser_import(&root, &logical, 0, &generation, 1)
            .unwrap();
        store
            .finish_browser_import(
                &root,
                &logical,
                journal.revision,
                &generation,
                &journal.pending.unwrap().credentials,
            )
            .unwrap();
        store
            .activate_browser_profile(&root, &logical, binding.revision, &generation)
            .unwrap();
        let cached_workspace = Document::default().workspace_view().unwrap();
        let (worker, handle) = Worker::new(
            api.clone(),
            scope.clone(),
            root,
            device,
            store,
            document::reduce,
        )
        .unwrap();
        let mut active = Session {
            id: uuid::Uuid::new_v4().to_string(),
            scope,
            device_id,
            api,
            _database_lock: lock_database(&path).unwrap(),
            cached_workspace,
            cached_pending: vec![],
            handle,
            task: tokio::spawn(worker.run()),
            notifications: tokio::spawn(std::future::pending()),
            credential_task: None,
            credential_issue: Some("Website storage unavailable"),
            #[cfg(any(target_os = "macos", windows))]
            capture_view: None,
        };
        // A failed read-back must not revoke an activated local store. This is
        // the same journal failure that previously prevented native tab creation.
        let journal = active
            .handle
            .browser_import_journal(logical.clone())
            .await
            .unwrap();
        assert!(active
            .handle
            .finish_browser_import(logical.clone(), journal.revision, generation, vec![])
            .await
            .is_err());
        let selected = resolve_local_profile(&mut active, &logical, None)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(selected.physical, physical);
        let status = view(&mut active).await.unwrap();
        assert!(!status.browser_profile_ready);
        assert_eq!(
            status.browser_profile_issue,
            Some("Website storage unavailable")
        );

        active.handle.stop();
        (&mut active.task).await.unwrap().unwrap();
        let retained = resolve_local_profile(&mut active, &logical, Some(&selected))
            .await
            .unwrap();
        assert_eq!(retained, Some(selected.clone()));
        // A failed worker cannot justify switching accounts or inventing a new
        // store. Optional synced sessionStorage failure still permits browsing.
        assert!(
            resolve_local_profile(&mut active, &"f".repeat(64), Some(&selected))
                .await
                .is_err()
        );
        assert!(resolve_local_profile(&mut active, &logical, None)
            .await
            .is_err());
        assert!(local_tab_session(
            &mut active,
            &logical,
            &document::credentials::Area::SessionStorage {
                origin: "https://example.test".into(),
                tab_id: uuid::Uuid::new_v4().to_string(),
            }
        )
        .await
        .is_none());
        assert!(active.credential_issue.is_some());
        active.notifications.abort();
    }

    #[tokio::test]
    async fn account_replacement_waits_for_key_owner_and_releases_process_lock() {
        let directory =
            std::env::temp_dir().join(format!("misty-sync-owner-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        struct Cleanup(PathBuf);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
        let _cleanup = Cleanup(directory.clone());
        let path = directory.join("workspace.sqlite");
        let database_lock = lock_database(&path).unwrap();
        assert!(
            lock_database(&path).is_err(),
            "a second process/owner must not use this device identity"
        );
        let _ = rustls::crypto::ring::default_provider().install_default();
        let api = SyncApi::new(
            "http://127.0.0.1:9",
            reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .unwrap(),
        )
        .unwrap();
        let scope = VaultScope {
            deployment: api.deployment(),
            account_id: "fixture".into(),
            workspace_id: uuid::Uuid::new_v4().to_string(),
        };
        let root = VaultRoot::generate();
        let device = DeviceKey::generate();
        let device_id = uuid::Uuid::new_v4().to_string();
        let grant = root.grant(&scope, &device_id, 1, &device).unwrap();
        let initial = Document::default();
        let store = Store::initialize(
            &path,
            scope.clone(),
            grant,
            &root,
            &device,
            &initial.encode().unwrap(),
        )
        .unwrap();
        let (worker, handle) = Worker::new(
            api.clone(),
            scope.clone(),
            root,
            device,
            store,
            document::reduce,
        )
        .unwrap();
        let observer = handle.clone();
        let active = Session {
            id: uuid::Uuid::new_v4().to_string(),
            scope,
            device_id,
            api,
            _database_lock: database_lock,
            cached_workspace: initial.workspace_view().unwrap(),
            cached_pending: vec![],
            handle,
            task: tokio::spawn(worker.run()),
            notifications: tokio::spawn(std::future::pending()),
            credential_task: None,
            credential_issue: None,
            #[cfg(any(target_os = "macos", windows))]
            capture_view: None,
        };
        *session().lock().await = Some(active);
        let epoch = BROWSER_ACCOUNT_EPOCH.load(Ordering::Acquire);
        change_account_if(None, |_| false, || Ok(())).await.unwrap();
        assert!(
            session().lock().await.is_some(),
            "forgetting another saved login must not stop this worker"
        );
        assert_eq!(epoch, BROWSER_ACCOUNT_EPOCH.load(Ordering::Acquire));
        let creation = browser_lifecycle().read().await;
        let change = change_account(None, || {
            assert!(observer.status.borrow().phase == misty_browser_sync::worker::Phase::Stopped);
            assert!(
                session().try_lock().is_err(),
                "jar replacement must remain serialized with unlock"
            );
            assert!(
                lock_database(&path).is_ok(),
                "old database lock is released only after its worker ends"
            );
            Ok(())
        });
        tokio::pin!(change);
        assert!(tokio::time::timeout(Duration::from_millis(20), &mut change)
            .await
            .is_err());
        assert!(
            session().lock().await.is_some(),
            "account shutdown must await the native creation lease"
        );
        let queued_creation = browser_profile_lease(None, None, None);
        tokio::pin!(queued_creation);
        assert!(
            tokio::time::timeout(Duration::from_millis(20), &mut queued_creation)
                .await
                .is_err()
        );
        drop(creation);
        tokio::time::timeout(Duration::from_secs(3), &mut change)
            .await
            .unwrap()
            .unwrap();
        assert!(
            queued_creation.await.is_err(),
            "creation queued for the old account must not reopen it"
        );
        assert!(session().lock().await.is_none());
        assert!(
            observer.snapshot().await.is_err(),
            "old handles cannot read decrypted data after account replacement"
        );
    }
}
