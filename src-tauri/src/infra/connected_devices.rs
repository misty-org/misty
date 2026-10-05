use std::{
    collections::{HashMap, HashSet},
    io::{Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, RwLock,
    },
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(not(target_os = "macos"))]
use crate::domain::connected_devices::DEVICE_ALPN;
#[cfg(target_os = "macos")]
use crate::infra::{
    document_intelligence::ServiceLease,
    peer_transport_worker::{
        Connection as TransportConnection, RecvStream as TransportRecvStream, Relay as RelayMode,
        SendStream as TransportSendStream,
    },
};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use ed25519_dalek::VerifyingKey;
#[cfg(not(target_os = "macos"))]
use iroh::endpoint::{
    Connection as TransportConnection, RecvStream as TransportRecvStream,
    SendStream as TransportSendStream,
};
#[cfg(not(target_os = "macos"))]
use iroh::{endpoint::presets, Endpoint, EndpointAddr, RelayMode, SecretKey};
#[cfg(target_os = "macos")]
type Endpoint = Arc<crate::infra::peer_transport_worker::Endpoint>;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::{
    domain::clipboard::{
        ClipboardFileRef, ClipboardImage, ClipboardPayload, ClipboardPayloadKind,
        SharedClipboardClient,
    },
    domain::connected_devices::{
        decode_control_frame, encode_control_frame, validate_clipboard_offer, verify_peer_ticket,
        ClipboardOffer, ClipboardOfferKind, OpenWorkspaceRouteRequest, OpenWorkspaceRouteResult,
        OpenWorkspaceRouteStatus, PeerError, PeerErrorCode, PeerFileReference, PeerRequest,
        PeerRequestEnvelope, PeerResponse, PeerResponseEnvelope, PeerRoot, PeerTicketClaims,
        SessionOffer, WorkspaceRouteSurface, DEVICE_PROTOCOL_VERSION, MAX_CONTROL_FRAME_BYTES,
    },
    error::{ApiError, ApiResult},
    infra::{
        device_sessions::{DeviceSessionStore, PeerConsent, SessionSummary, MAX_SESSION_DAYS},
        peer_files::PeerRootRegistry,
        peer_identity,
    },
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeConnectedDevicesRequest {
    pub account_id: String,
    pub device_id: String,
    #[serde(default)]
    pub device_name: String,
    #[serde(default)]
    pub development_ticket_keys: HashMap<String, String>,
    #[cfg(target_os = "macos")]
    pub instance: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectPeerRequest {
    #[cfg(target_os = "macos")]
    pub instance: String,
    pub device_id: String,
    pub address: serde_json::Value,
    pub ticket: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerPathRequest {
    pub device_id: String,
    pub path: String,
    #[serde(default)]
    pub show_hidden: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerReadRequest {
    pub device_id: String,
    pub path: String,
    pub offset: u64,
    pub length: Option<u64>,
    pub expected_snapshot: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedDevicesSnapshot {
    pub enabled: bool,
    pub endpoint_id: Option<String>,
    pub addressing: Option<serde_json::Value>,
    pub relay_policy: String,
    pub peers: Vec<ConnectedPeerStatus>,
    /// Local sessions with paired devices, live or ended.
    pub sessions: Vec<SessionSummary>,
    pub unavailable_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedPeerStatus {
    pub device_id: String,
    pub state: String,
    pub connection_type: String,
    pub authorization_expires_at: i64,
}

/// Optional progress and cancellation for a long transfer: bytes are added to
/// `bytes` as they move, and `canceled` stops the transfer between chunks.
#[derive(Clone, Copy, Default)]
pub struct TransferWatch<'a> {
    pub bytes: Option<&'a AtomicU64>,
    pub canceled: Option<&'a AtomicBool>,
}

impl TransferWatch<'_> {
    pub fn advance(&self, bytes: u64) {
        if let Some(counter) = self.bytes {
            counter.fetch_add(bytes, Ordering::Relaxed);
        }
    }

    pub fn check(&self) -> ApiResult<()> {
        if self
            .canceled
            .is_some_and(|canceled| canceled.load(Ordering::SeqCst))
        {
            return Err(ApiError::Message("Operation canceled.".to_owned()));
        }
        Ok(())
    }
}

#[derive(Clone)]
struct AuthorizedConnection {
    connection: TransportConnection,
    claims: PeerTicketClaims,
}

#[derive(Clone)]
struct ClipboardBlobRecord {
    bytes: Arc<Vec<u8>>,
    expires_at: i64,
}

struct ConnectedDevicesState {
    #[cfg(target_os = "macos")]
    instance: String,
    endpoint: Endpoint,
    account_id: String,
    local_device_id: String,
    keys: HashMap<String, VerifyingKey>,
    connections: Arc<RwLock<HashMap<String, AuthorizedConnection>>>,
    used_ticket_ids: Arc<Mutex<HashMap<String, i64>>>,
    roots: PeerRootRegistry,
    relay_policy: String,
}

#[derive(Clone, Default)]
pub struct ConnectedDevicesService {
    state: Arc<RwLock<Option<ConnectedDevicesState>>>,
    cache_root: Arc<PathBuf>,
    gateway: Arc<RwLock<Option<PeerMediaGateway>>>,
    clipboard_handler: Arc<RwLock<Option<Arc<dyn Fn(ClipboardPayload) + Send + Sync>>>>,
    workspace_route_handler:
        Arc<RwLock<Option<Arc<dyn Fn(OpenWorkspaceRouteRequest) -> bool + Send + Sync>>>>,
    workspace_route_results: Arc<Mutex<HashMap<String, (i64, OpenWorkspaceRouteResult)>>>,
    directory_subscriptions: Arc<Mutex<HashSet<String>>>,
    clipboard_blobs: Arc<Mutex<HashMap<String, ClipboardBlobRecord>>>,
    local: PeerLocal,
    /// Bumped on every initialize, so an older reconnect loop stops.
    resume_generation: Arc<AtomicU64>,
    /// This device's id on Misty's server. Tickets, sessions, clipboard file
    /// references and `misty://device/` paths all name devices by it. The
    /// local agent id only scopes this device's own keychain entries.
    network_device_id: Arc<RwLock<String>>,
}

/// This device's own decisions about its paired devices: the local sessions
/// and consent it checks without the server, and the file service that applies
/// changes it accepts. Consent defaults to none, so it fails closed.
#[derive(Clone, Default)]
struct PeerLocal {
    sessions: DeviceSessionStore,
    explorer: Arc<RwLock<Option<crate::infra::explorer::ExplorerService>>>,
}

impl PeerLocal {
    fn consent(&self, device_id: &str) -> PeerConsent {
        self.sessions.consent(device_id)
    }

    fn explorer(&self) -> Option<crate::infra::explorer::ExplorerService> {
        self.explorer.read().ok()?.clone()
    }
}

#[path = "connected_devices_clipboard.rs"]
mod clipboard;
use clipboard::clipboard_offer_to_payload;
#[path = "connected_devices_media.rs"]
mod media;
use media::{peer_media_handler, PeerMediaGateway, PeerMediaGrant, PeerMediaState};
#[path = "connected_devices_sessions.rs"]
mod sessions;
pub use sessions::PairConsent;
#[path = "connected_devices_writes.rs"]
mod writes;
pub use writes::local_tree_size;
#[cfg(all(test, target_os = "macos"))]
#[path = "connected_devices_e2e_tests.rs"]
mod e2e_tests;

impl ConnectedDevicesService {
    pub fn new(cache_root: PathBuf) -> Self {
        let cache_root = cache_root.join("peer-files").join("v1");
        let cleanup_root = cache_root.clone();
        std::thread::spawn(move || cleanup_peer_cache(&cleanup_root));
        Self {
            state: Arc::new(RwLock::new(None)),
            cache_root: Arc::new(cache_root),
            gateway: Arc::new(RwLock::new(None)),
            clipboard_handler: Arc::new(RwLock::new(None)),
            workspace_route_handler: Arc::new(RwLock::new(None)),
            workspace_route_results: Arc::new(Mutex::new(HashMap::new())),
            directory_subscriptions: Arc::new(Mutex::new(HashSet::new())),
            clipboard_blobs: Arc::new(Mutex::new(HashMap::new())),
            local: PeerLocal::default(),
            resume_generation: Arc::new(AtomicU64::new(0)),
            network_device_id: Arc::new(RwLock::new(String::new())),
        }
    }

    /// Records this device's server id once registration returns it. Until
    /// then the device neither accepts nor starts connections.
    pub fn set_network_identity(&self, device_id: String) -> ApiResult<()> {
        let valid = device_id.starts_with("device_")
            && device_id.len() <= 128
            && device_id
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || "_-".contains(character));
        if !valid {
            return Err(ApiError::Message("The device id is invalid.".to_owned()));
        }
        *self.network_device_id.write().map_err(lock_error)? = device_id;
        Ok(())
    }

    fn network_device_id(&self) -> ApiResult<String> {
        let id = self.network_device_id.read().map_err(lock_error)?.clone();
        if id.is_empty() {
            return Err(ApiError::Unavailable(
                "This device is not registered with Misty yet.".to_owned(),
            ));
        }
        Ok(id)
    }

    pub fn set_local_explorer(&self, explorer: crate::infra::explorer::ExplorerService) {
        if let Ok(mut slot) = self.local.explorer.write() {
            *slot = Some(explorer);
        }
    }

    pub fn set_clipboard_handler(
        &self,
        handler: Arc<dyn Fn(ClipboardPayload) + Send + Sync>,
    ) -> ApiResult<()> {
        *self.clipboard_handler.write().map_err(lock_error)? = Some(handler);
        Ok(())
    }

    pub fn set_workspace_route_handler(
        &self,
        handler: Arc<dyn Fn(OpenWorkspaceRouteRequest) -> bool + Send + Sync>,
    ) -> ApiResult<()> {
        *self.workspace_route_handler.write().map_err(lock_error)? = Some(handler);
        Ok(())
    }

    pub fn subscribe_directory(
        &self,
        path: String,
        on_invalidated: Arc<dyn Fn(String) + Send + Sync>,
    ) -> ApiResult<()> {
        crate::infra::peer_files::PeerVirtualPath::parse(&path)?;
        {
            let mut subscriptions = self.directory_subscriptions.lock().map_err(lock_error)?;
            if !subscriptions.insert(path.clone()) {
                return Ok(());
            }
        }
        let service = self.clone();
        tauri::async_runtime::spawn(async move {
            let result = service
                .run_directory_subscription(&path, on_invalidated)
                .await;
            if let Ok(mut subscriptions) = service.directory_subscriptions.lock() {
                subscriptions.remove(&path);
            }
            let _ = result;
        });
        Ok(())
    }

    async fn run_directory_subscription(
        &self,
        path: &str,
        on_invalidated: Arc<dyn Fn(String) + Send + Sync>,
    ) -> ApiResult<()> {
        let parsed = crate::infra::peer_files::PeerVirtualPath::parse(path)?;
        let connection = self.authorized_connection(&parsed.device_id)?;
        let (mut send, mut receive) = connection
            .open_bi()
            .await
            .map_err(|error| ApiError::Unavailable(error.to_string()))?;
        write_request(
            &mut send,
            PeerRequest::SubscribeDirectory {
                path: path.to_owned(),
            },
        )
        .await?;
        loop {
            let envelope: PeerResponseEnvelope = read_frame(&mut receive).await?;
            match envelope.response.map_err(peer_error)? {
                PeerResponse::Subscribed { .. } => {}
                PeerResponse::DirectoryInvalidated { path, .. } => on_invalidated(path),
                _ => {
                    return Err(ApiError::Message(
                        "Peer returned an unexpected subscription response.".to_owned(),
                    ))
                }
            }
        }
    }

    pub async fn initialize(
        &self,
        request: InitializeConnectedDevicesRequest,
        #[cfg(target_os = "macos")] lease: Arc<ServiceLease>,
    ) -> ApiResult<ConnectedDevicesSnapshot> {
        #[cfg(target_os = "macos")]
        {
            let existing = self
                .state
                .read()
                .map_err(lock_error)?
                .as_ref()
                .map(|state| (state.instance.clone(), state.endpoint.clone()));
            if let Some((instance, endpoint)) = existing {
                if instance == request.instance && !endpoint.is_closed() {
                    endpoint.snapshot().await.map_err(ApiError::Unavailable)?;
                    return self.snapshot();
                }
                endpoint.close();
                self.state.write().map_err(lock_error)?.take();
            }
            let owner = lease
                .peer_identity(&request.device_id)
                .map_err(ApiError::Unavailable)?;
            if owner.account_id != request.account_id {
                return Err(ApiError::Unavailable(
                    "The Files session belongs to a different account.".into(),
                ));
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            let same_owner = self
                .state
                .read()
                .map_err(lock_error)?
                .as_ref()
                .map(|state| {
                    state.account_id == request.account_id
                        && state.local_device_id == request.device_id
                });
            match same_owner {
                Some(true) => return self.snapshot(),
                // Another account or device: nothing of the previous one carries over.
                Some(false) => {
                    if let Some(previous) = self.state.write().map_err(lock_error)?.take() {
                        previous.endpoint.close().await;
                    }
                }
                None => {}
            }
        }
        let secret = peer_identity::load_or_create(&request.account_id, &request.device_id)?;
        self.local
            .sessions
            .open(&request.account_id, &request.device_id)?;
        // The previous owner's server id must never answer for this one.
        *self.network_device_id.write().map_err(lock_error)? = String::new();
        let keys = pinned_ticket_keys(&request.development_ticket_keys)?;
        let (relay_mode, relay_policy) = configured_relay_mode()?;
        #[cfg(not(target_os = "macos"))]
        // IPv4 only, as in the macOS transport worker: a global IPv6 path
        // would fail the LAN check for a peer on the same network.
        let endpoint = Endpoint::builder(presets::Minimal)
            .secret_key(SecretKey::from_bytes(&secret))
            .relay_mode(relay_mode)
            .alpns(vec![DEVICE_ALPN.to_vec()])
            .clear_ip_transports()
            .bind_addr("0.0.0.0:0")
            .map_err(|error| ApiError::Message(format!("Invalid bind address: {error}")))?
            .bind()
            .await
            .map_err(|error| {
                ApiError::Unavailable(format!(
                    "Could not start Connected Devices networking: {error}"
                ))
            })?;
        #[cfg(target_os = "macos")]
        let endpoint = crate::infra::peer_transport_worker::Endpoint::initialize_legacy(
            lease, secret, relay_mode,
        )
        .await
        .map_err(ApiError::Unavailable)?;
        let state = ConnectedDevicesState {
            #[cfg(target_os = "macos")]
            instance: request.instance.clone(),
            endpoint: endpoint.clone(),
            account_id: request.account_id,
            local_device_id: request.device_id,
            keys,
            connections: Arc::new(RwLock::new(HashMap::new())),
            used_ticket_ids: Arc::new(Mutex::new(HashMap::new())),
            roots: PeerRootRegistry::discover(),
            relay_policy,
        };
        let accept_context = PeerAcceptContext {
            endpoint: endpoint.clone(),
            network_device_id: self.network_device_id.clone(),
            keys: state.keys.clone(),
            used_ticket_ids: state.used_ticket_ids.clone(),
            roots: state.roots.clone(),
            clipboard_handler: self.clipboard_handler.clone(),
            clipboard_blobs: self.clipboard_blobs.clone(),
            workspace_route_handler: self.workspace_route_handler.clone(),
            workspace_route_results: self.workspace_route_results.clone(),
            local: self.local.clone(),
            connections: state.connections.clone(),
        };
        *self.state.write().map_err(lock_error)? = Some(state);
        tokio::spawn(run_accept_loop(accept_context));
        self.start_session_resumer();
        self.ensure_media_gateway().await?;
        self.snapshot()
    }

    pub fn snapshot(&self) -> ApiResult<ConnectedDevicesSnapshot> {
        let guard = self.state.read().map_err(lock_error)?;
        let Some(state) = guard.as_ref() else {
            return Ok(ConnectedDevicesSnapshot {
                unavailable_reason: Some("Connected Devices has not started.".to_owned()),
                relay_policy: "disabled".to_owned(),
                ..Default::default()
            });
        };
        #[cfg(target_os = "macos")]
        if state.endpoint.is_closed() {
            return Ok(ConnectedDevicesSnapshot {
                unavailable_reason: Some("The Space Files device service closed.".into()),
                relay_policy: "disabled".into(),
                ..Default::default()
            });
        }
        let peers = state
            .connections
            .read()
            .map_err(lock_error)?
            .iter()
            .filter(|(_, connection)| !connection_closed(&connection.connection))
            .map(|(device_id, connection)| ConnectedPeerStatus {
                device_id: device_id.clone(),
                state: if connection.claims.exp > unix_now() {
                    "online"
                } else {
                    "authorization_expired"
                }
                .to_owned(),
                #[cfg(target_os = "macos")]
                connection_type: "direct".into(),
                #[cfg(not(target_os = "macos"))]
                connection_type: connection
                    .connection
                    .paths()
                    .iter()
                    .find(|path| path.is_selected())
                    .map(|path| {
                        if path.is_ip() {
                            "direct"
                        } else if path.is_relay() {
                            "relay"
                        } else {
                            "unknown"
                        }
                    })
                    .unwrap_or("unknown")
                    .to_owned(),
                authorization_expires_at: connection.claims.exp,
            })
            .collect();
        Ok(ConnectedDevicesSnapshot {
            enabled: true,
            endpoint_id: Some(state.endpoint.id().to_string()),
            #[cfg(not(target_os = "macos"))]
            addressing: serde_json::to_value(state.endpoint.addr()).ok(),
            #[cfg(target_os = "macos")]
            addressing: Some(state.endpoint.address()),
            relay_policy: state.relay_policy.clone(),
            peers,
            sessions: self.local.sessions.summaries(),
            unavailable_reason: None,
        })
    }

    pub async fn roots(&self, device_id: &str) -> ApiResult<Vec<PeerRoot>> {
        match self.request(device_id, PeerRequest::GetRoots).await? {
            PeerResponse::Roots { roots } => Ok(roots),
            _ => Err(ApiError::Message(
                "Peer returned an unexpected response.".to_owned(),
            )),
        }
    }

    pub async fn open_workspace_route(
        &self,
        device_id: &str,
        request: OpenWorkspaceRouteRequest,
    ) -> ApiResult<OpenWorkspaceRouteResult> {
        let request_id = request.request_id.clone();
        let connection = self.authorized_connection(device_id)?;
        let response = exchange_control_with_id(
            &connection,
            &request_id,
            PeerRequest::OpenWorkspaceRoute { request },
        )
        .await?;
        match response {
            PeerResponse::WorkspaceRoute { result } if result.request_id == request_id => {
                Ok(result)
            }
            _ => Err(ApiError::Message(
                "Peer returned an unexpected workspace handoff response.".to_owned(),
            )),
        }
    }

    pub async fn list_directory(&self, request: PeerPathRequest) -> ApiResult<PeerResponse> {
        self.request(
            &request.device_id,
            PeerRequest::ListDirectory {
                path: request.path,
                show_hidden: request.show_hidden,
            },
        )
        .await
    }

    pub async fn read_file(&self, request: PeerReadRequest) -> ApiResult<Vec<u8>> {
        let connection = self.authorized_connection(&request.device_id)?;
        let (mut send, mut receive) = connection.open_bi().await.map_err(|error| {
            ApiError::Unavailable(format!("Could not open peer stream: {error}"))
        })?;
        write_request(
            &mut send,
            PeerRequest::ReadFile {
                path: request.path,
                offset: request.offset,
                length: request.length,
                expected_snapshot: request.expected_snapshot,
            },
        )
        .await?;
        let response: PeerResponseEnvelope = read_frame(&mut receive).await?;
        let response = response.response.map_err(peer_error)?;
        let PeerResponse::FileRange { length, .. } = response else {
            return Err(ApiError::Message(
                "Peer returned an unexpected file response.".to_owned(),
            ));
        };
        let length: usize = length
            .try_into()
            .map_err(|_| ApiError::Message("Peer file range is too large.".to_owned()))?;
        // Command callers use bounded preview/range requests. Permanent copies use
        // the transfer adapter, which streams chunks directly to a `.part` file.
        if length > 64 * 1024 * 1024 {
            return Err(ApiError::Message(
                "Peer range exceeds the in-memory preview limit.".to_owned(),
            ));
        }
        let mut bytes = vec![0; length];
        receive.read_exact(&mut bytes).await.map_err(|error| {
            ApiError::Unavailable(format!("Peer file stream ended early: {error}"))
        })?;
        Ok(bytes)
    }

    pub async fn materialize(&self, path: &str) -> ApiResult<MaterializedPeerFile> {
        self.materialize_with(path, TransferWatch::default()).await
    }

    /// Downloads one file into the peer cache, resuming a partial download.
    /// `watch` counts the bytes as they arrive and can cancel between chunks.
    pub async fn materialize_with(
        &self,
        path: &str,
        watch: TransferWatch<'_>,
    ) -> ApiResult<MaterializedPeerFile> {
        let parsed = crate::infra::peer_files::PeerVirtualPath::parse(path)?;
        let stat = self
            .request(
                &parsed.device_id,
                PeerRequest::Stat {
                    path: path.to_owned(),
                },
            )
            .await?;
        let PeerResponse::Stat { entry } = stat else {
            return Err(ApiError::Message(
                "Peer returned an unexpected file response.".to_owned(),
            ));
        };
        if !matches!(
            entry.kind,
            crate::domain::connected_devices::PeerEntryKind::File
        ) {
            return Err(ApiError::Message(
                "Remote folders must be copied through the transfer queue.".to_owned(),
            ));
        }
        let size = entry
            .size_bytes
            .ok_or_else(|| ApiError::Message("Peer did not provide the file size.".to_owned()))?;
        let mut hasher = Sha256::new();
        hasher.update(path.as_bytes());
        hasher.update(b"\0");
        hasher.update(entry.snapshot.as_bytes());
        let cache_key = hex::encode(hasher.finalize());
        let directory = self.cache_root.join(&cache_key);
        let file_name = sanitize_peer_file_name(&entry.name);
        let final_path = directory.join(&file_name);
        if final_path.is_file() {
            watch.advance(size);
            return Ok(MaterializedPeerFile {
                local_path: final_path,
                cache_hit: true,
                snapshot: entry.snapshot,
            });
        }
        tokio::fs::create_dir_all(&directory)
            .await
            .map_err(|error| ApiError::Message(format!("Could not create peer cache: {error}")))?;
        let partial_path = directory.join(format!("{file_name}.part"));
        let metadata_path = directory.join("resume.json");
        let resume = read_resume_metadata(&metadata_path).filter(|resume| {
            resume.source_path == path
                && resume.snapshot == entry.snapshot
                && resume.size_bytes == size
        });
        if resume.is_none() {
            let _ = tokio::fs::remove_file(&partial_path).await;
        }
        let mut offset = tokio::fs::metadata(&partial_path)
            .await
            .ok()
            .map_or(0, |metadata| metadata.len())
            .min(size);
        let resume_document = PeerResumeMetadata {
            source_path: path.to_owned(),
            snapshot: entry.snapshot.clone(),
            size_bytes: size,
        };
        tokio::fs::write(&metadata_path, serde_json::to_vec(&resume_document)?)
            .await
            .map_err(|error| {
                ApiError::Message(format!("Could not save peer transfer resume data: {error}"))
            })?;
        let mut file = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&partial_path)
            .await
            .map_err(|error| {
                ApiError::Message(format!("Could not open peer partial file: {error}"))
            })?;
        // A resumed download already has these bytes.
        watch.advance(offset);
        const CHUNK_BYTES: u64 = 4 * 1024 * 1024;
        while offset < size {
            watch.check()?;
            let length = CHUNK_BYTES.min(size - offset);
            let bytes = self
                .read_file(PeerReadRequest {
                    device_id: parsed.device_id.clone(),
                    path: path.to_owned(),
                    offset,
                    length: Some(length),
                    expected_snapshot: Some(entry.snapshot.clone()),
                })
                .await?;
            if bytes.len() as u64 != length {
                return Err(ApiError::Unavailable(
                    "Peer file stream ended before the requested range.".to_owned(),
                ));
            }
            file.write_all(&bytes).await.map_err(|error| {
                ApiError::Message(format!("Could not write peer partial file: {error}"))
            })?;
            file.flush().await.map_err(|error| {
                ApiError::Message(format!("Could not flush peer partial file: {error}"))
            })?;
            offset += length;
            watch.advance(length);
        }
        drop(file);
        tokio::fs::rename(&partial_path, &final_path)
            .await
            .map_err(|error| {
                ApiError::Message(format!("Could not finish peer download: {error}"))
            })?;
        let _ = tokio::fs::remove_file(metadata_path).await;
        let cleanup_root = self.cache_root.as_ref().clone();
        tokio::task::spawn_blocking(move || cleanup_peer_cache(&cleanup_root));
        Ok(MaterializedPeerFile {
            local_path: final_path,
            cache_hit: false,
            snapshot: entry.snapshot,
        })
    }

    pub async fn materialize_tree(&self, path: &str) -> ApiResult<MaterializedPeerFile> {
        self.materialize_tree_with(path, TransferWatch::default())
            .await
    }

    /// Downloads a file or folder into the peer cache. See `materialize_with`.
    pub async fn materialize_tree_with(
        &self,
        path: &str,
        watch: TransferWatch<'_>,
    ) -> ApiResult<MaterializedPeerFile> {
        let parsed = crate::infra::peer_files::PeerVirtualPath::parse(path)?;
        let response = self
            .request(
                &parsed.device_id,
                PeerRequest::Stat {
                    path: path.to_owned(),
                },
            )
            .await?;
        let PeerResponse::Stat { entry } = response else {
            return Err(ApiError::Message(
                "Peer returned an unexpected file response.".to_owned(),
            ));
        };
        if matches!(
            entry.kind,
            crate::domain::connected_devices::PeerEntryKind::File
        ) {
            return self.materialize_with(path, watch).await;
        }
        if !matches!(
            entry.kind,
            crate::domain::connected_devices::PeerEntryKind::Directory
        ) {
            return Err(ApiError::Message(
                "Remote links cannot be materialized outside Misty.".to_owned(),
            ));
        }
        let mut hasher = Sha256::new();
        hasher.update(b"tree\0");
        hasher.update(path.as_bytes());
        hasher.update(b"\0");
        hasher.update(entry.snapshot.as_bytes());
        let directory = self.cache_root.join(hex::encode(hasher.finalize()));
        let final_path = directory.join(sanitize_peer_file_name(&entry.name));
        if final_path.is_dir() {
            return Ok(MaterializedPeerFile {
                local_path: final_path,
                cache_hit: true,
                snapshot: entry.snapshot,
            });
        }
        let partial_path = directory.join("tree.part");
        let _ = tokio::fs::remove_dir_all(&partial_path).await;
        tokio::fs::create_dir_all(&partial_path)
            .await
            .map_err(|error| {
                ApiError::Message(format!("Could not create peer folder cache: {error}"))
            })?;
        let mut pending = vec![(path.to_owned(), partial_path.clone())];
        while let Some((remote_directory, local_directory)) = pending.pop() {
            let response = self
                .request(
                    &parsed.device_id,
                    PeerRequest::ListDirectory {
                        path: remote_directory,
                        show_hidden: true,
                    },
                )
                .await?;
            let PeerResponse::Directory { entries, .. } = response else {
                return Err(ApiError::Message(
                    "Peer returned an unexpected directory response.".to_owned(),
                ));
            };
            for child in entries {
                let child_local = local_directory.join(sanitize_peer_file_name(&child.name));
                match child.kind {
                    crate::domain::connected_devices::PeerEntryKind::Directory => {
                        tokio::fs::create_dir_all(&child_local)
                            .await
                            .map_err(|error| {
                                ApiError::Message(format!(
                                    "Could not create peer folder cache: {error}"
                                ))
                            })?;
                        pending.push((child.path, child_local));
                    }
                    crate::domain::connected_devices::PeerEntryKind::File => {
                        watch.check()?;
                        let materialized = self.materialize_with(&child.path, watch).await?;
                        tokio::fs::copy(&materialized.local_path, &child_local)
                            .await
                            .map_err(|error| {
                                ApiError::Message(format!("Could not stage remote file: {error}"))
                            })?;
                    }
                    crate::domain::connected_devices::PeerEntryKind::Symlink => {}
                }
            }
        }
        tokio::fs::rename(&partial_path, &final_path)
            .await
            .map_err(|error| {
                ApiError::Message(format!("Could not finish remote folder: {error}"))
            })?;
        Ok(MaterializedPeerFile {
            local_path: final_path,
            cache_hit: false,
            snapshot: entry.snapshot,
        })
    }

    pub async fn media_url(&self, path: &str) -> ApiResult<String> {
        let parsed = crate::infra::peer_files::PeerVirtualPath::parse(path)?;
        let stat = self
            .request(
                &parsed.device_id,
                PeerRequest::Stat {
                    path: path.to_owned(),
                },
            )
            .await?;
        let PeerResponse::Stat { entry } = stat else {
            return Err(ApiError::Message(
                "Peer returned an unexpected file response.".to_owned(),
            ));
        };
        let size_bytes = entry
            .size_bytes
            .ok_or_else(|| ApiError::Message("Peer did not provide the file size.".to_owned()))?;
        self.ensure_media_gateway().await?;
        let gateway = self.gateway.read().map_err(lock_error)?;
        let gateway = gateway.as_ref().ok_or_else(|| {
            ApiError::Unavailable("Peer media gateway is unavailable.".to_owned())
        })?;
        let mut token_bytes = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut token_bytes);
        let token = URL_SAFE_NO_PAD.encode(token_bytes);
        gateway.grants.lock().map_err(lock_error)?.insert(
            token.clone(),
            PeerMediaGrant {
                device_id: parsed.device_id,
                path: path.to_owned(),
                snapshot: entry.snapshot,
                size_bytes,
                expires_at: unix_now() + 600,
            },
        );
        Ok(format!("{}/peer/{token}", gateway.base_url))
    }

    async fn ensure_media_gateway(&self) -> ApiResult<()> {
        if self.gateway.read().map_err(lock_error)?.is_some() {
            return Ok(());
        }
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|error| {
                ApiError::Unavailable(format!("Could not start peer media gateway: {error}"))
            })?;
        let address = listener
            .local_addr()
            .map_err(|error| ApiError::Unavailable(error.to_string()))?;
        let grants = Arc::new(Mutex::new(HashMap::new()));
        let router = axum::Router::new()
            .route("/peer/{token}", axum::routing::get(peer_media_handler))
            .with_state(PeerMediaState {
                service: self.clone(),
                grants: grants.clone(),
            });
        tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });
        *self.gateway.write().map_err(lock_error)? = Some(PeerMediaGateway {
            base_url: format!("http://127.0.0.1:{}", address.port()),
            grants,
        });
        Ok(())
    }

    async fn request(&self, device_id: &str, request: PeerRequest) -> ApiResult<PeerResponse> {
        let connection = self.authorized_connection(device_id)?;
        let result = exchange_control(&connection, request).await;
        // A transport failure means the connection is gone. Forget it so the
        // session reconnects instead of failing every request until it expires.
        if matches!(result, Err(ApiError::Unavailable(_))) {
            self.drop_connection(device_id, &connection);
        }
        result
    }

    fn drop_connection(&self, device_id: &str, connection: &TransportConnection) {
        let Ok(guard) = self.state.read() else {
            return;
        };
        let Some(state) = guard.as_ref() else {
            return;
        };
        if let Ok(mut connections) = state.connections.write() {
            let same = connections
                .get(device_id)
                .is_some_and(|current| same_connection(&current.connection, connection));
            if same {
                connections.remove(device_id);
            }
        }
        close_connection(connection);
    }

    fn authorized_connection(&self, device_id: &str) -> ApiResult<TransportConnection> {
        let guard = self.state.read().map_err(lock_error)?;
        let state = guard.as_ref().ok_or_else(|| {
            ApiError::Unavailable("Connected Devices has not started.".to_owned())
        })?;
        let connections = state.connections.read().map_err(lock_error)?;
        let peer = connections
            .get(device_id)
            .filter(|peer| !connection_closed(&peer.connection))
            .ok_or_else(|| ApiError::Unavailable("The device is offline.".to_owned()))?;
        if peer.claims.exp <= unix_now() {
            return Err(ApiError::Unavailable(
                "The device session ended. Connect again from Files.".to_owned(),
            ));
        }
        Ok(peer.connection.clone())
    }
}

