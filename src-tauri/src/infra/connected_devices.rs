use std::{
    collections::{HashMap, HashSet},
    io::{Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, RwLock},
    time::{SystemTime, UNIX_EPOCH},
};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use ed25519_dalek::VerifyingKey;
use iroh::{endpoint::presets, Endpoint, EndpointAddr, RelayMode, SecretKey};
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
        WorkspaceRouteSurface, DEVICE_ALPN, MAX_CONTROL_FRAME_BYTES,
    },
    error::{ApiError, ApiResult},
    infra::{peer_files::PeerRootRegistry, peer_identity},
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
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectPeerRequest {
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

#[derive(Clone)]
struct AuthorizedConnection {
    connection: iroh::endpoint::Connection,
    claims: PeerTicketClaims,
}

#[derive(Clone)]
struct ClipboardBlobRecord {
    bytes: Arc<Vec<u8>>,
    expires_at: i64,
}

struct ConnectedDevicesState {
    endpoint: Endpoint,
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
}

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
    ) -> ApiResult<ConnectedDevicesSnapshot> {
        if self.state.read().map_err(lock_error)?.is_some() {
            return self.snapshot();
        }
        let secret = peer_identity::load_or_create(&request.account_id, &request.device_id)?;
        let keys = pinned_ticket_keys(&request.development_ticket_keys)?;
        let (relay_mode, relay_policy) = configured_relay_mode()?;
        let endpoint = Endpoint::builder(presets::N0)
            .secret_key(secret)
            .relay_mode(relay_mode)
            .alpns(vec![DEVICE_ALPN.to_vec()])
            .bind()
            .await
            .map_err(|error| {
                ApiError::Unavailable(format!(
                    "Could not start Connected Devices networking: {error}"
                ))
            })?;
        let state = ConnectedDevicesState {
            endpoint: endpoint.clone(),
            local_device_id: request.device_id,
            keys,
            connections: Arc::new(RwLock::new(HashMap::new())),
            used_ticket_ids: Arc::new(Mutex::new(HashMap::new())),
            roots: PeerRootRegistry::discover(),
            relay_policy,
        };
        let accept_context = PeerAcceptContext {
            endpoint: endpoint.clone(),
            local_device_id: state.local_device_id.clone(),
            keys: state.keys.clone(),
            used_ticket_ids: state.used_ticket_ids.clone(),
            roots: state.roots.clone(),
            clipboard_handler: self.clipboard_handler.clone(),
            clipboard_blobs: self.clipboard_blobs.clone(),
            workspace_route_handler: self.workspace_route_handler.clone(),
            workspace_route_results: self.workspace_route_results.clone(),
        };
        *self.state.write().map_err(lock_error)? = Some(state);
        tokio::spawn(run_accept_loop(accept_context));
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
        let peers = state
            .connections
            .read()
            .map_err(lock_error)?
            .iter()
            .map(|(device_id, connection)| ConnectedPeerStatus {
                device_id: device_id.clone(),
                state: if connection.claims.exp > unix_now() {
                    "online"
                } else {
                    "authorization_expired"
                }
                .to_owned(),
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
            addressing: serde_json::to_value(state.endpoint.addr()).ok(),
            relay_policy: state.relay_policy.clone(),
            peers,
            unavailable_reason: None,
        })
    }

    pub async fn connect(
        &self,
        request: ConnectPeerRequest,
    ) -> ApiResult<ConnectedDevicesSnapshot> {
        let (endpoint, local_endpoint_id, keys, connections) = {
            let guard = self.state.read().map_err(lock_error)?;
            let state = guard.as_ref().ok_or_else(|| {
                ApiError::Unavailable("Connected Devices has not started.".to_owned())
            })?;
            (
                state.endpoint.clone(),
                state.endpoint.id().to_string(),
                state.keys.clone(),
                state.connections.clone(),
            )
        };
        let address: EndpointAddr = serde_json::from_value(request.address)
            .map_err(|error| ApiError::Message(format!("Peer addressing is invalid: {error}")))?;
        let remote_endpoint_id = address.id.to_string();
        let claims = verify_peer_ticket(
            &request.ticket,
            &keys,
            &local_endpoint_id,
            &remote_endpoint_id,
            unix_now(),
            &mut HashMap::new(),
        )?;
        if claims.source_device_id.is_empty() || claims.target_device_id != request.device_id {
            return Err(ApiError::Message(
                "Peer ticket targets a different device.".to_owned(),
            ));
        }
        let connection = endpoint
            .connect(address, DEVICE_ALPN)
            .await
            .map_err(|error| {
                ApiError::Unavailable(format!("Could not connect to peer: {error}"))
            })?;
        let response = exchange_control(
            &connection,
            PeerRequest::Hello {
                ticket: request.ticket,
            },
        )
        .await?;
        let PeerResponse::Authorized { expires_at } = response else {
            return Err(ApiError::Message(
                "Peer did not authorize the connection.".to_owned(),
            ));
        };
        if expires_at != claims.exp {
            return Err(ApiError::Message(
                "Peer authorization did not match the server ticket.".to_owned(),
            ));
        }
        connections.write().map_err(lock_error)?.insert(
            request.device_id,
            AuthorizedConnection { connection, claims },
        );
        self.snapshot()
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
        const CHUNK_BYTES: u64 = 4 * 1024 * 1024;
        while offset < size {
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
            return self.materialize(path).await;
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
                        let materialized = self.materialize(&child.path).await?;
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
        exchange_control(&connection, request).await
    }

    fn authorized_connection(&self, device_id: &str) -> ApiResult<iroh::endpoint::Connection> {
        let guard = self.state.read().map_err(lock_error)?;
        let state = guard.as_ref().ok_or_else(|| {
            ApiError::Unavailable("Connected Devices has not started.".to_owned())
        })?;
        let connections = state.connections.read().map_err(lock_error)?;
        let peer = connections
            .get(device_id)
            .ok_or_else(|| ApiError::Unavailable("The peer is offline.".to_owned()))?;
        if peer.claims.exp <= unix_now() {
            return Err(ApiError::Unavailable(
                "Peer authorization expired; reconnect through Misty's server.".to_owned(),
            ));
        }
        Ok(peer.connection.clone())
    }
}

