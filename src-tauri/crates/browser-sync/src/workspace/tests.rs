use std::collections::{BTreeMap, HashMap};

use serde_json::json;

use super::{
    protocol::{
        Manifest, WorkspaceChange, WorkspaceClaim, WorkspaceNode, WorkspaceSnapshot, PAGE_STATE,
    },
    state::{Verifier, WorkspaceState},
};
use crate::{
    crypto::{DeviceKey, VaultRoot, VaultScope},
    document::{entities::Kind, Resume, ViewRecord},
    protocol::DeviceGrant,
};

const VAULT: &str = "01951d32-40ac-7000-8000-000000000001";
const DEVICE: &str = "01951d32-40ac-7000-8000-000000000002";

struct Fixture {
    root: VaultRoot,
    scope: VaultScope,
    key: DeviceKey,
    grant: DeviceGrant,
    grants: HashMap<String, DeviceGrant>,
}

fn fixture() -> Fixture {
    let root = VaultRoot::generate();
    let scope = VaultScope {
        deployment: "https://sync.example.test".into(),
        account_id: "account".into(),
        vault_id: VAULT.into(),
    };
    let key = DeviceKey::generate();
    let grant = root.grant(&scope, DEVICE, 1, &key).unwrap();
    let grants = HashMap::from([(DEVICE.to_string(), grant.clone())]);
    Fixture {
        root,
        scope,
        key,
        grant,
        grants,
    }
}

fn record(kind: Kind, id: &str, fields: serde_json::Value) -> ViewRecord {
    ViewRecord {
        kind,
        id: id.into(),
        fields: serde_json::from_value(fields).unwrap(),
    }
}

fn workspace() -> Vec<ViewRecord> {
    vec![
        record(Kind::Window, "w1", json!({"title": "Main", "order": 0})),
        record(
            Kind::Tab,
            "l1",
            json!({"window_id": "w1", "title": "", "order": 0, "tree": {"type": "leaf", "id": "p1"}}),
        ),
        record(
            Kind::View,
            "t1",
            json!({"surface": "browser", "title": "Docs", "placement": {"layout_id": "l1", "pane_id": "p1", "order": 0}, "url": "https://example.com/", "profile_id": "a".repeat(64), "website_id": null, "tool_route": null, "agent_owned": false}),
        ),
    ]
}

fn resume() -> Resume {
    Resume {
        active_window_id: "w1".into(),
        active_tab_id: "l1".into(),
        focused_pane_id: "p1".into(),
        active_view_by_pane: BTreeMap::from([("p1".into(), "t1".into())]),
    }
}

fn snapshot_of(state: &WorkspaceState, last: WorkspaceChange) -> WorkspaceSnapshot {
    WorkspaceSnapshot {
        workspace_id: state.workspace_id.clone(),
        version: state.version,
        nodes: state
            .nodes
            .iter()
            .map(|(id, n)| WorkspaceNode {
                node_id: id.clone(),
                parent_id: n.parent_id.clone(),
                version: n.version,
                key_epoch: n.key_epoch,
                ciphertext: n.ciphertext.clone(),
            })
            .collect(),
        slots: state.slots.values().cloned().collect(),
        last_change: Some(last),
    }
}

fn change_of(op: &super::protocol::WorkspaceOp) -> WorkspaceChange {
    WorkspaceChange {
        workspace_version: op.workspace_version(),
        sequence: 1,
        operation_id: op.operation_id.clone(),
        device_id: op.device_id.clone(),
        device_counter: op.device_counter,
        key_epoch: op.key_epoch,
        merkle_root: op.merkle_root.clone(),
        manifest: op.manifest(),
        signature: op.signature.clone(),
    }
}

