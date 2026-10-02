//! Live per-workspace fixture, driven by the server's
//! `TestBrowserSyncNativeWorkspacesAgainstGo`. Two real workers: A publishes its
//! workspace and sign-in data, B takes A's workspace over and receives A's tabs and
//! sign-ins, A is displaced and can no longer write them, then A takes its
//! workspace back and loads the sign-ins B wrote.
use std::{path::Path, time::Duration};

use misty_browser_sync::{
    crypto::{generate_sync_secret, DeviceKey, VaultRoot, VaultScope},
    document::{self, credentials::Area, Change, Document},
    protocol::Vault,
    store::{signin_digest_hex, BrowserObservation, CachedVault, DeviceSignin, Store},
    transport::SyncApi,
    worker::{Phase, Worker, WorkerHandle},
    workspace::{signin, sync::SyncState},
    Error, Result,
};
use serde_json::json;
use tokio::{task::JoinHandle, time::timeout};
use uuid::Uuid;

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

async fn wait_workspaces(
    label: &str,
    handle: &WorkerHandle,
    predicate: impl Fn(&SyncState) -> bool,
) {
    let mut workspaces = handle.workspaces.clone();
    let status = handle.status.clone();
    let result = timeout(Duration::from_secs(20), async {
        loop {
            {
                let state = status.borrow();
                assert!(
                    state.phase != Phase::Attention,
                    "{label}: worker requires attention: {:?}",
                    state.issue
                );
            }
            if predicate(&workspaces.borrow_and_update()) {
                return;
            }
            let _ = timeout(Duration::from_millis(250), workspaces.changed()).await;
        }
    })
    .await;
    if result.is_err() {
        let view = handle.workspaces.borrow();
        panic!(
            "{label}: timed out; driving={:?} versions={:?} pending={:?}",
            view.driving_workspace,
            view.contents
                .iter()
                .map(|(k, v)| (k.clone(), v.version, v.records.len()))
                .collect::<Vec<_>>(),
            view.pending
        );
    }
}

fn changes(value: serde_json::Value) -> Vec<Change> {
    serde_json::from_value(value).unwrap()
}

fn signins(cookie_value: &str, local: &str) -> Vec<BrowserObservation> {
    vec![
        BrowserObservation {
            area: Area::Cookies,
            payload: json!([{
                "name": "session", "value": cookie_value, "domain": "example.com", "path": "/",
                "host_only": true, "secure": true, "http_only": true, "same_site": "lax",
                "expires_unix_seconds": null, "partition_key": null
            }]),
        },
        BrowserObservation {
            area: Area::LocalStorage {
                origin: "https://example.com".into(),
            },
            payload: json!({ "k": local }),
        },
    ]
}

/// Publishes one complete set of sign-in data for the device `workspace`.
async fn publish_signins(
    handle: &WorkerHandle,
    workspace: &str,
    observations: &[BrowserObservation],
) -> Result<()> {
    let status = handle.signin_status(workspace.into()).await?;
    let packed = signin::pack(observations, &Default::default()).unwrap();
    let written: std::collections::BTreeMap<i16, String> = packed
        .digests
        .iter()
        .map(|(kind, digest)| (*kind, signin_digest_hex(digest)))
        .collect();
    let previous = status
        .binding
        .map(|binding| binding.written)
        .unwrap_or_default();
    let writes = (signin::FIRST_SLOT..=signin::LAST_SLOT)
        .filter(|kind| written.get(kind) != previous.get(kind))
        .map(|kind| (kind, packed.shards.get(&kind).cloned()))
        .collect();
    handle.write_signin(workspace.into(), writes, written).await
}

