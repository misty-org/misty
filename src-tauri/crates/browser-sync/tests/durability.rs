use misty_browser_sync::{
    crypto::{DeviceKey, VaultRoot, VaultScope},
    protocol::{DeviceGrant, Event, Mutation, Receipt},
    store::Store,
    Error,
};
use rusqlite::Connection;
use tempfile::TempDir;
use uuid::Uuid;
use zeroize::Zeroizing;

fn scope() -> VaultScope {
    VaultScope {
        deployment: "https://sync.example.test".into(),
        account_id: "account-fixture".into(),
        workspace_id: Uuid::new_v4().to_string(),
    }
}

fn add(
    state: &[u8],
    payload: &[u8],
    _: &misty_browser_sync::protocol::EventContext,
) -> misty_browser_sync::Result<Zeroizing<Vec<u8>>> {
    let mut result = state.to_vec();
    result.extend_from_slice(payload);
    Ok(Zeroizing::new(result))
}

fn event(mutation: Mutation, sequence: u64, grant: &DeviceGrant) -> (Event, DeviceGrant) {
    (Event { mutation, sequence }, grant.clone())
}

#[test]
fn restart_lost_ack_and_replay_preserve_exact_operation_and_counter() {
    let temp = TempDir::new().unwrap();
    let path = temp.path().join("sync.sqlite");
    let root = VaultRoot::generate();
    let device = DeviceKey::generate();
    let scope = scope();
    let grant = root
        .grant(&scope, &Uuid::new_v4().to_string(), 1, &device)
        .unwrap();
    let mut store = Store::initialize(
        &path,
        scope.clone(),
        grant.clone(),
        &root,
        &device,
        b"initial:",
    )
    .unwrap();
    let mutation = store
        .enqueue(&root, &device, b"fixture-cookie-not-plaintext-on-disk")
        .unwrap();
    let encoded = serde_json::to_string(&mutation).unwrap();
    assert_eq!(mutation.device_counter, 1);
    drop(store);
    let (mut store, recovered_device) = Store::unlock(&path, scope.clone(), &root).unwrap();
    assert_eq!(device.public_key(), recovered_device.public_key());
    assert_eq!(
        serde_json::to_string(&store.pending(true, 1).unwrap()[0]).unwrap(),
        encoded
    );
    let receipt = Receipt {
        discarded: false,
        operation_id: mutation.operation_id.clone(),
        sequence: 1,
    };
    store.acknowledge(&receipt).unwrap();
    assert_eq!(store.observed_head().unwrap(), 1);
    assert!(store.pending(true, 10).unwrap().is_empty());
    assert_eq!(
        store.pending(false, 10).unwrap().len(),
        1,
        "ack must not discard the optimistic edit before replay"
    );
    drop(store);
    let (mut store, recovered_device) = Store::unlock(&path, scope, &root).unwrap();
    assert_eq!(
        store.observed_head().unwrap(),
        1,
        "restart must preserve a head learned from an acknowledgment before replay"
    );
    let page = [event(mutation, 1, &grant)];
    store.apply_events(&root, &page, add).unwrap();
    assert!(store.pending(false, 10).unwrap().is_empty());
    assert_eq!(store.applied_sequence().unwrap(), 1);
    assert_eq!(
        &**store.committed_snapshot(&root).unwrap(),
        b"initial:fixture-cookie-not-plaintext-on-disk"
    );
    store.acknowledge(&receipt).unwrap(); // acknowledgment can arrive after replay
    store
        .apply_events(&root, &page, |_, _, _| {
            panic!("duplicate replay must not reduce twice")
        })
        .unwrap();
    assert_eq!(
        store
            .enqueue(&root, &recovered_device, b"second")
            .unwrap()
            .device_counter,
        2
    );
    for name in ["sync.sqlite", "sync.sqlite-wal", "sync.sqlite-shm"] {
        if let Ok(bytes) = std::fs::read(temp.path().join(name)) {
            assert!(!bytes
                .windows(b"fixture-cookie-not-plaintext-on-disk".len())
                .any(|b| b == b"fixture-cookie-not-plaintext-on-disk"));
        }
    }
}

