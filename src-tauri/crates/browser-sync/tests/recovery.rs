use misty_browser_sync::{
    crypto::{VaultRoot, VaultScope},
    recovery::RecoveryStore,
};

fn scope() -> VaultScope {
    VaultScope {
        deployment: "https://example.test".into(),
        account_id: "owner".into(),
        workspace_id: "d32b3d14-d7b6-4d4c-a674-d36bb5aefb74".into(),
    }
}

#[test]
fn recovery_encrypts_database_and_wal_and_skips_unchanged_writes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("recovery.sqlite");
    let mut store = RecoveryStore::open(&path, scope(), VaultRoot::generate()).unwrap();
    let secret = "private-workspace-url-and-title-0123456789";
    assert_eq!(store.write("workspace", 0, secret).unwrap().revision, 1);
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute_batch("CREATE TRIGGER forbid_write BEFORE INSERT ON recovery_records BEGIN SELECT RAISE(FAIL,'unexpected write'); END;").unwrap();
    assert_eq!(store.write("workspace", 0, secret).unwrap().revision, 1);
    assert_eq!(store.write("workspace", 1, secret).unwrap().revision, 1);
    assert!(store.write("workspace", 1, "new value").is_err());
    assert_eq!(store.read("workspace").unwrap().unwrap().value, secret);
    for name in ["recovery.sqlite", "recovery.sqlite-wal"] {
        if let Ok(bytes) = std::fs::read(dir.path().join(name)) {
            assert!(!bytes.windows(secret.len()).any(|v| v == secret.as_bytes()));
        }
    }
}

#[test]
fn restart_requires_same_key_and_account_and_retries_lost_ack() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("recovery.sqlite");
    let s = scope();
    let root = VaultRoot::generate();
    let secret = misty_browser_sync::crypto::generate_sync_secret();
    let wrapped = root.wrap(&s, "fixture-password", &secret).unwrap();
    let public = root.public_key().unwrap();
    let mut store = RecoveryStore::open(&path, s.clone(), root).unwrap();
    store.write("workspace", 0, "first").unwrap();
    drop(store);
    assert!(RecoveryStore::open(&path, s.clone(), VaultRoot::generate()).is_err());
    let restore = || VaultRoot::unlock(&s, &wrapped, "fixture-password", &secret, &public).unwrap();
    let mut other = s.clone();
    other.account_id = "other-account".into();
    assert!(RecoveryStore::open(&path, other, restore()).is_err());
    let mut store = RecoveryStore::open(&path, s.clone(), restore()).unwrap();
    assert_eq!(store.write("workspace", 0, "first").unwrap().revision, 1);
    store.write("workspace", 1, "second").unwrap();
    assert!(store.write("workspace", 0, "stale").is_err());
    assert_eq!(store.read("workspace").unwrap().unwrap().value, "second");
}

#[test]
fn ciphertext_cannot_be_moved_between_records_or_revisions_and_archives_are_immutable() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("recovery.sqlite");
    let mut store = RecoveryStore::open(&path, scope(), VaultRoot::generate()).unwrap();
    store.write("workspace", 0, "private").unwrap();
    store.write("archive:original", 0, "legacy raw").unwrap();
    assert!(store.write("archive:original", 1, "replacement").is_err());
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute("INSERT INTO recovery_records SELECT 'other',revision,envelope FROM recovery_records WHERE record_key='workspace'", []).unwrap();
    assert!(store.read("other").is_err());
    db.execute(
        "UPDATE recovery_records SET revision=revision+1 WHERE record_key='workspace'",
        [],
    )
    .unwrap();
    assert!(store.read("workspace").is_err());
}
