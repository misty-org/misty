//! Where site permission choices live on Windows and Linux: persistent profiles
//! in a local file, the private session in memory until its last tab closes.
use super::Permissions;
use kiri::engine::StoreScope;
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{Mutex, OnceLock},
};

pub(super) type SitePermissions = BTreeMap<String, Permissions>;
pub(super) type PermissionStore = BTreeMap<String, SitePermissions>;

fn temporary() -> &'static Mutex<BTreeMap<usize, SitePermissions>> {
    static TEMPORARY: OnceLock<Mutex<BTreeMap<usize, SitePermissions>>> = OnceLock::new();
    TEMPORARY.get_or_init(Mutex::default)
}

/// Serializes read/modify/write of the file.
fn file_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(Mutex::default)
}

fn path() -> Option<PathBuf> {
    super::super::paths::misty_home_dir().map(|home| home.join("browser").join("site-permissions.json"))
}

pub(super) fn forget_temporary() {
    if let Ok(mut sessions) = temporary().lock() {
        sessions.clear();
    }
}

fn update_site(sites: &mut SitePermissions, origin: &str, permissions: Permissions) {
    if permissions == Permissions::default() {
        sites.remove(origin);
    } else {
        sites.insert(origin.to_owned(), permissions);
    }
}

/// # Safety
/// Always safe here; `unsafe` matches the WebKit store's signature.
pub(super) unsafe fn sites_for_scope(scope: &StoreScope) -> SitePermissions {
    match scope {
        StoreScope::Persistent(profile) => read_store().remove(profile).unwrap_or_default(),
        StoreScope::Temporary(session) => temporary()
            .lock()
            .ok()
            .and_then(|sessions| sessions.get(session).cloned())
            .unwrap_or_default(),
    }
}

/// # Safety
/// Always safe here; `unsafe` matches the WebKit store's signature.
pub(super) unsafe fn update_scope(
    scope: &StoreScope,
    origin: &str,
    permissions: Permissions,
) -> Result<SitePermissions, String> {
    match scope {
        StoreScope::Persistent(profile) => {
            let _guard = file_lock().lock().map_err(|_| "Site permissions are unavailable.")?;
            let mut store = read_store();
            let sites = store.entry(profile.clone()).or_default();
            update_site(sites, origin, permissions);
            let sites = sites.clone();
            store.retain(|_, sites| !sites.is_empty());
            write_file(&store)?;
            Ok(sites)
        }
        StoreScope::Temporary(session) => {
            let mut sessions = temporary().lock().map_err(|_| "Site permissions are unavailable.")?;
            let sites = sessions.entry(*session).or_default();
            update_site(sites, origin, permissions);
            Ok(sites.clone())
        }
    }
}

pub(super) fn read_store() -> PermissionStore {
    path()
        .and_then(|path| std::fs::read(path).ok())
        .and_then(|raw| serde_json::from_slice(&raw).ok())
        .unwrap_or_default()
}

pub(super) fn write_store(store: &PermissionStore) -> Result<(), String> {
    let _guard = file_lock().lock().map_err(|_| "Site permissions are unavailable.")?;
    write_file(store)
}

fn write_file(store: &PermissionStore) -> Result<(), String> {
    let path = path().ok_or("Misty's data folder is unavailable.")?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let data = serde_json::to_vec(store).map_err(|error| error.to_string())?;
    // Replace atomically so a crash never leaves half a file.
    let staging = path.with_extension("json.tmp");
    std::fs::write(&staging, data).map_err(|error| error.to_string())?;
    std::fs::rename(&staging, &path).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use kiri::permissions::Decision;

    #[test]
    fn private_choices_stay_in_memory_until_the_session_ends() {
        let scope = StoreScope::Temporary(7);
        let allowed = Permissions {
            camera: Decision::Allow,
            microphone: Decision::Ask,
        };
        unsafe {
            let persisted_before = read_store();
            let sites = update_scope(&scope, "https://example.com", allowed.clone()).unwrap();
            assert_eq!(sites.get("https://example.com"), Some(&allowed));
            assert_eq!(sites_for_scope(&scope).get("https://example.com"), Some(&allowed));
            assert_eq!(read_store(), persisted_before);
            update_scope(&scope, "https://example.com", Permissions::default()).unwrap();
            assert!(sites_for_scope(&scope).is_empty());
            update_scope(&scope, "https://example.com", allowed).unwrap();
            forget_temporary();
            assert!(sites_for_scope(&scope).is_empty());
        }
    }
}