#[test]
fn transaction_failure_leaves_outbox_counter_and_applied_cursor_unchanged() {
    let temp = TempDir::new().unwrap();
    let path = temp.path().join("sync.sqlite");
    let root = VaultRoot::generate();
    let device = DeviceKey::generate();
    let scope = scope();
    let grant = root
        .grant(&scope, &Uuid::new_v4().to_string(), 1, &device)
        .unwrap();
    let mut store = Store::initialize(&path, scope, grant.clone(), &root, &device, b"").unwrap();
    let inspection = Connection::open(&path).unwrap();
    inspection.execute_batch("CREATE TRIGGER fail_counter BEFORE UPDATE OF next_counter ON sync_identity BEGIN SELECT RAISE(ABORT, 'fixture'); END;").unwrap();
    assert!(store.enqueue(&root, &device, b"first").is_err());
    assert!(store.pending(false, 10).unwrap().is_empty());
    inspection
        .execute_batch("DROP TRIGGER fail_counter;")
        .unwrap();
    let a = store.enqueue(&root, &device, b"first").unwrap();
    assert_eq!(a.device_counter, 1);
    let b = store.enqueue(&root, &device, b"second").unwrap();
    let page = [event(a, 1, &grant), event(b, 2, &grant)];
    assert!(store
        .apply_events(&root, &page, |state, payload, seq| {
            if seq.sequence == 2 {
                Err(Error::Invalid)
            } else {
                add(state, payload, seq)
            }
        })
        .is_err());
    assert_eq!(store.applied_sequence().unwrap(), 0);
    assert_eq!(store.pending(false, 10).unwrap().len(), 2);
    assert!(store.committed_snapshot(&root).unwrap().is_empty());
    inspection.execute_batch("CREATE TRIGGER fail_snapshot BEFORE UPDATE OF snapshot ON sync_identity BEGIN SELECT RAISE(ABORT, 'fixture'); END;").unwrap();
    assert!(store.apply_events(&root, &page, add).is_err());
    assert_eq!(store.applied_sequence().unwrap(), 0);
    assert_eq!(store.pending(false, 10).unwrap().len(), 2);
    inspection
        .execute_batch("DROP TRIGGER fail_snapshot;")
        .unwrap();
    assert_eq!(store.apply_events(&root, &page, add).unwrap(), 2);
    assert_eq!(&**store.committed_snapshot(&root).unwrap(), b"firstsecond");
}

#[test]
fn multiple_writers_apply_server_order_and_reject_gaps_tampering_and_conflicts() {
    let temp = TempDir::new().unwrap();
    let path = temp.path().join("sync.sqlite");
    let root = VaultRoot::generate();
    let scope = scope();
    let a = DeviceKey::generate();
    let b = DeviceKey::generate();
    let ga = root
        .grant(&scope, &Uuid::new_v4().to_string(), 1, &a)
        .unwrap();
    let gb = root
        .grant(&scope, &Uuid::new_v4().to_string(), 1, &b)
        .unwrap();
    let mut store = Store::initialize(&path, scope.clone(), ga.clone(), &root, &a, b"").unwrap();
    let local = store.enqueue(&root, &a, b"mac").unwrap();
    let remote = root
        .seal_mutation(&scope, &gb, &b, &Uuid::new_v4().to_string(), 1, b"windows")
        .unwrap();
    assert!(store
        .apply_events(&root, &[event(remote.clone(), 2, &gb)], add)
        .is_err());
    assert_eq!(store.applied_sequence().unwrap(), 0);
    let mut corrupted = remote.clone();
    corrupted.device_counter = 2;
    assert!(store
        .apply_events(&root, &[event(corrupted, 1, &gb)], add)
        .is_err());
    store
        .apply_events(
            &root,
            &[event(remote.clone(), 1, &gb), event(local.clone(), 2, &ga)],
            add,
        )
        .unwrap();
    assert_eq!(&**store.committed_snapshot(&root).unwrap(), b"windowsmac");
    assert!(store
        .apply_events(&root, &[event(remote, 2, &gb)], add)
        .is_err());
    assert!(store
        .acknowledge(&Receipt {
            discarded: false,
            operation_id: local.operation_id,
            sequence: 1
        })
        .is_err());
    assert_eq!(store.applied_sequence().unwrap(), 2);
}

#[test]
fn account_device_and_cursor_substitution_cannot_unlock_local_state() {
    let temp = TempDir::new().unwrap();
    let path = temp.path().join("sync.sqlite");
    let root = VaultRoot::generate();
    let scope = scope();
    let device = DeviceKey::generate();
    let grant = root
        .grant(&scope, &Uuid::new_v4().to_string(), 1, &device)
        .unwrap();
    let store = Store::initialize(
        &path,
        scope.clone(),
        grant.clone(),
        &root,
        &device,
        b"local-secret",
    )
    .unwrap();
    drop(store);
    let mut other_scope = scope.clone();
    other_scope.account_id = "another-account".into();
    assert!(Store::unlock(&path, other_scope, &root).is_err());
    assert!(Store::unlock(&path, scope.clone(), &VaultRoot::generate()).is_err());
    let other_device = DeviceKey::generate();
    assert!(Store::initialize(&path, scope.clone(), grant, &root, &other_device, b"").is_err());
    Connection::open(&path)
        .unwrap()
        .execute("UPDATE sync_identity SET applied_sequence=1", [])
        .unwrap();
    assert!(Store::unlock(&path, scope, &root).is_err());
}