#[derive(Debug, Clone)]
pub struct MaterializedPeerFile {
    pub local_path: PathBuf,
    pub cache_hit: bool,
    pub snapshot: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PeerResumeMetadata {
    source_path: String,
    snapshot: String,
    size_bytes: u64,
}

fn read_resume_metadata(path: &Path) -> Option<PeerResumeMetadata> {
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

fn sanitize_peer_file_name(value: &str) -> String {
    let value = value.trim();
    let sanitized: String = value
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
                )
            {
                '_'
            } else {
                character
            }
        })
        .collect();
    if sanitized.is_empty() {
        "remote-file".to_owned()
    } else {
        sanitized
    }
}

fn cleanup_peer_cache(root: &Path) {
    const TTL_SECONDS: u64 = 72 * 60 * 60;
    const SOFT_CAP_BYTES: u64 = 10 * 1024 * 1024 * 1024;
    let now = SystemTime::now();
    let mut files = Vec::new();
    let mut total = 0u64;
    let Ok(directories) = std::fs::read_dir(root) else {
        return;
    };
    for directory in directories.flatten() {
        let Ok(children) = std::fs::read_dir(directory.path()) else {
            continue;
        };
        for child in children.flatten() {
            let Ok(metadata) = child.metadata() else {
                continue;
            };
            if !metadata.is_file()
                || child.file_name() == "resume.json"
                || child.file_name().to_string_lossy().ends_with(".part")
            {
                continue;
            }
            let modified = metadata.modified().unwrap_or(UNIX_EPOCH);
            if now.duration_since(modified).unwrap_or_default().as_secs() > TTL_SECONDS {
                let _ = std::fs::remove_dir_all(directory.path());
                continue;
            }
            total = total.saturating_add(metadata.len());
            files.push((modified, metadata.len(), directory.path()));
        }
    }
    files.sort_by_key(|(modified, _, _)| *modified);
    for (_, size, directory) in files {
        if total <= SOFT_CAP_BYTES {
            break;
        }
        if std::fs::remove_dir_all(directory).is_ok() {
            total = total.saturating_sub(size);
        }
    }
}

