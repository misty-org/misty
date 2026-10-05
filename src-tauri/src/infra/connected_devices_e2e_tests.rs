//! Two devices in one process, each with its own built-in peer transport
//! worker, exercising the whole Connected Devices flow over a real connection:
//! an explicit connect, browsing, file changes and transfers with byte counts,
//! consent, clipboard sharing, reconnecting from a local session, and ending it.

use std::{
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
    time::Duration,
};

use super::*;
use crate::{
    domain::{
        clipboard::{ClipboardPayload, ClipboardPayloadKind, SharedClipboardClient},
        explorer::{ClipboardOperation, PasteItem, PasteItemsRequest},
        operation_queue::OperationStatus,
    },
    infra::{
        document_intelligence::ServiceLease,
        environment::AppEnvironmentService,
        explorer::ExplorerService,
        explorer_library::ExplorerLibraryService,
        operation_queue::OperationQueueService,
        peer_files::PeerVirtualPath,
        transfers::{TransferFilter, TransferService},
    },
    platform::mini_app::{insert_builtin_test_instance, MiniAppState},
};
use ed25519_dalek::{Signer, SigningKey};

const ACCOUNT: &str = "e2e-account";
const KEY_ID: &str = "e2e-key";

struct Device {
    service: ConnectedDevicesService,
    explorer: ExplorerService,
    transfers: TransferService,
    network_id: String,
    endpoint_id: String,
    address: serde_json::Value,
    _state: MiniAppState,
    _directories: Vec<tempfile::TempDir>,
}

async fn device(label: &str, local_id: &str, network_id: &str, signing: &SigningKey) -> Device {
    let state = MiniAppState::default();
    insert_builtin_test_instance(&state, label, ACCOUNT, "devices");
    let lease = Arc::new(
        ServiceLease::acquire_service(&state, label, "files", "peer-transport", 2)
            .await
            .unwrap(),
    );
    let cache = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();
    let environment = AppEnvironmentService::for_test_home(home.path().to_path_buf());
    let transfers = TransferService::new(environment.clone());
    let explorer = ExplorerService::new(
        environment.clone(),
        transfers.clone(),
        ExplorerLibraryService::new(environment),
    );
    let service = ConnectedDevicesService::new(cache.path().to_path_buf());
    service.set_local_explorer(explorer.clone());
    let snapshot = service
        .initialize(
            InitializeConnectedDevicesRequest {
                account_id: ACCOUNT.into(),
                device_id: local_id.into(),
                device_name: label.into(),
                development_ticket_keys: HashMap::from([(
                    KEY_ID.to_owned(),
                    STANDARD.encode(signing.verifying_key().to_bytes()),
                )]),
                instance: label.into(),
            },
            lease,
        )
        .await
        .unwrap();
    service.set_network_identity(network_id.into()).unwrap();
    service.configure_sessions(7).unwrap();
    Device {
        service,
        explorer,
        transfers,
        network_id: network_id.into(),
        endpoint_id: snapshot.endpoint_id.unwrap(),
        address: snapshot.addressing.unwrap(),
        _state: state,
        _directories: vec![cache, home],
    }
}

/// A ticket as Misty's server issues one for `source` to reach `target`.
fn ticket(signing: &SigningKey, source: &Device, target: &Device) -> String {
    let now = unix_now();
    let encode = |value: serde_json::Value| URL_SAFE_NO_PAD.encode(value.to_string());
    let header = encode(serde_json::json!({"alg": "EdDSA", "typ": "JWT", "kid": KEY_ID}));
    let claims = encode(serde_json::json!({
        "iss": "misty-api",
        "aud": DEVICE_PROTOCOL_VERSION,
        "jti": uuid::Uuid::new_v4().to_string(),
        "pairId": "pair_e2e",
        "sourceDeviceId": source.network_id,
        "sourceEndpointId": source.endpoint_id,
        "targetDeviceId": target.network_id,
        "targetEndpointId": target.endpoint_id,
        "protocolVersion": DEVICE_PROTOCOL_VERSION,
        "permissions": ["roots:read", "files:read", "directories:subscribe"],
        "iat": now,
        "exp": now + 240,
    }));
    let signature = signing.sign(format!("{header}.{claims}").as_bytes());
    format!(
        "{header}.{claims}.{}",
        URL_SAFE_NO_PAD.encode(signature.to_bytes())
    )
}

