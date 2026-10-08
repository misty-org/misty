//! Two devices in one process, each with its own built-in peer transport
//! worker, exercising the whole flow over a real LAN connection: trust from the
//! root-signed device list, clipboard sharing, agent file delivery,
//! reconnecting, and removal. Misty no longer shares files between devices.

use std::{
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
    time::Duration,
};

use super::*;
use crate::infra::{
    device_records::{DeviceList, DevicePolicy, ListMember, SignedRecord},
    device_trust,
};
use crate::{
    domain::{
        clipboard::{ClipboardPayload, ClipboardPayloadKind, SharedClipboardClient},
    },
    infra::{
        document_intelligence::ServiceLease,
        environment::AppEnvironmentService,
        explorer::ExplorerService,
        explorer_library::ExplorerLibraryService,
        transfers::TransferService,
    },
    platform::mini_app::{insert_builtin_test_instance, MiniAppState},
};
use misty_browser_sync::crypto::VaultRoot;

const ACCOUNT: &str = "e2e-account";
const VAULT: &str = "00000000-0000-0000-0000-0000000000e2";

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

async fn device(label: &str, local_id: &str, network_id: &str) -> Device {
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
                instance: label.into(),
            },
            lease,
        )
        .await
        .unwrap();
    service.set_network_identity(network_id.into()).unwrap();
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

fn member(device: &Device) -> ListMember {
    ListMember {
        device_id: device.network_id.clone(),
        public_key: STANDARD.encode(hex::decode(&device.endpoint_id).unwrap()),
    }
}

/// The account's device list, signed by the vault root as an added device would.
fn signed_list(
    root: &VaultRoot,
    version: u64,
    admitted: &[ListMember],
    revoked: &[ListMember],
) -> SignedRecord {
    let payload =
        DeviceList::next_payload(ACCOUNT, VAULT, version, 1, admitted, revoked, unix_now())
            .unwrap();
    SignedRecord::new(&payload, root.sign_device_record(&payload).unwrap())
}