#[test]
fn independent_connections_allocate_counters_without_collisions() {
    let temp = TempDir::new().unwrap();
    let path = temp.path().join("sync.sqlite");
    let root = VaultRoot::generate();
    let scope = scope();
    let device = DeviceKey::generate();
    let grant = root
        .grant(&scope, &Uuid::new_v4().to_string(), 1, &device)
        .unwrap();
    let mut a = Store::initialize(&path, scope.clone(), grant, &root, &device, b"").unwrap();
    let (mut b, recovered) = Store::unlock(&path, scope, &root).unwrap();
    std::thread::scope(|threads| {
        let root = &root;
        let left = threads.spawn(move || {
            (0..20)
                .map(|_| a.enqueue(root, &device, b"mac").unwrap().device_counter)
                .collect::<Vec<_>>()
        });
        let right = threads.spawn(move || {
            (0..20)
                .map(|_| {
                    b.enqueue(root, &recovered, b"mac-window-2")
                        .unwrap()
                        .device_counter
                })
                .collect::<Vec<_>>()
        });
        let mut counters = left.join().unwrap();
        counters.extend(right.join().unwrap());
        counters.sort_unstable();
        assert_eq!(counters, (1..=40).collect::<Vec<_>>());
    });
}

#[test]
fn lost_renderer_reply_retries_same_intent_even_after_replay_and_restart() {
    let temp = TempDir::new().unwrap();
    let path = temp.path().join("sync.sqlite");
    let root = VaultRoot::generate();
    let device = DeviceKey::generate();
    let scope = scope();
    let grant = root
        .grant(&scope, &Uuid::new_v4().to_string(), 1, &device)
        .unwrap();
    let mut store =
        Store::initialize(&path, scope.clone(), grant.clone(), &root, &device, b"").unwrap();
    let intent = Uuid::new_v4().to_string();
    let payload = b"private-renderer-intent-fixture";
    let mutation = store
        .enqueue_identified(&root, &device, &intent, payload)
        .unwrap()
        .unwrap();
    assert!(store
        .enqueue_identified(&root, &device, &intent, payload)
        .unwrap()
        .is_none());
    assert_eq!(store.allocated_counter().unwrap(), 1);
    store
        .apply_events(&root, &[event(mutation, 1, &grant)], add)
        .unwrap();
    assert_eq!(store.pending_count().unwrap(), 0);
    drop(store);
    let (mut store, restored) = Store::unlock(&path, scope, &root).unwrap();
    assert!(store
        .enqueue_identified(&root, &restored, &intent, payload)
        .unwrap()
        .is_none());
    assert!(store
        .enqueue_identified(&root, &restored, &intent, b"different edit")
        .is_err());
    assert_eq!(store.allocated_counter().unwrap(), 1);
    assert_eq!(store.pending_count().unwrap(), 0);
    assert_eq!(store.committed_snapshot(&root).unwrap().as_slice(), payload);
}

#[test]
fn discarded_stale_outbox_drains_without_losing_its_encrypted_recovery_copy() {
    let temp = TempDir::new().unwrap();
    let path = temp.path().join("sync.sqlite");
    let root = VaultRoot::generate();
    let device = DeviceKey::generate();
    let scope = scope();
    let grant = root
        .grant(&scope, &Uuid::new_v4().to_string(), 1, &device)
        .unwrap();
    let mut store =
        Store::initialize(&path, scope.clone(), grant.clone(), &root, &device, b"").unwrap();
    let stale = store
        .enqueue(&root, &device, b"stale-private-fixture")
        .unwrap();
    let receipt = Receipt {
        operation_id: stale.operation_id.clone(),
        sequence: 1,
        discarded: true,
    };
    store.acknowledge(&receipt).unwrap();
    store.acknowledge(&receipt).unwrap();
    assert!(store.pending(false, 10).unwrap().is_empty());
    assert_eq!(store.applied_sequence().unwrap(), 0);
    drop(store);
    let (mut store, device) = Store::unlock(&path, scope, &root).unwrap();
    let fresh = store.enqueue(&root, &device, b"fresh").unwrap();
    assert_eq!(fresh.device_counter, 2);
    store
        .apply_events(&root, &[event(fresh, 1, &grant)], add)
        .unwrap();
    assert_eq!(&**store.committed_snapshot(&root).unwrap(), b"fresh");
    let db = Connection::open(&path).unwrap();
    let encoded: String = db
        .query_row("SELECT mutation FROM sync_discarded", [], |r| r.get(0))
        .unwrap();
    assert!(!encoded.contains("stale-private-fixture"));
    assert_eq!(
        serde_json::from_str::<Mutation>(&encoded)
            .unwrap()
            .operation_id,
        stale.operation_id
    );
}
