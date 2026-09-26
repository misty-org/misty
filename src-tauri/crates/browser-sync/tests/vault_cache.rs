use misty_browser_sync::{
    crypto::{generate_sync_secret, DeviceKey, VaultRoot, VaultScope},
    document::Document,
    protocol::Workspace,
    store::{CachedVault, Store},
};
use uuid::Uuid;

fn fixture() -> (
    VaultScope,
    VaultRoot,
    DeviceKey,
    CachedVault,
    zeroize::Zeroizing<String>,
) {
    let scope = VaultScope {
        deployment: "https://sync.example.test/v1".into(),
        account_id: "fixture".into(),
        workspace_id: Uuid::new_v4().to_string(),
    };
    let root = VaultRoot::generate();
    let device = DeviceKey::generate();
    let secret = generate_sync_secret();
    let workspace = Workspace {
        workspace_id: scope.workspace_id.clone(),
        key_epoch: 1,
        head_sequence: 0,
        root_public_key: root.public_key().unwrap(),
        key_envelope: root
            .wrap(&scope, "public fixture password", &secret)
            .unwrap(),
    };
    (
        scope,
        root,
        device,
        CachedVault {
            workspace,
            bootstrap_pending: true,
            enrollment_pending: true,
        },
        secret,
    )
}

#[test]
fn interrupted_setup_recovers_same_root_device_and_outbox_without_network() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("workspace.sqlite");
    let (scope, root, device, cached, secret) = fixture();
    let grant = root
        .grant(&scope, &Uuid::new_v4().to_string(), 1, &device)
        .unwrap();
    let device_id = grant.device_id.clone();
    let public = device.public_key();
    let mut store = Store::initialize_vault(
        &path,
        scope.clone(),
        grant,
        &root,
        &device,
        &Document::default().encode().unwrap(),
        Some(&cached),
    )
    .unwrap();
    let operation = store
        .enqueue(&root, &device, b"public offline test mutation")
        .unwrap();
    drop(store);
    drop(root);
    drop(device);
    assert!(Store::read_cached_vault(&path, &scope.deployment, "another-account").is_err());
    assert!(
        Store::read_cached_vault(&path, "https://another.example.test", &scope.account_id).is_err()
    );
    let saved = Store::read_cached_vault(&path, &scope.deployment, &scope.account_id)
        .unwrap()
        .unwrap();
    assert!(saved.bootstrap_pending && saved.enrollment_pending);
    let root = VaultRoot::unlock(
        &scope,
        &saved.workspace.key_envelope,
        "public fixture password",
        &secret,
        &saved.workspace.root_public_key,
    )
    .unwrap();
    let (mut store, device) = Store::unlock(&path, scope, &root).unwrap();
    assert_eq!(store.grant().device_id, device_id);
    assert_eq!(device.public_key(), public);
    assert!(store.pending(false, 1).unwrap()[0] == operation);
    let mut wrong = saved.workspace.clone();
    wrong.root_public_key = VaultRoot::generate().public_key().unwrap();
    assert!(store.confirm_enrollment(&wrong).is_err());
    assert!(store.cached_vault().unwrap().unwrap().bootstrap_pending);
    let mut confirmed = saved.workspace;
    confirmed.head_sequence = 2;
    store.confirm_enrollment(&confirmed).unwrap();
    let settled = store.cached_vault().unwrap().unwrap();
    assert!(!settled.bootstrap_pending && !settled.enrollment_pending);
    assert_eq!(store.observed_head().unwrap(), 2);
    confirmed.head_sequence = 1;
    assert!(store.confirm_enrollment(&confirmed).is_err());
    assert_eq!(
        store.pending_count().unwrap(),
        1,
        "confirmation never drops unsent edits"
    );
    drop(store);
    let data = std::fs::read(path).unwrap();
    for plaintext in [
        secret.as_bytes(),
        b"public fixture password",
        b"public offline test mutation",
    ] {
        assert!(!data.windows(plaintext.len()).any(|part| part == plaintext));
    }
}

#[test]
fn metadata_and_device_creation_roll_back_together() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("workspace.sqlite");
    let (scope, root, device, cached, _secret) = fixture();
    let grant = root
        .grant(&scope, &Uuid::new_v4().to_string(), 1, &device)
        .unwrap();
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection.execute_batch("CREATE TABLE sync_vault(singleton INTEGER PRIMARY KEY,workspace TEXT NOT NULL,bootstrap_pending INTEGER NOT NULL,enrollment_pending INTEGER NOT NULL);
        CREATE TRIGGER fail_metadata BEFORE INSERT ON sync_vault BEGIN SELECT RAISE(ABORT,'fixture disk failure'); END;").unwrap();
    assert!(Store::initialize_vault(
        &path,
        scope.clone(),
        grant.clone(),
        &root,
        &device,
        &Document::default().encode().unwrap(),
        Some(&cached)
    )
    .is_err());
    assert!(
        Store::read_cached_vault(&path, &scope.deployment, &scope.account_id)
            .unwrap()
            .is_none()
    );
    let count: u64 = connection
        .query_row("SELECT count(*) FROM sync_identity", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 0);
    connection
        .execute_batch("DROP TRIGGER fail_metadata;")
        .unwrap();
    let store = Store::initialize_vault(
        &path,
        scope,
        grant,
        &root,
        &device,
        &Document::default().encode().unwrap(),
        Some(&cached),
    )
    .unwrap();
    assert!(store.cached_vault().unwrap().unwrap().bootstrap_pending);
}

#[test]
fn earlier_native_databases_gain_offline_unlock_without_changing_identity_or_pending_edits() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("workspace.sqlite");
    let (scope, root, device, mut cached, _secret) = fixture();
    cached.bootstrap_pending = false;
    let grant = root
        .grant(&scope, &Uuid::new_v4().to_string(), 1, &device)
        .unwrap();
    let mut store = Store::initialize(
        &path,
        scope.clone(),
        grant.clone(),
        &root,
        &device,
        &Document::default().encode().unwrap(),
    )
    .unwrap();
    let pending = store
        .enqueue(&root, &device, b"pending before metadata migration")
        .unwrap();
    drop(store);
    assert!(Store::belongs_to_account(&path, &scope.deployment, &scope.account_id).unwrap());
    assert!(!Store::belongs_to_account(&path, &scope.deployment, "different-account").unwrap());
    assert!(
        Store::read_cached_vault(&path, &scope.deployment, &scope.account_id)
            .unwrap()
            .is_none()
    );
    let (mut store, restored) = Store::unlock(&path, scope.clone(), &root).unwrap();
    assert!(store
        .cache_verified_vault(&VaultRoot::generate(), &cached)
        .is_err());
    assert!(store.cached_vault().unwrap().is_none());
    store.cache_verified_vault(&root, &cached).unwrap();
    assert_eq!(restored.public_key(), device.public_key());
    assert_eq!(store.grant().device_id, grant.device_id);
    assert_eq!(store.allocated_counter().unwrap(), 1);
    assert!(store.pending(false, 1).unwrap()[0] == pending);
    assert_eq!(store.applied_sequence().unwrap(), 0);
    assert!(
        Store::read_cached_vault(&path, &scope.deployment, &scope.account_id)
            .unwrap()
            .is_some()
    );
}
