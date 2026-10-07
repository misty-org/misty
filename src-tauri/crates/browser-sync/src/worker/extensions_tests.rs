// SPDX-License-Identifier: MIT
use super::*;

#[test]
fn extension_values_are_durable_but_never_in_renderer_collection_snapshots() {
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
    let (mut worker, _handle) =
        Worker::new(api, scope, root, key, store, crate::document::reduce).unwrap();
    let id = "extension-key".to_owned();
    let record = crate::document::ViewRecord {
        kind: crate::document::entities::Kind::ExtensionSyncKey,
        id: id.clone(),
        fields: std::collections::BTreeMap::from([
            ("extension".into(), serde_json::json!("fixture@misty.test")),
            (
                "generation".into(),
                serde_json::json!(uuid::Uuid::new_v4().to_string()),
            ),
            ("key".into(), serde_json::json!("fixture")),
            (
                "change".into(),
                serde_json::json!({"value":"private-extension-value"}),
            ),
        ]),
    };
    worker
        .records_write(crate::collections::EXTENSION_SYNC, vec![(id, Some(record))])
        .unwrap();
    assert_eq!(
        worker
            .records_list(crate::collections::EXTENSION_SYNC)
            .unwrap()
            .1
            .len(),
        1
    );
    let renderer = worker.collections_view().unwrap();
    assert!(!renderer.contains_key(crate::collections::EXTENSION_SYNC));
    assert!(!serde_json::to_string(&renderer)
        .unwrap()
        .contains("private-extension-value"));
}
