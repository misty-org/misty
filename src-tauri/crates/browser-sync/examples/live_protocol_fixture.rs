//! Opt-in fixture launched by the Go integration suite against a disposable
//! loopback server/database. Never point this program at a real account.
use std::{path::Path, time::Duration};

use misty_browser_sync::{
    crypto::{generate_sync_secret, DeviceKey, VaultRoot, VaultScope},
    document::{self, entities::Kind, Document},
    protocol::Workspace,
    store::{CachedVault, Store},
    transport::{SyncApi, SyncSocket},
    worker::{Phase, Worker, WorkerHandle},
    Error, Result,
};
use serde_json::{json, Value};
use tokio::{task::JoinHandle, time::timeout};
use uuid::Uuid;
use zeroize::Zeroizing;

fn workspace(changes: Value) -> Value {
    json!({"kind":"workspace","version":1,"changes":changes})
}
fn credential(updates: Value) -> Value {
    json!({"kind":"credentials","version":1,"batch":{"profile_id":"a".repeat(64),"updates":updates}})
}
fn bytes(value: Value) -> Zeroizing<Vec<u8>> {
    Zeroizing::new(serde_json::to_vec(&value).unwrap())
}
async fn sync_to(a: &WorkerHandle, b: &WorkerHandle, sequence: u64) {
    wait_for(a, |s| {
        s.applied_sequence == sequence && s.pending_changes == 0
    })
    .await;
    wait_for(b, |s| {
        s.applied_sequence == sequence && s.pending_changes == 0
    })
    .await;
}

fn peer(
    path: &Path,
    api: SyncApi,
    scope: VaultScope,
    root: VaultRoot,
) -> (WorkerHandle, JoinHandle<Result<()>>) {
    let (store, device) = Store::unlock(path, scope.clone(), &root).unwrap();
    let (worker, handle) = Worker::new(api, scope, root, device, store, document::reduce).unwrap();
    (handle, tokio::spawn(worker.run()))
}

async fn wait_for(
    handle: &WorkerHandle,
    predicate: impl Fn(&misty_browser_sync::worker::Status) -> bool,
) {
    let mut status = handle.status.clone();
    timeout(Duration::from_secs(20), async {
        loop {
            {
                let state = status.borrow_and_update();
                assert!(
                    state.phase != Phase::Attention,
                    "worker requires attention: {:?}",
                    state.issue
                );
                if predicate(&state) {
                    return;
                }
            }
            status.changed().await.expect("worker stopped unexpectedly");
        }
    })
    .await
    .expect("sync fixture timed out");
}