/// Waits until the device's sign-in slots are current, with nothing queued.
async fn settled_signins(
    label: &str,
    handle: &WorkerHandle,
    workspace: &str,
) -> misty_browser_sync::workspace::sync::SigninStatus {
    timeout(Duration::from_secs(20), async {
        loop {
            let status = handle.signin_status(workspace.into()).await.unwrap();
            if status.current && !status.pending && !status.server.is_empty() {
                return status;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("{label}: sign-in data did not settle"))
}

async fn read_signins(
    handle: &WorkerHandle,
    workspace: &str,
    status: &misty_browser_sync::workspace::sync::SigninStatus,
) -> Vec<BrowserObservation> {
    let mut shards = Vec::new();
    for kind in status.server.keys() {
        shards.push(
            handle
                .read_signin(workspace.into(), *kind)
                .await
                .unwrap()
                .expect("published shard"),
        );
    }
    signin::unpack(shards.iter().map(Vec::as_slice)).unwrap()
}

fn same(a: &[BrowserObservation], b: &[BrowserObservation]) -> bool {
    serde_json::to_value(a).unwrap() == serde_json::to_value(b).unwrap()
}

#[tokio::main]
async fn main() {
    let base = std::env::var("MISTY_SYNC_FIXTURE_BASE").expect("fixture server required");
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
    let api = SyncApi::new(&base, http).unwrap();
    let scope = VaultScope {
        deployment: api.deployment(),
        account_id: "owner".into(),
        vault_id: Uuid::new_v4().to_string(),
    };
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
    let (path_a, path_b) = (
        directory.path().join("a.sqlite"),
        directory.path().join("b.sqlite"),
    );
    let initial = Document::default().encode().unwrap();
    let vault = |bootstrap: bool| CachedVault {
        vault: Vault {
            vault_id: scope.vault_id.clone(),
            key_epoch: 1,
            head_sequence: 0,
            root_public_key: public.clone(),
            key_envelope: wrapper.clone(),
        },
        bootstrap_pending: bootstrap,
        enrollment_pending: true,
    };
    drop(
        Store::initialize_vault(
            &path_a,
            scope.clone(),
            ga,
            &root,
            &a,
            &initial,
            Some(&vault(true)),
        )
        .unwrap(),
    );
    let root_b = VaultRoot::unlock(&scope, &wrapper, password, &secret, &public).unwrap();
    let (ha, _ta) = peer(&path_a, api.clone(), scope.clone(), root);
    wait_workspaces("A connects", &ha, |v| {
        v.driving_workspace.as_deref() == Some(id_a.as_str())
    })
    .await;

    ha.workspace_changes(changes(json!([
        {"action":"create","kind":"window","id":"w1","fields":{"title":"Main","order":0}},
        {"action":"create","kind":"layout","id":"l1","fields":{"window_id":"w1","title":"","order":0,"tree":{"type":"leaf","id":"p1"}}},
        {"action":"create","kind":"tab","id":"t1","fields":{"surface":"browser","title":"Docs","placement":{"layout_id":"l1","pane_id":"p1","order":0},"url":"https://example.com/","profile_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","website_id":null,"tool_route":null,"agent_owned":false}},
        {"action":"create","kind":"group","id":"g1","fields":{"label":"Work","icon":"briefcase","order":0,"hidden":false}}
    ])))
    .await
    .unwrap();
    wait_workspaces("A publishes", &ha, |v| {
        v.pending.is_empty()
            && v.contents
                .get(&id_a)
                .is_some_and(|w| w.version >= 1 && w.records.iter().any(|r| r.id == "t1"))
            && v.contents
                .get(&scope.vault_id)
                .is_some_and(|w| w.records.iter().any(|r| r.id == "g1"))
    })
    .await;

    // A's own sign-in data, under A's lock.
    ha.bind_signin(
        id_a.clone(),
        DeviceSignin {
            physical_id: "a".repeat(64),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let from_a = signins("token-from-a", "local-from-a");
    publish_signins(&ha, &id_a, &from_a).await.unwrap();
    let a_status = settled_signins("A publishes sign-ins", &ha, &id_a).await;
    assert!(
        a_status
            .binding
            .as_ref()
            .unwrap()
            .reflects(&a_status.server),
        "A's store reflects what it published"
    );

    drop(
        Store::initialize_vault(
            &path_b,
            scope.clone(),
            gb,
            &root_b,
            &b,
            &initial,
            Some(&vault(false)),
        )
        .unwrap(),
    );
    let (hb, _tb) = peer(&path_b, api.clone(), scope.clone(), root_b);
    wait_workspaces("B connects", &hb, |v| {
        v.driving_workspace.as_deref() == Some(id_b.as_str())
    })
    .await;

    // B continues on A's workspace: it gets A's tabs, and A loses its seat.
    hb.claim_workspace(id_a.clone())
        .await
        .expect("B claims A's tree");
    wait_workspaces("B drives A", &hb, |v| {
        v.driving_workspace.as_deref() == Some(id_a.as_str())
            && v.contents
                .get(&id_a)
                .is_some_and(|w| w.records.iter().any(|r| r.id == "t1"))
    })
    .await;
    wait_workspaces("A displaced", &ha, |v| v.driving_workspace.is_none()).await;
    assert!(
        ha.workspace_changes(changes(
            json!([{"action":"patch","kind":"window","id":"w1","fields":{"title":"x"}}])
        ))
        .await
        .is_err(),
        "a displaced device cannot edit"
    );

    // B receives exactly A's sign-ins; displaced A can no longer write them.
    let b_view = settled_signins("B sees A's sign-ins", &hb, &id_a).await;
    assert_eq!(b_view.server, a_status.server);
    assert!(
        b_view.binding.is_none(),
        "B has no store for A's device yet, so it must load it"
    );
    assert!(same(
        &read_signins(&hb, &id_a, &b_view).await,
        &signin::unpack(
            signin::pack(&from_a, &Default::default())
                .unwrap()
                .shards
                .values()
                .map(Vec::as_slice)
        )
        .unwrap()
    ));
    assert!(
        matches!(
            publish_signins(&ha, &id_a, &signins("stale-a", "stale-a")).await,
            Err(Error::InactiveDevice)
        ),
        "a displaced device cannot write sign-ins"
    );
    hb.bind_signin(
        id_a.clone(),
        DeviceSignin {
            physical_id: "b".repeat(64),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let from_b = signins("token-from-b", "local-from-b");
    publish_signins(&hb, &id_a, &from_b).await.unwrap();
    let b_status = settled_signins("B publishes A's sign-ins", &hb, &id_a).await;
    assert_ne!(b_status.server, a_status.server);

    // B edits A's workspace; A takes it back and sees the edit.
    hb.workspace_changes(changes(
        json!([{"action":"patch","kind":"window","id":"w1","fields":{"title":"Edited on B"}}]),
    ))
    .await
    .unwrap();
    // Wait for the edit itself: sign-in writes also advance the version.
    wait_workspaces("B publishes", &hb, |v| {
        v.pending.is_empty()
            && v.contents.get(&id_a).is_some_and(|w| {
                w.records
                    .iter()
                    .any(|r| r.fields.get("title") == Some(&json!("Edited on B")))
            })
    })
    .await;
    ha.claim_workspace(id_a.clone())
        .await
        .expect("A takes its tree back");
    wait_workspaces("A drives again", &ha, |v| {
        v.driving_workspace.as_deref() == Some(id_a.as_str())
            && v.contents.get(&id_a).is_some_and(|w| {
                w.records
                    .iter()
                    .any(|r| r.fields.get("title") == Some(&json!("Edited on B")))
            })
    })
    .await;
    wait_workspaces("B displaced", &hb, |v| v.driving_workspace.is_none()).await;

    // A's store no longer reflects its device: it must load what B wrote.
    let back = settled_signins("A sees B's sign-ins", &ha, &id_a).await;
    assert_eq!(back.server, b_status.server);
    assert!(
        !back.binding.as_ref().unwrap().reflects(&back.server),
        "A detects that another session wrote its device"
    );
    let loaded = read_signins(&ha, &id_a, &back).await;
    assert!(
        loaded[0].payload.to_string().contains("token-from-b")
            && loaded[1].payload["k"] == "local-from-b"
    );
    println!("native_tree_fixture_ok");
}
