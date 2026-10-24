// SPDX-License-Identifier: MIT
use super::*;

fn login(origin: &str) -> crate::document::ViewRecord {
    crate::document::ViewRecord {
        kind: crate::document::entities::Kind::Login,
        id: format!("login:{}", uuid::Uuid::new_v4()),
        fields: std::collections::BTreeMap::from([
            ("origin".into(), serde_json::json!(origin)),
            ("username".into(), serde_json::json!("me@example.test")),
            ("password".into(), serde_json::json!("correct horse")),
            ("created_at".into(), serde_json::json!(1)),
            ("updated_at".into(), serde_json::json!(1)),
        ]),
    }
}

/// A local vault never reaches a server: its API points at a name that cannot resolve, and
/// reads and writes still work, survive the worker, and deletes need no server either.
#[tokio::test]
async fn a_local_vault_keeps_records_without_a_server() {
    let directory = tempfile::tempdir().unwrap();
    let _ = rustls::crypto::ring::default_provider().install_default();
    let path = directory.path().join("local.sqlite");
    let api = SyncApi::new("https://local.misty.invalid", reqwest::Client::new()).unwrap();
    let scope = VaultScope {
        deployment: api.deployment(),
        account_id: "local".into(),
        vault_id: uuid::Uuid::new_v4().to_string(),
    };
    let root = VaultRoot::generate();
    let key = DeviceKey::generate();
    let grant = root
        .grant(&scope, &uuid::Uuid::new_v4().to_string(), 1, &key)
        .unwrap();
    let store = Store::initialize(
        &path,
        scope.clone(),
        grant,
        &root,
        &key,
        &crate::document::Document::default().encode().unwrap(),
    )
    .unwrap();
    let (worker, handle) = Worker::new(
        api.clone(),
        scope.clone(),
        root.duplicate(),
        key,
        store,
        crate::document::reduce,
    )
    .unwrap();
    let task = tokio::spawn(worker.local().run());

    let kept = login("https://kept.test");
    let dropped = login("https://dropped.test");
    handle
        .records_write(
            crate::collections::PASSWORDS.into(),
            vec![
                (kept.id.clone(), Some(kept.clone())),
                (dropped.id.clone(), Some(dropped.clone())),
            ],
        )
        .await
        .unwrap();
    handle
        .records_write(
            crate::collections::PASSWORDS.into(),
            vec![(dropped.id.clone(), None)],
        )
        .await
        .unwrap();
    let (_, records) = handle
        .records_list(crate::collections::PASSWORDS.into())
        .await
        .unwrap();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].id, kept.id);
    assert!(handle
        .records_ready(crate::collections::PASSWORDS.into())
        .await
        .unwrap());
    assert!(handle.status.borrow().phase != Phase::Connecting);

    handle.stop();
    task.await.unwrap().unwrap();

    // Reopened, the record is still there.
    let (store, key) = Store::unlock(&path, scope.clone(), &root).unwrap();
    let (worker, handle) =
        Worker::new(api, scope, root, key, store, crate::document::reduce).unwrap();
    let task = tokio::spawn(worker.local().run());
    let (_, records) = handle
        .records_list(crate::collections::PASSWORDS.into())
        .await
        .unwrap();
    assert_eq!(records.len(), 1);
    handle.stop();
    task.await.unwrap().unwrap();
}
