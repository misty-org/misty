use std::collections::HashMap;

use super::*;
use crate::{
    crypto::{DeviceKey, VaultRoot, VaultScope},
    document::Document,
    protocol::DeviceGrant,
    store::{DeviceSignin, Store},
    tree::{
        protocol::{Slot, Tree, TreeReceipt},
        signin::{FIRST_SLOT, MAX_FRAME},
        state::Verifier,
    },
};

const WORKSPACE: &str = "01951d32-40ac-7000-8000-000000000001";
const DEVICE: &str = "01951d32-40ac-7000-8000-000000000002";
const OTHER: &str = "01951d32-40ac-7000-8000-000000000003";

struct Harness {
    root: VaultRoot,
    scope: VaultScope,
    key: DeviceKey,
    grant: DeviceGrant,
    grants: HashMap<String, DeviceGrant>,
    store: Store,
    sync: TreeSync,
    _dir: tempfile::TempDir,
}

fn roster(driver: Option<&str>, epoch: &str) -> Vec<Tree> {
    vec![Tree {
        tree_id: DEVICE.into(),
        shared: false,
        driver_device_id: driver.map(str::to_owned),
        driver_epoch: driver.map(|_| epoch.to_owned()),
        driver_seen_at: None,
        version: 0,
    }]
}

/// A connected session holding this device's lock, with its tree current.
fn harness() -> Harness {
    let root = VaultRoot::generate();
    let scope = VaultScope {
        deployment: "https://sync.example.test".into(),
        account_id: "account".into(),
        workspace_id: WORKSPACE.into(),
    };
    let key = DeviceKey::generate();
    let grant = root.grant(&scope, DEVICE, 1, &key).unwrap();
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::initialize_vault(
        &dir.path().join("workspace.sqlite"),
        scope.clone(),
        grant.clone(),
        &root,
        &key,
        &Document::default().encode().unwrap(),
        None,
    )
    .unwrap();
    let mut sync = TreeSync::new(&scope, &grant);
    sync.on_connect();
    sync.on_roster(&mut store, &root, roster(Some(DEVICE), "epoch-1"))
        .unwrap();
    assert!(sync.on_current(&mut store, DEVICE, 0).unwrap().is_empty());
    let grants = HashMap::from([(DEVICE.to_owned(), grant.clone())]);
    store
        .set_device_signin(
            &root,
            DEVICE,
            &DeviceSignin {
                physical_id: "b".repeat(64),
                ..Default::default()
            },
        )
        .unwrap();
    Harness {
        root,
        scope,
        key,
        grant,
        grants,
        store,
        sync,
        _dir: dir,
    }
}

impl Harness {
    fn tick(&mut self) -> Vec<TreeOp> {
        self.sync
            .tick(
                &mut self.store,
                &self.root,
                &self.scope,
                &self.grant,
                &self.key,
            )
            .unwrap()
            .into_iter()
            .filter_map(|frame| match frame {
                Outgoing::Publish { op, .. } => Some(op),
                _ => None,
            })
            .collect()
    }
    fn ack(&mut self, op: &TreeOp) {
        let verifier = Verifier {
            root: &self.root,
            scope: &self.scope,
            grants: &self.grants,
        };
        let receipt = TreeReceipt {
            operation_id: op.operation_id.clone(),
            sequence: 1,
            discarded: false,
            reason: None,
            tree_version: Some(op.tree_version()),
        };
        self.sync
            .on_ack(&mut self.store, &verifier, None, receipt)
            .unwrap();
    }
    fn status(&self) -> SigninStatus {
        self.sync
            .signin_status(&self.store, &self.root, DEVICE)
            .unwrap()
    }
}

/// Incompressible shard plaintext of roughly `len` bytes.
fn incompressible(len: usize, seed: u8) -> Vec<u8> {
    let mut out = Vec::with_capacity(len);
    let mut block = sha2::Sha256::digest([seed]);
    while out.len() < len {
        out.extend_from_slice(&block);
        block = sha2::Sha256::digest(block);
    }
    out.truncate(len);
    out
}