#[derive(Clone)]
struct PeerAcceptContext {
    endpoint: Endpoint,
    network_device_id: Arc<RwLock<String>>,
    keys: HashMap<String, VerifyingKey>,
    used_ticket_ids: Arc<Mutex<HashMap<String, i64>>>,
    roots: PeerRootRegistry,
    clipboard_handler: Arc<RwLock<Option<Arc<dyn Fn(ClipboardPayload) + Send + Sync>>>>,
    clipboard_blobs: Arc<Mutex<HashMap<String, ClipboardBlobRecord>>>,
    workspace_route_handler:
        Arc<RwLock<Option<Arc<dyn Fn(OpenWorkspaceRouteRequest) -> bool + Send + Sync>>>>,
    workspace_route_results: Arc<Mutex<HashMap<String, (i64, OpenWorkspaceRouteResult)>>>,
    local: PeerLocal,
    connections: Arc<RwLock<HashMap<String, AuthorizedConnection>>>,
}

#[cfg(not(target_os = "macos"))]
async fn run_accept_loop(context: PeerAcceptContext) {
    while let Some(incoming) = context.endpoint.accept().await {
        let context = context.clone();
        tokio::spawn(async move {
            let Ok(connection) = incoming.await else {
                return;
            };
            let _ = handle_incoming_connection(context, connection).await;
        });
    }
}

