use misty_browser_sync::{
    crypto::{DeviceKey, VaultRoot, VaultScope},
    store::Store,
    transport::SyncApi,
    worker::{Phase, Worker},
};
use std::{
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    time::timeout,
};
use uuid::Uuid;
use zeroize::Zeroizing;

fn client() -> reqwest::Client {
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap()
}

#[tokio::test]
async fn authenticated_requests_refresh_once_retry_and_persist_rotated_cookies() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}/v1", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        for (expected, status, body) in [
            (
                "GET /v1/sync/workspace ",
                "401 Unauthorized",
                r#"{"code":"not_authenticated"}"#,
            ),
            ("POST /v1/auth/refresh ", "204 No Content", ""),
            ("GET /v1/sync/workspace ", "200 OK", r#"{"workspace":null}"#),
        ] {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = vec![0; 8192];
            let read = stream.read(&mut request).await.unwrap();
            assert!(String::from_utf8_lossy(&request[..read]).starts_with(expected));
            stream
                .write_all(
                    format!(
                        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
        }
    });
    let persisted = Arc::new(AtomicUsize::new(0));
    let called = persisted.clone();
    let api = SyncApi::new(&base, client())
        .unwrap()
        .with_refresh_hook(move || {
            called.fetch_add(1, Ordering::SeqCst);
            Ok(())
        });
    assert!(api.workspace().await.unwrap().is_none());
    assert_eq!(persisted.load(Ordering::SeqCst), 1);
    server.await.unwrap();
}

#[test]
fn endpoints_reject_insecure_remote_hosts_credentials_and_query_injection() {
    for base in [
        "https://example.test/api",
        "http://127.0.0.1:1234/v1",
        "http://[::1]:1234",
        "http://localhost",
    ] {
        assert!(SyncApi::new(base, client()).is_ok(), "{base}");
    }
    for base in [
        "http://192.168.1.1",
        "http://example.test",
        "https://user:secret@example.test",
        "https://example.test/?ticket=bad",
        "https://example.test/#other",
        "file:///tmp/sync",
        "https://localhost.evil.test@evil.test",
    ] {
        assert!(SyncApi::new(base, client()).is_err(), "{base}");
    }
}

#[tokio::test]
async fn pending_connection_does_not_block_local_durability_or_lock() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let api = SyncApi::new(
        &format!("http://{}", listener.local_addr().unwrap()),
        client(),
    )
    .unwrap();
    let stalled = tokio::spawn(async move {
        let (_connection, _) = listener.accept().await.unwrap();
        std::future::pending::<()>().await;
    });
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("sync.sqlite");
    let root = VaultRoot::generate();
    let device = DeviceKey::generate();
    let scope = VaultScope {
        deployment: api.deployment(),
        account_id: "fixture".into(),
        workspace_id: Uuid::new_v4().to_string(),
    };
    let grant = root
        .grant(&scope, &Uuid::new_v4().to_string(), 1, &device)
        .unwrap();
    let store = Store::initialize(&path, scope.clone(), grant, &root, &device, b"").unwrap();
    let (worker, handle) = Worker::new(api, scope, root, device, store, |state, _, _| {
        Ok(Zeroizing::new(state.to_vec()))
    })
    .unwrap();
    let task = tokio::spawn(worker.run());
    timeout(
        Duration::from_secs(2),
        handle.enqueue(Zeroizing::new(b"offline secret".to_vec())),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(handle.status.borrow().pending_changes, 1);
    handle.stop();
    timeout(Duration::from_secs(2), task)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(handle.status.borrow().phase == Phase::Stopped);
    let connection = rusqlite::Connection::open(path).unwrap();
    assert_eq!(
        connection
            .query_row::<i64, _, _>("SELECT count(*) FROM sync_outbox", [], |r| r.get(0))
            .unwrap(),
        1
    );
    stalled.abort();
}

#[tokio::test]
async fn offline_edits_are_validated_against_pending_creates_without_advancing_committed_state() {
    use misty_browser_sync::document::{self, Document};
    use serde_json::json;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let api = SyncApi::new(
        &format!("http://{}", listener.local_addr().unwrap()),
        client(),
    )
    .unwrap();
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("sync.sqlite");
    let root = VaultRoot::generate();
    let device = DeviceKey::generate();
    let scope = VaultScope {
        deployment: api.deployment(),
        account_id: "fixture".into(),
        workspace_id: Uuid::new_v4().to_string(),
    };
    let grant = root
        .grant(&scope, &Uuid::new_v4().to_string(), 1, &device)
        .unwrap();
    let store = Store::initialize(
        &path,
        scope.clone(),
        grant,
        &root,
        &device,
        &Document::default().encode().unwrap(),
    )
    .unwrap();
    let (worker, handle) = Worker::new(api, scope, root, device, store, document::reduce).unwrap();
    let task = tokio::spawn(worker.run());
    let encode = |change| {
        Zeroizing::new(
            serde_json::to_vec(&json!({"kind":"workspace","version":1,"changes":[change]}))
                .unwrap(),
        )
    };
    let create = handle.enqueue(encode(json!({"action":"create","kind":"group","id":"social","fields":{"label":"Social","icon":"messages","order":0,"hidden":false}}))).await.unwrap();
    // A patch may depend on a create which has not reached the server yet.
    let patch = handle
        .enqueue(encode(
            json!({"action":"patch","kind":"group","id":"social","fields":{"label":"Friends"}}),
        ))
        .await
        .unwrap();
    assert!(handle.enqueue(encode(json!({"action":"patch","kind":"group","id":"social","fields":{"active_tab":"private-focus"}}))).await.is_err());
    assert!(handle
        .enqueue(Zeroizing::new(b"not JSON".to_vec()))
        .await
        .is_err());
    let pending = handle.pending_snapshot().await.unwrap();
    assert_eq!(pending.committed_sequence, 0);
    assert_eq!(pending.operation_ids, vec![create, patch]);
    let projected: Document = serde_json::from_slice(&pending.snapshot).unwrap();
    assert_eq!(
        projected.workspace_view().unwrap().records[0].fields["label"],
        "Friends"
    );
    let committed: Document = serde_json::from_slice(&handle.snapshot().await.unwrap()).unwrap();
    assert_eq!(committed.sequence, 0);
    assert!(committed.records.is_empty());
    assert_eq!(handle.status.borrow().pending_changes, 2);
    assert!(handle.imports_applied(2).await.is_err());
    handle.stop();
    timeout(Duration::from_secs(2), task)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let connection = rusqlite::Connection::open(path).unwrap();
    let next: u64 = connection
        .query_row("SELECT next_counter FROM sync_identity", [], |r| r.get(0))
        .unwrap();
    assert_eq!(next, 3, "rejected edits must not consume a device counter");
}