use sha2::Digest;

#[test]
fn only_the_confirmed_lock_holder_may_queue_sign_in_writes() {
    let mut h = harness();
    assert!(h.status().writer);
    h.sync.on_disconnect();
    assert!(!h.status().writer);
    assert!(matches!(
        h.sync.write_signin(
            &mut h.store,
            &h.root,
            DEVICE,
            vec![(FIRST_SLOT, Some(b"{}".to_vec()))],
            Default::default()
        ),
        Err(Error::InactiveDevice)
    ));
    h.sync.on_connect();
    h.sync
        .on_roster(&mut h.store, &h.root, roster(Some(OTHER), "epoch-2"))
        .unwrap();
    assert!(!h.status().writer);
    assert!(matches!(
        h.sync.write_signin(
            &mut h.store,
            &h.root,
            DEVICE,
            vec![(FIRST_SLOT, Some(b"{}".to_vec()))],
            Default::default()
        ),
        Err(Error::InactiveDevice)
    ));
    // Tab slot kinds are never sign-in slots.
    let mut h = harness();
    assert!(matches!(
        h.sync.write_signin(
            &mut h.store,
            &h.root,
            DEVICE,
            vec![(2, Some(b"{}".to_vec()))],
            Default::default()
        ),
        Err(Error::Invalid)
    ));
}

#[test]
fn large_shards_publish_across_ops_within_the_servers_op_limit() {
    let mut h = harness();
    // Three full-size shards: at most two fit one op, so the third waits.
    let writes: Vec<_> = (0..3)
        .map(|i| {
            (
                FIRST_SLOT + i,
                Some(incompressible(MAX_FRAME - 1024, i as u8)),
            )
        })
        .collect();
    h.sync
        .write_signin(&mut h.store, &h.root, DEVICE, writes, Default::default())
        .unwrap();
    assert!(h.status().pending);
    let first = h.tick();
    assert_eq!(first.len(), 1);
    let bytes: usize = first[0]
        .slots
        .iter()
        .filter_map(|s| s.ciphertext.as_ref())
        .map(Vec::len)
        .sum::<usize>()
        + first[0]
            .upserts
            .iter()
            .map(|n| n.ciphertext.len())
            .sum::<usize>();
    assert!(bytes <= 1400 << 10, "op carries {bytes} bytes");
    assert_eq!(first[0].slots.len(), 2);
    assert!(first[0].slots.iter().all(|s| s.tab_node_id == DEVICE));
    h.ack(&first[0]);
    let second = h.tick();
    assert_eq!(second.len(), 1);
    assert_eq!(second[0].slots.len(), 1);
    h.ack(&second[0]);
    assert!(h.tick().is_empty());
    let status = h.status();
    assert!(!status.pending);
    assert_eq!(status.server.len(), 3);
    // Accepted writes mark the local store as reflecting the device.
    assert!(status.binding.unwrap().reflects(&status.server));
}

#[test]
fn losing_the_lock_discards_queued_sign_in_writes_even_if_it_comes_back() {
    let mut h = harness();
    h.sync
        .write_signin(
            &mut h.store,
            &h.root,
            DEVICE,
            vec![(FIRST_SLOT, Some(b"{\"version\":1,\"units\":[]}".to_vec()))],
            Default::default(),
        )
        .unwrap();
    assert!(h.status().pending);
    // Another session claims and this one claims back: a new epoch.
    h.sync
        .on_roster(&mut h.store, &h.root, roster(Some(DEVICE), "epoch-2"))
        .unwrap();
    assert!(!h.status().pending);
    assert!(h.tick().is_empty());
    // The same seat and epoch re-sent keeps queued writes.
    h.sync
        .write_signin(
            &mut h.store,
            &h.root,
            DEVICE,
            vec![(FIRST_SLOT, Some(b"{}".to_vec()))],
            Default::default(),
        )
        .unwrap();
    h.sync
        .on_roster(&mut h.store, &h.root, roster(Some(DEVICE), "epoch-2"))
        .unwrap();
    assert!(h.status().pending);
}

