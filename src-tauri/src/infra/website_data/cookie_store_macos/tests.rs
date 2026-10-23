use super::*;

fn fixture() -> Cookie {
    Cookie {
        name: "session".into(),
        value: "synthetic-only".into(),
        domain: "example.test".into(),
        path: "/".into(),
        host_only: true,
        secure: true,
        http_only: true,
        same_site: Some(SameSite::Lax),
        expires_unix_seconds: None,
        partition_key: None,
    }
}

fn tomorrow() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
        + 86_400
}

#[test]
fn refuses_host_authentication_views_and_invalid_profile_handles() {
    assert_eq!(
        expected_profile("space-personal", &"a".repeat(64)),
        Err(CookieStoreError::Profile)
    );
    assert_eq!(
        expected_profile("misty-browser-test", "../profile"),
        Err(CookieStoreError::Profile)
    );
    assert_eq!(
        expected_profile("misty-browser-test", &"a".repeat(64)),
        Ok([0xaa; 16])
    );
}

#[test]
fn foundation_round_trip_preserves_domain_and_session_security() {
    objc2::rc::autoreleasepool(|_| {
        for domain in ["example.test", ".example.test"] {
            for expires in [None, Some(tomorrow())] {
                for policy in [
                    Some(SameSite::Lax),
                    Some(SameSite::Strict),
                    Some(SameSite::None),
                    None,
                ] {
                    for secure in [true, false] {
                        if !secure && matches!(policy, Some(SameSite::None)) {
                            continue;
                        }
                        for http_only in [true, false] {
                            let mut cookie = fixture();
                            cookie.domain = domain.into();
                            cookie.host_only = !domain.starts_with('.');
                            cookie.expires_unix_seconds = expires;
                            cookie.same_site = policy.clone();
                            cookie.secure = secure;
                            cookie.http_only = http_only;
                            let native = import_cookie(&cookie).expect("lossless cookie import");
                            let mut exported = export_cookie(&native).unwrap();
                            if matches!(policy, Some(SameSite::None)) {
                                // Reported as nil; callers align it with the synced copy.
                                assert!(exported.same_site.is_none());
                                exported.same_site = policy.clone();
                            }
                            assert!(equal(&cookie, &exported).unwrap());
                        }
                    }
                }
            }
        }
    });
}

#[test]
fn rejects_silent_expiry_shortening() {
    let mut cookie = fixture();
    cookie.expires_unix_seconds = Some(tomorrow() + 10 * 365 * 86_400);
    assert!(matches!(
        import_cookie(&cookie),
        Err(CookieStoreError::Unsupported)
    ));
    assert!(!representable(&cookie));
}

#[test]
fn cookies_without_same_site_or_secure_are_captured_as_unspecified() {
    // `document.cookie = "a=1"`: Foundation reports no SameSite policy.
    let mut cookie = fixture();
    cookie.secure = false;
    cookie.same_site = None;
    let native = import_cookie(&cookie).expect("unspecified SameSite imports");
    let exported = export_cookie(&native).unwrap();
    assert!(exported.same_site.is_none());
    assert!(equal(&cookie, &exported).unwrap());
}

#[test]
fn refuses_to_drop_native_partition_and_port_restrictions() {
    for (key, value) in [
        (
            ns_string!("StoragePartition"),
            ns_string!("https://top.example.test"),
        ),
        (
            unsafe { objc2_foundation::NSHTTPCookiePort },
            ns_string!("443"),
        ),
    ] {
        let native = import_cookie(&fixture()).unwrap();
        let properties =
            NSMutableDictionary::dictionaryWithDictionary(&native.properties().unwrap());
        properties.insert(key, value);
        unsafe {
            properties.insert(NSHTTPCookieVersion, ns_string!("1"));
        }
        let native = unsafe { NSHTTPCookie::cookieWithProperties(&properties) }.unwrap();
        assert!(matches!(
            export_cookie(&native),
            Err(CookieStoreError::Unsupported)
        ));
    }
}

#[test]
fn rejects_partitioned_and_invalid_cookies_before_mutating_the_store() {
    let mut cookie = fixture();
    cookie.partition_key = Some(misty_browser_sync::document::credentials::PartitionKey {
        top_level_site: "https://example.test".into(),
        has_cross_site_ancestor: false,
    });
    assert!(matches!(
        import_cookie(&cookie),
        Err(CookieStoreError::Unsupported)
    ));
    cookie.partition_key = None;
    cookie.name = "bad\r\nname".into();
    assert!(matches!(
        import_cookie(&cookie),
        Err(CookieStoreError::Invalid)
    ));
}
