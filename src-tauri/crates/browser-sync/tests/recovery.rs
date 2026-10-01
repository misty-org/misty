use misty_browser_sync::{
    crypto::{VaultRoot, VaultScope},
    recovery::RecoveryStore,
};

fn scope() -> VaultScope {
    VaultScope {
        deployment: "https://example.test".into(),
        account_id: "owner".into(),
        vault_id: "d32b3d14-d7b6-4d4c-a674-d36bb5aefb74".into(),
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
    // The database refuses this write, so it waits encrypted in a pending slot.
    let waiting = store.write("workspace", 1, "new value").unwrap();
    assert!(waiting.pending);
    assert_eq!(waiting.revision, 1);
    assert_eq!(store.read("workspace").unwrap().unwrap().value, "new value");
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

#[test]
fn old_archives_are_retired_so_saving_never_stops_at_the_record_cap() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("recovery.sqlite");
    let mut store = RecoveryStore::open(&path, scope(), VaultRoot::generate()).unwrap();
    store.write("workspace", 0, "first").unwrap();
    for n in 0..300 {
        store
            .write(&format!("archive:{n:04}"), 0, &format!("original {n}"))
            .unwrap();
    }
    // The newest originals survive; the oldest were retired to make room.
    assert!(store.read("archive:0299").unwrap().is_some());
    assert!(store.read("archive:0000").unwrap().is_none());
    // Live records keep saving and a new live key still fits.
    assert_eq!(store.write("workspace", 1, "second").unwrap().revision, 2);
    assert_eq!(store.write("before-sync", 0, "kept").unwrap().revision, 1);
    let db = rusqlite::Connection::open(&path).unwrap();
    let archives: u64 = db
        .query_row(
            "SELECT count(*) FROM recovery_records WHERE record_key LIKE 'archive:%'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(archives <= 32);
}

fn failing_inserts(path: &std::path::Path, on: bool) {
    let db = rusqlite::Connection::open(path).unwrap();
    db.execute_batch(if on {
        "CREATE TRIGGER fail_insert BEFORE INSERT ON recovery_records BEGIN SELECT RAISE(FAIL,'disk'); END;
         CREATE TRIGGER fail_update BEFORE UPDATE ON recovery_records BEGIN SELECT RAISE(FAIL,'disk'); END;"
    } else {
        "DROP TRIGGER fail_insert; DROP TRIGGER fail_update;"
    })
    .unwrap();
}

fn slots(dir: &std::path::Path) -> usize {
    std::fs::read_dir(dir.join("recovery-pending"))
        .map(|entries| entries.count())
        .unwrap_or(0)
}

#[test]
fn failed_saves_wait_in_one_encrypted_slot_per_key_and_replay_once() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("recovery.sqlite");
    let mut store = RecoveryStore::open(&path, scope(), VaultRoot::generate()).unwrap();
    store.write("workspace", 0, "first").unwrap();
    failing_inserts(&path, true);
    let secret = "pending-private-url-0123456789";
    for attempt in ["second", "third", secret] {
        let record = store.write("workspace", 1, attempt).unwrap();
        assert!(record.pending);
        assert_eq!(record.revision, 1);
    }
    // Repeated failures replace one slot; they never pile up.
    assert_eq!(slots(dir.path()), 1);
    assert_eq!(store.pending_keys().unwrap(), vec!["workspace".to_string()]);
    let bytes = std::fs::read_dir(dir.path().join("recovery-pending"))
        .unwrap()
        .map(|e| std::fs::read(e.unwrap().path()).unwrap())
        .next()
        .unwrap();
    assert!(!bytes.windows(secret.len()).any(|v| v == secret.as_bytes()));
    let read = store.read("workspace").unwrap().unwrap();
    assert!(read.pending);
    assert_eq!((read.revision, read.value.as_str()), (1, secret));
    failing_inserts(&path, false);
    // Replay on the next write lands the pending save exactly once.
    let landed = store.write("workspace", 1, secret).unwrap();
    assert!(!landed.pending);
    assert_eq!(landed.revision, 2);
    assert_eq!(slots(dir.path()), 0);
    assert!(store.pending_keys().unwrap().is_empty());
}

#[test]
fn pending_saves_replay_when_the_store_reopens() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("recovery.sqlite");
    let root = VaultRoot::generate();
    let secret = misty_browser_sync::crypto::generate_sync_secret();
    let wrapped = root.wrap(&scope(), "fixture-password", &secret).unwrap();
    let public = root.public_key().unwrap();
    let reopen =
        || VaultRoot::unlock(&scope(), &wrapped, "fixture-password", &secret, &public).unwrap();
    let mut store = RecoveryStore::open(&path, scope(), root).unwrap();
    store.write("workspace", 0, "saved").unwrap();
    failing_inserts(&path, true);
    assert!(store.write("workspace", 1, "waiting").unwrap().pending);
    drop(store);
    failing_inserts(&path, false);
    let mut store = RecoveryStore::open(&path, scope(), reopen()).unwrap();
    let read = store.read("workspace").unwrap().unwrap();
    assert_eq!(
        (read.revision, read.value.as_str(), read.pending),
        (2, "waiting", false)
    );
    assert_eq!(slots(dir.path()), 0);
}
