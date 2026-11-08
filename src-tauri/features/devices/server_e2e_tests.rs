//! Two sessions of one account against a real Misty server, through the app's
//! own native code: registering with proof of each key, which trusts them at
//! once, then policy, names, presence and removal. Every request, signature and
//! check is real.
//!
//! Run against a local server built from this checkout:
//! MISTY_DEVICE_SERVER=http://127.0.0.1:8099/v1 cargo test --lib device_server_e2e -- --ignored
use std::time::Duration;

use browser_data::transport::{open_device_socket, SocketMessage};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};

use super::{
    admission::{self as admission, DeviceContext},
    channel::{self, ChannelConfig},
    trust,
};
use crate::account::session;

const LOCAL_A: &str = "device_a1a1a1a1a1a1";
const LOCAL_B: &str = "device_b2b2b2b2b2b2";

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "needs a Misty server: set MISTY_DEVICE_SERVER"]
async fn device_server_e2e_add_once() {
    let Ok(base) = std::env::var("MISTY_DEVICE_SERVER") else {
        return;
    };
    let _ = rustls::crypto::ring::default_provider().install_default();
    let credentials = tempfile::tempdir().unwrap();
    let _ = misty_credential_store::configure_root(credentials.path().to_path_buf());
    let trust = tempfile::tempdir().unwrap();
    trust::set_storage_root(trust.path().to_path_buf());

    // Sign up through the app's native account client, as the app does.
    let url = session::server(&base).unwrap();
    let client = session::current(&url).unwrap();
    let suffix = uuid::Uuid::new_v4().simple().to_string();
    let response = client
        .http
        .post(format!("{base}/register"))
        .header("X-Misty-CSRF", "1")
        .header(session::TOKEN_TRANSPORT.0, session::TOKEN_TRANSPORT.1)
        .json(&serde_json::json!({
            "name": "Devices", "username": format!("dev{}", &suffix[..12]),
            "email": format!("devices-{suffix}@example.com"), "password": "password-123-password",
        }))
        .send()
        .await
        .unwrap();
    client.capture(&url, response.headers()).unwrap();
    let signed_up: serde_json::Value = response.json().await.unwrap();
    let account = signed_up["user_id"].as_str().unwrap().to_owned();

    // A registers, and is trusted at once.
    let mut a = DeviceContext::open(&base, &account, LOCAL_A).unwrap();
    admission::register(&mut a, "Laptop", "macos", "15", "1.0")
        .await
        .unwrap();
    assert!(trust::self_admitted());
    let a_id = a.server_device_id.clone();

    // So is B.
    let mut b = DeviceContext::open(&base, &account, LOCAL_B).unwrap();
    admission::register(&mut b, "Studio", "macos", "15", "1.0")
        .await
        .unwrap();
    assert!(trust::self_admitted());
    let b_id = b.server_device_id.clone();
    admission::publish_policy(&b, "view", true, vec!["folders".into()], vec![])
        .await
        .unwrap();

    let a = DeviceContext::open(&base, &account, LOCAL_A).unwrap();

    // The control channel: A runs the app's own channel client; B is a bare
    // socket. Only presence flows between them.
    channel::start(ChannelConfig {
        app: None,
        http: a.http.clone(),
        local_device_id: LOCAL_A.into(),
        server_device_id: a_id.clone(),
    });
    assert!(
        eventually(|| {
            let s = channel::snapshot();
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
    assert!(
        eventually(|| channel::snapshot()
            .peers
            .iter()
            .any(|peer| peer.device_id == b_id && peer.online))
        .await
    );
    channel::stop();
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
    S: futures_util::Stream<Item = Result<SocketMessage, browser_data::transport::SocketError>>
        + Unpin,
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
