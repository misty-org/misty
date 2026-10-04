//! Where site permission choices live: persistent profiles in user defaults,
//! private sessions on their own website-data store.
use super::{PermissionScope, Permissions};
use objc2_foundation::{NSString, NSUserDefaults};
use std::collections::BTreeMap;

const PREFERENCES_KEY: &str = "misty.browser.site-permissions.v1";
static TEMPORARY_PERMISSIONS_KEY: u8 = 0;

unsafe extern "C" {
    fn objc_getAssociatedObject(
        object: *mut objc::runtime::Object,
        key: *const std::ffi::c_void,
    ) -> *mut objc::runtime::Object;
    fn objc_setAssociatedObject(
        object: *mut objc::runtime::Object,
        key: *const std::ffi::c_void,
        value: *mut objc::runtime::Object,
        policy: usize,
    );
}

pub(super) type SitePermissions = BTreeMap<String, Permissions>;
pub(super) type PermissionStore = BTreeMap<String, SitePermissions>;

// The website-data store owns these choices. Nothing is written to defaults or
// sync; releasing the private session's store releases its permissions too.
unsafe fn temporary_sites(store: *const objc::runtime::Object) -> SitePermissions {
    let value = objc_getAssociatedObject(
        store.cast_mut(),
        (&TEMPORARY_PERMISSIONS_KEY as *const u8).cast(),
    );
    value
        .cast::<NSString>()
        .as_ref()
        .and_then(|value| serde_json::from_str(&value.to_string()).ok())
        .unwrap_or_default()
}

unsafe fn set_temporary_sites(
    store: *const objc::runtime::Object,
    sites: &SitePermissions,
) -> Result<(), String> {
    let value =
        NSString::from_str(&serde_json::to_string(sites).map_err(|error| error.to_string())?);
    objc_setAssociatedObject(
        store.cast_mut(),
        (&TEMPORARY_PERMISSIONS_KEY as *const u8).cast(),
        if sites.is_empty() {
            std::ptr::null_mut()
        } else {
            (&*value as *const NSString).cast_mut().cast()
        },
        1, // OBJC_ASSOCIATION_RETAIN_NONATOMIC; all access is on the main thread.
    );
    Ok(())
}

fn update_site(sites: &mut SitePermissions, origin: &str, permissions: Permissions) {
    if permissions == Permissions::default() {
        sites.remove(origin);
    } else {
        sites.insert(origin.to_owned(), permissions);
    }
}

pub(super) unsafe fn sites_for_scope(scope: &PermissionScope) -> SitePermissions {
    match scope {
        PermissionScope::Persistent(profile) => read_store().remove(profile).unwrap_or_default(),
        PermissionScope::Temporary(store) => {
            temporary_sites(*store as *const objc::runtime::Object)
        }
    }
}

pub(super) unsafe fn update_scope(
    scope: &PermissionScope,
    origin: &str,
    permissions: Permissions,
) -> Result<SitePermissions, String> {
    let mut sites = sites_for_scope(scope);
    update_site(&mut sites, origin, permissions);
    match scope {
        PermissionScope::Persistent(profile) => {
            let mut store = read_store();
            store.insert(profile.clone(), sites.clone());
            write_store(&store)?;
        }
        PermissionScope::Temporary(store) => {
            set_temporary_sites(*store as *const objc::runtime::Object, &sites)?;
        }
    }
    Ok(sites)
}

pub(super) fn read_store() -> PermissionStore {
    NSUserDefaults::standardUserDefaults()
        .stringForKey(&NSString::from_str(PREFERENCES_KEY))
        .and_then(|raw| serde_json::from_str(&raw.to_string()).ok())
        .unwrap_or_default()
}

pub(super) fn write_store(store: &PermissionStore) -> Result<(), String> {
    let data = serde_json::to_string(store).map_err(|error| error.to_string())?;
    unsafe {
        NSUserDefaults::standardUserDefaults().setObject_forKey(
            Some(&NSString::from_str(&data)),
            &NSString::from_str(PREFERENCES_KEY),
        );
    }
    Ok(())
}
