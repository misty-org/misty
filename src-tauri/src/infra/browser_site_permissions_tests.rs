use super::store::{read_store, sites_for_scope, update_scope};
use super::*;
use objc2_foundation::NSObject;

#[test]
fn temporary_permissions_are_shared_by_store_isolated_and_resettable() {
    // NSObject exercises the same associated-object lifetime as WKWebsiteDataStore
    // without constructing a WebKit view outside the application main thread.
    let session = NSObject::new();
    let other_session = NSObject::new();
    let scope = PermissionScope::Temporary(&*session as *const _ as usize);
    let other_scope = PermissionScope::Temporary(&*other_session as *const _ as usize);
    let origin = "https://example.com";
    let allowed = Permissions {
        camera: Decision::Allow,
        microphone: Decision::Block,
    };
    unsafe {
        let persisted_before = read_store();
        update_scope(&scope, origin, allowed.clone()).unwrap();
        assert_eq!(sites_for_scope(&scope).get(origin), Some(&allowed));
        assert_eq!(decision(&sites_for_scope(&scope)[origin], 0, true), 1);
        assert_eq!(decision(&sites_for_scope(&scope)[origin], 1, true), 2);
        assert!(sites_for_scope(&other_scope).is_empty());
        assert_eq!(read_store(), persisted_before);
        update_scope(&scope, origin, Permissions::default()).unwrap();
        assert!(sites_for_scope(&scope).is_empty());
    }
}

#[test]
fn a_new_temporary_session_does_not_inherit_closed_session_permissions() {
    unsafe {
        {
            let session = NSObject::new();
            let scope = PermissionScope::Temporary(&*session as *const _ as usize);
            update_scope(
                &scope,
                "https://example.com",
                Permissions {
                    camera: Decision::Allow,
                    microphone: Decision::Allow,
                },
            )
            .unwrap();
        }
        let session = NSObject::new();
        let scope = PermissionScope::Temporary(&*session as *const _ as usize);
        assert!(sites_for_scope(&scope).is_empty());
    }
}

#[test]
fn origin_identity_preserves_scheme_host_and_nondefault_port() {
    assert_eq!(
        canonical_origin("https://user:pass@EXAMPLE.com:443/path?q=x").unwrap(),
        "https://example.com"
    );
    assert_eq!(
        canonical_origin("https://example.com:8443/").unwrap(),
        "https://example.com:8443"
    );
    assert_eq!(
        canonical_origin("http://[::1]:3000/").unwrap(),
        "http://[::1]:3000"
    );
    assert!(canonical_origin("file:///tmp/page.html").is_err());
    assert!(canonical_origin("javascript:alert(1)").is_err());
}
#[test]
fn prompts_by_default_and_never_inherits_an_allowance_into_another_origin() {
    assert_eq!(decision(&Permissions::default(), 2, true), 0);
    let allowed = Permissions {
        camera: Decision::Allow,
        microphone: Decision::Allow,
    };
    assert_eq!(decision(&allowed, 2, true), 1);
    assert_eq!(decision(&allowed, 2, false), 0);
    assert_eq!(decision(&allowed, 99, true), 2);
}
#[test]
fn saved_requester_blocks_apply_inside_frames_and_top_blocks_override_requester_allows() {
    let blocked = Permissions {
        camera: Decision::Block,
        microphone: Decision::Ask,
    };
    let allowed = Permissions {
        camera: Decision::Allow,
        microphone: Decision::Allow,
    };
    assert_eq!(
        decision(
            &effective_permissions(&Permissions::default(), &blocked),
            0,
            false
        ),
        2
    );
    assert_eq!(
        decision(&effective_permissions(&blocked, &allowed), 0, false),
        2
    );
    assert_eq!(
        decision(
            &effective_permissions(&Permissions::default(), &allowed),
            0,
            false
        ),
        0
    );
}

#[test]
fn combined_requests_require_both_grants_and_block_wins() {
    let partial = Permissions {
        camera: Decision::Allow,
        microphone: Decision::Ask,
    };
    assert_eq!(decision(&partial, 0, true), 1);
    assert_eq!(decision(&partial, 2, true), 0);
    let blocked = Permissions {
        camera: Decision::Allow,
        microphone: Decision::Block,
    };
    assert_eq!(decision(&blocked, 2, true), 2);
    assert_eq!(decision(&blocked, 1, false), 2);
}
