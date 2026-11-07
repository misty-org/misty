//! This computer's link to the account's vault. The person creates the vault once and types its
//! password once per computer; after that it runs in the background, and Settings is the only
//! place it ever shows, apart from a notice when something needs them.
//!
//! The link only copies the local records (`profile_data`) to and from the server, so pausing it,
//! losing it or destroying the vault leaves everything on this computer as it is.
use std::sync::{Arc, Mutex};

use misty_browser_sync::{
    crypto::{DeviceKey, VaultRoot},
    local::LocalStore,
    secure_store,
    transport::{SessionAuth, SyncApi},
    vault::{
        client::SessionInfo,
        exchange::Notice,
        link::{Link, LinkConfig, LinkStatus},
    },
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use tokio::sync::broadcast;

use super::account::session::AccountClient;
use super::profile_data::{self, RecordsChanged};
use super::profile_windows;

mod commands;
pub(crate) mod history;
mod profiles;
pub(crate) mod site_data;
mod usage;
pub(crate) use commands::forget_on_sign_out;
pub use commands::*;
pub(crate) use profiles::{follow_remote_list, profile_changed};
pub use usage::*;

/// Emitted to every window when where sync stands changes.
pub const VAULT_STATUS_EVENT: &str = "misty://vault-status";
pub(super) const META_VAULT: &str = "vault.id";
const META_SESSION: &str = "vault.session";
const META_PAUSED: &str = "vault.paused";
/// Set once the person has answered the offer to create a vault, or created one. Kept when a vault
/// is destroyed: Misty never asks twice.
pub(super) const META_ASKED: &str = "asked.vault";
const SECRET_SESSION_KEY: &str = "session-key";

struct Active {
    scope: String,
    vault_id: String,
    session_id: String,
    root: VaultRoot,
    link: Option<Link>,
    /// Forwards local edits to the link, and watches its status.
    tasks: Vec<tokio::task::JoinHandle<()>>,
}

static ACTIVE: tokio::sync::Mutex<Option<Active>> = tokio::sync::Mutex::const_new(None);
/// The last thing worth saying, for a link that has stopped.
static NOTICE: Mutex<Option<Notice>> = Mutex::new(None);

/// Where sync stands on this computer.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case", tag = "state")]
pub enum VaultState {
    /// No vault is open here. `exists` says whether the account has one: unknown when offline.
    Off {
        exists: Option<bool>,
        asked: bool,
        notice: Option<Notice>,
    },
    Paused {
        vault_id: String,
    },
    On {
        vault_id: String,
        session_id: String,
        status: LinkStatus,
    },
}

/// The account's name for its storage on this computer, and for its remembered key.
fn key_identity(scope: &str) -> String {
    hex::encode(Sha256::digest(format!("misty.vault-key.v1\0{scope}")))
}

/// Lends sync the account's session: the bearer for each request, and the shared, serialized refresh.
struct AccountSession {
    client: Arc<AccountClient>,
    base: url::Url,
}

impl SessionAuth for AccountSession {
    fn bearer(&self) -> Option<String> {
        self.client.access_header()
    }

    fn refresh<'a>(
        &'a self,
        used: Option<&'a str>,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = misty_browser_sync::Result<()>> + Send + 'a>,
    > {
        Box::pin(async move {
            let answer = self
                .client
                .refresh_after(&self.base, used)
                .await
                .map_err(|_| misty_browser_sync::Error::Network)?;
            match answer.status {
                200..=299 => Ok(()),
                401 | 403 => Err(misty_browser_sync::Error::Authentication),
                _ => Err(misty_browser_sync::Error::Network),
            }
        })
    }
}

pub(super) fn account_api(api_base: &str) -> Result<SyncApi, String> {
    let url = super::account::session::server(api_base)?;
    let client = super::account::session::current(&url)?;
    let http = client.http.clone();
    SyncApi::new(api_base, http)
        .map(|api| api.with_session(Arc::new(AccountSession { client, base: url })))
        .map_err(|_| "This server's address isn't valid.".to_owned())
}

fn with_store<T>(
    work: impl FnOnce(&mut LocalStore) -> misty_browser_sync::Result<T>,
) -> Result<T, String> {
    let store = profile_data::local_store()?;
    let mut store = store.lock().map_err(|_| "Local storage is unavailable.")?;
    work(&mut store).map_err(|_| "Local storage is unavailable.".to_owned())
}

/// This session's name, for the list in Settings.
fn session_info() -> SessionInfo {
    SessionInfo {
        name: crate::app::device_commands::computer_name(),
        platform: std::env::consts::OS.to_owned(),
        os_version: tauri_plugin_os::version().to_string(),
    }
}

/// This session's id and signing key, made once for each vault it joins.
fn session_identity(store: &LocalStore) -> misty_browser_sync::Result<(String, DeviceKey)> {
    let id = match store.meta(META_SESSION)? {
        Some(id) => id,
        None => {
            let id = uuid::Uuid::new_v4().to_string();
            store.set_meta(META_SESSION, &id)?;
            id
        }
    };
    let key = match store.secret(SECRET_SESSION_KEY)? {
        Some(bytes) => DeviceKey::from_secret_bytes(&bytes)?,
        None => {
            let key = DeviceKey::generate();
            store.set_secret(SECRET_SESSION_KEY, key.secret_bytes().as_ref())?;
            key
        }
    };
    Ok((id, key))
}

/// Starts the link for an open vault. Replaces any link already running.
async fn start(
    app: &AppHandle,
    api_base: &str,
    root: VaultRoot,
    vault_id: String,
) -> Result<(), String> {
    let scope = profile_windows::current_scope();
    let store = profile_data::local_store()?;
    let (session_id, session_key) = {
        let store = store.lock().map_err(|_| "Local storage is unavailable.")?;
        session_identity(&store).map_err(|_| "Local storage is unavailable.")?
    };
    let api = account_api(api_base)?;
    let on_change = Arc::new(move |profile: &str, collection: &str| {
        profile_data::announce(RecordsChanged {
            profile: profile.to_owned(),
            collection: collection.to_owned(),
            remote: true,
        });
    });
    let sessions_app = app.clone();
    let on_sessions = Arc::new(move || announce_status(&sessions_app));
    let link = Link::start(LinkConfig {
        api,
        store,
        root: root.duplicate(),
        vault_id: vault_id.clone(),
        session_id: session_id.clone(),
        session_key,
        on_change,
        on_sessions,
    })
    .map_err(|_| "Sync couldn't start.")?;
    let mut tasks = Vec::new();
    // Local edits wake the link; it sends them when their batch is due.
    let wake = link.waker();
    let mut changes = profile_data::subscribe();
    tasks.push(tokio::spawn(async move {
        loop {
            match changes.recv().await {
                Ok(change) if !change.remote => wake.notify_one(),
                Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    }));
    let mut status = link.status.clone();
    let watch_app = app.clone();
    tasks.push(tokio::spawn(async move {
        while status.changed().await.is_ok() {
            let current = status.borrow().clone();
            announce_status(&watch_app);
            if current.stopped {
                stopped(&watch_app, current.notice).await;
                break;
            }
        }
    }));
    tasks.push(history::spawn(app.clone()));
    tasks.push(super::memory::vault_link::spawn(app.clone()));
    let previous = ACTIVE.lock().await.replace(Active {
        scope,
        vault_id,
        session_id,
        root,
        link: Some(link),
        tasks,
    });
    shut_down(previous).await;
    profiles::publish_all(app);
    announce_status(app);
    Ok(())
}

async fn shut_down(active: Option<Active>) {
    if let Some(mut active) = active {
        for task in &active.tasks {
            task.abort();
        }
        if let Some(link) = active.link.take() {
            link.shutdown().await;
        }
    }
}

/// The link stopped by itself: this session was removed, or the vault is gone. Local data stays.
/// The key is no use any more, and a later vault uploads from what's here.
async fn stopped(app: &AppHandle, notice: Option<Notice>) {
    let Some(notice) = notice else { return };
    if let Ok(mut last) = NOTICE.lock() {
        *last = Some(notice);
    }
    let active = ACTIVE.lock().await.take();
    if let Some(active) = &active {
        let _ = secure_store::forget_vault_root(&key_identity(&active.scope));
    }
    shut_down(active).await;
    let _ = with_store(|store| store.unlink());
    announce_status(app);
}

pub(super) fn announce_status(app: &AppHandle) {
    profile_windows::emit(app, VAULT_STATUS_EVENT, ());
}

/// Stops the link without touching anything saved. Used when the account changes.
pub(crate) async fn close_for_account_change() {
    shut_down(ACTIVE.lock().await.take()).await;
}

/// The vault's sealed clipboard key, while it's open here.
pub(crate) async fn clipboard_key() -> Option<misty_browser_sync::crypto::ClipboardKey> {
    let active = ACTIVE.lock().await;
    let active = active.as_ref()?;
    active.root.vault_clipboard_key(&active.vault_id).ok()
}

/// The clipboard's ring isn't any one profile's.
pub(crate) fn clipboard_records() -> Option<profile_data::ProfileRecords> {
    profile_data::profile_records(profiles::LIST_OWNER)
}

/// Picks the link back up if this computer already has the vault open: at launch, and after the
/// account changes. Never asks for anything.
async fn resume(app: &AppHandle, api_base: &str) -> Result<(), String> {
    let scope = profile_windows::current_scope();
    if scope == profile_windows::LOCAL_SCOPE {
        return Ok(());
    }
    if ACTIVE
        .lock()
        .await
        .as_ref()
        .is_some_and(|active| active.scope == scope)
    {
        return Ok(());
    }
    let (vault_id, paused) =
        with_store(|store| Ok((store.meta(META_VAULT)?, store.meta(META_PAUSED)?.is_some())))?;
    let Some(vault_id) = vault_id else {
        return Ok(());
    };
    if paused {
        return Ok(());
    }
    let identity = key_identity(&scope);
    // A failed read is an error that retries next launch: only a confirmed-missing key means this
    // computer has to ask for the password again.
    let root = tokio::task::spawn_blocking(move || secure_store::recall_vault_root(&identity))
        .await
        .map_err(|_| "Sync couldn't start.")?
        .map_err(|_| "This computer's key storage is unavailable.")?;
    match root {
        Some(root) => start(app, api_base, root, vault_id).await,
        None => Ok(()),
    }
}
