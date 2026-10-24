//! The credential phase: replayed sign-in batches, a native import that
//! survives a restart, and logout.
use misty_browser_sync::{
    document::{entities::Kind, Document},
    worker::{Phase, WorkerHandle},
    Result,
};
use serde_json::json;
use tokio::task::JoinHandle;
use uuid::Uuid;

use crate::helpers::{bytes, credential, sync_to, wait_for};

type Peer = (WorkerHandle, JoinHandle<Result<()>>);

/// Runs with A and B caught up at sequence 4. `reopen` restarts B's worker on
/// its store; the returned peer is B's worker afterwards.
pub async fn run(
    ha: &WorkerHandle,
    hb: WorkerHandle,
    tb: JoinHandle<Result<()>>,
    reopen: impl Fn() -> Peer,
) -> Peer {
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
    let group = document.live(Kind::Folder, "social").unwrap().values();
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
    let (hb, tb) = reopen();
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
    (hb, tb)
}
