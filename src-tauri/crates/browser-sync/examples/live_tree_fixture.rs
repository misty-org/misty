//! Live per-device tree fixture, driven by the server's
//! `TestBrowserSyncNativeTreesAgainstGo`. Two real workers: A publishes its
//! workspace, B takes A's tree over and receives A's tabs, A is displaced,
//! then A takes its tree back.
use std::{path::Path, time::Duration};

use misty_browser_sync::{
    crypto::{generate_sync_secret, DeviceKey, VaultRoot, VaultScope},
    document::{self, Change, Document},
    protocol::Workspace,
    store::{CachedVault, Store},
    transport::SyncApi,
    tree::sync::TreeView,
    worker::{Phase, Worker, WorkerHandle},
    Result,
};
use serde_json::json;
use tokio::{task::JoinHandle, time::timeout};
use uuid::Uuid;

fn peer(path: &Path, api: SyncApi, scope: VaultScope, root: VaultRoot) -> (WorkerHandle, JoinHandle<Result<()>>) {
    let (store, device) = Store::unlock(path, scope.clone(), &root).unwrap();
    let (worker, handle) = Worker::new(api, scope, root, device, store, document::reduce).unwrap();
    (handle, tokio::spawn(worker.run()))
}

async fn wait_trees(label: &str, handle: &WorkerHandle, predicate: impl Fn(&TreeView) -> bool) {
    let mut trees = handle.trees.clone();
    let status = handle.status.clone();
    let result = timeout(Duration::from_secs(20), async {
        loop {
            {
                let state = status.borrow();
                assert!(state.phase != Phase::Attention, "{label}: worker requires attention: {:?}", state.issue);
            }
            if predicate(&trees.borrow_and_update()) {
                return;
            }
            let _ = timeout(Duration::from_millis(250), trees.changed()).await;
        }
    })
    .await;
    if result.is_err() {
        let view = handle.trees.borrow();
        panic!(
            "{label}: timed out; driving={:?} versions={:?} pending={:?}",
            view.driving_tree,
            view.workspaces.iter().map(|(k, v)| (k.clone(), v.version, v.records.len())).collect::<Vec<_>>(),
            view.pending
        );
    }
}

fn changes(value: serde_json::Value) -> Vec<Change> {
    serde_json::from_value(value).unwrap()
}

#[tokio::main]
async fn main() {
    let base = std::env::var("MISTY_SYNC_FIXTURE_BASE").expect("fixture server required");
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(reqwest::header::COOKIE, std::env::var("MISTY_SYNC_FIXTURE_COOKIE").unwrap().parse().unwrap());
    let _ = rustls::crypto::ring::default_provider().install_default();
    let http = reqwest::Client::builder().default_headers(headers).redirect(reqwest::redirect::Policy::none()).build().unwrap();
    let api = SyncApi::new(&base, http).unwrap();
    let scope = VaultScope { deployment: api.deployment(), account_id: "owner".into(), workspace_id: Uuid::new_v4().to_string() };
    let root = VaultRoot::generate();
    let secret = generate_sync_secret();
    let password = "public test-only sync password";
    let wrapper = root.wrap(&scope, password, &secret).unwrap();
    let public = root.public_key().unwrap();
    let (a, b) = (DeviceKey::generate(), DeviceKey::generate());
    let (id_a, id_b) = (Uuid::new_v4().to_string(), Uuid::new_v4().to_string());
    let ga = root.grant(&scope, &id_a, 1, &a).unwrap();
    let gb = root.grant(&scope, &id_b, 1, &b).unwrap();
    let directory = tempfile::tempdir().unwrap();
    let (path_a, path_b) = (directory.path().join("a.sqlite"), directory.path().join("b.sqlite"));
    let initial = Document::default().encode().unwrap();
    let vault = |bootstrap: bool| CachedVault {
        workspace: Workspace {
            workspace_id: scope.workspace_id.clone(),
            key_epoch: 1,
            head_sequence: 0,
            root_public_key: public.clone(),
            key_envelope: wrapper.clone(),
        },
        bootstrap_pending: bootstrap,
        enrollment_pending: true,
    };
    drop(Store::initialize_vault(&path_a, scope.clone(), ga, &root, &a, &initial, Some(&vault(true))).unwrap());
    let root_b = VaultRoot::unlock(&scope, &wrapper, password, &secret, &public).unwrap();
    let (ha, _ta) = peer(&path_a, api.clone(), scope.clone(), root);
    wait_trees("A connects", &ha, |v| v.driving_tree.as_deref() == Some(id_a.as_str())).await;

    ha.tree_changes(changes(json!([
        {"action":"create","kind":"window","id":"w1","fields":{"title":"Main","order":0}},
        {"action":"create","kind":"layout","id":"l1","fields":{"window_id":"w1","title":"","order":0,"tree":{"type":"leaf","id":"p1"}}},
        {"action":"create","kind":"tab","id":"t1","fields":{"surface":"browser","title":"Docs","placement":{"layout_id":"l1","pane_id":"p1","order":0},"url":"https://example.com/","profile_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","website_id":null,"tool_route":null,"agent_owned":false}},
        {"action":"create","kind":"group","id":"g1","fields":{"label":"Work","icon":"briefcase","order":0,"hidden":false}}
    ])))
    .await
    .unwrap();
    wait_trees("A publishes", &ha, |v| {
        v.pending.is_empty()
            && v.workspaces.get(&id_a).is_some_and(|w| w.version >= 1 && w.records.iter().any(|r| r.id == "t1"))
            && v.workspaces.get(&scope.workspace_id).is_some_and(|w| w.records.iter().any(|r| r.id == "g1"))
    })
    .await;

    drop(Store::initialize_vault(&path_b, scope.clone(), gb, &root_b, &b, &initial, Some(&vault(false))).unwrap());
    let (hb, _tb) = peer(&path_b, api.clone(), scope.clone(), root_b);
    wait_trees("B connects", &hb, |v| v.driving_tree.as_deref() == Some(id_b.as_str())).await;

    // B continues on A's workspace: it gets A's tabs, and A loses its seat.
    hb.claim_tree(id_a.clone()).await.expect("B claims A's tree");
    wait_trees("B drives A", &hb, |v| {
        v.driving_tree.as_deref() == Some(id_a.as_str())
            && v.workspaces.get(&id_a).is_some_and(|w| w.records.iter().any(|r| r.id == "t1"))
    })
    .await;
    wait_trees("A displaced", &ha, |v| v.driving_tree.is_none()).await;
    assert!(ha.tree_changes(changes(json!([{"action":"patch","kind":"window","id":"w1","fields":{"title":"x"}}]))).await.is_err(), "a displaced device cannot edit");

    // B edits A's workspace; A takes it back and sees the edit.
    hb.tree_changes(changes(json!([{"action":"patch","kind":"window","id":"w1","fields":{"title":"Edited on B"}}]))).await.unwrap();
    wait_trees("B publishes", &hb, |v| v.pending.is_empty() && v.workspaces.get(&id_a).is_some_and(|w| w.version >= 2)).await;
    ha.claim_tree(id_a.clone()).await.expect("A takes its tree back");
    wait_trees("A drives again", &ha, |v| {
        v.driving_tree.as_deref() == Some(id_a.as_str())
            && v.workspaces.get(&id_a).is_some_and(|w| w.records.iter().any(|r| r.fields.get("title") == Some(&json!("Edited on B"))))
    })
    .await;
    wait_trees("B displaced", &hb, |v| v.driving_tree.is_none()).await;
    println!("native_tree_fixture_ok");
}
