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

mod account;
mod database;
mod os_version;
mod profile;
mod vault_open;
mod view;
mod workspace_control;
mod workspace_edits;

pub use account::browser_sync_lock;
pub use account::browser_sync_set_frequency;
use account::stop;
pub(crate) use account::{__cmd__browser_sync_lock, __tauri_command_name_browser_sync_lock};
pub(crate) use account::{
    __cmd__browser_sync_set_frequency, __tauri_command_name_browser_sync_set_frequency,
};
pub(super) use account::{change_account, change_account_if};
pub(super) use database::lock_database;
pub(crate) use database::{
    __cmd__browser_sync_availability, __cmd__browser_sync_forget_key,
    __tauri_command_name_browser_sync_availability, __tauri_command_name_browser_sync_forget_key,
};
pub use database::{browser_sync_availability, browser_sync_forget_key, VaultAvailability};
use database::{database_path, retire_database};
use os_version::os_version;
#[cfg(any(target_os = "macos", windows))]
pub(super) use profile::popup_lifecycle_lease;
pub(super) use profile::{browser_profile_lease, BrowserProfileLease};
use profile::{default_profile_id, selected_profile, SelectedProfile};
#[cfg(test)]
use profile::{local_tab_session, resolve_local_profile, select_bound_profile};
pub(super) use vault_open::account_api;
use vault_open::open_vault_with;
pub(crate) use vault_open::{
    __cmd__browser_sync_connect, __cmd__browser_sync_generate_secret, __cmd__browser_sync_setup,
    __tauri_command_name_browser_sync_connect, __tauri_command_name_browser_sync_generate_secret,
    __tauri_command_name_browser_sync_setup,
};
pub use vault_open::{browser_sync_connect, browser_sync_generate_secret, browser_sync_setup};
use view::view;
pub(crate) use view::{
    __cmd__browser_sync_account_feed, __cmd__browser_sync_state,
    __tauri_command_name_browser_sync_account_feed, __tauri_command_name_browser_sync_state,
};
pub use view::{browser_sync_account_feed, browser_sync_state, AccountFeed, SyncView};
pub(crate) use workspace_control::{
    __cmd__browser_sync_activate, __cmd__browser_sync_claim, __cmd__browser_sync_control_device,
    __cmd__browser_sync_flush, __cmd__browser_sync_rename_device,
    __tauri_command_name_browser_sync_activate, __tauri_command_name_browser_sync_claim,
    __tauri_command_name_browser_sync_control_device, __tauri_command_name_browser_sync_flush,
    __tauri_command_name_browser_sync_rename_device,
};
pub use workspace_control::{
    browser_sync_activate, browser_sync_claim, browser_sync_control_device, browser_sync_flush,
    browser_sync_rename_device, flush_before_exit,
};
pub(crate) use workspace_control::{page_state_reader, page_state_worker};
pub use workspace_edits::browser_sync_edit;
use workspace_edits::enqueue;
pub(crate) use workspace_edits::{
    __cmd__browser_sync_edit, __tauri_command_name_browser_sync_edit,
};

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
    session()
        .lock()
        .await
        .as_ref()
        .filter(|s| s.scope.account_id == account)
        .map(|s| s.handle.clone())
}

/// Whether `profile` is the account's own browser profile (its logical identity
/// or the native store it is bound to), which a device profile must never be.
pub(crate) async fn is_account_browser_profile(profile: &str) -> bool {
    let logical = session()
        .lock()
        .await
        .as_ref()
        .and_then(|active| default_profile_id(&active.scope).ok());
    let selected = selected_profile()
        .lock()
        .ok()
        .and_then(|selected| selected.clone());
    logical.as_deref() == Some(profile)
        || selected
            .is_some_and(|selected| selected.logical == profile || selected.physical == profile)
}

/// The shared clipboard rides on the account's sync connection and seals clips
/// with a key derived from the vault root. None while the vault is locked.
pub(crate) async fn clipboard_session(
    account: &str,
) -> Option<(WorkerHandle, misty_browser_sync::crypto::ClipboardKey)> {
    let session = session().lock().await;
    let active = session.as_ref().filter(|s| s.scope.account_id == account)?;
    let key = active.admission_root.clipboard_key(&active.scope).ok()?;
    Some((active.handle.clone(), key))
}

/// Saved passwords live in the unlocked vault of the signed-in account. None
/// while the vault is locked.
pub(crate) async fn vault_handle() -> Option<WorkerHandle> {
    session().lock().await.as_ref().map(|s| s.handle.clone())
}

// A browser creation/import owns a read/write lease independently of worker
// commands. Account changes take the write side before SESSION, so callbacks
// cannot create a view after shutdown selected a different account.
static BROWSER_LIFECYCLE: OnceLock<RwLock<()>> = OnceLock::new();
static BROWSER_ACCOUNT_EPOCH: AtomicU64 = AtomicU64::new(0);
pub(super) fn browser_lifecycle() -> &'static RwLock<()> {
    BROWSER_LIFECYCLE.get_or_init(|| RwLock::new(()))
}

fn require_main(webview: &tauri::Webview) -> Result<(), String> {
    if !crate::infra::space_windows::is_space_window(webview.label()) {
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

fn require_session(active: &Session, expected: &str) -> Result<(), String> {
    if active.id != expected {
        return Err("The sync session changed. Refresh the workspace before editing.".into());
    }
    Ok(())
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

#[cfg(test)]
mod tests;
