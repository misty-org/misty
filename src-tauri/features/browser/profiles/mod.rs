//! What each profile keeps, on this computer: one encrypted database per account, reached
//! through a [`ProfileRecords`] handle. It works with no account, and it never leaves this
//! computer. Also the account-change barrier, which keeps browser views and data from outliving
//! the account they belong to.
use file_access::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};

use browser_data::{
    document::ViewRecord,
    local::{LocalKey, LocalStore},
    secure_store,
};
use sha2::{Digest, Sha256};
use tokio::sync::{RwLock, RwLockReadGuard};

use crate::browser::app_windows;

mod account;
mod commands;
mod records;
mod seed;
mod tabs;
pub(crate) use account::*;
pub use records::*;
pub(crate) use seed::seed_first_profile;
pub use tabs::*;

#[cfg(test)]
// Tests build their fixtures directly, outside the file gate.
#[allow(clippy::disallowed_methods, clippy::disallowed_types)]
mod tests;

/// Tabs' saved page state and back/forward lists, one row per `<view id>:<slot>`. A tab's rows go
/// when the tab is closed.
pub const PAGE_STATE: &str = "page_state";

struct OpenStore {
    scope: String,
    store: Arc<Mutex<LocalStore>>,
    _lock: fs::File,
}

static OPEN: Mutex<Option<OpenStore>> = Mutex::new(None);

fn hashed(value: impl AsRef<[u8]>) -> String {
    hex::encode(Sha256::digest(value))
}

/// The account's folder. A development profile has its own, even for the same account.
fn account_identity(scope: &str) -> String {
    match std::env::var("MISTY_PROFILE") {
        Ok(dev) if !dev.is_empty() => hashed(format!("{scope}\0{dev}")),
        _ => hashed(scope),
    }
}

pub(crate) fn account_dir(scope: &str) -> Result<PathBuf, String> {
    let directory = file_access::paths::misty_home_dir()
        .ok_or("Local application storage is unavailable")?
        .join("sync")
        .join(account_identity(scope));
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    builder.mode(0o700);
    builder
        .create(&directory)
        .map_err(|_| "Could not create local storage")?;
    Ok(directory)
}

/// Sets aside a database whose key is confirmed gone. It can never open again, but it stays on
/// disk rather than being deleted.
fn set_aside(path: &std::path::Path) -> Result<(), String> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or_default();
    let aside = path.with_file_name(format!("records.lost-{stamp}.sqlite"));
    for suffix in ["", "-wal", "-shm"] {
        let from = PathBuf::from(format!("{}{suffix}", path.display()));
        if fs::exists(&from) {
            fs::rename(&from, format!("{}{suffix}", aside.display()))
                .map_err(|_| "Could not set aside local storage")?;
        }
    }
    Ok(())
}

fn open_key(identity: &str, path: &std::path::Path) -> Result<LocalKey, String> {
    // A read that failed is an error and retries later: only a key confirmed missing is replaced.
    match secure_store::local_records_key(identity)
        .map_err(|_| "This computer's key storage is unavailable.")?
    {
        Some(key) => Ok(key),
        None => {
            if fs::exists(&path) {
                set_aside(path)?;
            }
            secure_store::create_local_records_key(identity)
                .map_err(|_| "This computer's key storage is unavailable.".to_owned())
        }
    }
}

/// The current account's database, opened on first use.
pub(crate) fn local_store() -> Result<Arc<Mutex<LocalStore>>, String> {
    let scope = app_windows::current_scope();
    let mut open = OPEN.lock().map_err(|_| "Local storage is unavailable.")?;
    if let Some(store) = open.as_ref().filter(|store| store.scope == scope) {
        return Ok(store.store.clone());
    }
    let directory = account_dir(&scope)?;
    let path = directory.join("records.sqlite");
    let lock = lock_database(&path)?;
    let key = open_key(&account_identity(&scope), &path)?;
    let store = Arc::new(Mutex::new(
        LocalStore::open(&path, &key).map_err(|_| "Local storage is unavailable.")?,
    ));
    *open = Some(OpenStore {
        scope,
        store: store.clone(),
        _lock: lock,
    });
    Ok(store)
}

