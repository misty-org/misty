use super::*;
#[test]
fn rejected_edits_do_not_emit_unchanged_status_and_trigger_retries() {
    let directory = tempfile::tempdir().unwrap();
    let _ = rustls::crypto::ring::default_provider().install_default();
    let api = SyncApi::new("http://127.0.0.1", reqwest::Client::new()).unwrap();
    let scope = VaultScope {
        deployment: api.deployment(),
        account_id: "fixture".into(),
        vault_id: uuid::Uuid::new_v4().to_string(),
    };
    let root = VaultRoot::generate();
    let key = DeviceKey::generate();
    let grant = root
        .grant(&scope, &uuid::Uuid::new_v4().to_string(), 1, &key)
        .unwrap();
    let store = Store::initialize(
        &directory.path().join("sync.sqlite"),
        scope.clone(),
        grant,
        &root,
        &key,
        &crate::document::Document::default().encode().unwrap(),
    )
    .unwrap();
    let (mut worker, mut handle) =
        Worker::new(api, scope, root, key, store, crate::document::reduce).unwrap();
    handle.status.borrow_and_update();
    for _ in 0..10 {
        let (reply, mut result) = oneshot::channel();
        worker
            .command(Some(Command::Enqueue(
                uuid::Uuid::new_v4().to_string(),
                Zeroizing::new(b"invalid edit".to_vec()),
                reply,
            )))
            .unwrap();
        assert!(result.try_recv().unwrap().is_err());
        assert!(
            !handle.status.has_changed().unwrap(),
            "a rejected edit must not notify the renderer to retry itself"
        );
    }
    worker.report(Phase::Connecting, None).unwrap();
    assert!(handle.status.has_changed().unwrap());
    handle.status.borrow_and_update();
    worker.report(Phase::Connecting, None).unwrap();
    assert!(!handle.status.has_changed().unwrap());
    worker
        .report(Phase::Attention, Some("fixture_failure"))
        .unwrap();
    assert!(handle.status.has_changed().unwrap());
}

#[test]
fn remote_activation_claims_once_and_ignores_expired_or_independent_requests() {
    let directory = tempfile::tempdir().unwrap();
    let _ = rustls::crypto::ring::default_provider().install_default();
    let api = SyncApi::new("http://127.0.0.1", reqwest::Client::new()).unwrap();
    let scope = VaultScope {
        deployment: api.deployment(),
        account_id: "fixture".into(),
        vault_id: uuid::Uuid::new_v4().to_string(),
    };
    let root = VaultRoot::generate();
    let key = DeviceKey::generate();
    let grant = root
        .grant(&scope, &uuid::Uuid::new_v4().to_string(), 1, &key)
        .unwrap();
    let store = Store::initialize(
        &directory.path().join("sync.sqlite"),
        scope.clone(),
        grant.clone(),
        &root,
        &key,
        &crate::document::Document::default().encode().unwrap(),
    )
    .unwrap();
    let (mut worker, handle) =
        Worker::new(api, scope, root, key, store, crate::document::reduce).unwrap();
    // Decode the real flattened wire format, including optional controls.
    let mut json = serde_json::to_value(&grant).unwrap();
    json["last_counter"] = 0.into();
    json["revoked_at"] = serde_json::Value::Null;
    let legacy: Device = serde_json::from_value(json.clone()).unwrap();
    assert!(legacy.full_sync);
    let request = uuid::Uuid::new_v4().to_string();
    json["activation_request"] = request.clone().into();
    json["activation_expires_at"] = 1u64.into();
    worker
        .update_roster(vec![serde_json::from_value(json.clone()).unwrap()])
        .unwrap();
    assert!(worker.workspace_outbox.is_empty());
    json["activation_expires_at"] = (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
        + 30000)
        .into();
    json["full_sync"] = false.into();
    worker
        .update_roster(vec![serde_json::from_value(json.clone()).unwrap()])
        .unwrap();
    assert!(worker.workspace_outbox.is_empty());
    assert!(!handle.devices.borrow()[0].full_sync);
    json["full_sync"] = true.into();
    // Existing clients ignore the additive metadata, including the flattened grant.
    #[derive(serde::Deserialize)]
    struct LegacyDevice {
        #[serde(flatten)]
        grant: crate::protocol::DeviceGrant,
        last_counter: u64,
        revoked_at: Option<String>,
    }
    let older: LegacyDevice = serde_json::from_value(json.clone()).unwrap();
    assert_eq!(older.grant.device_id, grant.device_id);
    assert_eq!(older.last_counter, 0);
    assert!(older.revoked_at.is_none());
    for _ in 0..2 {
        worker
            .update_roster(vec![serde_json::from_value(json.clone()).unwrap()])
            .unwrap();
    }
    // One signed claim reusing the request ID; the device's own workspace is
    // the default target when the request names none.
    assert_eq!(worker.workspace_outbox.len(), 1);
    match &worker.workspace_outbox[0] {
        Outgoing::Claim { claim, .. } => {
            assert_eq!(claim.operation_id, request);
            assert_eq!(claim.workspace_id, grant.device_id);
        }
        _ => panic!("expected a tree claim"),
    }
    assert!(worker.store.pending(true, 10).unwrap().is_empty());
}
