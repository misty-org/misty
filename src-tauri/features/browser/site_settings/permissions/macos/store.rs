//! Where site permission choices live on macOS: persistent profiles in `misty.db`. A private
//! session keeps none.
use crate::browser::site_settings::permissions::Permissions;
use kiri::engine::StoreScope as PermissionScope;
use std::collections::BTreeMap;

pub(in crate::browser::site_settings::permissions) type SitePermissions =
    BTreeMap<String, Permissions>;
pub(in crate::browser::site_settings::permissions) type PermissionStore =
    BTreeMap<String, SitePermissions>;

/// # Safety
/// Always safe; `unsafe` keeps the signature engines call it with on the main thread.
pub(in crate::browser::site_settings::permissions) unsafe fn sites_for_scope(
    scope: &PermissionScope,
) -> SitePermissions {
    match scope {
        PermissionScope::Persistent(profile) => read_store().remove(profile).unwrap_or_default(),
        PermissionScope::Temporary(_) => SitePermissions::new(),
    }
}

pub(in crate::browser::site_settings::permissions) fn read_store() -> PermissionStore {
    crate::browser::site_settings::permissions::db::read_all()
}

pub(in crate::browser::site_settings::permissions) fn write_store(
    store: &PermissionStore,
) -> Result<(), String> {
    crate::browser::site_settings::permissions::db::write_all(store)
}
