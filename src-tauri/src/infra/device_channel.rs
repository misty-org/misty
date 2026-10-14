//! The device control channel (docs/design/devices/BRIEF.md): one socket per
//! device carrying presence, device-list hints and removal. It never carries
//! file data, and devices never connect to each other directly.
use std::{
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};

use futures_util::{SinkExt, StreamExt};
use misty_browser_sync::transport::{open_device_socket, SocketError, SocketMessage};
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::infra::{device_http::DeviceHttp, device_identity::DeviceIdentity, device_trust};

const FRAME_LIMIT: usize = 64 << 10;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PeerPresence {
    pub device_id: String,
    pub online: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelSnapshot {
    pub connected: bool,
    pub admitted: bool,
    pub peers: Vec<PeerPresence>,
}

/// A device-list hint ("devices", "device-admission", "jobs") or "ready".
pub type EventHandler = Arc<dyn Fn(String) + Send + Sync>;

struct Running {
    snapshot: Arc<Mutex<ChannelSnapshot>>,
}

static RUNNING: OnceLock<Mutex<Option<Running>>> = OnceLock::new();
static GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn running() -> &'static Mutex<Option<Running>> {
    RUNNING.get_or_init(|| Mutex::new(None))
}

pub struct ChannelConfig {
    /// Where UI events go; None runs the channel headless (tests).
    pub app: Option<AppHandle>,
    pub http: DeviceHttp,
    pub local_device_id: String,
    pub server_device_id: String,
    pub on_event: EventHandler,
}

/// Starts (or restarts) the channel for this account's device.
pub fn start(config: ChannelConfig) {
    let generation = GENERATION.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
    let snapshot = Arc::new(Mutex::new(ChannelSnapshot::default()));
    if let Ok(mut slot) = running().lock() {
        *slot = Some(Running {
            snapshot: snapshot.clone(),
        });
    }
    tauri::async_runtime::spawn(run(config, generation, snapshot));
}

pub fn stop() {
    GENERATION.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    if let Ok(mut slot) = running().lock() {
        *slot = None;
    }
}

fn current(generation: u64) -> bool {
    GENERATION.load(std::sync::atomic::Ordering::SeqCst) == generation
}

pub fn snapshot() -> ChannelSnapshot {
    running()
        .lock()
        .ok()
        .and_then(|slot| {
            slot.as_ref()
                .and_then(|running| running.snapshot.lock().ok().map(|s| s.clone()))
        })
        .unwrap_or_default()
}

fn emit<S: Serialize + Clone>(app: &Option<AppHandle>, event: &str, payload: S) {
    if let Some(app) = app {
        let _ = app.emit_to("main", event, payload);
    }
}

fn emit_snapshot(app: &Option<AppHandle>, snapshot: &Arc<Mutex<ChannelSnapshot>>) {
    if let Ok(value) = snapshot.lock() {
        emit(app, "misty:devices-presence", value.clone());
    }
}

async fn run(config: ChannelConfig, generation: u64, snapshot: Arc<Mutex<ChannelSnapshot>>) {
    let mut backoff = Duration::from_secs(1);
    while current(generation) {
        let started = std::time::Instant::now();
        let outcome = session(&config, generation, &snapshot).await;
        if let Ok(mut value) = snapshot.lock() {
            value.connected = false;
            for peer in &mut value.peers {
                peer.online = false;
            }
        }
        emit_snapshot(&config.app, &snapshot);
        match outcome {
            Outcome::Removed => {
                device_trust::forget_after_removal();
                emit(&config.app, "misty:device-removed", ());
                return;
            }
            Outcome::Stopped => return,
            Outcome::Retry => {}
        }
        if started.elapsed() > Duration::from_secs(60) {
            backoff = Duration::from_secs(1);
        }
        // Full jitter, doubling to a minute.
        let wait = rand::thread_rng().gen_range(Duration::from_millis(250)..=backoff);
        tokio::time::sleep(wait).await;
        backoff = (backoff * 2).min(Duration::from_secs(60));
    }
}

enum Outcome {
    Retry,
    Removed,
    Stopped,
}

#[derive(Deserialize)]
struct TicketResponse {
    ticket: String,
}

