//! Explicit connects, local sessions and reconnects (see `device_sessions`).
//!
//! An explicit connect is the only step that needs Misty's server: its ticket
//! proves both devices belong to one account and are paired. From then on the
//! devices reconnect on their own with their session tokens, until the session
//! ends or expires.

use std::time::Duration;

use super::*;
use crate::infra::device_sessions::ResumableSession;

/// How often sessions without a live connection try to reconnect.
const RESUME_INTERVAL: Duration = Duration::from_secs(15);
const DIAL_TIMEOUT: Duration = Duration::from_secs(12);

/// One paired device and this device's consent toward it, from the account.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairConsent {
    pub device_id: String,
    #[serde(default)]
    pub accepts_writes: bool,
    #[serde(default)]
    pub shares_clipboard: bool,
}

struct Dialed {
    connection: TransportConnection,
    remote_endpoint_id: String,
    local_device_id: String,
    local_endpoint_id: String,
    own_address: Option<serde_json::Value>,
    keys: HashMap<String, VerifyingKey>,
    connections: Arc<RwLock<HashMap<String, AuthorizedConnection>>>,
}

impl ConnectedDevicesService {
    /// How many days a session started from now lasts.
    pub fn configure_sessions(&self, session_days: u32) -> ApiResult<()> {
        self.local.sessions.set_session_days(session_days)
    }

    /// The paired devices and this device's consent toward each, from the
    /// account. It is kept locally so it holds while the server is unreachable.
    /// Devices that are no longer paired lose their sessions and connections.
    pub fn sync_pairs(&self, pairs: Vec<PairConsent>) -> ApiResult<()> {
        let paired: Vec<String> = pairs.iter().map(|pair| pair.device_id.clone()).collect();
        let consent = pairs
            .into_iter()
            .map(|pair| {
                let consent = PeerConsent {
                    accepts_writes: pair.accepts_writes,
                    shares_clipboard: pair.shares_clipboard,
                };
                (pair.device_id, consent)
            })
            .collect();
        self.local.sessions.set_consent(consent)?;
        self.local.sessions.retain(&paired)?;
        self.close_connections_except(&paired);
        Ok(())
    }

    /// An explicit connect. One server ticket authorizes it, and it starts a
    /// local session in both directions.
    pub async fn connect(
        &self,
        request: ConnectPeerRequest,
    ) -> ApiResult<ConnectedDevicesSnapshot> {
        #[cfg(target_os = "macos")]
        let instance = Some(request.instance.as_str());
        #[cfg(not(target_os = "macos"))]
        let instance: Option<&str> = None;
        let dialed = self.dial(request.address.clone(), instance).await?;
        let verified = verify_peer_ticket(
            &request.ticket,
            &dialed.keys,
            &dialed.local_endpoint_id,
            &dialed.remote_endpoint_id,
            unix_now(),
            &mut HashMap::new(),
        );
        let claims = match verified {
            Ok(claims) if claims.target_device_id == request.device_id => claims,
            Ok(_) => {
                close_connection(&dialed.connection);
                return Err(ApiError::Message(
                    "Peer ticket targets a different device.".to_owned(),
                ));
            }
            Err(error) => {
                close_connection(&dialed.connection);
                return Err(error);
            }
        };
        let sessions = &self.local.sessions;
        let expires_at = sessions.expiry_from(unix_now());
        let token =
            sessions.issue_incoming(&request.device_id, &dialed.remote_endpoint_id, expires_at)?;
        let response = exchange_envelope(
            &dialed.connection,
            PeerRequest::Connect {
                ticket: request.ticket,
                session: SessionOffer { token, expires_at },
                address: dialed.own_address.clone(),
            },
        )
        .await;
        let (granted, writable) = match response {
            Ok(Ok(PeerResponse::Connected {
                expires_at: granted,
                session: Some(offer),
                writable,
            })) => {
                let granted = granted.min(offer.expires_at);
                sessions.store_outgoing(
                    &request.device_id,
                    &dialed.remote_endpoint_id,
                    offer.token,
                    granted,
                    Some(request.address),
                )?;
                (granted, writable)
            }
            Ok(Ok(_)) => {
                close_connection(&dialed.connection);
                return Err(ApiError::Message(
                    "The device did not start a session.".to_owned(),
                ));
            }
            Ok(Err(error)) => {
                close_connection(&dialed.connection);
                return Err(peer_error(error));
            }
            Err(error) => {
                close_connection(&dialed.connection);
                return Err(error);
            }
        };
        let claims = session_claims(
            &claims.source_device_id,
            &dialed.local_endpoint_id,
            &request.device_id,
            &dialed.remote_endpoint_id,
            granted,
            writable,
        );
        self.install(dialed, &request.device_id, claims);
        self.snapshot()
    }