#[test]
fn sign_in_reads_accept_only_the_verified_slot() {
    let mut h = harness();
    h.sync
        .write_signin(
            &mut h.store,
            &h.root,
            DEVICE,
            vec![(FIRST_SLOT, Some(b"{\"version\":1,\"units\":[]}".to_vec()))],
            Default::default(),
        )
        .unwrap();
    let op = h.tick().remove(0);
    h.ack(&op);
    let genuine = op.slots[0].ciphertext.clone().unwrap();
    let read = |h: &mut Harness, ciphertext: Option<Vec<u8>>| {
        let (send, mut receive) = tokio::sync::oneshot::channel();
        let Some(Outgoing::SlotGet { request_id, .. }) =
            h.sync.read_signin(DEVICE, FIRST_SLOT, send)
        else {
            panic!("no read")
        };
        let slot = ciphertext.map(|ciphertext| Slot {
            tree_id: DEVICE.into(),
            tab_node_id: DEVICE.into(),
            slot: FIRST_SLOT,
            version: op.tree_version(),
            key_epoch: 1,
            ciphertext,
        });
        h.sync.on_slot(&h.root, &h.scope, Some(&request_id), slot);
        receive.try_recv().unwrap()
    };
    assert_eq!(
        read(&mut h, Some(genuine.clone())).unwrap().unwrap(),
        b"{\"version\":1,\"units\":[]}"
    );
    let mut forged = genuine;
    forged[20] ^= 1;
    assert!(matches!(read(&mut h, Some(forged)), Err(Error::Sequence)));
    // A server claiming the slot is gone cannot hide sign-in data either.
    assert!(matches!(read(&mut h, None), Err(Error::Sequence)));
    // Disconnecting fails reads in flight instead of leaving them hanging.
    let (send, mut receive) = tokio::sync::oneshot::channel();
    assert!(h.sync.read_signin(DEVICE, FIRST_SLOT, send).is_some());
    h.sync.on_disconnect();
    assert!(matches!(receive.try_recv().unwrap(), Err(Error::Network)));
}

fn roster_at(driver: Option<&str>, epoch: &str, version: u64) -> Vec<Tree> {
    let mut trees = roster(driver, epoch);
    trees[0].version = version;
    trees
}

fn resume() -> crate::document::Resume {
    crate::document::Resume {
        active_window_id: "w1".into(),
        active_layout_id: "l1".into(),
        focused_pane_id: "p1".into(),
        active_tab_by_pane: std::collections::BTreeMap::from([("p1".into(), "t1".into())]),
    }
}

/// Publishes one sign-in shard and acknowledges it: the tree advances a version.
fn publish_one(h: &mut Harness, seed: u8) {
    h.sync
        .write_signin(
            &mut h.store,
            &h.root,
            DEVICE,
            vec![(FIRST_SLOT, Some(format!("{{\"s\":{seed}}}").into_bytes()))],
            Default::default(),
        )
        .unwrap();
    let ops = h.tick();
    assert_eq!(ops.len(), 1);
    h.ack(&ops[0]);
}

#[test]
fn a_session_without_the_lock_keeps_receiving_the_tree_it_drove() {
    let mut h = harness();
    publish_one(&mut h, 1);
    // Another session takes the lock: this one keeps watching the tree.
    let frames = h
        .sync
        .on_roster(&mut h.store, &h.root, roster_at(Some(OTHER), "epoch-2", 1))
        .unwrap();
    assert!(!frames
        .iter()
        .any(|frame| matches!(frame, Outgoing::Unwatch { tree_id } if tree_id == DEVICE)));
    let view = h.sync.view(&h.store).unwrap();
    assert_eq!(view.driving_tree, None);
    assert_eq!(view.following.as_deref(), Some(DEVICE));
    assert_eq!(
        view.workspaces.get(DEVICE).map(|tree| tree.version),
        Some(1)
    );
    assert!(!view.writable);
    // It reads, but never writes.
    assert!(matches!(
        h.sync.set_resume(&mut h.store, &h.root, resume()),
        Err(Error::InactiveDevice)
    ));
    assert!(h.tick().is_empty());
    // A reconnect re-watches the followed tree from its current version.
    h.sync.on_disconnect();
    let frames = h.sync.on_connect();
    assert!(frames
        .iter()
        .any(|frame| matches!(frame, Outgoing::Watch { tree_id, after: 1 } if tree_id == DEVICE)));
}