async fn session(
    config: &ChannelConfig,
    generation: u64,
    snapshot: &Arc<Mutex<ChannelSnapshot>>,
) -> Outcome {
    let account_id = config.http.account_id().to_owned();
    let Ok(identity) = DeviceIdentity::load(&account_id, &config.local_device_id) else {
        return Outcome::Stopped;
    };
    let ticket: TicketResponse = match config
        .http
        .session(
            reqwest::Method::POST,
            &format!("devices/{}/channel-ticket", config.server_device_id),
            None::<&()>,
        )
        .await
    {
        Ok(ticket) => ticket,
        Err(crate::infra::device_http::DeviceHttpError::Status(404 | 403, _)) => {
            return Outcome::Removed
        }
        Err(_) => return Outcome::Retry,
    };
    if !(32..=128).contains(&ticket.ticket.len()) {
        return Outcome::Retry;
    }
    let Ok(mut url) = config.http.websocket_url("devices/channel") else {
        return Outcome::Stopped;
    };
    url.query_pairs_mut().append_pair("ticket", &ticket.ticket);
    let Ok(mut socket) = open_device_socket(&url, FRAME_LIMIT).await else {
        return Outcome::Retry;
    };
    let challenge =
        match tokio::time::timeout(Duration::from_secs(10), next_json(&mut socket)).await {
            Ok(Some(frame)) if frame["type"] == "challenge" => frame,
            _ => return Outcome::Retry,
        };
    let (Some(nonce), Some(instance)) = (
        challenge["challenge"].as_str(),
        challenge["instance"].as_str(),
    ) else {
        return Outcome::Retry;
    };
    let Ok(signature) =
        identity.channel_proof(&account_id, &config.server_device_id, instance, nonce)
    else {
        return Outcome::Stopped;
    };
    if socket
        .send(SocketMessage::Text(
            json!({"type": "authenticate", "signature": signature})
                .to_string()
                .into(),
        ))
        .await
        .is_err()
    {
        return Outcome::Retry;
    }
    loop {
        if !current(generation) {
            let _ = socket.close(None).await;
            return Outcome::Stopped;
        }
        // Wake now and then so a stopped channel closes its socket promptly.
        let frame = match tokio::time::timeout(Duration::from_secs(5), next_json(&mut socket)).await
        {
            Ok(Some(frame)) => frame,
            Ok(None) => return Outcome::Retry,
            Err(_) => continue,
        };
        if handle_frame(config, snapshot, &frame) {
            return Outcome::Removed;
        }
    }
}

/// Applies one frame; true when this device was removed.
fn handle_frame(
    config: &ChannelConfig,
    snapshot: &Arc<Mutex<ChannelSnapshot>>,
    frame: &Value,
) -> bool {
    let app = &config.app;
    match frame["type"].as_str().unwrap_or_default() {
        "ready" | "admitted" => {
            let admitted = frame["type"] == "admitted" || frame["state"] == "admitted";
            let peers: Vec<PeerPresence> =
                serde_json::from_value(frame["presence"].clone()).unwrap_or_default();
            if let Ok(mut value) = snapshot.lock() {
                value.connected = true;
                value.admitted = admitted;
                value.peers = peers
                    .into_iter()
                    .filter(|peer| peer.device_id != config.server_device_id)
                    .collect();
            }
            emit_snapshot(app, snapshot);
            emit(app, "misty:devices-event", json!({"topic": "devices"}));
            (config.on_event)("ready".to_owned());
        }
        "presence.delta" => {
            let Ok(peer) = serde_json::from_value::<PeerPresence>(frame["device"].clone()) else {
                return false;
            };
            if peer.device_id == config.server_device_id {
                return false;
            }
            if let Ok(mut value) = snapshot.lock() {
                match value
                    .peers
                    .iter_mut()
                    .find(|item| item.device_id == peer.device_id)
                {
                    Some(existing) => *existing = peer,
                    None => value.peers.push(peer),
                }
            }
            emit_snapshot(app, snapshot);
        }
        "event" => {
            let topic = frame["topic"].as_str().unwrap_or_default();
            emit(app, "misty:devices-event", json!({ "topic": topic }));
            (config.on_event)(topic.to_owned());
        }
        "revoked" => return true,
        _ => {}
    }
    false
}

async fn next_json<S>(socket: &mut S) -> Option<Value>
where
    S: futures_util::Stream<Item = Result<SocketMessage, SocketError>> + Unpin,
{
    loop {
        match socket.next().await? {
            Ok(SocketMessage::Text(text)) => {
                if text.len() > FRAME_LIMIT {
                    return None;
                }
                return serde_json::from_str(&text).ok();
            }
            Ok(SocketMessage::Ping(_) | SocketMessage::Pong(_)) => continue,
            Ok(SocketMessage::Close(_)) | Err(_) => return None,
            Ok(_) => return None,
        }
    }
}