    /// Reconnects every unexpired session without a live connection. Fresher
    /// `addresses` from the server replace cached ones; none are needed.
    pub async fn resume_sessions(
        &self,
        addresses: HashMap<String, serde_json::Value>,
    ) -> ApiResult<ConnectedDevicesSnapshot> {
        let pending: Vec<ResumableSession> = self
            .local
            .sessions
            .resumable(unix_now(), &addresses)
            .into_iter()
            .filter(|session| !self.is_connected(&session.device_id))
            .collect();
        let mut attempts = tokio::task::JoinSet::new();
        for session in pending {
            let service = self.clone();
            attempts.spawn(async move {
                let _ = tokio::time::timeout(DIAL_TIMEOUT, service.resume_one(session)).await;
            });
        }
        while attempts.join_next().await.is_some() {}
        self.snapshot()
    }

    /// Ends the session with one device on both sides. The pair stays; it
    /// reconnects only after an explicit connect.
    pub async fn end_session(&self, device_id: &str) -> ApiResult<ConnectedDevicesSnapshot> {
        if let Ok(connection) = self.authorized_connection(device_id) {
            let _ = tokio::time::timeout(
                Duration::from_secs(5),
                exchange_control(&connection, PeerRequest::EndSession),
            )
            .await;
            self.drop_connection(device_id, &connection);
        }
        // If the other device is unreachable now, its next reconnect is refused
        // here and it ends its side then.
        self.local.sessions.end(device_id)?;
        self.snapshot()
    }

    pub(super) fn start_session_resumer(&self) {
        let generation = self.resume_generation.fetch_add(1, Ordering::SeqCst) + 1;
        let service = self.clone();
        tokio::spawn(async move {
            loop {
                if service.resume_generation.load(Ordering::SeqCst) != generation {
                    break;
                }
                let started = service
                    .state
                    .read()
                    .map(|state| state.is_some())
                    .unwrap_or(false);
                if !started {
                    break;
                }
                let _ = service.resume_sessions(HashMap::new()).await;
                tokio::time::sleep(RESUME_INTERVAL).await;
            }
        });
    }

    async fn resume_one(&self, session: ResumableSession) -> ApiResult<()> {
        let dialed = self.dial(session.address.clone(), None).await?;
        if dialed.remote_endpoint_id != session.endpoint_id {
            close_connection(&dialed.connection);
            return Err(ApiError::Message(
                "A different device answered at this address.".to_owned(),
            ));
        }
        let response = exchange_envelope(
            &dialed.connection,
            PeerRequest::Resume {
                device_id: dialed.local_device_id.clone(),
                token: session.token,
                address: dialed.own_address.clone(),
            },
        )
        .await;
        match response {
            Ok(Ok(PeerResponse::Connected {
                expires_at,
                writable,
                ..
            })) => {
                let claims = session_claims(
                    &dialed.local_device_id,
                    &dialed.local_endpoint_id,
                    &session.device_id,
                    &dialed.remote_endpoint_id,
                    expires_at.min(session.expires_at),
                    writable,
                );
                self.install(dialed, &session.device_id, claims);
                Ok(())
            }
            Ok(Err(error)) => {
                close_connection(&dialed.connection);
                // The other device ended the session; only an explicit connect
                // starts a new one.
                if matches!(error.code, PeerErrorCode::Revoked) {
                    let _ = self.local.sessions.end(&session.device_id);
                }
                Err(peer_error(error))
            }
            Ok(Ok(_)) => {
                close_connection(&dialed.connection);
                Err(ApiError::Message(
                    "The device did not resume the session.".to_owned(),
                ))
            }
            Err(error) => {
                close_connection(&dialed.connection);
                Err(error)
            }
        }
    }

