use std::collections::{BTreeMap, HashMap};

use serde_json::json;

use super::{
    protocol::{Manifest, TreeChange, TreeClaim, TreeNode, TreeSnapshot, SLOT_PAGE_STATE},
    state::{TreeState, Verifier},
};
use crate::{
    crypto::{DeviceKey, VaultRoot, VaultScope},
    document::{entities::Kind, Resume, ViewRecord},
    protocol::DeviceGrant,
};

const WORKSPACE: &str = "01951d32-40ac-7000-8000-000000000001";
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
    let scope = VaultScope { deployment: "https://sync.example.test".into(), account_id: "account".into(), workspace_id: WORKSPACE.into() };
    let key = DeviceKey::generate();
    let grant = root.grant(&scope, DEVICE, 1, &key).unwrap();
    let grants = HashMap::from([(DEVICE.to_string(), grant.clone())]);
    Fixture { root, scope, key, grant, grants }
}

fn record(kind: Kind, id: &str, fields: serde_json::Value) -> ViewRecord {
    ViewRecord { kind, id: id.into(), fields: serde_json::from_value(fields).unwrap() }
}

fn workspace() -> Vec<ViewRecord> {
    vec![
        record(Kind::Window, "w1", json!({"title": "Main", "order": 0})),
        record(Kind::Layout, "l1", json!({"window_id": "w1", "title": "", "order": 0, "tree": {"type": "leaf", "id": "p1"}})),
        record(Kind::Tab, "t1", json!({"surface": "browser", "title": "Docs", "placement": {"layout_id": "l1", "pane_id": "p1", "order": 0}, "url": "https://example.com/", "profile_id": null, "website_id": null, "tool_route": null, "agent_owned": false})),
    ]
}

fn resume() -> Resume {
    Resume { active_window_id: "w1".into(), active_layout_id: "l1".into(), focused_pane_id: "p1".into(), active_tab_by_pane: BTreeMap::from([("p1".into(), "t1".into())]) }
}

fn snapshot_of(state: &TreeState, last: TreeChange) -> TreeSnapshot {
    TreeSnapshot {
        tree_id: state.tree_id.clone(),
        version: state.version,
        nodes: state
            .nodes
            .iter()
            .map(|(id, n)| TreeNode { node_id: id.clone(), parent_id: n.parent_id.clone(), version: n.version, key_epoch: n.key_epoch, ciphertext: n.ciphertext.clone() })
            .collect(),
        slots: state.slots.values().cloned().collect(),
        last_change: Some(last),
    }
}