#[test]
fn builds_verifies_and_restores_a_workspace() {
    let f = fixture();
    let v = Verifier {
        root: &f.root,
        scope: &f.scope,
        grants: &f.grants,
    };
    let mut state = WorkspaceState::empty(DEVICE);
    let tab = state.tab_node("t1");
    let op = state
        .build_op(
            &f.root,
            &f.scope,
            &f.grant,
            &f.key,
            1,
            &workspace(),
            Some(&resume()),
            vec![(tab.clone(), PAGE_STATE, Some(b"{\"scroll\":10}".to_vec()))],
            vec![],
        )
        .unwrap()
        .expect("initial op");
    assert_eq!(op.upserts[0].node_id, DEVICE, "root node first");
    state.apply_own(&v, &op).unwrap();
    assert_eq!(state.version, 1);
    assert_eq!(state.records.len(), 3);
    assert_eq!(state.resume.as_ref().unwrap().active_window_id, "w1");
    // A second device restores the same workspace from a server snapshot.
    let restored = WorkspaceState::from_snapshot(&v, snapshot_of(&state, change_of(&op))).unwrap();
    assert_eq!(restored.records.len(), 3);
    assert_eq!(restored.slots.len(), 1);
    // No change, no op.
    assert!(state
        .build_op(
            &f.root,
            &f.scope,
            &f.grant,
            &f.key,
            2,
            &workspace(),
            Some(&resume()),
            vec![],
            vec![]
        )
        .unwrap()
        .is_none());
    // Closing the tab deletes its node and slot.
    let mut fewer = workspace();
    fewer.pop();
    let close = state
        .build_op(
            &f.root,
            &f.scope,
            &f.grant,
            &f.key,
            2,
            &fewer,
            Some(&resume()),
            vec![],
            vec![],
        )
        .unwrap()
        .unwrap();
    assert_eq!(close.deletes, vec![tab]);
    state.apply_own(&v, &close).unwrap();
    assert_eq!(
        (state.records.len(), state.slots.len(), state.version),
        (2, 0, 2)
    );
}

#[test]
fn detects_hidden_nodes_rollbacks_and_forged_changes() {
    let f = fixture();
    let v = Verifier {
        root: &f.root,
        scope: &f.scope,
        grants: &f.grants,
    };
    let mut state = WorkspaceState::empty(DEVICE);
    let first = state
        .build_op(
            &f.root,
            &f.scope,
            &f.grant,
            &f.key,
            1,
            &workspace(),
            Some(&resume()),
            vec![],
            vec![],
        )
        .unwrap()
        .unwrap();
    state.apply_own(&v, &first).unwrap();
    let v1 = state.clone();
    let mut renamed = workspace();
    renamed[0].fields.insert("title".into(), json!("Renamed"));
    let second = state
        .build_op(
            &f.root,
            &f.scope,
            &f.grant,
            &f.key,
            2,
            &renamed,
            Some(&resume()),
            vec![],
            vec![],
        )
        .unwrap()
        .unwrap();
    state.apply_own(&v, &second).unwrap();

    // Hiding a node breaks the Merkle root.
    let mut hidden = snapshot_of(&state, change_of(&second));
    hidden.nodes.retain(|n| n.node_id != state.tab_node("t1"));
    assert!(WorkspaceState::from_snapshot(&v, hidden).is_err());
    // Serving the old window node under the new root is detected.
    let mut rolled = snapshot_of(&state, change_of(&second));
    let window = super::model::node_id(DEVICE, Kind::Window, "w1");
    let old = v1.nodes[&window].clone();
    for n in rolled.nodes.iter_mut().filter(|n| n.node_id == window) {
        n.version = old.version;
        n.ciphertext = old.ciphertext.clone();
    }
    assert!(WorkspaceState::from_snapshot(&v, rolled).is_err());
    // Replaying the whole older workspace as if it were current is detected too.
    let mut stale = snapshot_of(&v1, change_of(&first));
    stale.version = 2;
    assert!(WorkspaceState::from_snapshot(&v, stale).is_err());
    // A change signed by a key without a vault grant is rejected.
    let intruder = DeviceKey::generate();
    let forged = state
        .build_op(
            &f.root,
            &f.scope,
            &f.grant,
            &intruder,
            3,
            &workspace(),
            None,
            vec![],
            vec![],
        )
        .unwrap()
        .unwrap();
    assert!(state.clone().apply_own(&v, &forged).is_err());
}

