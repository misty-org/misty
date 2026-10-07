//! Two devices of one account against a real Misty server, through the app's
//! own native code: registering with proof of each key, adding the first with
//! the vault root (as after entering the sync password and secret), approving
//! the second from the first by matching codes and a sealed vault root, then
//! trust, permissions, names and removal. Only the open sync window is stood in
//! for (`set_test_authority`); every request, signature and check is real.
//!
//! Run against a local server built from this checkout:
//! MISTY_DEVICE_SERVER=http://127.0.0.1:8099/v1 cargo test --lib device_server_e2e -- --ignored
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use futures_util::{SinkExt, StreamExt};
use misty_browser_sync::{
    crypto::{generate_sync_secret, DeviceKey, VaultRoot, VaultScope},
    transport::{open_device_socket, SocketMessage, SyncApi},
};
use serde_json::{json, Value};

use super::{
    auth_cookies,
    device_admission::{self as admission, set_test_authority, DeviceContext},
    device_approval::{poll_request_core, start_request},
    device_approval_approver as approver,
    device_channel::{self, ChannelConfig},
    device_records::endpoint_of,
    device_trust,
};

const LOCAL_A: &str = "device_a1a1a1a1a1a1";
const LOCAL_B: &str = "device_b2b2b2b2b2b2";
const LOCAL_C: &str = "device_c3c3c3c3c3c3";

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "needs a Misty server: set MISTY_DEVICE_SERVER"]
async fn device_server_e2e_add_once_approve_by_code_and_remove() {
    let Ok(base) = std::env::var("MISTY_DEVICE_SERVER") else {
        return;
    };
    let _ = rustls::crypto::ring::default_provider().install_default();
    let credentials = tempfile::tempdir().unwrap();
    let _ = misty_credential_store::configure_root(credentials.path().to_path_buf());
    let trust = tempfile::tempdir().unwrap();
    device_trust::set_storage_root(trust.path().to_path_buf());

    // Sign up through the app's native cookie jar, as the app does.
    let url = auth_cookies::server(&base).unwrap();
    let client = auth_cookies::current(&url).unwrap();
    let suffix = uuid::Uuid::new_v4().simple().to_string();
    let signed_up: serde_json::Value = client
        .http
        .post(format!("{base}/register"))
        .header("X-Misty-CSRF", "1")
        .json(&serde_json::json!({
            "name": "Devices", "username": format!("dev{}", &suffix[..12]),
            "email": format!("devices-{suffix}@example.com"), "password": "password123password",
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let account = signed_up["user_id"].as_str().unwrap().to_owned();

    // The account's sync vault, created as the first device's sync setup does.
    let root = VaultRoot::generate();
    let vault_id = uuid::Uuid::new_v4().to_string();
    let scope = VaultScope {
        deployment: base.trim_end_matches('/').to_owned(),
        account_id: account.clone(),
        vault_id: vault_id.clone(),
    };
    let envelope = root
        .wrap(&scope, "password123password", &generate_sync_secret())
        .unwrap();
    let sync_device = uuid::Uuid::new_v4().to_string();
    let sync_grant = root
        .grant(&scope, &sync_device, 1, &DeviceKey::generate())
        .unwrap();
    SyncApi::new(&base, client.http.clone())
        .unwrap()
        .bootstrap(&root.public_key().unwrap(), &envelope, &sync_grant)
        .await
        .unwrap();

    // Device A registers (pending), then adds itself with the vault root.
    let mut a = DeviceContext::open(&base, &account, LOCAL_A).unwrap();
    let registered = admission::register(&mut a, "Laptop", "macos", "15", "1.0")
        .await
        .unwrap();
    assert_eq!(registered.admission_state, "pending");
    let a_id = a.server_device_id.clone();
    assert!(
        admission::admit_self(&a).await.is_err(),
        "no vault root, no admission"
    );
    set_test_authority(LOCAL_A, &root, &vault_id, &sync_device);
    admission::admit_self(&a).await.unwrap();
    admission::refresh_trust(&a).await.unwrap();
    assert!(device_trust::self_admitted());

    // Device B asks to be approved from A.
    let mut b = DeviceContext::open(&base, &account, LOCAL_B).unwrap();
    admission::register(&mut b, "Studio", "macos", "15", "1.0")
        .await
        .unwrap();
    let b_id = b.server_device_id.clone();
    let b_endpoint = b.identity.endpoint_id();
    let request = start_request(&b).await.unwrap();

    let a = DeviceContext::open(&base, &account, LOCAL_A).unwrap();
    let waiting = approver::list_requests(&a).await.unwrap();
    assert!(waiting
        .iter()
        .any(|item| item.request_id == request.request_id && item.device_id == b_id));
    approver::challenge(&a, &request.request_id).await.unwrap();
    // Approving before both sides show a code is refused.
    assert!(approver::approve(&a, &request.request_id).await.is_err());

    let b = DeviceContext::open(&base, &account, LOCAL_B).unwrap();
    let (shown_on_b, opened) = poll_request_core(&b, &request.request_id).await.unwrap();
    assert!(opened.is_none());
    let a = DeviceContext::open(&base, &account, LOCAL_A).unwrap();
    let shown_on_a = approver::approver_poll(&a, &request.request_id)
        .await
        .unwrap();
    assert!(shown_on_a.code.is_some());
    assert_eq!(
        shown_on_a.code, shown_on_b.code,
        "both devices show the same code"
    );
    approver::approve(&a, &request.request_id).await.unwrap();

    // B opens the sealed vault root: it is exactly the vault's root.
    let b = DeviceContext::open(&base, &account, LOCAL_B).unwrap();
    let (_, opened) = poll_request_core(&b, &request.request_id).await.unwrap();
    let b_root = opened.expect("approved with a sealed vault root");
    assert_eq!(b_root.public_key().unwrap(), root.public_key().unwrap());
    set_test_authority(LOCAL_B, &b_root, &vault_id, "");
    admission::refresh_trust(&b).await.unwrap();
    assert!(device_trust::self_admitted());
    admission::publish_policy(&b, "view", true, vec!["folders".into()], vec![])
        .await
        .unwrap();

    // A trusts B through the signed list, and can rename it.
    let a = DeviceContext::open(&base, &account, LOCAL_A).unwrap();
    admission::refresh_trust(&a).await.unwrap();
    assert_eq!(device_trust::trusted_peer(&b_endpoint), Some(b_id.clone()));
    admission::rename(&a, &b_id, "Studio Mac").await.unwrap();

    // The control channel: A runs the app's own channel client; B is a bare
    // socket. Presence and LAN candidates flow between them, nothing else.
    let found: Arc<Mutex<Vec<(String, String, Vec<String>)>>> = Arc::default();
    let sink = found.clone();
    device_channel::start(ChannelConfig {
        app: None,
        http: a.http.clone(),
        local_device_id: LOCAL_A.into(),
        server_device_id: a_id.clone(),
        addresses: Arc::new(|| vec!["192.168.77.10:4100".to_owned(), "8.8.8.8:53".to_owned()]),
        on_candidates: Arc::new(move |device, endpoint, addresses| {
            sink.lock().unwrap().push((device, endpoint, addresses))
        }),
        on_event: Arc::new(|_| {}),
    });
    assert!(
        eventually(|| {
            let s = device_channel::snapshot();
            s.connected && s.admitted
        })
        .await
    );
    let b = DeviceContext::open(&base, &account, LOCAL_B).unwrap();
    let ticket: Value = b
        .http
        .session(
            reqwest::Method::POST,
            &format!("devices/{b_id}/channel-ticket"),
            None::<&()>,
        )
        .await
        .unwrap();
    let mut url = b.http.websocket_url("devices/channel").unwrap();
    url.query_pairs_mut()
        .append_pair("ticket", ticket["ticket"].as_str().unwrap());
    let mut socket = open_device_socket(&url, 64 << 10).await.unwrap();
    let challenge = next_frame(&mut socket, "challenge").await;
    let proof = b
        .identity
        .channel_proof(
            &account,
            &b_id,
            challenge["instance"].as_str().unwrap(),
            challenge["challenge"].as_str().unwrap(),
        )
        .unwrap();
    socket
        .send(SocketMessage::Text(
            json!({"type": "authenticate", "signature": proof})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
    let ready = next_frame(&mut socket, "ready").await;
    assert_eq!(ready["state"], "admitted");
    socket
        .send(SocketMessage::Text(
            json!({"type": "address", "candidates": ["192.168.77.20:4200"]})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
    assert!(
        eventually(|| device_channel::snapshot()
            .peers
            .iter()
            .any(|peer| peer.device_id == b_id && peer.online))
        .await
    );
    // A's client told the server its address when it connected; B asks for A.
    socket
        .send(SocketMessage::Text(
            json!({"type": "connect", "deviceId": a_id})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
    let to_b = next_frame(&mut socket, "candidates").await;
    assert_eq!(to_b["deviceId"], a_id.as_str());
    assert_eq!(
        to_b["addresses"],
        json!(["192.168.77.10:4100"]),
        "only LAN addresses are relayed"
    );
    assert!(
        eventually(|| found
            .lock()
            .unwrap()
            .iter()
            .any(|(device, endpoint, addresses)| {
                device == &b_id
                    && endpoint == &b_endpoint
                    && addresses == &vec!["192.168.77.20:4200".to_owned()]
            }))
        .await
    );

    // A third device's request can be denied; it is never added.
    let mut c = DeviceContext::open(&base, &account, LOCAL_C).unwrap();
    admission::register(&mut c, "Old", "windows", "11", "1.0")
        .await
        .unwrap();
    let denied = start_request(&c).await.unwrap();
    let a = DeviceContext::open(&base, &account, LOCAL_A).unwrap();
    approver::deny(&a, &denied.request_id).await.unwrap();
    let c = DeviceContext::open(&base, &account, LOCAL_C).unwrap();
    let (view, opened) = poll_request_core(&c, &denied.request_id).await.unwrap();
    assert_eq!(view.state, "denied");
    assert!(opened.is_none());

    // A removes B: A stops trusting it, and B's key can never register again.
    let a = DeviceContext::open(&base, &account, LOCAL_A).unwrap();
    admission::remove(&a, &b_id).await.unwrap();
    admission::refresh_trust(&a).await.unwrap();
    assert_eq!(device_trust::trusted_peer(&b_endpoint), None);
    let list = device_trust::current_list().unwrap();
    assert!(list.admitted_key(&a_id).is_some() && list.admitted_key(&b_id).is_none());
    assert!(list
        .revoked
        .iter()
        .any(|member| endpoint_of(&member.public_key).as_deref() == Some(b_endpoint.as_str())));
    // The removed device is told on its socket.
    assert_eq!(next_frame(&mut socket, "revoked").await["type"], "revoked");
    device_channel::stop();
    let mut b = DeviceContext::open(&base, &account, LOCAL_B).unwrap();
    let again = admission::register(&mut b, "Studio", "macos", "15", "1.0").await;
    assert!(again.is_err(), "a removed device registered again");
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

/// The next frame of a type, skipping hints and pings.
async fn next_frame<S>(socket: &mut S, kind: &str) -> Value
where
    S: futures_util::Stream<
            Item = Result<SocketMessage, misty_browser_sync::transport::SocketError>,
        > + Unpin,
{
    let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
    loop {
        let message = tokio::time::timeout_at(deadline, socket.next())
            .await
            .unwrap_or_else(|_| panic!("no {kind} frame"))
            .expect("socket open")
            .expect("socket frame");
        if let SocketMessage::Text(text) = message {
            let frame: Value = serde_json::from_str(&text).unwrap();
            if frame["type"] == kind {
                return frame;
            }
        }
    }
}