#[cfg(target_os = "macos")]
async fn run_accept_loop(context: PeerAcceptContext) {
    while let Ok(connection) = context.endpoint.accept().await {
        let context = context.clone();
        tokio::spawn(async move {
            let _ = handle_incoming_connection(context, connection).await;
        });
    }
}

async fn handle_incoming_connection(
    context: PeerAcceptContext,
    connection: TransportConnection,
) -> ApiResult<()> {
    #[cfg(not(target_os = "macos"))]
    if !connection.paths().iter().any(|path| path.is_selected() && matches!(path.remote_addr(), iroh::TransportAddr::Ip(socket) if crate::domain::lan::is_lan_address(socket.ip()))) {
        connection.close(0u8.into(), b"LAN files only");
        return Err(ApiError::Message("Files connections require a local network address.".into()));
    }
    let remote_endpoint = connection.remote_id().to_string();
    let (mut send, mut receive) = connection
        .accept_bi()
        .await
        .map_err(|error| ApiError::Unavailable(error.to_string()))?;
    let hello: PeerRequestEnvelope = read_frame(&mut receive).await?;
    let local_endpoint = context.endpoint.id().to_string();
    let local_device_id = context
        .network_device_id
        .read()
        .map(|id| id.clone())
        .unwrap_or_default();
    if local_device_id.is_empty() {
        return Err(ApiError::Unavailable(
            "This device is not registered with Misty yet.".to_owned(),
        ));
    }
    let verify_ticket = |ticket: &str| -> ApiResult<PeerTicketClaims> {
        let mut used = context.used_ticket_ids.lock().map_err(lock_error)?;
        verify_peer_ticket(
            ticket,
            &context.keys,
            &remote_endpoint,
            &local_endpoint,
            unix_now(),
            &mut used,
        )
    };
    // A server ticket alone (Hello) authorizes a short connection. Connect
    // also starts a local session; Resume continues one, checked only here.
    let (claims, response, session_based) = match hello.request {
        PeerRequest::Hello { ticket } => {
            let claims = verify_ticket(&ticket)?;
            let expires_at = claims.exp;
            (claims, PeerResponse::Authorized { expires_at }, false)
        }
        PeerRequest::Connect {
            ticket,
            session,
            address,
        } => {
            let mut claims = verify_ticket(&ticket)?;
            let now = unix_now();
            let expires_at = session
                .expires_at
                .min(now + i64::from(MAX_SESSION_DAYS) * 24 * 60 * 60);
            if expires_at <= now || !(32..=128).contains(&session.token.len()) {
                return Err(ApiError::Message(
                    "The session offer is invalid.".to_owned(),
                ));
            }
            let sessions = &context.local.sessions;
            sessions.store_outgoing(
                &claims.source_device_id,
                &remote_endpoint,
                session.token,
                expires_at,
                address,
            )?;
            let token =
                sessions.issue_incoming(&claims.source_device_id, &remote_endpoint, expires_at)?;
            claims.exp = expires_at;
            let writable = context
                .local
                .consent(&claims.source_device_id)
                .accepts_writes;
            let response = PeerResponse::Connected {
                expires_at,
                session: Some(SessionOffer { token, expires_at }),
                writable,
            };
            (claims, response, true)
        }
        PeerRequest::Resume {
            device_id,
            token,
            address,
        } => {
            let sessions = &context.local.sessions;
            let Some(expires_at) =
                sessions.verify_incoming(&device_id, &remote_endpoint, &token, unix_now())
            else {
                let _ = write_response(
                    &mut send,
                    &hello.request_id,
                    Err(PeerError {
                        code: PeerErrorCode::Revoked,
                        message: "This device session has ended. Connect again from Misty."
                            .to_owned(),
                        retry_after_ms: None,
                    }),
                )
                .await;
                return Err(ApiError::Message("Device session ended.".to_owned()));
            };
            if let Some(address) = address {
                let _ = sessions.remember_address(&device_id, address);
            }
            let writable = context.local.consent(&device_id).accepts_writes;
            let claims = session_claims(
                &device_id,
                &remote_endpoint,
                &local_device_id,
                &local_endpoint,
                expires_at,
                writable,
            );
            let response = PeerResponse::Connected {
                expires_at,
                session: None,
                writable,
            };
            (claims, response, true)
        }
        _ => {
            return Err(ApiError::Message(
                "The first peer request must authorize the connection.".to_owned(),
            ))
        }
    };
    if claims.target_device_id != local_device_id {
        return Err(ApiError::Message(
            "Peer ticket targets a different device.".to_owned(),
        ));
    }
    write_response(&mut send, &hello.request_id, Ok(response)).await?;

    loop {
        let ended = session_based
            && !context
                .local
                .sessions
                .incoming_active(&claims.source_device_id, unix_now());
        if claims.exp <= unix_now() || ended {
            #[cfg(not(target_os = "macos"))]
            connection.close(1u8.into(), b"authorization expired");
            #[cfg(target_os = "macos")]
            connection.close();
            return Ok(());
        }
        let Ok((send, receive)) = connection.accept_bi().await else {
            return Ok(());
        };
        let roots = context.roots.clone();
        let claims = claims.clone();
        let clipboard_handler = context.clipboard_handler.clone();
        let clipboard_blobs = context.clipboard_blobs.clone();
        let workspace_route_handler = context.workspace_route_handler.clone();
        let workspace_route_results = context.workspace_route_results.clone();
        let local = context.local.clone();
        let connections = context.connections.clone();
        tokio::spawn(async move {
            let _ = handle_authorized_stream(
                send,
                receive,
                roots,
                claims,
                clipboard_handler,
                clipboard_blobs,
                workspace_route_handler,
                workspace_route_results,
                local,
                connections,
            )
            .await;
        });
    }
}