/// Shared with `server/internal/sync/workspace_vectors_test.go`: both encoders
/// must produce these exact bytes.
#[test]
fn signing_bytes_match_the_shared_fixture() {
    let raw = include_str!("../../tests/fixtures/workspace-v3.json");
    let fixture: serde_json::Value = serde_json::from_str(raw).unwrap();
    let merkle = vec![7u8; 32];
    let manifest: Manifest = serde_json::from_value(fixture["manifest"].clone()).unwrap();
    let op_bytes = super::protocol::signing_bytes(
        VAULT,
        DEVICE,
        "01951d32-40ac-7000-8000-000000000003",
        DEVICE,
        5,
        1,
        9,
        &merkle,
        &manifest,
    )
    .unwrap();
    assert_eq!(
        String::from_utf8(op_bytes).unwrap(),
        fixture["op_signing_bytes"].as_str().unwrap()
    );
    let claim = WorkspaceClaim {
        vault_id: VAULT.into(),
        workspace_id: DEVICE.into(),
        operation_id: "01951d32-40ac-7000-8000-000000000003".into(),
        device_id: "01951d32-40ac-7000-8000-000000000004".into(),
        device_counter: 6,
        key_epoch: 1,
        signature: vec![],
    };
    assert_eq!(
        String::from_utf8(claim.signing_bytes().unwrap()).unwrap(),
        fixture["claim_signing_bytes"].as_str().unwrap()
    );
}

#[test]
fn a_remembered_seat_is_unconfirmed_until_the_roster_arrives_on_this_connection() {
    let f = fixture();
    let directory = tempfile::tempdir().unwrap();
    let mut store = crate::store::Store::initialize_vault(
        &directory.path().join("workspace.sqlite"),
        f.scope.clone(),
        f.grant.clone(),
        &f.root,
        &f.key,
        &crate::document::Document::default().encode().unwrap(),
        None,
    )
    .unwrap();
    let mut sync = super::sync::WorkspaceSync::new(&f.scope, &f.grant);
    let roster = vec![super::protocol::Workspace {
        workspace_id: DEVICE.into(),
        shared: false,
        driver_device_id: Some(DEVICE.into()),
        driver_epoch: Some("epoch".into()),
        driver_seen_at: None,
        version: 0,
    }];
    // A seat loaded from the cache or kept across a disconnect is not proof.
    assert!(!sync.view(&store).unwrap().seat_confirmed);
    sync.on_roster(&mut store, &f.root, roster.clone()).unwrap();
    assert!(sync.view(&store).unwrap().seat_confirmed);
    sync.on_disconnect();
    let view = sync.view(&store).unwrap();
    assert_eq!(view.driving_workspace.as_deref(), Some(DEVICE));
    assert!(!view.seat_confirmed);
    sync.on_connect();
    assert!(!sync.view(&store).unwrap().seat_confirmed);
    sync.on_roster(&mut store, &f.root, roster).unwrap();
    assert!(sync.view(&store).unwrap().seat_confirmed);
}

#[test]
fn a_forgotten_workspace_is_read_only_until_the_server_copy_arrives_again() {
    let f = fixture();
    let directory = tempfile::tempdir().unwrap();
    let mut store = crate::store::Store::initialize_vault(
        &directory.path().join("workspace.sqlite"),
        f.scope.clone(),
        f.grant.clone(),
        &f.root,
        &f.key,
        &crate::document::Document::default().encode().unwrap(),
        None,
    )
    .unwrap();
    let mut sync = super::sync::WorkspaceSync::new(&f.scope, &f.grant);
    let roster = vec![super::protocol::Workspace {
        workspace_id: DEVICE.into(),
        shared: false,
        driver_device_id: Some(DEVICE.into()),
        driver_epoch: Some("epoch".into()),
        driver_seen_at: None,
        version: 0,
    }];
    sync.on_connect();
    sync.on_roster(&mut store, &f.root, roster.clone()).unwrap();
    sync.on_current(&mut store, DEVICE, 0).unwrap();
    assert!(sync.view(&store).unwrap().writable);

    // A copy that failed to verify is dropped, not trusted or written back.
    sync.forget(&mut store, DEVICE).unwrap();
    assert!(!sync.view(&store).unwrap().writable);

    // The next connection refetches from scratch and catches up again.
    let frames = sync.on_connect();
    assert!(frames.iter().any(|frame| matches!(
        frame,
        super::sync::Outgoing::Watch { workspace_id, after: 0 } if workspace_id == DEVICE
    )));
    sync.on_roster(&mut store, &f.root, roster).unwrap();
    sync.on_current(&mut store, DEVICE, 0).unwrap();
    assert!(sync.view(&store).unwrap().writable);
}

