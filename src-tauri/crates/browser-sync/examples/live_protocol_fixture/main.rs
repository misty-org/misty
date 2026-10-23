//! Opt-in fixture launched by the Go integration suite against a disposable
//! loopback server/database. Never point this program at a real account.
use std::time::Duration;

use misty_browser_sync::{
    crypto::{generate_sync_secret, DeviceKey, VaultRoot, VaultScope},
    document::{self, Document},
    protocol::Vault,
    store::{CachedVault, Store},
    transport::{SyncApi, SyncSocket},
    worker::{Phase, Worker},
    Error,
};
use serde_json::json;
use tokio::time::timeout;
use uuid::Uuid;

mod credentials;
mod helpers;

use helpers::{bytes, peer, sync_to, wait_for, workspace};

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
        vault_id: Uuid::new_v4().to_string(),
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
    assert!(api.vault().await.unwrap().is_none());
    let directory = tempfile::tempdir().unwrap();
    let path_a = directory.path().join("a.sqlite");
    let path_b = directory.path().join("b.sqlite");
    let initial = Document::default().encode().unwrap();
    let cached_a = CachedVault {
        vault: Vault {
            vault_id: scope.vault_id.clone(),
            key_epoch: 1,
            head_sequence: 0,
            root_public_key: public.clone(),
            key_envelope: Some(wrapper.clone()),
            space_key_envelope: None,
            key_transition: None,
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
        anonymous.vault().await,
        Err(Error::Authentication)
    ));
    drop(root);
    let cached = Store::read_cached_vault(&path_a, &scope.deployment, &scope.account_id)
        .unwrap()
        .unwrap();
    let root = VaultRoot::unlock(
        &scope,
        cached.vault.key_envelope.as_ref().unwrap(),
        password,
        &secret,
        &cached.vault.root_public_key,
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
    assert_eq!(api.vault().await.unwrap().unwrap().root_public_key, public);
    let cached_b = CachedVault {
        vault: api.vault().await.unwrap().unwrap(),
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
    let (hb, tb) = credentials::run(&ha, hb, tb, || {
        let root_b = VaultRoot::unlock(&scope, &wrapper, password, &secret, &public).unwrap();
        peer(&path_b, api.clone(), scope.clone(), root_b)
    })
    .await;
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
