use super::*;
#[cfg(any(target_os = "macos", windows))]
#[test]
fn background_restore_never_replaces_open_pages() {
    for label in [
        "misty-browser-tab-one",
        "misty-browser-popup-one",
        "misty-browser-partial",
    ] {
        assert_eq!(
            check_restore_mode(RestoreMode::Background, [label].into_iter()),
            Err(RESTORE_DEFERRED.into())
        );
        assert!(check_restore_mode(RestoreMode::Explicit, [label].into_iter()).is_ok());
    }
    assert!(check_restore_mode(
        RestoreMode::Background,
        [
            "space-personal",
            "misty-browser-capture-one",
            "misty-browser-storage-one"
        ]
        .into_iter()
    )
    .is_ok());
}
#[test]
fn initial_capture_deduplicates_pending_data_and_never_replaces_a_received_version() {
    let profile = "a".repeat(64);
    let mut document = Document::default();
    let payload = serde_json::json!([{
        "name": "session", "value": "synthetic", "domain": ".example.test", "path": "/",
        "host_only": false, "secure": true, "http_only": true, "same_site": "lax",
        "expires_unix_seconds": null, "partition_key": null,
    }]);
    let Some(Payload::Credentials { batch, .. }) =
        initial_capture(&document, &profile, payload.clone()).unwrap()
    else {
        panic!("missing initial capture");
    };
    assert_eq!(batch.updates[0].base_sequence, 0);
    let key = Area::Cookies.key(&profile).unwrap();
    document.credentials.insert(
        key.clone(),
        CredentialRecord {
            profile_id: profile.clone(),
            sequence: 10,
            area: Area::Cookies,
            payload: payload.clone(),
        },
    );
    let mut equivalent = payload.clone();
    equivalent[0]["domain"] = serde_json::json!("example.test");
    assert!(initial_capture(&document, &profile, equivalent)
        .unwrap()
        .is_none());
    // Native logout is not allowed to erase a received credential version.
    assert!(initial_capture(&document, &profile, serde_json::json!([])).is_err());
    // Neither may an old local token resurrect a remotely logged-out profile.
    document.credentials.get_mut(&key).unwrap().payload = serde_json::json!([]);
    assert!(initial_capture(&document, &profile, payload).is_err());
}
#[test]
fn restore_requires_captured_supported_data_but_allows_explicit_logout() {
    let profile = "a".repeat(64);
    let mut document = Document::default();
    assert!(cookie_target(&document, &profile).is_err());
    let key = Area::Cookies.key(&profile).unwrap();
    document.credentials.insert(
        key.clone(),
        CredentialRecord {
            sequence: 1,
            profile_id: profile.clone(),
            area: Area::Cookies,
            payload: serde_json::json!([]),
        },
    );
    assert_eq!(cookie_target(&document, &profile).unwrap().len(), 1);
    document.credentials.get_mut(&key).unwrap().area = Area::LocalStorage {
        origin: "https://example.test".into(),
    };
    assert!(cookie_target(&document, &profile).is_err());
    assert!(cookie_target(&document, &"b".repeat(64)).is_err());
}