#[test]
fn the_ui_view_shows_unacknowledged_edits_and_the_verified_view_does_not() {
    let f = fixture();
    let directory = tempfile::tempdir().unwrap();
    let mut store = crate::store::Store::initialize_vault(
        &directory.path().join("workspace.sqlite"),
        f.scope.clone(),
        f.grant.clone(),
        &f.root,
        &f.key,
        &crate::document::Document::default().encode().unwrap(),
        None,
    )
    .unwrap();
    let mut sync = super::sync::WorkspaceSync::new(&f.scope, &f.grant);
    let roster = vec![super::protocol::Workspace {
        workspace_id: DEVICE.into(),
        shared: false,
        driver_device_id: Some(DEVICE.into()),
        driver_epoch: Some("epoch".into()),
        driver_seen_at: None,
        version: 0,
    }];
    sync.on_connect();
    sync.on_roster(&mut store, &f.root, roster).unwrap();
    sync.on_current(&mut store, DEVICE, 0).unwrap();
    let changes = workspace()
        .into_iter()
        .map(|r| crate::document::Change::Create {
            kind: r.kind,
            id: r.id,
            fields: r.fields,
        })
        .collect();
    sync.apply_changes(&mut store, &f.root, changes).unwrap();

    let ids = |view: super::sync::SyncState| -> Vec<String> {
        view.contents[DEVICE]
            .records
            .iter()
            .map(|r| r.id.clone())
            .collect()
    };
    assert!(ids(sync.view(&store).unwrap()).is_empty());
    let mut shown = ids(sync.optimistic_view(&store, &f.root).unwrap());
    shown.sort();
    assert_eq!(shown, ["l1", "t1", "w1"]);

    // Each waiting record is listed once for the renderer to name per tab.
    let unsynced = |view: super::sync::SyncState| -> Vec<(String, bool)> {
        let mut records: Vec<_> = view
            .unsynced
            .into_iter()
            .map(|r| (r.id, r.deleted))
            .collect();
        records.sort();
        records
    };
    let waiting = |id: &str, deleted| (id.to_owned(), deleted);
    assert_eq!(
        unsynced(sync.optimistic_view(&store, &f.root).unwrap()),
        [
            waiting("l1", false),
            waiting("t1", false),
            waiting("w1", false)
        ]
    );
    let view = workspace().into_iter().find(|r| r.id == "t1").unwrap();
    sync.apply_changes(
        &mut store,
        &f.root,
        vec![crate::document::Change::Delete {
            kind: view.kind,
            id: view.id,
        }],
    )
    .unwrap();
    // A later close replaces the entry instead of adding a second one.
    assert_eq!(
        unsynced(sync.optimistic_view(&store, &f.root).unwrap()),
        [
            waiting("l1", false),
            waiting("t1", true),
            waiting("w1", false)
        ]
    );
    assert!(sync.view(&store).unwrap().unsynced.is_empty());
    assert_eq!(
        sync.optimistic_view(&store, &f.root).unwrap().retired_edits,
        0
    );
}

mod multi_writer_rebase {
    use std::collections::BTreeMap;

    use serde_json::json;

    use super::workspace;
    use crate::{
        document::{entities::Kind, Change},
        store::Desired,
        workspace::model::rebase_batches,
    };