impl SharedClipboardClient for ConnectedDevicesService {
    fn publish(&self, payload: &ClipboardPayload) -> bool {
        let (source_endpoint_id, local_device_id, roots, peers) = {
            let Ok(guard) = self.state.read() else {
                return false;
            };
            let Some(state) = guard.as_ref() else {
                return false;
            };
            let Ok(connections) = state.connections.read() else {
                return false;
            };
            let peers = connections
                .values()
                .filter(|peer| {
                    peer.claims.exp > unix_now()
                        && peer
                            .claims
                            .permissions
                            .iter()
                            .any(|permission| permission == "clipboard:send")
                })
                .map(|peer| peer.connection.clone())
                .collect::<Vec<_>>();
            (
                state.endpoint.id().to_string(),
                state.local_device_id.clone(),
                state.roots.clone(),
                peers,
            )
        };
        if peers.is_empty() {
            return false;
        }
        let Some(mut kind) = clipboard_payload_to_offer_kind(payload, &local_device_id, &roots)
        else {
            return false;
        };
        if let ClipboardOfferKind::Image { blob_id, png_bytes } = &mut kind {
            if blob_id.is_empty() {
                *blob_id = format!("clipboard_{}", hex::encode(Sha256::digest(&png_bytes)));
            }
            if let Ok(mut blobs) = self.clipboard_blobs.lock() {
                blobs.retain(|_, blob| blob.expires_at > unix_now());
                blobs.insert(
                    blob_id.clone(),
                    ClipboardBlobRecord {
                        bytes: Arc::new(png_bytes.clone()),
                        expires_at: unix_now() + 600,
                    },
                );
            }
        }
        let offer = ClipboardOffer {
            source_endpoint_id,
            revision: payload.revision,
            kind,
        };
        if validate_clipboard_offer(&offer).is_err() {
            return false;
        }
        for connection in peers {
            let offer = offer.clone();
            tauri::async_runtime::spawn(async move {
                let _ =
                    exchange_control(&connection, PeerRequest::ClipboardOffer { payload: offer })
                        .await;
            });
        }
        true
    }

    fn hydrate_payload(&self, _payload: &mut ClipboardPayload) -> bool {
        // Remote file references intentionally stay lazy. Native applications get
        // their readable fallback until Misty explicitly materializes the files.
        true
    }
}