async fn handle_authorized_stream(
    mut send: TransportSendStream,
    mut receive: TransportRecvStream,
    roots: PeerRootRegistry,
    claims: PeerTicketClaims,
    clipboard_handler: Arc<RwLock<Option<Arc<dyn Fn(ClipboardPayload) + Send + Sync>>>>,
    clipboard_blobs: Arc<Mutex<HashMap<String, ClipboardBlobRecord>>>,
    workspace_route_handler: Arc<
        RwLock<Option<Arc<dyn Fn(OpenWorkspaceRouteRequest) -> bool + Send + Sync>>>,
    >,
    workspace_route_results: Arc<Mutex<HashMap<String, (i64, OpenWorkspaceRouteResult)>>>,
    local: PeerLocal,
    connections: Arc<RwLock<HashMap<String, AuthorizedConnection>>>,
) -> ApiResult<()> {
    let envelope: PeerRequestEnvelope = read_frame(&mut receive).await?;
    #[cfg(target_os = "macos")]
    if send.is_closed() {
        return Err(ApiError::Unavailable(
            "The Files device session closed.".into(),
        ));
    }

    if claims.exp <= unix_now() {
        return write_response(
            &mut send,
            &envelope.request_id,
            Err(PeerError {
                code: PeerErrorCode::AuthorizationExpired,
                message: "Authorization expired.".to_owned(),
                retry_after_ms: None,
            }),
        )
        .await;
    }
    // Changes and clipboard follow this device's own current consent, so a
    // change of mind applies at once, without the server or a new session.
    let consent = local.consent(&claims.source_device_id);
    let writable = consent.accepts_writes;
    match envelope.request {
        PeerRequest::EndSession => {
            let _ = local.sessions.end(&claims.source_device_id);
            let dropped = connections
                .write()
                .ok()
                .and_then(|mut connections| connections.remove(&claims.source_device_id));
            if let Some(dropped) = dropped {
                close_connection(&dropped.connection);
            }
            write_response(
                &mut send,
                &envelope.request_id,
                Ok(PeerResponse::SessionEnded),
            )
            .await
        }
        PeerRequest::GetRoots if has_permission(&claims, "roots:read") => {
            let mut shared = roots.roots();
            for root in &mut shared {
                root.readonly = !writable;
            }
            write_response(
                &mut send,
                &envelope.request_id,
                Ok(PeerResponse::Roots { roots: shared }),
            )
            .await
        }
        PeerRequest::WriteFile {
            directory,
            name,
            size,
        } => {
            if !writable {
                return write_forbidden(&mut send, &envelope.request_id).await;
            }
            let result = receive_upload(
                &roots,
                &claims.target_device_id,
                &directory,
                &name,
                size,
                &mut receive,
            )
            .await;
            write_response(
                &mut send,
                &envelope.request_id,
                writable_entry(result).map_err(peer_protocol_error),
            )
            .await
        }
        request @ (PeerRequest::CreateItem { .. }
        | PeerRequest::RenameItem { .. }
        | PeerRequest::TransferItem { .. }
        | PeerRequest::DeleteItem { .. }) => {
            if !writable {
                return write_forbidden(&mut send, &envelope.request_id).await;
            }
            let result = match local.explorer() {
                Some(explorer) => {
                    crate::infra::peer_writes::apply_change(
                        &roots,
                        &explorer,
                        &claims.target_device_id,
                        request,
                    )
                    .await
                }
                None => Err(ApiError::Unavailable(
                    "This device is not ready to receive changes.".to_owned(),
                )),
            };
            write_response(
                &mut send,
                &envelope.request_id,
                writable_entry(result).map_err(peer_protocol_error),
            )
            .await
        }
        PeerRequest::ListDirectory { path, show_hidden } => {
            if !has_permission(&claims, "files:read") {
                return write_forbidden(&mut send, &envelope.request_id).await;
            }
            let result = (|| {
                let parsed = crate::infra::peer_files::PeerVirtualPath::parse(&path)?;
                roots.list_directory(
                    &claims.target_device_id,
                    &parsed.root_id,
                    &parsed.relative_path,
                    show_hidden,
                )
            })();
            let (mut entries, snapshot) = match result {
                Ok(value) => value,
                Err(error) => {
                    return write_response(
                        &mut send,
                        &envelope.request_id,
                        Err(peer_protocol_error(error)),
                    )
                    .await
                }
            };
            for entry in &mut entries {
                entry.readonly = !writable;
            }
            write_response(
                &mut send,
                &envelope.request_id,
                Ok(PeerResponse::Directory {
                    path,
                    entries,
                    snapshot,
                    writable,
                }),
            )
            .await
        }
        PeerRequest::Stat { path } => {
            if !has_permission(&claims, "files:read") {
                return write_forbidden(&mut send, &envelope.request_id).await;
            }
            let result = (|| {
                let parsed = crate::infra::peer_files::PeerVirtualPath::parse(&path)?;
                roots.stat(
                    &claims.target_device_id,
                    &parsed.root_id,
                    &parsed.relative_path,
                )
            })();
            let mut entry = match result {
                Ok(value) => value,
                Err(error) => {
                    return write_response(
                        &mut send,
                        &envelope.request_id,
                        Err(peer_protocol_error(error)),
                    )
                    .await
                }
            };
            entry.readonly = !writable;
            write_response(
                &mut send,
                &envelope.request_id,
                Ok(PeerResponse::Stat { entry }),
            )
            .await
        }
        PeerRequest::ReadFile {
            path,
            offset,
            length,
            expected_snapshot,
        } => {
            if !has_permission(&claims, "files:read") {
                return write_forbidden(&mut send, &envelope.request_id).await;
            }
            let result = (|| {
                let parsed = crate::infra::peer_files::PeerVirtualPath::parse(&path)?;
                let mut opened = roots.open_file(
                    &parsed.root_id,
                    &parsed.relative_path,
                    expected_snapshot.as_deref(),
                )?;
                let range_length = opened.range_length(offset, length)?;
                opened
                    .file
                    .seek(SeekFrom::Start(offset))
                    .map_err(|error| ApiError::Message(error.to_string()))?;
                Ok((opened, range_length))
            })();
            let (opened, range_length) = match result {
                Ok(value) => value,
                Err(error) => {
                    return write_response(
                        &mut send,
                        &envelope.request_id,
                        Err(peer_protocol_error(error)),
                    )
                    .await
                }
            };
            let snapshot = opened.snapshot.clone();
            write_response_open(
                &mut send,
                &envelope.request_id,
                Ok(PeerResponse::FileRange {
                    snapshot,
                    offset,
                    length: range_length,
                }),
            )
            .await?;
            let mut file = tokio::fs::File::from_std(opened.file);
            let mut remaining = range_length;
            let mut buffer = vec![0u8; 256 * 1024];
            while remaining > 0 {
                let requested = buffer.len().min(remaining as usize);
                let count = file
                    .read(&mut buffer[..requested])
                    .await
                    .map_err(|error| ApiError::Message(error.to_string()))?;
                if count == 0 {
                    return Err(ApiError::Message(
                        "Source changed while streaming.".to_owned(),
                    ));
                }
                send.write_all(&buffer[..count])
                    .await
                    .map_err(|error| ApiError::Unavailable(error.to_string()))?;
                remaining -= count as u64;
            }
            finish_stream(&mut send)
                .await
                .map_err(|error| ApiError::Unavailable(error.to_string()))?;
            Ok(())
        }
        PeerRequest::SubscribeDirectory { path } => {
            if !has_permission(&claims, "directories:subscribe") {
                return write_forbidden(&mut send, &envelope.request_id).await;
            }
            let parsed = match crate::infra::peer_files::PeerVirtualPath::parse(&path) {
                Ok(value) => value,
                Err(error) => {
                    return write_response(
                        &mut send,
                        &envelope.request_id,
                        Err(peer_protocol_error(error)),
                    )
                    .await
                }
            };
            let (_, mut snapshot) = match roots.list_directory(
                &claims.target_device_id,
                &parsed.root_id,
                &parsed.relative_path,
                true,
            ) {
                Ok(value) => value,
                Err(error) => {
                    return write_response(
                        &mut send,
                        &envelope.request_id,
                        Err(peer_protocol_error(error)),
                    )
                    .await
                }
            };
            let subscription_id = uuid::Uuid::new_v4().to_string();
            write_response_open(
                &mut send,
                &envelope.request_id,
                Ok(PeerResponse::Subscribed {
                    subscription_id: subscription_id.clone(),
                }),
            )
            .await?;
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(1));
            loop {
                interval.tick().await;
                if claims.exp <= unix_now() {
                    break;
                }
                let Ok((_, current)) = roots.list_directory(
                    &claims.target_device_id,
                    &parsed.root_id,
                    &parsed.relative_path,
                    true,
                ) else {
                    break;
                };
                if current != snapshot {
                    snapshot = current;
                    if write_response_open(
                        &mut send,
                        &envelope.request_id,
                        Ok(PeerResponse::DirectoryInvalidated {
                            subscription_id: subscription_id.clone(),
                            path: path.clone(),
                        }),
                    )
                    .await
                    .is_err()
                    {
                        break;
                    }
                }
            }
            let _ = finish_stream(&mut send).await;
            Ok(())
        }
        PeerRequest::ClipboardOffer { payload } => {
            if !consent.shares_clipboard {
                return write_response(
                    &mut send,
                    &envelope.request_id,
                    Err(PeerError {
                        code: PeerErrorCode::Revoked,
                        message: "Clipboard sharing is not enabled for this device pair."
                            .to_owned(),
                        retry_after_ms: None,
                    }),
                )
                .await;
            }
            let source_mismatch = payload.source_endpoint_id != claims.source_endpoint_id
                || matches!(&payload.kind, ClipboardOfferKind::FileReferences { files, .. }
                    if files.iter().any(|file| file.device_id != claims.source_device_id));
            if source_mismatch {
                return write_response(
                    &mut send,
                    &envelope.request_id,
                    Err(PeerError {
                        code: PeerErrorCode::MalformedRequest,
                        message: "Clipboard offer identity does not match the authorized peer."
                            .to_owned(),
                        retry_after_ms: None,
                    }),
                )
                .await;
            }
            if let Err(error) = validate_clipboard_offer(&payload) {
                return write_response(&mut send, &envelope.request_id, Err(error)).await;
            }
            let revision = payload.revision;
            let converted = clipboard_offer_to_payload(&claims.source_device_id, payload);
            #[cfg(target_os = "macos")]
            if send.is_closed() {
                return Err(ApiError::Unavailable(
                    "The Files device session closed.".into(),
                ));
            }
            if let Some(handler) = clipboard_handler.read().map_err(lock_error)?.clone() {
                handler(converted);
            }
            write_response(
                &mut send,
                &envelope.request_id,
                Ok(PeerResponse::ClipboardAccepted { revision }),
            )
            .await
        }
        PeerRequest::ClipboardFetchBlob {
            blob_id,
            offset,
            length,
        } => {
            if !consent.shares_clipboard {
                return write_forbidden(&mut send, &envelope.request_id).await;
            }
            let blob = {
                let mut blobs = clipboard_blobs.lock().map_err(lock_error)?;
                blobs.retain(|_, blob| blob.expires_at > unix_now());
                blobs.get(&blob_id).cloned()
            };
            let Some(blob) = blob else {
                return write_response(
                    &mut send,
                    &envelope.request_id,
                    Err(PeerError {
                        code: PeerErrorCode::NotFound,
                        message: "Clipboard image is no longer available.".to_owned(),
                        retry_after_ms: None,
                    }),
                )
                .await;
            };
            let total = blob.bytes.len() as u64;
            if offset > total {
                return write_response(
                    &mut send,
                    &envelope.request_id,
                    Err(PeerError {
                        code: PeerErrorCode::MalformedRequest,
                        message: "Clipboard blob range is invalid.".to_owned(),
                        retry_after_ms: None,
                    }),
                )
                .await;
            }
            let range_length = length.unwrap_or(total - offset).min(total - offset);
            write_response_open(
                &mut send,
                &envelope.request_id,
                Ok(PeerResponse::ClipboardBlob {
                    blob_id,
                    offset,
                    length: range_length,
                }),
            )
            .await?;
            let start = offset as usize;
            let end = start + range_length as usize;
            send.write_all(&blob.bytes[start..end])
                .await
                .map_err(|error| ApiError::Unavailable(error.to_string()))?;
            finish_stream(&mut send)
                .await
                .map_err(|error| ApiError::Unavailable(error.to_string()))?;
            Ok(())
        }
        PeerRequest::OpenWorkspaceRoute { request } => {
            let result = handle_workspace_route_request(
                &envelope.request_id,
                &claims,
                request,
                &workspace_route_handler,
                &workspace_route_results,
            )?;
            write_response(
                &mut send,
                &envelope.request_id,
                Ok(PeerResponse::WorkspaceRoute { result }),
            )
            .await
        }
        PeerRequest::Ping { nonce } => {
            write_response(
                &mut send,
                &envelope.request_id,
                Ok(PeerResponse::Pong { nonce }),
            )
            .await
        }
        PeerRequest::ReadLink { .. } => {
            write_response(
                &mut send,
                &envelope.request_id,
                Err(PeerError {
                    code: PeerErrorCode::UnsupportedOperation,
                    message: "Symbolic links require a Space peer connection.".into(),
                    retry_after_ms: None,
                }),
            )
            .await
        }
        PeerRequest::Hello { .. } | PeerRequest::Connect { .. } | PeerRequest::Resume { .. } => {
            write_response(
                &mut send,
                &envelope.request_id,
                Err(PeerError {
                    code: PeerErrorCode::MalformedRequest,
                    message: "Connection is already authorized.".to_owned(),
                    retry_after_ms: None,
                }),
            )
            .await
        }
        PeerRequest::GetRoots => write_forbidden(&mut send, &envelope.request_id).await,
    }
}

