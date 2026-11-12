//! Where site permission choices live on Windows and Linux: persistent profiles in `misty.db`. A
//! private session keeps none.
use super::Permissions;
use kiri::engine::StoreScope;
use std::{
    collections::BTreeMap,
    sync::{Mutex, OnceLock},
};

pub(super) type SitePermissions = BTreeMap<String, Permissions>;
pub(super) type PermissionStore = BTreeMap<String, SitePermissions>;

/// Serializes writes of the stored choices.
fn file_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(Mutex::default)
}

/// # Safety
/// Always safe here; `unsafe` matches the WebKit store's signature.
pub(super) unsafe fn sites_for_scope(scope: &StoreScope) -> SitePermissions {
    match scope {
        StoreScope::Persistent(profile) => read_store().remove(profile).unwrap_or_default(),
        StoreScope::Temporary(_) => SitePermissions::new(),
    }
}

pub(super) fn read_store() -> PermissionStore {
    super::db::read_all()
}

pub(super) fn write_store(store: &PermissionStore) -> Result<(), String> {
    let _guard = file_lock()
        .lock()
        .map_err(|_| "Site permissions are unavailable.")?;
    super::db::write_all(store)
}