fn clipboard_payload_to_offer_kind(
    payload: &ClipboardPayload,
    local_device_id: &str,
    roots: &PeerRootRegistry,
) -> Option<ClipboardOfferKind> {
    match payload.kind {
        ClipboardPayloadKind::Text => Some(ClipboardOfferKind::Text {
            text: payload.text.clone(),
            html: None,
        }),
        ClipboardPayloadKind::Html => Some(ClipboardOfferKind::Text {
            text: payload.text.clone(),
            html: (!payload.html.is_empty()).then(|| payload.html.clone()),
        }),
        ClipboardPayloadKind::Image => {
            payload
                .images
                .first()
                .map(|image| ClipboardOfferKind::Image {
                    blob_id: image.blob_id.clone(),
                    png_bytes: image.bytes.clone(),
                })
        }
        ClipboardPayloadKind::FileRefs => {
            let files = payload
                .file_refs
                .iter()
                .filter_map(|item| {
                    if item.local_path.is_empty() || !item.provider_type.is_empty() {
                        return None;
                    }
                    let (root_id, relative_path) =
                        roots.reference_for_local_path(Path::new(&item.local_path))?;
                    if relative_path.as_os_str().is_empty() {
                        return None;
                    }
                    let virtual_path = crate::infra::peer_files::PeerVirtualPath::format(
                        local_device_id,
                        &root_id,
                        &relative_path,
                    )
                    .ok()?;
                    let snapshot = roots
                        .stat(local_device_id, &root_id, &relative_path)
                        .ok()?
                        .snapshot;
                    let parsed =
                        crate::infra::peer_files::PeerVirtualPath::parse(&virtual_path).ok()?;
                    Some(PeerFileReference {
                        device_id: local_device_id.to_owned(),
                        root_id,
                        relative_path: parsed.relative_path.to_string_lossy().replace('\\', "/"),
                        is_directory: item.is_dir,
                        snapshot,
                    })
                })
                .take(100)
                .collect::<Vec<_>>();
            if files.is_empty() {
                return None;
            }
            let fallback_text = if payload.text.is_empty() {
                payload
                    .file_refs
                    .iter()
                    .map(|item| item.display_name.as_str())
                    .collect::<Vec<_>>()
                    .join("\n")
            } else {
                payload.text.clone()
            };
            Some(ClipboardOfferKind::FileReferences {
                files,
                fallback_text,
            })
        }
        ClipboardPayloadKind::Empty => None,
    }
}

fn clipboard_offer_to_payload(source_device_id: &str, offer: ClipboardOffer) -> ClipboardPayload {
    let mut payload = ClipboardPayload {
        source_device_id: offer.source_endpoint_id,
        source_device_name: source_device_id.to_owned(),
        revision: offer.revision,
        ..ClipboardPayload::default()
    };
    match offer.kind {
        ClipboardOfferKind::Text { text, html } => {
            payload.text = text;
            payload.html = html.unwrap_or_default();
            payload.kind = if payload.html.is_empty() {
                ClipboardPayloadKind::Text
            } else {
                ClipboardPayloadKind::Html
            };
        }
        ClipboardOfferKind::Image { blob_id, png_bytes } => {
            let checksum = hex::encode(Sha256::digest(&png_bytes));
            payload.kind = ClipboardPayloadKind::Image;
            payload.images.push(ClipboardImage {
                mime_type: "image/png".to_owned(),
                blob_id,
                checksum,
                size_bytes: png_bytes.len() as u64,
                bytes: png_bytes,
                ..ClipboardImage::default()
            });
        }
        ClipboardOfferKind::FileReferences {
            files,
            fallback_text,
        } => {
            payload.kind = ClipboardPayloadKind::FileRefs;
            payload.text = fallback_text;
            payload.file_refs = files
                .into_iter()
                .filter_map(|file| {
                    let relative = PathBuf::from(&file.relative_path);
                    let remote_path = crate::infra::peer_files::PeerVirtualPath::format(
                        &file.device_id,
                        &file.root_id,
                        &relative,
                    )
                    .ok()?;
                    Some(ClipboardFileRef {
                        display_name: relative
                            .file_name()
                            .map(|name| name.to_string_lossy().into_owned())
                            .unwrap_or_else(|| "Remote file".to_owned()),
                        provider_type: "misty_peer".to_owned(),
                        remote_name: source_device_id.to_owned(),
                        remote_path,
                        is_dir: file.is_directory,
                        ..ClipboardFileRef::default()
                    })
                })
                .collect();
        }
    }
    payload
}

#[derive(Clone)]
struct PeerMediaGateway {
    base_url: String,
    grants: Arc<Mutex<HashMap<String, PeerMediaGrant>>>,
}

#[derive(Clone)]
struct PeerMediaState {
    service: ConnectedDevicesService,
    grants: Arc<Mutex<HashMap<String, PeerMediaGrant>>>,
}

