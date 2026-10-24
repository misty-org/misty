//! Payload builders and worker helpers shared by the fixture's phases.
use std::{path::Path, time::Duration};

use misty_browser_sync::{
    crypto::{VaultRoot, VaultScope},
    document,
    store::Store,
    transport::SyncApi,
    worker::{Phase, Worker, WorkerHandle},
    Result,
};
use serde_json::{json, Value};
use tokio::{task::JoinHandle, time::timeout};
use zeroize::Zeroizing;

pub fn workspace(changes: Value) -> Value {
    json!({"kind":"workspace","version":1,"changes":changes})
}
pub fn credential(updates: Value) -> Value {
    json!({"kind":"credentials","version":1,"batch":{"profile_id":"a".repeat(64),"updates":updates}})
}
pub fn bytes(value: Value) -> Zeroizing<Vec<u8>> {
    Zeroizing::new(serde_json::to_vec(&value).unwrap())
}
pub async fn sync_to(a: &WorkerHandle, b: &WorkerHandle, sequence: u64) {
    wait_for(a, |s| {
        s.applied_sequence == sequence && s.pending_changes == 0
    })
    .await;
    wait_for(b, |s| {
        s.applied_sequence == sequence && s.pending_changes == 0
    })
    .await;
}

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

pub async fn wait_for(
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