/// Closes the account's database, before another account's takes its place.
pub(crate) fn close_store() {
    if let Ok(mut open) = OPEN.lock() {
        *open = None;
    }
}

const LOCK_ATTEMPTS: u32 = 10;
const LOCK_RETRY: std::time::Duration = std::time::Duration::from_millis(25);

/// Holds a database for this process. A process being spawned holds a copy of every open file
/// until it execs, which keeps a lock this app just released looking held for a moment; only a
/// lock that stays busy is another Misty's.
pub(crate) fn lock_database(path: &std::path::Path) -> Result<fs::File, String> {
    let mut options = fs::OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    options.mode(0o600);
    let file = options
        .open(path.with_extension("lock"))
        .map_err(|_| "Could not lock local storage")?;
    for _ in 1..LOCK_ATTEMPTS {
        if file.try_lock().is_ok() {
            return Ok(file);
        }
        std::thread::sleep(LOCK_RETRY);
    }
    file.try_lock()
        .map_err(|_| "Another Misty process owns this computer's local storage")?;
    Ok(file)
}

/// A profile's records. `None` when this computer's key storage can't be read right now.
pub fn profile_records(profile: &str) -> Option<ProfileRecords> {
    Some(ProfileRecords {
        profile: profile.to_owned(),
        store: local_store().ok()?,
    })
}

/// The records of the profile a window belongs to.
pub fn window_records(label: &str) -> Option<ProfileRecords> {
    profile_records(&app_windows::profile_for_window(label)?)
}

/// The records of the profile that opens its pages in `store_key`, as
/// `site_settings::permissions::store_key` names a store: downloads and site permissions file
/// things under that key. A store no profile of this account uses has none.
pub fn store_records(store_key: &str) -> Option<ProfileRecords> {
    let profile = app_windows::listed_profiles().into_iter().find(|profile| {
        app_windows::store_for_profile(&profile.id)
            .ok()
            .and_then(|store| {
                crate::browser::site_settings::permissions::store_key(store.as_deref()).ok()
            })
            .is_some_and(|key| key == store_key)
    })?;
    profile_records(&profile.id)
}

/// Erases everything a deleted profile kept.
pub async fn remove_profile(profile: &str) {
    let profile = profile.to_owned();
    let _ = tokio::task::spawn_blocking(move || {
        if let Ok(store) = local_store() {
            if let Ok(mut store) = store.lock() {
                let _ = store.remove_profile(&profile);
            }
        }
    })
    .await;
}

/// This install's stable id among the account's signed-in sessions.
pub fn session_id() -> Option<String> {
    let store = local_store().ok()?;
    let store = store.lock().ok()?;
    if let Ok(Some(id)) = store.meta("session.id") {
        return Some(id);
    }
    let id = uuid::Uuid::new_v4().to_string();
    store.set_meta("session.id", &id).ok()?;
    Some(id)
}

/// A browser view's lease on its store: the account can't change, and the store can't be erased,
/// until the view that asked has finished opening.
pub struct PageStore {
    _lifecycle: RwLockReadGuard<'static, ()>,
    /// `None` is this computer's original store.
    pub store: Option<String>,
}

pub async fn page_store(profile: &str) -> Result<PageStore, String> {
    let epoch = account_epoch();
    let lifecycle = browser_lifecycle().read().await;
    if account_epoch() != epoch {
        return Err("The browser account changed before this page could open.".into());
    }
    let store = app_windows::store_for_profile(profile)?;
    Ok(PageStore {
        _lifecycle: lifecycle,
        store,
    })
}

pub(crate) fn browser_lifecycle() -> &'static RwLock<()> {
    static LIFECYCLE: OnceLock<RwLock<()>> = OnceLock::new();
    LIFECYCLE.get_or_init(|| RwLock::new(()))
}

/// Takes the lifecycle lease when it is free: engines ask for popups on their UI thread, which
/// must never wait on an account change.
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
pub(crate) fn popup_lifecycle_lease() -> Option<RwLockReadGuard<'static, ()>> {
    browser_lifecycle().try_read().ok()
}