#[derive(Clone)]
struct PeerMediaGrant {
    device_id: String,
    path: String,
    snapshot: String,
    size_bytes: u64,
    expires_at: i64,
}

async fn peer_media_handler(
    axum::extract::State(state): axum::extract::State<PeerMediaState>,
    axum::extract::Path(token): axum::extract::Path<String>,
    headers: axum::http::HeaderMap,
) -> axum::response::Response {
    use axum::{
        body::Body,
        http::{header, HeaderValue, Response, StatusCode},
    };
    let grant = state.grants.lock().ok().and_then(|mut grants| {
        grants.retain(|_, grant| grant.expires_at > unix_now());
        grants.get(&token).cloned()
    });
    let Some(grant) = grant else {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::empty())
            .unwrap();
    };
    let range = headers
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok());
    let (start, end, partial) = match parse_http_range(range, grant.size_bytes) {
        Ok(value) => value,
        Err(()) => {
            return Response::builder()
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(
                    header::CONTENT_RANGE,
                    format!("bytes */{}", grant.size_bytes),
                )
                .body(Body::empty())
                .unwrap()
        }
    };
    let content_length = if grant.size_bytes == 0 {
        0
    } else {
        end.saturating_sub(start).saturating_add(1)
    };
    let service = state.service.clone();
    let stream_grant = grant.clone();
    let stream = async_stream::stream! {
        let mut offset = start;
        const CHUNK: u64 = 1024 * 1024;
        while stream_grant.size_bytes > 0 && offset <= end {
            let length = CHUNK.min(end - offset + 1);
            let result = service.read_file(PeerReadRequest {
                device_id: stream_grant.device_id.clone(),
                path: stream_grant.path.clone(),
                offset,
                length: Some(length),
                expected_snapshot: Some(stream_grant.snapshot.clone()),
            }).await;
            match result {
                Ok(bytes) => {
                    offset += bytes.len() as u64;
                    yield Ok::<_, std::io::Error>(axum::body::Bytes::from(bytes));
                }
                Err(error) => {
                    yield Err::<axum::body::Bytes, _>(std::io::Error::other(error.to_string()));
                    break;
                }
            }
        }
    };
    let mut response = Response::builder()
        .status(if partial {
            StatusCode::PARTIAL_CONTENT
        } else {
            StatusCode::OK
        })
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, content_length)
        .header(header::CACHE_CONTROL, "private, no-store")
        .header(header::CONTENT_TYPE, peer_content_type(&grant.path));
    if partial {
        response = response.header(
            header::CONTENT_RANGE,
            format!("bytes {start}-{end}/{}", grant.size_bytes),
        );
    }
    response.body(Body::from_stream(stream)).unwrap()
}

fn parse_http_range(header: Option<&str>, size: u64) -> Result<(u64, u64, bool), ()> {
    if size == 0 {
        return Ok((0, 0, false));
    }
    let Some(value) = header else {
        return Ok((0, size - 1, false));
    };
    let range = value.strip_prefix("bytes=").ok_or(())?;
    if range.contains(',') {
        return Err(());
    }
    let (start, end) = range.split_once('-').ok_or(())?;
    if start.is_empty() {
        let suffix: u64 = end.parse().map_err(|_| ())?;
        if suffix == 0 {
            return Err(());
        }
        let start = size.saturating_sub(suffix.min(size));
        return Ok((start, size - 1, true));
    }
    let start: u64 = start.parse().map_err(|_| ())?;
    if start >= size {
        return Err(());
    }
    let end = if end.is_empty() {
        size - 1
    } else {
        end.parse::<u64>().map_err(|_| ())?.min(size - 1)
    };
    if end < start {
        return Err(());
    }
    Ok((start, end, true))
}

fn peer_content_type(path: &str) -> &'static str {
    match Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "gif" => "image/gif",
        "heic" | "heif" => "image/heic",
        "jpeg" | "jpg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "wav" => "audio/wav",
        "ogg" | "oga" => "audio/ogg",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
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
    local_device_id: String,
    keys: HashMap<String, VerifyingKey>,
    used_ticket_ids: Arc<Mutex<HashMap<String, i64>>>,
    roots: PeerRootRegistry,
    clipboard_handler: Arc<RwLock<Option<Arc<dyn Fn(ClipboardPayload) + Send + Sync>>>>,
    clipboard_blobs: Arc<Mutex<HashMap<String, ClipboardBlobRecord>>>,
    workspace_route_handler:
        Arc<RwLock<Option<Arc<dyn Fn(OpenWorkspaceRouteRequest) -> bool + Send + Sync>>>>,
    workspace_route_results: Arc<Mutex<HashMap<String, (i64, OpenWorkspaceRouteResult)>>>,
}

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