fn handle_workspace_route_request(
    envelope_request_id: &str,
    claims: &PeerTicketClaims,
    request: OpenWorkspaceRouteRequest,
    handler: &Arc<RwLock<Option<Arc<dyn Fn(OpenWorkspaceRouteRequest) -> bool + Send + Sync>>>>,
    results: &Arc<Mutex<HashMap<String, (i64, OpenWorkspaceRouteResult)>>>,
) -> ApiResult<OpenWorkspaceRouteResult> {
    let now = unix_now();
    {
        let mut cached = results.lock().map_err(lock_error)?;
        cached.retain(|_, (stored_at, _)| *stored_at > now - 600);
        if let Some((_, result)) = cached.get(&request.request_id) {
            return Ok(result.clone());
        }
    }

    let sent_at = chrono::DateTime::parse_from_rfc3339(&request.sent_at)
        .map(|value| value.timestamp())
        .unwrap_or(0);
    let expired = sent_at < now - 120 || sent_at > now + 30;
    let identity_valid = request.request_id == envelope_request_id
        && uuid::Uuid::parse_str(&request.request_id).is_ok()
        && request.source_device_id == claims.source_device_id
        && !request.source_device_name.trim().is_empty()
        && request.source_device_name.len() <= 80;
    let route_valid = match request.surface {
        WorkspaceRouteSurface::Code => request.route.starts_with("/code"),
        WorkspaceRouteSurface::Terminal => request.route.starts_with("/terminal"),
        WorkspaceRouteSurface::Transfers => request.route.starts_with("/transfers"),
        WorkspaceRouteSurface::Files => request.route.starts_with("/files"),
    } && request.route.len() <= 2048;

    let result = if expired {
        OpenWorkspaceRouteResult {
            request_id: request.request_id.clone(),
            status: OpenWorkspaceRouteStatus::Expired,
            reason: "This handoff request expired. Try again from the sending device.".to_owned(),
        }
    } else if !identity_valid || !route_valid {
        OpenWorkspaceRouteResult {
            request_id: request.request_id.clone(),
            status: OpenWorkspaceRouteStatus::Rejected,
            reason: "This device did not accept the requested workspace route.".to_owned(),
        }
    } else {
        let emitted = handler
            .read()
            .map_err(lock_error)?
            .clone()
            .is_some_and(|handler| handler(request.clone()));
        OpenWorkspaceRouteResult {
            request_id: request.request_id.clone(),
            status: if emitted {
                OpenWorkspaceRouteStatus::Opened
            } else {
                OpenWorkspaceRouteStatus::Rejected
            },
            reason: if emitted {
                "Opened on the selected desktop.".to_owned()
            } else {
                "The destination app could not open this workspace route.".to_owned()
            },
        }
    };
    results
        .lock()
        .map_err(lock_error)?
        .insert(request.request_id, (now, result.clone()));
    Ok(result)
}