#[tokio::main]
async fn main() {
    let base = std::env::var("MISTY_SYNC_FIXTURE_BASE").expect("fixture server required");
    let parsed = url::Url::parse(&base).unwrap();
    assert_eq!(parsed.scheme(), "http");
    assert_eq!(parsed.host_str(), Some("127.0.0.1"));
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::COOKIE,
        std::env::var("MISTY_SYNC_FIXTURE_COOKIE")
            .unwrap()
            .parse()
            .unwrap(),
    );
    let _ = rustls::crypto::ring::default_provider().install_default();
    let http = reqwest::Client::builder()
        .default_headers(headers)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();
    let api = SyncApi::new(&base, http.clone()).unwrap();
    let scope = VaultScope {
        deployment: api.deployment(),
        account_id: "owner".into(),
        workspace_id: Uuid::new_v4().to_string(),
    };
    let root = VaultRoot::generate();
    let secret = generate_sync_secret();
    let password = "public test-only sync password";
    let wrapper = root.wrap(&scope, password, &secret).unwrap();
    let public = root.public_key().unwrap();
    let a = DeviceKey::generate();
    let b = DeviceKey::generate();
    let ga = root
        .grant(&scope, &Uuid::new_v4().to_string(), 1, &a)
        .unwrap();
    let gb = root
        .grant(&scope, &Uuid::new_v4().to_string(), 1, &b)
        .unwrap();
    assert!(api.workspace().await.unwrap().is_none());
    let directory = tempfile::tempdir().unwrap();
    let path_a = directory.path().join("a.sqlite");
    let path_b = directory.path().join("b.sqlite");
    let initial = Document::default().encode().unwrap();
    let cached_a = CachedVault {
        workspace: Workspace {
            workspace_id: scope.workspace_id.clone(),
            key_epoch: 1,
            head_sequence: 0,
            root_public_key: public.clone(),
            key_envelope: wrapper.clone(),
        },
        bootstrap_pending: true,
        enrollment_pending: true,
    };
    drop(
        Store::initialize_vault(
            &path_a,
            scope.clone(),
            ga.clone(),
            &root,
            &a,
            &initial,
            Some(&cached_a),
        )
        .unwrap(),
    );
    // The fixture server drops the first successful bootstrap response. The
    // worker must recover using this persisted wrapper/grant before publishing.
    let anonymous = SyncApi::new(
        &base,
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap(),
    )
    .unwrap();
    assert!(matches!(
        anonymous.workspace().await,
        Err(Error::Authentication)
    ));
    drop(root);
    let cached = Store::read_cached_vault(&path_a, &scope.deployment, &scope.account_id)
        .unwrap()
        .unwrap();
    let root = VaultRoot::unlock(
        &scope,
        &cached.workspace.key_envelope,
        password,
        &secret,
        &cached.workspace.root_public_key,
    )
    .unwrap();
    let root_b = VaultRoot::unlock(&scope, &wrapper, password, &secret, &public).unwrap();
    let (ha, ta) = peer(&path_a, api.clone(), scope.clone(), root);
    ha.enqueue(bytes(workspace(json!([
        {"action":"create","kind":"group","id":"social","fields":{"label":"Social","icon":"messages","order":0,"hidden":false}}
    ])))).await.unwrap();
    wait_for(&ha, |status| {
        status.applied_sequence == 1 && status.pending_changes == 0
    })
    .await;
    assert!(matches!(
        SyncSocket::connect(
            &api,
            &scope,
            &ga,
            &a,
            &VaultRoot::generate().public_key().unwrap(),
            0
        )
        .await,
        Err(Error::Identity)
    ));
    assert_eq!(
        api.workspace().await.unwrap().unwrap().root_public_key,
        public
    );
    let cached_b = CachedVault {
        workspace: api.workspace().await.unwrap().unwrap(),
        bootstrap_pending: false,
        enrollment_pending: true,
    };
    drop(
        Store::initialize_vault(
            &path_b,
            scope.clone(),
            gb,
            &root_b,
            &b,
            &initial,
            Some(&cached_b),
        )
        .unwrap(),
    );
    let (hb, tb) = peer(&path_b, api.clone(), scope.clone(), root_b);
    sync_to(&ha, &hb, 1).await;
    assert!(
        !Store::read_cached_vault(&path_a, &scope.deployment, &scope.account_id)
            .unwrap()
            .unwrap()
            .enrollment_pending
    );
    assert!(
        !Store::read_cached_vault(&path_b, &scope.deployment, &scope.account_id)
            .unwrap()
            .unwrap()
            .enrollment_pending
    );
    let (ra, rb) = tokio::join!(
        ha.enqueue(bytes(workspace(
            json!([{"action":"patch","kind":"group","id":"social","fields":{"label":"Friends"}}])
        ))),
        hb.enqueue(bytes(workspace(
            json!([{"action":"patch","kind":"group","id":"social","fields":{"hidden":true}}])
        )))
    );
    ra.unwrap();
    rb.unwrap();
    sync_to(&ha, &hb, 3).await;
    assert!(
        ha.status.borrow().phase == Phase::CatchingUp,
        "connected must not imply imported"
    );
    ha.imports_applied(3).await.unwrap();
    hb.imports_applied(3).await.unwrap();
    wait_for(&ha, |s| s.phase == Phase::Ready).await;
    wait_for(&hb, |s| s.phase == Phase::Ready).await;
    http.post(format!("{base}/fixture/offline"))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();
    wait_for(&ha, |s| s.phase == Phase::Offline).await;
    wait_for(&hb, |s| s.phase == Phase::Offline).await;
    timeout(
        Duration::from_secs(2),
        ha.enqueue(bytes(workspace(json!([{"action":"patch","kind":"group","id":"social","fields":{"label":"Offline rename"}}])))),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(ha.status.borrow().pending_changes, 1);
    ha.stop();
    ta.await.unwrap().unwrap();
    let root_a = VaultRoot::unlock(&scope, &wrapper, password, &secret, &public).unwrap();
    let (ha, ta) = peer(&path_a, api.clone(), scope.clone(), root_a);
    assert_eq!(ha.status.borrow().pending_changes, 1);
    http.post(format!("{base}/fixture/online"))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();
    sync_to(&ha, &hb, 4).await;
    hb.imports_applied(3).await.unwrap();
    assert!(
        hb.status.borrow().phase == Phase::CatchingUp,
        "old import completion must not mark new state ready"
    );
    assert!(hb.imports_applied(5).await.is_err());
    ha.enqueue(bytes(credential(json!([
        {"area":{"kind":"local_storage","origin":"https://accounts.example.test"},"base_sequence":0,"payload":{"token":"native-private-cookie-fixture-v1"}},
        {"area":{"kind":"session_storage","origin":"https://accounts.example.test","tab_id":"tab:one"},"base_sequence":0,"payload":{"nonce":"native-private-cookie-fixture-nonce"}}
    ])))).await.unwrap();
    sync_to(&ha, &hb, 5).await;
    assert!(
        hb.imports_applied(5).await.is_err(),
        "credential replay is not native import evidence"
    );
    let import_id = Uuid::new_v4().to_string();
    let staged = hb
        .begin_browser_import("a".repeat(64), 0, import_id.clone(), 5)
        .await
        .unwrap();
    assert!(hb.enqueue(bytes(credential(json!([
        {"area":{"kind":"local_storage","origin":"https://accounts.example.test"},"base_sequence":5,"payload":{"token":"partial-import-must-not-echo"}}
    ])))).await.is_err());
    // Synthetic read-back exercises worker ordering, not a real browser engine.
    hb.finish_browser_import(
        "a".repeat(64),
        staged.revision,
        import_id,
        staged.pending.unwrap().credentials,
    )
    .await
    .unwrap();
    hb.imports_applied(5).await.unwrap();
    wait_for(&hb, |s| s.phase == Phase::Ready).await;
    hb.enqueue(bytes(credential(json!([
        {"area":{"kind":"local_storage","origin":"https://accounts.example.test"},"base_sequence":5,"payload":{"token":"native-private-cookie-fixture-v2"}}
    ])))).await.unwrap();
    sync_to(&ha, &hb, 6).await;
    ha.enqueue(bytes(credential(json!([
        {"area":{"kind":"local_storage","origin":"https://accounts.example.test"},"base_sequence":5,"payload":{"token":"native-private-cookie-fixture-stale"}},
        {"area":{"kind":"session_storage","origin":"https://accounts.example.test","tab_id":"tab:one"},"base_sequence":5,"payload":{"nonce":"native-private-cookie-fixture-stale"}}
    ])))).await.unwrap();
    sync_to(&ha, &hb, 7).await;
    let before_logout: Document = serde_json::from_slice(&ha.snapshot().await.unwrap()).unwrap();
    assert_eq!(before_logout.rejected_credentials_by_device.len(), 1);
    assert!(before_logout
        .credentials
        .values()
        .any(|v| v.payload == json!({"token":"native-private-cookie-fixture-v2"})));
    assert!(before_logout
        .credentials
        .values()
        .any(|v| v.payload == json!({"nonce":"native-private-cookie-fixture-nonce"})));
    hb.enqueue(bytes(credential(json!([
        {"area":{"kind":"local_storage","origin":"https://accounts.example.test"},"base_sequence":6,"payload":{}},
        {"area":{"kind":"session_storage","origin":"https://accounts.example.test","tab_id":"tab:one"},"base_sequence":5,"payload":{}}
    ])))).await.unwrap();
    sync_to(&ha, &hb, 8).await;
    ha.enqueue(bytes(credential(json!([
        {"area":{"kind":"local_storage","origin":"https://accounts.example.test"},"base_sequence":6,"payload":{"token":"native-private-cookie-fixture-v2"}}
    ])))).await.unwrap();
    sync_to(&ha, &hb, 9).await;
    let state_a = ha.snapshot().await.unwrap();
    let state_b = hb.snapshot().await.unwrap();
    assert_eq!(*state_a, *state_b);
    let document: Document = serde_json::from_slice(&state_a).unwrap();
    let group = document.live(Kind::Group, "social").unwrap().values();
    assert_eq!(group["label"], "Offline rename");
    assert_eq!(group["hidden"], true);
    assert!(document
        .credentials
        .values()
        .all(|v| v.payload == json!({})));
    assert!(
        hb.imports_applied(9).await.is_err(),
        "old native receipt cannot cover logout"
    );
    let import_id = Uuid::new_v4().to_string();
    let staged = hb
        .begin_browser_import("a".repeat(64), 2, import_id.clone(), 9)
        .await
        .unwrap();
    hb.stop();
    tb.await.unwrap().unwrap();
    let root_b = VaultRoot::unlock(&scope, &wrapper, password, &secret, &public).unwrap();
    let (hb, tb) = peer(&path_b, api.clone(), scope.clone(), root_b);
    let recovered = hb.browser_import_journal("a".repeat(64)).await.unwrap();
    assert_eq!(recovered.revision, staged.revision);
    assert_eq!(recovered.pending.as_ref().unwrap().id, import_id);
    assert!(hb.imports_applied(9).await.is_err());
    hb.finish_browser_import(
        "a".repeat(64),
        recovered.revision,
        import_id,
        recovered.pending.unwrap().credentials,
    )
    .await
    .unwrap();
    hb.imports_applied(9).await.unwrap();
    wait_for(&hb, |s| s.phase == Phase::Ready).await;
    ha.stop();
    hb.stop();
    ta.await.unwrap().unwrap();
    tb.await.unwrap().unwrap();
    // An acknowledged/observed head must survive process restart even when its
    // events have not yet been applied. Never silently accept an older server.
    let root_a = VaultRoot::unlock(&scope, &wrapper, password, &secret, &public).unwrap();
    let (mut store, device) = Store::unlock(&path_a, scope.clone(), &root_a).unwrap();
    store.observe_head(10).unwrap();
    let (worker, handle) =
        Worker::new(api, scope, root_a, device, store, document::reduce).unwrap();
    assert!(matches!(
        timeout(Duration::from_secs(10), worker.run())
            .await
            .unwrap(),
        Err(Error::Recovery)
    ));
    assert!(handle.status.borrow().phase == Phase::Attention);
    assert_eq!(handle.status.borrow().applied_sequence, 9);
    println!("native_protocol_fixture_ok");
}