fn set_policy(files: &str, clipboard: bool) {
    let policy = DevicePolicy {
        version: unix_now() as u64,
        files: files.into(),
        clipboard,
        agent_surfaces: vec![],
        shared_folders: vec![],
    };
    device_trust::store_own_policy(
        policy,
        SignedRecord {
            payload: String::new(),
            signature: String::new(),
        },
    )
    .unwrap();
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
async fn devices_trust_the_signed_list_share_the_clipboard_and_drop_removed_devices() {
    let credentials = tempfile::tempdir().unwrap();
    let _ = misty_credential_store::configure_root(credentials.path().to_path_buf());
    let trust = tempfile::tempdir().unwrap();
    device_trust::set_storage_root(trust.path().to_path_buf());
    device_trust::open("https://misty.test", ACCOUNT, "device_eeeeeeeeeeee").unwrap();
    // Both devices share this process's trust state; neither key is "this device".
    device_trust::set_server_device_id("device_00000000-0000-0000-0000-000000000000").unwrap();
    device_trust::set_own_endpoint(&"0".repeat(64)).unwrap();
    let a = device(
        "device-a",
        "device_aaaaaaaaaaaa",
        "device_00000000-0000-0000-0000-00000000000a",
    )
    .await;
    let b = device(
        "device-b",
        "device_bbbbbbbbbbbb",
        "device_00000000-0000-0000-0000-00000000000b",
    )
    .await;
    let peer_b = b.network_id.as_str();
    let root = VaultRoot::generate();
    device_trust::pin_root(&root.public_key().unwrap(), VAULT).unwrap();
    device_trust::apply_server_list(Some(&signed_list(&root, 1, &[member(&a), member(&b)], &[])))
        .unwrap();
    set_policy("edit", true);

    // No ticket and no session: the list is the only trust, the handshake
    // proves the key, and the address is only a hint.
    let candidates = crate::infra::device_channel::lan_candidates(&b.address);
    a.service
        .connect_device(peer_b, &b.endpoint_id, candidates.clone())
        .await
        .unwrap();
    assert!(a.service.is_connected(peer_b));

    // Misty no longer shares files with other devices; that moved to Kura.
    assert!(a
        .service
        .roots(peer_b)
        .await
        .map_or(true, |roots| roots.is_empty()));

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

    // An agent's file send: A delivers a file straight to B over the LAN, and
    // B keeps it only because B signed the grant for its own inbox.
    let inbox = tempfile::tempdir().unwrap();
    delivery::set_test_inbox(inbox.path().to_path_buf());
    device_trust::open("https://misty.test", ACCOUNT, "device_bbbbbbbbbbbb").unwrap();
    device_trust::set_server_device_id(peer_b).unwrap();
    device_trust::set_own_endpoint(&"0".repeat(64)).unwrap();
    device_trust::pin_root(&root.public_key().unwrap(), VAULT).unwrap();
    device_trust::apply_server_list(Some(&signed_list(&root, 1, &[member(&a), member(&b)], &[]))).unwrap();
    set_policy("view", true);
    let inbox_scope = format!("inbox:{peer_b}");
    let grant_for = |signer: &crate::infra::device_identity::DeviceIdentity, requester: &str, scope: &str| {
        let grant = crate::infra::device_records::RunGrant {
            account_id: ACCOUNT.into(),
            grant_id: format!("rungrant_{}", uuid::Uuid::new_v4()),
            requester_device_id: requester.into(),
            target_device_id: peer_b.into(),
            agent_id: String::new(),
            capabilities: vec!["files.receive".into()],
            scopes: vec![scope.into()],
            issued_at: unix_now(),
            expires_at: unix_now() + 600,
        };
        let payload = grant.payload().unwrap();
        SignedRecord::new(&payload, signer.sign_record(&payload).unwrap())
    };
    let b_identity = crate::infra::device_identity::DeviceIdentity::load(ACCOUNT, "device_bbbbbbbbbbbb").unwrap();
    let a_identity = crate::infra::device_identity::DeviceIdentity::load(ACCOUNT, "device_aaaaaaaaaaaa").unwrap();
    let local = tempfile::tempdir().unwrap();
    let content: Vec<u8> = (0..200_000u32).map(|value| (value % 251) as u8).collect();
    let report = local.path().join("report.pdf");
    std::fs::write(&report, &content[..200_000]).unwrap();
    let receipt = a
        .service
        .deliver_file(peer_b, &report, grant_for(&b_identity, peer_b, &inbox_scope), &inbox_scope)
        .await
        .unwrap();
    assert_eq!(receipt.size, 200_000);
    assert_eq!(receipt.sha256, hex::encode(Sha256::digest(&content[..200_000])));
    assert_eq!(std::fs::read(inbox.path().join(&receipt.file_name)).unwrap(), &content[..200_000]);
    // A grant B did not sign, or for another inbox, delivers nothing.
    assert!(a
        .service
        .deliver_file(peer_b, &report, grant_for(&a_identity, &a.network_id, &inbox_scope), &inbox_scope)
        .await
        .is_err());
    let other_scope = format!("inbox:{}", a.network_id);
    assert!(a
        .service
        .deliver_file(peer_b, &report, grant_for(&b_identity, peer_b, &other_scope), &other_scope)
        .await
        .is_err());
    assert_eq!(std::fs::read_dir(inbox.path()).unwrap().count(), 1);

    // A dropped connection comes back from the cached address alone.
    let connection = a.service.authorized_connection(peer_b).unwrap();
    a.service.drop_connection(peer_b, &connection);
    assert!(!a.service.is_connected(peer_b));
    // This trust state was reopened as B above; cache A's last dial again.
    device_trust::remember_addresses(peer_b, &candidates);
    a.service
        .connect_device(
            peer_b,
            &b.endpoint_id,
            device_trust::known_addresses(peer_b),
        )
        .await
        .unwrap();
    assert!(a.service.is_connected(peer_b));

    // Removing B ends its connections, and it cannot connect again.
    device_trust::apply_server_list(Some(&signed_list(&root, 2, &[member(&a)], &[member(&b)])))
        .unwrap();
    a.service.close_untrusted();
    assert!(!a.service.is_connected(peer_b));
    assert!(a
        .service
        .connect_device(peer_b, &b.endpoint_id, candidates)
        .await
        .is_err());
}