async fn handle_incoming_connection(
    context: PeerAcceptContext,
    connection: iroh::endpoint::Connection,
) -> ApiResult<()> {
    let remote_endpoint = connection.remote_id().to_string();
    let (mut send, mut receive) = connection
        .accept_bi()
        .await
        .map_err(|error| ApiError::Unavailable(error.to_string()))?;
    let hello: PeerRequestEnvelope = read_frame(&mut receive).await?;
    let PeerRequest::Hello { ticket } = hello.request else {
        return Err(ApiError::Message(
            "The first peer request must authorize the connection.".to_owned(),
        ));
    };
    let claims = {
        let mut used = context.used_ticket_ids.lock().map_err(lock_error)?;
        verify_peer_ticket(
            &ticket,
            &context.keys,
            &remote_endpoint,
            &context.endpoint.id().to_string(),
            unix_now(),
            &mut used,
        )?
    };
    if claims.target_device_id != context.local_device_id {
        return Err(ApiError::Message(
            "Peer ticket targets a different device.".to_owned(),
        ));
    }
    write_response(
        &mut send,
        &hello.request_id,
        Ok(PeerResponse::Authorized {
            expires_at: claims.exp,
        }),
    )
    .await?;

    loop {
        if claims.exp <= unix_now() {
            connection.close(1u8.into(), b"authorization expired");
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
            )
            .await;
        });
    }
}