fn consent(device: &Device, accepts_writes: bool) -> Vec<PairConsent> {
    vec![PairConsent {
        device_id: device.network_id.clone(),
        accepts_writes,
        shares_clipboard: true,
    }]
}

fn watch<'a>(bytes: &'a AtomicU64, canceled: &'a AtomicBool) -> TransferWatch<'a> {
    TransferWatch {
        bytes: Some(bytes),
        canceled: Some(canceled),
    }
}

async fn eventually(mut condition: impl FnMut() -> bool) -> bool {
    for _ in 0..100 {
        if condition() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    false
}

// Opt-in, like the other worker-backed tests: it runs two transport workers
// and real network traffic, which slows timing-sensitive tests beside it.
// cargo test --lib e2e_tests -- --ignored
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "starts two peer transport workers on the local network"]
async fn devices_connect_share_files_and_clipboard_and_keep_local_sessions() {
    let credentials = tempfile::tempdir().unwrap();
    let _ = misty_credential_store::configure_root(credentials.path().to_path_buf());
    let signing = SigningKey::from_bytes(&[42u8; 32]);
    let a = device("device-a", "device_aaaaaaaaaaaa", "device_net-a", &signing).await;
    let b = device("device-b", "device_bbbbbbbbbbbb", "device_net-b", &signing).await;
    let (peer_a, peer_b) = (a.network_id.as_str(), b.network_id.as_str());

    // Each device keeps its own consent: B lets A change its files.
    a.service.sync_pairs(consent(&b, false)).unwrap();
    b.service.sync_pairs(consent(&a, true)).unwrap();

    // An explicit connect, authorized once by a server ticket.
    a.service
        .connect(ConnectPeerRequest {
            instance: "device-a".into(),
            device_id: peer_b.into(),
            address: b.address.clone(),
            ticket: ticket(&signing, &a, &b),
        })
        .await
        .unwrap();
    assert!(a.service.is_connected(peer_b));
    let now = unix_now();
    let session = |device: &Device, peer: &str| {
        device
            .service
            .snapshot()
            .unwrap()
            .sessions
            .into_iter()
            .find(|session| session.device_id == peer)
            .unwrap()
    };
    assert!(session(&a, peer_b).outgoing_expires_at > now + 6 * 86_400);
    assert!(session(&b, peer_a).incoming_expires_at > now + 6 * 86_400);

    // B's shared folder, as A addresses it.
    let shared = tempfile::tempdir().unwrap();
    let shared_path = std::fs::canonicalize(shared.path()).unwrap();
    let roots = a.service.roots(peer_b).await.unwrap();
    let system = roots
        .iter()
        .find(|root| {
            matches!(
                root.kind,
                crate::domain::connected_devices::PeerRootKind::System
            )
        })
        .unwrap();
    let relative = shared_path.strip_prefix("/").unwrap();
    let directory = PeerVirtualPath::format(peer_b, &system.id, relative).unwrap();
    let listing = a
        .service
        .list_directory(PeerPathRequest {
            device_id: peer_b.into(),
            path: directory.clone(),
            show_hidden: false,
        })
        .await
        .unwrap();
    assert!(matches!(
        listing,
        PeerResponse::Directory { writable: true, .. }
    ));

    // Upload, counting bytes as they leave.
    let local = tempfile::tempdir().unwrap();
    let content: Vec<u8> = (0..3_000_000u32).map(|value| (value % 251) as u8).collect();
    let source = local.path().join("upload.bin");
    std::fs::write(&source, &content).unwrap();
    let (sent, not_canceled) = (AtomicU64::new(0), AtomicBool::new(false));
    a.service
        .upload_file(
            &source,
            &directory,
            "upload.bin",
            watch(&sent, &not_canceled),
        )
        .await
        .unwrap();
    assert_eq!(
        std::fs::read(shared_path.join("upload.bin")).unwrap(),
        content
    );
    assert_eq!(sent.load(Ordering::Relaxed), content.len() as u64);
    // Uploads never replace an existing item.
    assert!(a
        .service
        .upload_file(&source, &directory, "upload.bin", TransferWatch::default())
        .await
        .is_err());

    // Create, rename, copy within B, and delete.
    let folder = a
        .service
        .create_item(&directory, "Folder", true)
        .await
        .unwrap();
    assert!(shared_path.join("Folder").is_dir());
    let uploaded = PeerVirtualPath::parse(&directory)
        .unwrap()
        .child("upload.bin")
        .unwrap();
    let renamed = a
        .service
        .rename_item(&uploaded, "renamed.bin")
        .await
        .unwrap();
    assert!(shared_path.join("renamed.bin").is_file());
    let copied = a
        .service
        .transfer_item(&renamed.path, &folder.path, "copy.bin", true)
        .await
        .unwrap();
    assert_eq!(
        std::fs::read(shared_path.join("Folder/copy.bin")).unwrap(),
        content
    );
    a.service.delete_item(&renamed.path, true).await.unwrap();
    assert!(!shared_path.join("renamed.bin").exists());

    // Download, counting bytes as they arrive.
    let received = AtomicU64::new(0);
    let downloaded = a
        .service
        .materialize_with(&copied.path, watch(&received, &not_canceled))
        .await
        .unwrap();
    assert_eq!(std::fs::read(downloaded.local_path).unwrap(), content);
    assert_eq!(received.load(Ordering::Relaxed), content.len() as u64);

    // Through A's transfer queue, the transfer record shows every byte.
    let queue = OperationQueueService::new(a.explorer.clone(), a.transfers.clone())
        .with_connected_devices(a.service.clone());
    queue
        .enqueue_paste_items(PasteItemsRequest {
            sources: vec![PasteItem {
                path: source.to_string_lossy().into_owned(),
                is_directory: false,
                size_bytes: Some(content.len() as i64),
                remote_modified: None,
            }],
            destination_directory: folder.path.clone(),
            operation: ClipboardOperation::Copy,
            target_name: None,
        })
        .await
        .unwrap();
    let mut finished = None;
    for _ in 0..200 {
        let snapshot = queue.snapshot().await;
        let operation = snapshot.operations.first().cloned();
        if let Some(operation) = operation.filter(|operation| {
            !matches!(
                operation.status,
                OperationStatus::Queued | OperationStatus::InProgress
            )
        }) {
            finished = Some(operation);
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let finished = finished.expect("the queued upload finished");
    assert_eq!(
        finished.status,
        OperationStatus::Completed,
        "{}",
        finished.error_message
    );
    assert_eq!(
        std::fs::read(shared_path.join("Folder/upload.bin")).unwrap(),
        content
    );
    let record = a
        .transfers
        .snapshot(TransferFilter::default())
        .await
        .unwrap()
        .rows
        .into_iter()
        .find(|row| row.id == finished.transfer_id)
        .unwrap();
    assert_eq!(record.transferred_bytes, content.len() as i64);
    assert_eq!(record.total_bytes, content.len() as i64);

    // B changes its mind: the next change is refused at once, without the server.
    b.service.sync_pairs(consent(&a, false)).unwrap();
    assert!(a
        .service
        .create_item(&directory, "Denied", true)
        .await
        .is_err());
    assert!(!shared_path.join("Denied").exists());

    // Clipboard: copying on A reaches B.
    let pasted = Arc::new(Mutex::new(Vec::<ClipboardPayload>::new()));
    let sink = pasted.clone();
    b.service
        .set_clipboard_handler(Arc::new(move |payload| sink.lock().unwrap().push(payload)))
        .unwrap();
    assert!(a.service.publish(&ClipboardPayload {
        kind: ClipboardPayloadKind::Text,
        text: "copied on A".into(),
        revision: 1,
        ..ClipboardPayload::default()
    }));
    assert!(
        eventually(|| pasted
            .lock()
            .unwrap()
            .iter()
            .any(|payload| payload.text == "copied on A"))
        .await
    );

    // A dropped connection comes back from the local session alone.
    let connection = a.service.authorized_connection(peer_b).unwrap();
    a.service.drop_connection(peer_b, &connection);
    assert!(!a.service.is_connected(peer_b));
    a.service.resume_sessions(HashMap::new()).await.unwrap();
    assert!(a.service.is_connected(peer_b));

    // Ending the session ends it on both devices; nothing reconnects by itself.
    a.service.end_session(peer_b).await.unwrap();
    assert_eq!(session(&a, peer_b).outgoing_expires_at, 0);
    assert!(eventually(|| session(&b, peer_a).incoming_expires_at == 0).await);
    a.service.resume_sessions(HashMap::new()).await.unwrap();
    assert!(!a.service.is_connected(peer_b));
}
