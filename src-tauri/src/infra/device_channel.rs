//! The device control channel (docs/design/devices/BRIEF.md): one socket per
//! device carrying presence, LAN address candidates, connect intents and
//! device-list hints. It never carries file data. Addresses are pushed when
//! they change; nothing here polls the server.
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};

use futures_util::{SinkExt, StreamExt};
use misty_browser_sync::transport::{open_device_socket, SocketError, SocketMessage};
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

use crate::infra::{device_http::DeviceHttp, device_identity::DeviceIdentity, device_trust};

const FRAME_LIMIT: usize = 64 << 10;
const ADDRESS_CHECK: Duration = Duration::from_secs(5);
const ADDRESS_SETTLE: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PeerPresence {
    pub device_id: String,
    #[serde(default)]
    pub endpoint_id: String,
    pub online: bool,
    #[serde(default)]
    pub network_key: String,
    #[serde(default)]
    pub overlay: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelSnapshot {
    pub connected: bool,
    pub admitted: bool,
    /// This device's own network key, to compare with peers' keys.
    pub network_key: String,
    pub overlay: bool,
    pub peers: Vec<PeerPresence>,
}

/// Candidates for one device, from a connect intent.
pub type CandidateHandler = Arc<dyn Fn(String, String, Vec<String>) + Send + Sync>;
/// This device's current LAN candidates ("ip:port").
pub type AddressSource = Arc<dyn Fn() -> Vec<String> + Send + Sync>;
/// A device-list hint ("devices", "device-admission", "jobs") or "ready".
pub type EventHandler = Arc<dyn Fn(String) + Send + Sync>;

struct Running {
    generation: u64,
    commands: mpsc::UnboundedSender<Value>,
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
    pub addresses: AddressSource,
    pub on_candidates: CandidateHandler,
    pub on_event: EventHandler,
}

/// Starts (or restarts) the channel for this account's device.
pub fn start(config: ChannelConfig) {
    let generation = GENERATION.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
    let (commands, receiver) = mpsc::unbounded_channel();
    let snapshot = Arc::new(Mutex::new(ChannelSnapshot::default()));
    if let Ok(mut slot) = running().lock() {
        *slot = Some(Running {
            generation,
            commands,
            snapshot: snapshot.clone(),
        });
    }
    tauri::async_runtime::spawn(run(config, generation, receiver, snapshot));
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

/// Asks the server to introduce this device to another; both receive each
/// other's LAN candidates and dial.
pub fn request_connect(device_id: &str) -> bool {
    running()
        .lock()
        .ok()
        .and_then(|slot| {
            slot.as_ref().map(|running| {
                running
                    .commands
                    .send(json!({"type": "connect", "deviceId": device_id}))
                    .is_ok()
            })
        })
        .unwrap_or(false)
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

async fn run(
    config: ChannelConfig,
    generation: u64,
    mut commands: mpsc::UnboundedReceiver<Value>,
    snapshot: Arc<Mutex<ChannelSnapshot>>,
) {
    let mut backoff = Duration::from_secs(1);
    while current(generation) {
        let started = std::time::Instant::now();
        let outcome = session(&config, generation, &mut commands, &snapshot).await;
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
    commands: &mut mpsc::UnboundedReceiver<Value>,
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
    let mut last_sent: Vec<String> = Vec::new();
    let mut pending: Option<(Vec<String>, std::time::Instant)> = None;
    let mut check = tokio::time::interval(ADDRESS_CHECK);
    check.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        if !current(generation) {
            let _ = socket.close(None).await;
            return Outcome::Stopped;
        }
        tokio::select! {
            frame = next_json(&mut socket) => {
                let Some(frame) = frame else { return Outcome::Retry };
                match handle_frame(config, snapshot, &frame) {
                    FrameEffect::Removed => return Outcome::Removed,
                    FrameEffect::Admitted => {
                        // Tell the server where this device is right away.
                        last_sent.clear();
                        pending = None;
                        check.reset_immediately();
                    }
                    FrameEffect::None => {}
                }
            }
            command = commands.recv() => {
                let Some(command) = command else { return Outcome::Stopped };
                if socket.send(SocketMessage::Text(command.to_string().into())).await.is_err() {
                    return Outcome::Retry;
                }
            }
            _ = check.tick() => {
                let admitted = snapshot.lock().map(|value| value.admitted).unwrap_or(false);
                if !admitted {
                    continue;
                }
                let mut addresses = (config.addresses)();
                addresses.sort();
                addresses.dedup();
                if addresses == last_sent {
                    pending = None;
                    continue;
                }
                // The first address after connecting goes out at once; later
                // changes settle first, so a network change sends once.
                if last_sent.is_empty() {
                    let frame = json!({"type": "address", "candidates": addresses});
                    if socket.send(SocketMessage::Text(frame.to_string().into())).await.is_err() {
                        return Outcome::Retry;
                    }
                    last_sent = addresses;
                    continue;
                }
                match &pending {
                    Some((candidate, since)) if *candidate == addresses && since.elapsed() >= ADDRESS_SETTLE => {
                        let frame = json!({"type": "address", "candidates": addresses});
                        if socket.send(SocketMessage::Text(frame.to_string().into())).await.is_err() {
                            return Outcome::Retry;
                        }
                        last_sent = addresses;
                        pending = None;
                    }
                    Some((candidate, _)) if *candidate == addresses => {}
                    _ => pending = Some((addresses, std::time::Instant::now())),
                }
            }
        }
    }
}

enum FrameEffect {
    None,
    Admitted,
    Removed,
}

fn handle_frame(
    config: &ChannelConfig,
    snapshot: &Arc<Mutex<ChannelSnapshot>>,
    frame: &Value,
) -> FrameEffect {
    let app = &config.app;
    match frame["type"].as_str().unwrap_or_default() {
        "ready" | "admitted" => {
            let admitted = frame["type"] == "admitted" || frame["state"] == "admitted";
            let peers: Vec<PeerPresence> =
                serde_json::from_value(frame["presence"].clone()).unwrap_or_default();
            if let Ok(mut value) = snapshot.lock() {
                value.connected = true;
                value.admitted = admitted;
                if let Some(own) = peers
                    .iter()
                    .find(|peer| peer.device_id == config.server_device_id)
                {
                    value.network_key = own.network_key.clone();
                    value.overlay = own.overlay;
                }
                value.peers = peers
                    .into_iter()
                    .filter(|peer| peer.device_id != config.server_device_id)
                    .collect();
            }
            emit_snapshot(app, snapshot);
            emit(app, "misty:devices-event", json!({"topic": "devices"}));
            (config.on_event)("ready".to_owned());
            if admitted {
                return FrameEffect::Admitted;
            }
        }
        "presence.delta" => {
            let Ok(peer) = serde_json::from_value::<PeerPresence>(frame["device"].clone()) else {
                return FrameEffect::None;
            };
            if let Ok(mut value) = snapshot.lock() {
                if peer.device_id == config.server_device_id {
                    value.network_key = peer.network_key.clone();
                    value.overlay = peer.overlay;
                } else if let Some(existing) = value
                    .peers
                    .iter_mut()
                    .find(|item| item.device_id == peer.device_id)
                {
                    *existing = peer;
                } else {
                    value.peers.push(peer);
                }
            }
            emit_snapshot(app, snapshot);
        }
        "candidates" => {
            let (Some(device), Some(endpoint)) =
                (frame["deviceId"].as_str(), frame["endpointId"].as_str())
            else {
                return FrameEffect::None;
            };
            let addresses: Vec<String> = frame["addresses"]
                .as_array()
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| item.as_str().map(str::to_owned))
                        .take(8)
                        .collect()
                })
                .unwrap_or_default();
            (config.on_candidates)(device.to_owned(), endpoint.to_owned(), addresses);
        }
        "unreachable" => {
            emit(app, "misty:device-unreachable", frame["deviceId"].clone());
        }
        "event" => {
            let topic = frame["topic"].as_str().unwrap_or_default();
            emit(app, "misty:devices-event", json!({ "topic": topic }));
            (config.on_event)(topic.to_owned());
        }
        "revoked" => return FrameEffect::Removed,
        _ => {}
    }
    FrameEffect::None
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

/// LAN candidates ("ip:port") inside an iroh endpoint address, as JSON.
pub fn lan_candidates(addressing: &Value) -> Vec<String> {
    let mut out = HashSet::new();
    if let Some(addresses) = addressing["addrs"].as_array() {
        for address in addresses {
            let text = address["Ip"]
                .as_str()
                .or_else(|| address.as_str())
                .unwrap_or_default();
            if let Ok(socket) = text.parse::<std::net::SocketAddr>() {
                if crate::domain::lan::is_lan_address(socket.ip()) && !socket.ip().is_loopback() {
                    out.insert(socket.to_string());
                }
            }
        }
    }
    let mut list: Vec<String> = out.into_iter().collect();
    list.sort();
    list.truncate(8);
    list
}

/// The iroh endpoint address JSON for dialing a device at these candidates.
pub fn dial_address(endpoint_id: &str, candidates: &[String]) -> Value {
    let addresses: Vec<Value> = candidates
        .iter()
        .filter(|candidate| {
            candidate
                .parse::<std::net::SocketAddr>()
                .is_ok_and(|socket| {
                    crate::domain::lan::is_lan_address(socket.ip()) && socket.is_ipv4()
                })
        })
        .take(8)
        .map(|candidate| json!({ "Ip": candidate }))
        .collect();
    json!({ "id": endpoint_id, "addrs": addresses })
}

pub fn same_network(snapshot: &ChannelSnapshot, peer: &PeerPresence) -> bool {
    (!snapshot.network_key.is_empty() && snapshot.network_key == peer.network_key)
        || (snapshot.overlay && peer.overlay)
}

pub type PresenceMap = HashMap<String, PeerPresence>;