async fn handle_authorized_stream(
    mut send: iroh::endpoint::SendStream,
    mut receive: iroh::endpoint::RecvStream,
    roots: PeerRootRegistry,
    claims: PeerTicketClaims,
    clipboard_handler: Arc<RwLock<Option<Arc<dyn Fn(ClipboardPayload) + Send + Sync>>>>,
    clipboard_blobs: Arc<Mutex<HashMap<String, ClipboardBlobRecord>>>,
    workspace_route_handler: Arc<
        RwLock<Option<Arc<dyn Fn(OpenWorkspaceRouteRequest) -> bool + Send + Sync>>>,
    >,
    workspace_route_results: Arc<Mutex<HashMap<String, (i64, OpenWorkspaceRouteResult)>>>,
) -> ApiResult<()> {
    let envelope: PeerRequestEnvelope = read_frame(&mut receive).await?;
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
    match envelope.request {
        PeerRequest::GetRoots if has_permission(&claims, "roots:read") => {
            write_response(
                &mut send,
                &envelope.request_id,
                Ok(PeerResponse::Roots {
                    roots: roots.roots(),
                }),
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
            let (entries, snapshot) = match result {
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
            write_response(
                &mut send,
                &envelope.request_id,
                Ok(PeerResponse::Directory {
                    path,
                    entries,
                    snapshot,
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
            let entry = match result {
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
            send.finish()
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
            let _ = send.finish();
            Ok(())
        }
        PeerRequest::ClipboardOffer { payload } => {
            if !claims
                .permissions
                .iter()
                .any(|permission| permission == "clipboard:send")
            {
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
            if !has_permission(&claims, "clipboard:receive") {
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
            send.finish()
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
        PeerRequest::Hello { .. } => {
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

async fn write_forbidden(send: &mut iroh::endpoint::SendStream, request_id: &str) -> ApiResult<()> {
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
    connection: &iroh::endpoint::Connection,
    request: PeerRequest,
) -> ApiResult<PeerResponse> {
    exchange_control_with_id(connection, &uuid::Uuid::new_v4().to_string(), request).await
}

async fn exchange_control_with_id(
    connection: &iroh::endpoint::Connection,
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

async fn write_request(
    send: &mut iroh::endpoint::SendStream,
    request: PeerRequest,
) -> ApiResult<()> {
    write_request_with_id(send, &uuid::Uuid::new_v4().to_string(), request).await
}

async fn write_request_with_id(
    send: &mut iroh::endpoint::SendStream,
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
    send.finish()
        .map_err(|error| ApiError::Unavailable(error.to_string()))?;
    Ok(())
}

async fn write_response(
    send: &mut iroh::endpoint::SendStream,
    request_id: &str,
    response: Result<PeerResponse, PeerError>,
) -> ApiResult<()> {
    write_response_open(send, request_id, response).await?;
    send.finish()
        .map_err(|error| ApiError::Unavailable(error.to_string()))?;
    Ok(())
}

async fn write_response_open(
    send: &mut iroh::endpoint::SendStream,
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
    receive: &mut iroh::endpoint::RecvStream,
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

fn pinned_ticket_keys(
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
    let relay_url = option_env!("MISTY_DEVICE_RELAY_URL").unwrap_or("").trim();
    if !relay_url.is_empty() {
        let parsed = relay_url.parse().map_err(|_| {
            ApiError::Message("Managed Connected Devices relay URL is invalid.".to_owned())
        })?;
        return Ok((RelayMode::custom([parsed]), "managed".to_owned()));
    }
    if cfg!(debug_assertions) {
        Ok((RelayMode::Default, "public-development".to_owned()))
    } else {
        Err(ApiError::Unavailable(
            "A managed Connected Devices relay is required in production.".to_owned(),
        ))
    }
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
mod workspace_route_tests {
    use super::*;
    use crate::domain::connected_devices::DEVICE_PROTOCOL_VERSION;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn claims() -> PeerTicketClaims {
        PeerTicketClaims {
            iss: "misty-api".to_owned(),
            aud: DEVICE_PROTOCOL_VERSION.to_owned(),
            jti: "ticket".to_owned(),
            pair_id: "pair".to_owned(),
            source_device_id: "source-device".to_owned(),
            source_endpoint_id: "source-endpoint".to_owned(),
            target_device_id: "target-device".to_owned(),
            target_endpoint_id: "target-endpoint".to_owned(),
            protocol_version: DEVICE_PROTOCOL_VERSION.to_owned(),
            permissions: Vec::new(),
            iat: unix_now() - 1,
            exp: unix_now() + 60,
        }
    }

    fn request(request_id: &str) -> OpenWorkspaceRouteRequest {
        OpenWorkspaceRouteRequest {
            request_id: request_id.to_owned(),
            route: "/terminal".to_owned(),
            surface: WorkspaceRouteSurface::Terminal,
            sent_at: chrono::Utc::now().to_rfc3339(),
            source_device_id: "source-device".to_owned(),
            source_device_name: "Misty iPhone".to_owned(),
        }
    }

    #[test]
    fn workspace_routes_validate_and_are_idempotent() {
        let request_id = uuid::Uuid::new_v4().to_string();
        let calls = Arc::new(AtomicUsize::new(0));
        let handler_calls = calls.clone();
        let handler: Arc<
            RwLock<Option<Arc<dyn Fn(OpenWorkspaceRouteRequest) -> bool + Send + Sync>>>,
        > = Arc::new(RwLock::new(Some(Arc::new(move |_| {
            handler_calls.fetch_add(1, Ordering::SeqCst);
            true
        }))));
        let results = Arc::new(Mutex::new(HashMap::new()));

        let first = handle_workspace_route_request(
            &request_id,
            &claims(),
            request(&request_id),
            &handler,
            &results,
        )
        .expect("first route");
        let duplicate = handle_workspace_route_request(
            &request_id,
            &claims(),
            request(&request_id),
            &handler,
            &results,
        )
        .expect("duplicate route");

        assert_eq!(first.status, OpenWorkspaceRouteStatus::Opened);
        assert_eq!(duplicate, first);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn workspace_routes_reject_mismatches_and_expiry() {
        let handler: Arc<
            RwLock<Option<Arc<dyn Fn(OpenWorkspaceRouteRequest) -> bool + Send + Sync>>>,
        > = Arc::new(RwLock::new(Some(Arc::new(|_| true))));
        let results = Arc::new(Mutex::new(HashMap::new()));
        let mismatch_id = uuid::Uuid::new_v4().to_string();
        let mut mismatch = request(&mismatch_id);
        mismatch.route = "/code".to_owned();
        let rejected =
            handle_workspace_route_request(&mismatch_id, &claims(), mismatch, &handler, &results)
                .expect("rejected route");
        assert_eq!(rejected.status, OpenWorkspaceRouteStatus::Rejected);

        let expired_id = uuid::Uuid::new_v4().to_string();
        let mut expired = request(&expired_id);
        expired.sent_at = (chrono::Utc::now() - chrono::Duration::minutes(5)).to_rfc3339();
        let result =
            handle_workspace_route_request(&expired_id, &claims(), expired, &handler, &results)
                .expect("expired route");
        assert_eq!(result.status, OpenWorkspaceRouteStatus::Expired);
    }
}