#[test]
fn taking_the_lock_back_waits_for_the_servers_copy_and_never_replays_old_edits() {
    let mut h = harness();
    publish_one(&mut h, 1);
    // An edit queued but not yet published when another session takes over.
    h.sync.set_resume(&mut h.store, &h.root, resume()).unwrap();
    h.sync
        .on_roster(&mut h.store, &h.root, roster_at(Some(OTHER), "epoch-2", 1))
        .unwrap();
    assert!(h.sync.view(&h.store).unwrap().displaced_with_edits);
    // Taken back while the server holds a newer version than this copy.
    h.sync
        .on_roster(&mut h.store, &h.root, roster_at(Some(DEVICE), "epoch-3", 4))
        .unwrap();
    assert_eq!(
        h.sync.view(&h.store).unwrap().driving_tree.as_deref(),
        Some(DEVICE)
    );
    assert!(
        !h.sync.writable(),
        "a copy behind the server must not be written to"
    );
    assert!(!h.status().writer);
    assert!(matches!(
        h.sync.set_resume(&mut h.store, &h.root, resume()),
        Err(Error::InactiveDevice)
    ));
    // The old tenure's edit is kept aside, never published over the server's state.
    assert!(h.store.tree_desired(&h.root, DEVICE).unwrap().is_none());
    assert_eq!(
        h.store.retired_tree_desired(&h.root, DEVICE).unwrap().len(),
        1
    );
    assert!(h.tick().is_empty());
    // The server's copy is newer: fetch it instead of treating this one as current.
    let frames = h.sync.on_current(&mut h.store, DEVICE, 4).unwrap();
    assert!(matches!(frames.as_slice(), [Outgoing::Watch { after, .. }] if *after == MAX_COUNTER));
    assert!(!h.sync.writable());
}

#[test]
fn a_followed_tree_that_is_current_is_writable_as_soon_as_the_lock_returns() {
    let mut h = harness();
    publish_one(&mut h, 1);
    h.sync
        .on_roster(&mut h.store, &h.root, roster_at(Some(OTHER), "epoch-2", 1))
        .unwrap();
    // Followed while away, so the copy already matches the server.
    h.sync
        .on_roster(&mut h.store, &h.root, roster_at(Some(DEVICE), "epoch-3", 1))
        .unwrap();
    assert!(h.sync.writable());
    assert!(h.status().writer);
    h.sync.set_resume(&mut h.store, &h.root, resume()).unwrap();
    let ops = h.tick();
    assert_eq!(ops.len(), 1);
    assert_eq!(ops[0].base_tree_version, 1);
}

#[test]
fn a_seat_kept_across_a_restart_stays_writable_offline() {
    let mut h = harness();
    publish_one(&mut h, 1);
    let verifier_grants = h.grants.clone();
    let mut restarted = TreeSync::new(&h.scope, &h.grant);
    let verifier = Verifier {
        root: &h.root,
        scope: &h.scope,
        grants: &verifier_grants,
    };
    restarted.load(&h.store, &verifier).unwrap();
    // Same epoch as before the restart: no other session can have written.
    assert!(restarted.writable());
    restarted
        .set_resume(&mut h.store, &h.root, resume())
        .unwrap();
    // The same seat confirmed again keeps the queued edit.
    restarted.on_connect();
    restarted
        .on_roster(&mut h.store, &h.root, roster_at(Some(DEVICE), "epoch-1", 1))
        .unwrap();
    assert!(h.store.tree_desired(&h.root, DEVICE).unwrap().is_some());
}
