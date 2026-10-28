//! Main-window IPC boundary for the native sync worker. Website views and agent
//! windows cannot unlock the vault or publish arbitrary credential payloads.
use std::{
    borrow::Cow,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, OnceLock,
    },
};

use misty_browser_sync::{
    crypto::{AccountKeys, DeviceKey, VaultRoot, VaultScope},
    document::{self, Change, Document, Payload, WorkspaceView},
    protocol::{Presence, Vault},
    secure_store,
    store::{BrowserProfileBinding, CachedVault, Store},
    transport::SyncApi,
    worker::{Phase, Status, Worker, WorkerHandle},
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::Manager;
use tokio::{
    sync::{Mutex, RwLock, RwLockReadGuard},
    task::JoinHandle,
};
use zeroize::Zeroizing;

mod account_credentials;
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
mod database_legacy;
mod local_vault;
mod os_version;
mod profile;
mod profile_selection;
mod session_start;
mod sessions;
#[cfg(desktop)]
mod space_data;
mod space_sites;
mod space_vaults;
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
pub(crate) use account_credentials::{
    __cmd__account_check_password, __cmd__account_login_credential,
    __cmd__browser_sync_use_account_password, __tauri_command_name_account_check_password,
    __tauri_command_name_account_login_credential,
    __tauri_command_name_browser_sync_use_account_password,
};
pub use account_credentials::{
    account_check_password, account_login_credential, browser_sync_use_account_password,
};
pub(super) use database::lock_database;
pub(crate) use database::{
    __cmd__browser_sync_availability, __cmd__browser_sync_delete_vault,
    __cmd__browser_sync_forget_key, __tauri_command_name_browser_sync_availability,
    __tauri_command_name_browser_sync_delete_vault, __tauri_command_name_browser_sync_forget_key,
};
pub use database::{browser_sync_availability, browser_sync_delete_vault, browser_sync_forget_key};
use database::{database_path, personal_vault_id, remember_personal_vault, retire_database};
use os_version::os_version;
pub(super) use profile::browser_profile_lease;
#[cfg(any(target_os = "macos", windows))]
pub(super) use profile::popup_lifecycle_lease;
#[cfg(target_os = "macos")]
pub(super) use profile::BrowserProfileLease;
use profile::{default_profile_id, SelectedProfile};
#[cfg(test)]
use profile::{local_tab_session, resolve_local_profile, select_bound_profile};
use profile_selection::{
    clear_selected_profiles, selected_profile, set_selected_profile, store_lock,
};
use sessions::*;
#[cfg(desktop)]
pub(crate) use space_data::{
    device_name, hashed_id, space_vault, store_vault, window_space, SpaceVault,
};
pub(crate) use space_sites::{
    __cmd__browser_sync_set_space_sites, __cmd__browser_sync_space_sites,
    __tauri_command_name_browser_sync_set_space_sites,
    __tauri_command_name_browser_sync_space_sites,
};
pub use space_sites::{browser_sync_set_space_sites, browser_sync_space_sites};
pub use space_vaults::browser_sync_space_window;
pub(crate) use space_vaults::{
    __cmd__browser_sync_space_window, __tauri_command_name_browser_sync_space_window,
};
pub(super) use vault_open::account_api;
use vault_open::open_vault_with;
pub(crate) use vault_open::{
    __cmd__browser_sync_connect, __cmd__browser_sync_setup,
    __tauri_command_name_browser_sync_connect, __tauri_command_name_browser_sync_setup,
};
pub use vault_open::{browser_sync_connect, browser_sync_setup};
use view::view;
pub(crate) use view::{
    __cmd__browser_sync_account_feed, __cmd__browser_sync_state,
    __tauri_command_name_browser_sync_account_feed, __tauri_command_name_browser_sync_state,
};
pub use view::{browser_sync_account_feed, browser_sync_state, SyncView};
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
pub(crate) use workspace_edits::{
    __cmd__browser_sync_edit, __tauri_command_name_browser_sync_edit,
};

mod vault_access;
pub(crate) use vault_access::*;

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
    held: super::website_data::budget::Held,
    #[cfg(any(target_os = "macos", windows))]
    capture_view: Option<capture::CaptureView>,
    /// While the vault is open this device can admit and remove devices
    /// (docs/sync/devices.md). Dropped, and zeroized, on lock. For
    /// the personal vault it also opens every Space vault.
    admission_root: VaultRoot,
    /// This device's signing key, shared by every vault it is in.
    device_key: DeviceKey,
    /// The Space this vault belongs to; None for the personal vault.
    space_id: Option<String>,
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
        Error::Unlock => "That password did not work. Check it, and for an older vault the sync secret too.",
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