    fn create(kind: Kind, id: &str) -> Change {
        let source = workspace().into_iter().find(|r| r.kind == kind).unwrap();
        Change::Create {
            kind,
            id: id.into(),
            fields: source.fields,
        }
    }
    fn ids(records: &[crate::document::ViewRecord]) -> Vec<String> {
        let mut ids: Vec<_> = records.iter().map(|r| r.id.clone()).collect();
        ids.sort();
        ids
    }

    #[test]
    fn a_stale_create_does_not_resurrect_what_another_machine_closed() {
        // t1 was closed by another machine at version 5; this edit was made at 4.
        let records: Vec<_> = workspace().into_iter().filter(|r| r.id != "t1").collect();
        let tombstones = BTreeMap::from([((Kind::View, "t1".to_string()), 5)]);
        let stale = [create(Kind::View, "t1")];
        let out = rebase_batches(&records, &[(4, &stale)], &tombstones).unwrap();
        assert_eq!(ids(&out), ["l1", "w1"]);
        // Reopened after seeing the close (made at 5): both events stand.
        let out = rebase_batches(&records, &[(5, &stale)], &tombstones).unwrap();
        assert_eq!(ids(&out), ["l1", "t1", "w1"]);
    }

    #[test]
    fn a_move_into_a_closed_layout_is_dropped_but_its_other_fields_apply() {
        let records = workspace();
        let tombstones = BTreeMap::from([((Kind::Tab, "l2".to_string()), 7)]);
        let patch = [Change::Patch {
            kind: Kind::View,
            id: "t1".into(),
            fields: serde_json::from_value(json!({
                "title": "Renamed",
                "placement": {"layout_id": "l2", "pane_id": "p2", "order": 0},
            }))
            .unwrap(),
        }];
        let out = rebase_batches(&records, &[(6, &patch)], &tombstones).unwrap();
        let tab = out.iter().find(|r| r.id == "t1").unwrap();
        assert_eq!(tab.fields["title"], "Renamed");
        assert_eq!(tab.fields["placement"]["layout_id"], "l1");
    }

    #[test]
    fn queued_edits_drain_and_drop_by_whole_edit() {
        let mut desired = Desired::default();
        // A queue written before batches existed: one change of unknown base.
        desired.changes.push(create(Kind::Window, "w9"));
        desired.push_batch(vec![create(Kind::View, "a"), create(Kind::View, "b")], 3);
        desired.push_batch(vec![create(Kind::View, "c")], 4);
        let bases: Vec<_> = desired
            .batches()
            .iter()
            .map(|(b, c)| (*b, c.len()))
            .collect();
        assert_eq!(bases, [(0, 1), (3, 2), (4, 1)]);

        // A rejected op drops only the oldest edit.
        desired.drop_first_batch();
        let bases: Vec<_> = desired
            .batches()
            .iter()
            .map(|(b, c)| (*b, c.len()))
            .collect();
        assert_eq!(bases, [(3, 2), (4, 1)]);

        // An accepted op carried the first edit; the rest stays aligned.
        desired.drain_changes(2);
        let bases: Vec<_> = desired
            .batches()
            .iter()
            .map(|(b, c)| (*b, c.len()))
            .collect();
        assert_eq!(bases, [(4, 1)]);
    }
}

#[test]
fn a_retired_shared_workspace_is_no_longer_watched() {
    let f = fixture();
    let mut sync = super::sync::WorkspaceSync::new(&f.scope, &f.grant);
    let frames = sync.on_connect();
    assert!(frames.iter().any(|frame| matches!(
        frame,
        super::sync::Outgoing::Watch { workspace_id, .. } if workspace_id == VAULT
    )));
    let frames = sync.retire_shared(true);
    assert!(frames.iter().any(|frame| matches!(
        frame,
        super::sync::Outgoing::Unwatch { workspace_id } if workspace_id == VAULT
    )));
    // Idempotent, and a reconnect does not watch it again.
    assert!(sync.retire_shared(true).is_empty());
    assert!(!sync.on_connect().iter().any(|frame| matches!(
        frame,
        super::sync::Outgoing::Watch { workspace_id, .. } if workspace_id == VAULT
    )));
}