/// Receives `size` bytes into a staging file beside the destination, then
/// moves it into place. A partial or failed transfer leaves nothing behind.
async fn receive_upload(
    roots: &PeerRootRegistry,
    device_id: &str,
    directory: &str,
    name: &str,
    size: u64,
    receive: &mut TransportRecvStream,
) -> ApiResult<PeerResponse> {
    let upload = crate::infra::peer_writes::prepare_upload(roots, directory, name)?;
    let received = async {
        let mut file = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&upload.staging)
            .await
            .map_err(|error| ApiError::Message(format!("Could not receive the file: {error}")))?;
        let mut remaining = size;
        let mut buffer = vec![0u8; 256 * 1024];
        while remaining > 0 {
            let count = remaining.min(buffer.len() as u64) as usize;
            receive
                .read_exact(&mut buffer[..count])
                .await
                .map_err(|error| {
                    ApiError::Unavailable(format!("The file transfer stopped early: {error}"))
                })?;
            file.write_all(&buffer[..count])
                .await
                .map_err(|error| ApiError::Message(format!("Could not save the file: {error}")))?;
            remaining -= count as u64;
        }
        file.sync_all()
            .await
            .map_err(|error| ApiError::Message(format!("Could not save the file: {error}")))
    }
    .await;
    if let Err(error) = received {
        let _ = tokio::fs::remove_file(&upload.staging).await;
        return Err(error);
    }
    crate::infra::peer_writes::finish_upload(roots, device_id, upload).await
}

/// Entries a writer just produced are, by definition, writable by it.
fn writable_entry(result: ApiResult<PeerResponse>) -> ApiResult<PeerResponse> {
    result.map(|response| match response {
        PeerResponse::Stat { mut entry } => {
            entry.readonly = false;
            PeerResponse::Stat { entry }
        }
        other => other,
    })
}

