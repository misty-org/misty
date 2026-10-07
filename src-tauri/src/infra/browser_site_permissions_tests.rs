// Decision rules are tested in Kiri (kiri/src/permissions.rs); these cover
// Misty's stores and profile keys.
use super::store::{read_store, sites_for_scope, update_scope};
use super::*;

#[cfg(target_os = "macos")]
fn throwaway_store() -> objc2::rc::Retained<objc2_foundation::NSObject> {
    // NSObject exercises the same associated-object lifetime as WKWebsiteDataStore
    // without constructing a WebKit view outside the application main thread.
    objc2_foundation::NSObject::new()
}

#[cfg(target_os = "macos")]
fn temporary_scope(store: &objc2_foundation::NSObject) -> StoreScope {
    StoreScope::Temporary(store as *const _ as usize)
}

#[cfg(target_os = "macos")]
#[test]
fn temporary_permissions_are_shared_by_store_isolated_and_resettable() {
    let session = throwaway_store();
    let other_session = throwaway_store();
    let scope = temporary_scope(&session);
    let other_scope = temporary_scope(&other_session);
    let origin = "https://example.com";
    let allowed = Permissions {
        camera: Decision::Allow,
        microphone: Decision::Block,
    };
    unsafe {
        let persisted_before = read_store();
        update_scope(&scope, origin, allowed.clone()).unwrap();
        assert_eq!(sites_for_scope(&scope).get(origin), Some(&allowed));
        assert!(sites_for_scope(&other_scope).is_empty());
        assert_eq!(read_store(), persisted_before);
        update_scope(&scope, origin, Permissions::default()).unwrap();
        assert!(sites_for_scope(&scope).is_empty());
    }
}

#[cfg(target_os = "macos")]
#[test]
fn a_new_temporary_session_does_not_inherit_closed_session_permissions() {
    unsafe {
        {
            let session = throwaway_store();
            update_scope(
                &temporary_scope(&session),
                "https://example.com",
                Permissions {
                    camera: Decision::Allow,
                    microphone: Decision::Allow,
                },
            )
            .unwrap();
        }
        let session = throwaway_store();
        assert!(sites_for_scope(&temporary_scope(&session)).is_empty());
    }
}

#[cfg(not(target_os = "macos"))]
#[test]
fn private_session_permissions_end_with_the_session() {
    let scope = StoreScope::Temporary(0);
    let allowed = Permissions {
        camera: Decision::Allow,
        microphone: Decision::Ask,
    };
    unsafe {
        let persisted_before = read_store();
        update_scope(&scope, "https://example.com", allowed.clone()).unwrap();
        assert_eq!(sites_for_scope(&scope).get("https://example.com"), Some(&allowed));
        assert_eq!(read_store(), persisted_before);
        forget_private_session();
        assert!(sites_for_scope(&scope).is_empty());
    }
}

#[test]
fn profile_keys_match_webkit_store_identifiers() {
    let key = profile_key(Some(&"ab".repeat(32))).unwrap();
    assert_eq!(key, key.to_uppercase());
    assert_eq!(key.len(), 36);
    assert!(profile_key(Some("not-a-profile")).is_err());
}
