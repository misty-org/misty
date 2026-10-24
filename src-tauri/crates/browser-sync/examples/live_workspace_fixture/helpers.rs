//! Worker, workspace and sign-in helpers for the fixture.
use std::{path::Path, time::Duration};

use misty_browser_sync::{
    crypto::{VaultRoot, VaultScope},
    document::{self, credentials::Area, Change},
    store::{signin_digest_hex, BrowserObservation, Store},
    transport::SyncApi,
    worker::{Phase, Worker, WorkerHandle},
    workspace::{signin, sync::SyncState},
    Result,
};
use serde_json::json;
use tokio::{task::JoinHandle, time::timeout};

pub fn peer(
    path: &Path,
    api: SyncApi,
    scope: VaultScope,
    root: VaultRoot,
) -> (WorkerHandle, JoinHandle<Result<()>>) {
    let (store, device) = Store::unlock(path, scope.clone(), &root).unwrap();
    let (worker, handle) = Worker::new(api, scope, root, device, store, document::reduce).unwrap();
    (handle, tokio::spawn(worker.run()))
}

pub async fn wait_workspaces(
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

pub fn changes(value: serde_json::Value) -> Vec<Change> {
    serde_json::from_value(value).unwrap()
}

pub fn signins(cookie_value: &str, local: &str) -> Vec<BrowserObservation> {
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
pub async fn publish_signins(
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
pub async fn settled_signins(
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

pub async fn read_signins(
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

pub fn same(a: &[BrowserObservation], b: &[BrowserObservation]) -> bool {
    serde_json::to_value(a).unwrap() == serde_json::to_value(b).unwrap()
}