fn change_of(op: &super::protocol::TreeOp) -> TreeChange {
    TreeChange {
        tree_version: op.tree_version(),
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
fn builds_verifies_and_restores_a_tree() {
    let f = fixture();
    let v = Verifier { root: &f.root, scope: &f.scope, grants: &f.grants };
    let mut state = TreeState::empty(DEVICE);
    let tab = state.tab_node("t1");
    let op = state
        .build_op(&f.root, &f.scope, &f.grant, &f.key, 1, &workspace(), Some(&resume()), vec![(tab.clone(), SLOT_PAGE_STATE, Some(b"{\"scroll\":10}".to_vec()))], vec![])
        .unwrap()
        .expect("initial op");
    assert_eq!(op.upserts[0].node_id, DEVICE, "root node first");
    state.apply_own(&v, &op).unwrap();
    assert_eq!(state.version, 1);
    assert_eq!(state.records.len(), 3);
    assert_eq!(state.resume.as_ref().unwrap().active_window_id, "w1");
    // A second device restores the same tree from a server snapshot.
    let restored = TreeState::from_snapshot(&v, snapshot_of(&state, change_of(&op))).unwrap();
    assert_eq!(restored.records.len(), 3);
    assert_eq!(restored.slots.len(), 1);
    // No change, no op.
    assert!(state.build_op(&f.root, &f.scope, &f.grant, &f.key, 2, &workspace(), Some(&resume()), vec![], vec![]).unwrap().is_none());
    // Closing the tab deletes its node and slot.
    let mut fewer = workspace();
    fewer.pop();
    let close = state.build_op(&f.root, &f.scope, &f.grant, &f.key, 2, &fewer, Some(&resume()), vec![], vec![]).unwrap().unwrap();
    assert_eq!(close.deletes, vec![tab]);
    state.apply_own(&v, &close).unwrap();
    assert_eq!((state.records.len(), state.slots.len(), state.version), (2, 0, 2));
}

#[test]
fn detects_hidden_nodes_rollbacks_and_forged_changes() {
    let f = fixture();
    let v = Verifier { root: &f.root, scope: &f.scope, grants: &f.grants };
    let mut state = TreeState::empty(DEVICE);
    let first = state.build_op(&f.root, &f.scope, &f.grant, &f.key, 1, &workspace(), Some(&resume()), vec![], vec![]).unwrap().unwrap();
    state.apply_own(&v, &first).unwrap();
    let v1 = state.clone();
    let mut renamed = workspace();
    renamed[0].fields.insert("title".into(), json!("Renamed"));
    let second = state.build_op(&f.root, &f.scope, &f.grant, &f.key, 2, &renamed, Some(&resume()), vec![], vec![]).unwrap().unwrap();
    state.apply_own(&v, &second).unwrap();

    // Hiding a node breaks the Merkle root.
    let mut hidden = snapshot_of(&state, change_of(&second));
    hidden.nodes.retain(|n| n.node_id != state.tab_node("t1"));
    assert!(TreeState::from_snapshot(&v, hidden).is_err());
    // Serving the old window node under the new root is detected.
    let mut rolled = snapshot_of(&state, change_of(&second));
    let window = super::model::node_id(DEVICE, Kind::Window, "w1");
    let old = v1.nodes[&window].clone();
    for n in rolled.nodes.iter_mut().filter(|n| n.node_id == window) {
        n.version = old.version;
        n.ciphertext = old.ciphertext.clone();
    }
    assert!(TreeState::from_snapshot(&v, rolled).is_err());
    // Replaying the whole older tree as if it were current is detected too.
    let mut stale = snapshot_of(&v1, change_of(&first));
    stale.version = 2;
    assert!(TreeState::from_snapshot(&v, stale).is_err());
    // A change signed by a key without a vault grant is rejected.
    let intruder = DeviceKey::generate();
    let forged = state.build_op(&f.root, &f.scope, &f.grant, &intruder, 3, &workspace(), None, vec![], vec![]).unwrap().unwrap();
    assert!(state.clone().apply_own(&v, &forged).is_err());
}

/// Shared with `server/internal/sync/tree_vectors_test.go`: both encoders
/// must produce these exact bytes.
#[test]
fn signing_bytes_match_the_shared_fixture() {
    let raw = include_str!("../../tests/fixtures/tree-v2.json");
    let fixture: serde_json::Value = serde_json::from_str(raw).unwrap();
    let merkle = vec![7u8; 32];
    let manifest: Manifest = serde_json::from_value(fixture["manifest"].clone()).unwrap();
    let op_bytes = super::protocol::signing_bytes(WORKSPACE, DEVICE, "01951d32-40ac-7000-8000-000000000003", DEVICE, 5, 1, 9, &merkle, &manifest).unwrap();
    assert_eq!(String::from_utf8(op_bytes).unwrap(), fixture["op_signing_bytes"].as_str().unwrap());
    let claim = TreeClaim {
        workspace_id: WORKSPACE.into(),
        tree_id: DEVICE.into(),
        operation_id: "01951d32-40ac-7000-8000-000000000003".into(),
        device_id: "01951d32-40ac-7000-8000-000000000004".into(),
        device_counter: 6,
        key_epoch: 1,
        signature: vec![],
    };
    assert_eq!(String::from_utf8(claim.signing_bytes().unwrap()).unwrap(), fixture["claim_signing_bytes"].as_str().unwrap());
}