/// Claims for a connection authorized by a local session instead of a ticket.
/// Reads are part of every session; changes are checked against consent.
fn session_claims(
    source_device_id: &str,
    source_endpoint_id: &str,
    target_device_id: &str,
    target_endpoint_id: &str,
    expires_at: i64,
    writable: bool,
) -> PeerTicketClaims {
    let mut permissions = vec![
        "roots:read".to_owned(),
        "files:read".to_owned(),
        "directories:subscribe".to_owned(),
    ];
    if writable {
        permissions.push("files:write".to_owned());
    }
    PeerTicketClaims {
        iss: "misty-device-session".to_owned(),
        aud: DEVICE_PROTOCOL_VERSION.to_owned(),
        jti: uuid::Uuid::new_v4().to_string(),
        pair_id: String::new(),
        source_device_id: source_device_id.to_owned(),
        source_endpoint_id: source_endpoint_id.to_owned(),
        target_device_id: target_device_id.to_owned(),
        target_endpoint_id: target_endpoint_id.to_owned(),
        protocol_version: DEVICE_PROTOCOL_VERSION.to_owned(),
        permissions,
        iat: unix_now(),
        exp: expires_at,
    }
}

fn connection_closed(connection: &TransportConnection) -> bool {
    #[cfg(target_os = "macos")]
    {
        connection.is_closed()
    }
    #[cfg(not(target_os = "macos"))]
    {
        connection.close_reason().is_some()
    }
}

fn close_connection(connection: &TransportConnection) {
    #[cfg(target_os = "macos")]
    connection.close();
    #[cfg(not(target_os = "macos"))]
    connection.close(0u8.into(), b"session ended");
}

fn same_connection(left: &TransportConnection, right: &TransportConnection) -> bool {
    #[cfg(target_os = "macos")]
    {
        left.id() == right.id()
    }
    #[cfg(not(target_os = "macos"))]
    {
        left.stable_id() == right.stable_id()
    }
}

fn has_permission(claims: &PeerTicketClaims, permission: &str) -> bool {
    claims
        .permissions
        .iter()
        .any(|candidate| candidate == permission)
}

fn peer_protocol_error(error: ApiError) -> PeerError {
    let message = error.to_string();
    let normalized = message.to_ascii_lowercase();
    let code = if normalized.contains("changed") || normalized.contains("snapshot") {
        PeerErrorCode::SourceChanged
    } else if normalized.contains("not found") || normalized.contains("does not exist") {
        PeerErrorCode::NotFound
    } else if normalized.contains("escape")
        || normalized.contains("forbidden")
        || normalized.contains("symlink")
        || normalized.contains("reparse")
        || normalized.contains("root")
    {
        PeerErrorCode::ForbiddenPath
    } else if normalized.contains("range") || normalized.contains("invalid") {
        PeerErrorCode::MalformedRequest
    } else {
        PeerErrorCode::Internal
    };
    PeerError {
        code,
        message,
        retry_after_ms: None,
    }
}

async fn finish_stream(send: &mut TransportSendStream) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return send.finish().await;
    #[cfg(not(target_os = "macos"))]
    send.finish().map_err(|error| error.to_string())
}

async fn write_forbidden(send: &mut TransportSendStream, request_id: &str) -> ApiResult<()> {
    write_response(
        send,
        request_id,
        Err(PeerError {
            code: PeerErrorCode::Revoked,
            message: "The server ticket does not permit this operation.".to_owned(),
            retry_after_ms: None,
        }),
    )
    .await
}

async fn exchange_control(
    connection: &TransportConnection,
    request: PeerRequest,
) -> ApiResult<PeerResponse> {
    exchange_control_with_id(connection, &uuid::Uuid::new_v4().to_string(), request).await
}

async fn exchange_control_with_id(
    connection: &TransportConnection,
    request_id: &str,
    request: PeerRequest,
) -> ApiResult<PeerResponse> {
    let (mut send, mut receive) = connection
        .open_bi()
        .await
        .map_err(|error| ApiError::Unavailable(error.to_string()))?;
    write_request_with_id(&mut send, request_id, request).await?;
    let response: PeerResponseEnvelope = read_frame(&mut receive).await?;
    if response.request_id != request_id {
        return Err(ApiError::Message(
            "Peer response request ID did not match.".to_owned(),
        ));
    }
    response.response.map_err(peer_error)
}

async fn write_request(send: &mut TransportSendStream, request: PeerRequest) -> ApiResult<()> {
    write_request_with_id(send, &uuid::Uuid::new_v4().to_string(), request).await
}

async fn write_request_with_id(
    mut send: &mut TransportSendStream,
    request_id: &str,
    request: PeerRequest,
) -> ApiResult<()> {
    let envelope = PeerRequestEnvelope {
        request_id: request_id.to_owned(),
        request,
    };
    let frame = encode_control_frame(&envelope)?;
    send.write_all(&frame)
        .await
        .map_err(|error| ApiError::Unavailable(error.to_string()))?;
    finish_stream(&mut send)
        .await
        .map_err(|error| ApiError::Unavailable(error.to_string()))?;
    Ok(())
}

async fn write_response(
    mut send: &mut TransportSendStream,
    request_id: &str,
    response: Result<PeerResponse, PeerError>,
) -> ApiResult<()> {
    write_response_open(send, request_id, response).await?;
    finish_stream(&mut send)
        .await
        .map_err(|error| ApiError::Unavailable(error.to_string()))?;
    Ok(())
}

async fn write_response_open(
    send: &mut TransportSendStream,
    request_id: &str,
    response: Result<PeerResponse, PeerError>,
) -> ApiResult<()> {
    let frame = encode_control_frame(&PeerResponseEnvelope {
        request_id: request_id.to_owned(),
        response,
    })?;
    send.write_all(&frame)
        .await
        .map_err(|error| ApiError::Unavailable(error.to_string()))?;
    Ok(())
}

async fn read_frame<T: serde::de::DeserializeOwned>(
    receive: &mut TransportRecvStream,
) -> ApiResult<T> {
    let mut header = [0u8; 4];
    receive
        .read_exact(&mut header)
        .await
        .map_err(|error| ApiError::Unavailable(error.to_string()))?;
    let length = u32::from_be_bytes(header) as usize;
    if length > MAX_CONTROL_FRAME_BYTES {
        return Err(ApiError::Message(
            "Peer control message is too large.".to_owned(),
        ));
    }
    let mut payload = vec![0u8; length];
    receive
        .read_exact(&mut payload)
        .await
        .map_err(|error| ApiError::Unavailable(error.to_string()))?;
    let mut framed = header.to_vec();
    framed.extend_from_slice(&payload);
    decode_control_frame(&framed)
}

pub(crate) fn pinned_ticket_keys(
    development_keys: &HashMap<String, String>,
) -> ApiResult<HashMap<String, VerifyingKey>> {
    let configured = option_env!("MISTY_DEVICE_TICKET_PUBLIC_KEYS")
        .unwrap_or("")
        .trim();
    let values: HashMap<String, String> = if configured.is_empty() {
        if cfg!(debug_assertions) {
            development_keys.clone()
        } else {
            HashMap::new()
        }
    } else {
        serde_json::from_str(configured).map_err(|_| {
            ApiError::Message("Pinned Connected Devices ticket keys are invalid.".to_owned())
        })?
    };
    if values.is_empty() {
        return Err(ApiError::Unavailable(
            "No pinned Connected Devices ticket key is configured.".to_owned(),
        ));
    }
    values
        .into_iter()
        .map(|(id, encoded)| {
            let raw = STANDARD
                .decode(encoded)
                .map_err(|_| ApiError::Message("Pinned ticket key is invalid.".to_owned()))?;
            let bytes: [u8; 32] = raw
                .try_into()
                .map_err(|_| ApiError::Message("Pinned ticket key is invalid.".to_owned()))?;
            let key = VerifyingKey::from_bytes(&bytes)
                .map_err(|_| ApiError::Message("Pinned ticket key is invalid.".to_owned()))?;
            Ok((id, key))
        })
        .collect()
}

fn configured_relay_mode() -> ApiResult<(RelayMode, String)> {
    Ok((RelayMode::Disabled, "lan-only".to_owned()))
}

fn peer_error(error: PeerError) -> ApiError {
    ApiError::Message(error.message)
}
fn lock_error<T>(_: std::sync::PoisonError<T>) -> ApiError {
    ApiError::Unavailable("Connected Devices state is unavailable.".to_owned())
}
fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

#[cfg(test)]
#[path = "connected_devices_route_tests.rs"]
mod workspace_route_tests;