    async fn dial(&self, address: serde_json::Value, instance: Option<&str>) -> ApiResult<Dialed> {
        let (endpoint, local_device_id, local_endpoint_id, keys, connections) = {
            let guard = self.state.read().map_err(lock_error)?;
            let state = guard.as_ref().ok_or_else(|| {
                ApiError::Unavailable("Connected Devices has not started.".to_owned())
            })?;
            #[cfg(target_os = "macos")]
            if instance.is_some_and(|instance| instance != state.instance)
                || state.endpoint.is_closed()
            {
                return Err(ApiError::Unavailable(
                    "The originating Files device session closed.".into(),
                ));
            }
            #[cfg(not(target_os = "macos"))]
            let _ = instance;
            (
                state.endpoint.clone(),
                self.network_device_id()?,
                state.endpoint.id().to_string(),
                state.keys.clone(),
                state.connections.clone(),
            )
        };
        #[cfg(not(target_os = "macos"))]
        let own_address = serde_json::to_value(endpoint.addr()).ok();
        #[cfg(target_os = "macos")]
        let own_address = Some(endpoint.address());
        #[cfg(not(target_os = "macos"))]
        let (connection, remote_endpoint_id) = {
            let mut address: EndpointAddr = serde_json::from_value(address).map_err(|error| {
                ApiError::Message(format!("Peer addressing is invalid: {error}"))
            })?;
            let remote_endpoint_id = address.id.to_string();
            address.addrs.retain(|address| matches!(address, iroh::TransportAddr::Ip(socket) if crate::domain::lan::is_lan_address(socket.ip())));
            if address.addrs.is_empty() {
                return Err(ApiError::Message(
                    "Connect this device to the same local network.".into(),
                ));
            }
            let connection = endpoint
                .connect(address, DEVICE_ALPN)
                .await
                .map_err(|error| {
                    ApiError::Unavailable(format!("Could not connect to the device: {error}"))
                })?;
            (connection, remote_endpoint_id)
        };
        #[cfg(target_os = "macos")]
        let (connection, remote_endpoint_id) = {
            let remote_endpoint_id = address
                .get("id")
                .and_then(serde_json::Value::as_str)
                .filter(|value| {
                    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
                })
                .ok_or_else(|| ApiError::Message("Invalid peer endpoint identity.".into()))?
                .to_owned();
            let connection = endpoint
                .connect(address, &remote_endpoint_id)
                .await
                .map_err(ApiError::Unavailable)?;
            (connection, remote_endpoint_id)
        };
        Ok(Dialed {
            connection,
            remote_endpoint_id,
            local_device_id,
            local_endpoint_id,
            own_address,
            keys,
            connections,
        })
    }

    fn install(&self, dialed: Dialed, device_id: &str, claims: PeerTicketClaims) {
        if let Ok(mut connections) = dialed.connections.write() {
            connections.insert(
                device_id.to_owned(),
                AuthorizedConnection {
                    connection: dialed.connection,
                    claims,
                },
            );
        }
    }

    pub(super) fn is_connected(&self, device_id: &str) -> bool {
        let Ok(guard) = self.state.read() else {
            return false;
        };
        let Some(state) = guard.as_ref() else {
            return false;
        };
        let connected = state.connections.read().is_ok_and(|connections| {
            connections.get(device_id).is_some_and(|peer| {
                peer.claims.exp > unix_now() && !connection_closed(&peer.connection)
            })
        });
        connected
    }

    fn close_connections_except(&self, keep: &[String]) {
        let Ok(guard) = self.state.read() else {
            return;
        };
        let Some(state) = guard.as_ref() else {
            return;
        };
        if let Ok(mut connections) = state.connections.write() {
            connections.retain(|device_id, peer| {
                let paired = keep.contains(device_id);
                if !paired {
                    close_connection(&peer.connection);
                }
                paired
            });
        };
    }
}

/// Like `exchange_control`, but keeps the device's error code.
async fn exchange_envelope(
    connection: &TransportConnection,
    request: PeerRequest,
) -> ApiResult<Result<PeerResponse, PeerError>> {
    let request_id = uuid::Uuid::new_v4().to_string();
    let (mut send, mut receive) = connection
        .open_bi()
        .await
        .map_err(|error| ApiError::Unavailable(error.to_string()))?;
    write_request_with_id(&mut send, &request_id, request).await?;
    let response: PeerResponseEnvelope = read_frame(&mut receive).await?;
    if response.request_id != request_id {
        return Err(ApiError::Message(
            "Peer response request ID did not match.".to_owned(),
        ));
    }
    Ok(response.response)
}
