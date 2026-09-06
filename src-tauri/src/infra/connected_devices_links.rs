//! LAN connections between the account's added devices
//! (docs/design/devices/BRIEF.md). There is no pairing, ticket or session: a
//! device connects to another only when both are in the root-signed device
//! list, and the handshake proves each side's key. Each side enforces its own
//! signed policy; each Join also swaps lists, so removals spread device to
//! device even when the server withholds them.

use std::time::Duration;

use super::*;
use crate::infra::{device_channel, device_trust};

const DIAL_TIMEOUT: Duration = Duration::from_secs(12);

struct Dialed {
    connection: TransportConnection,
    remote_endpoint_id: String,
    local_device_id: String,
    local_endpoint_id: String,
    connections: Arc<RwLock<HashMap<String, AuthorizedConnection>>>,
}

/// What a device's policy lets the other device do over the LAN.
/// Misty no longer shares files with other devices (file management moved to
/// Kura, a separate app), so the signed policy's file setting grants nothing.
pub(super) fn policy_permissions(_files: &str, clipboard: bool) -> Vec<String> {
    let mut permissions = Vec::new();
    if clipboard {
        permissions.extend(["clipboard:send", "clipboard:receive"].map(str::to_owned));
    }
    permissions
}

/// Authorization for one connection, built locally from the device list and
/// policy. It lasts as long as the peer stays trusted.
pub(super) fn device_claims(
    source_device_id: &str,
    source_endpoint_id: &str,
    target_device_id: &str,
    target_endpoint_id: &str,
    permissions: Vec<String>,
) -> PeerTicketClaims {
    PeerTicketClaims {
        iss: "misty-device-list".to_owned(),
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
        exp: i64::MAX,
    }
}

impl ConnectedDevicesService {
    /// Dials an added device at these LAN candidates and joins it. Addresses
    /// are only hints: the handshake must prove the expected key.
    pub async fn connect_device(
        &self,
        device_id: &str,
        endpoint_id: &str,
        candidates: Vec<String>,
    ) -> ApiResult<()> {
        if self.is_connected(device_id) {
            return Ok(());
        }
        if device_trust::trusted_peer(endpoint_id).as_deref() != Some(device_id) {
            return Err(ApiError::Message(
                "That device isn't one of your added devices.".to_owned(),
            ));
        }
        let address = device_channel::dial_address(endpoint_id, &candidates);
        if address["addrs"]
            .as_array()
            .is_none_or(|items| items.is_empty())
        {
            return Err(ApiError::Message(
                "Connect this device to the same local network.".into(),
            ));
        }
        let dialed = tokio::time::timeout(DIAL_TIMEOUT, self.dial(address))
            .await
            .map_err(|_| {
                ApiError::Unavailable("The device didn't answer on this network.".into())
            })??;
        if dialed.remote_endpoint_id != endpoint_id {
            close_connection(&dialed.connection);
            return Err(ApiError::Message(
                "A different device answered at this address.".to_owned(),
            ));
        }
        let list = device_trust::current_list();
        let response = exchange_envelope(
            &dialed.connection,
            PeerRequest::Join {
                list_version: list.as_ref().map(|list| list.version).unwrap_or_default(),
                list: list.map(|list| list.record),
            },
        )
        .await;
        match response {
            Ok(Ok(PeerResponse::Joined {
                list,
                files,
                clipboard,
                ..
            })) => {
                if let Some(list) = list {
                    let _ = device_trust::apply_peer_list(&list);
                }
                // A list the peer just showed may remove this very peer.
                if device_trust::trusted_peer(endpoint_id).as_deref() != Some(device_id) {
                    close_connection(&dialed.connection);
                    return Err(ApiError::Message("That device was removed.".to_owned()));
                }
                device_trust::remember_addresses(device_id, &candidates);
                let claims = device_claims(
                    &dialed.local_device_id,
                    &dialed.local_endpoint_id,
                    device_id,
                    &dialed.remote_endpoint_id,
                    policy_permissions(&files, clipboard),
                );
                self.install(dialed, device_id, claims);
                Ok(())
            }
            Ok(Ok(_)) => {
                close_connection(&dialed.connection);
                Err(ApiError::Message("The device did not join.".to_owned()))
            }
            Ok(Err(error)) => {
                close_connection(&dialed.connection);
                Err(peer_error(error))
            }
            Err(error) => {
                close_connection(&dialed.connection);
                Err(error)
            }
        }
    }

    /// Closes connections to devices that are no longer trusted, after the
    /// device list changed.
    pub fn close_untrusted(&self) {
        let Ok(guard) = self.state.read() else {
            return;
        };
        let Some(state) = guard.as_ref() else {
            return;
        };
        if let Ok(mut connections) = state.connections.write() {
            connections.retain(|device_id, peer| {
                let trusted = device_trust::trusted_peer(&peer.claims.target_endpoint_id)
                    .as_deref()
                    == Some(device_id.as_str());
                if !trusted {
                    close_connection(&peer.connection);
                }
                trusted
            });
        };
    }

    async fn dial(&self, address: serde_json::Value) -> ApiResult<Dialed> {
        let (endpoint, local_device_id, local_endpoint_id, connections) = {
            let guard = self.state.read().map_err(lock_error)?;
            let state = guard.as_ref().ok_or_else(|| {
                ApiError::Unavailable("Connected Devices has not started.".to_owned())
            })?;
            #[cfg(target_os = "macos")]
            if state.endpoint.is_closed() {
                return Err(ApiError::Unavailable(
                    "The Files device service closed.".into(),
                ));
            }
            (
                state.endpoint.clone(),
                self.network_device_id()?,
                state.endpoint.id().to_string(),
                state.connections.clone(),
            )
        };
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
            connections,
        })
    }

    fn install(&self, dialed: Dialed, device_id: &str, claims: PeerTicketClaims) {
        if let Ok(mut connections) = dialed.connections.write() {
            if let Some(previous) = connections.insert(
                device_id.to_owned(),
                AuthorizedConnection {
                    connection: dialed.connection,
                    claims,
                },
            ) {
                close_connection(&previous.connection);
            }
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
            connections
                .get(device_id)
                .is_some_and(|peer| !connection_closed(&peer.connection))
        });
        connected
    }

    /// This device's live outgoing connections, by device id.
    pub fn connected_device_ids(&self) -> Vec<String> {
        let Ok(guard) = self.state.read() else {
            return Vec::new();
        };
        let Some(state) = guard.as_ref() else {
            return Vec::new();
        };
        state
            .connections
            .read()
            .map(|connections| {
                connections
                    .iter()
                    .filter(|(_, peer)| !connection_closed(&peer.connection))
                    .map(|(id, _)| id.clone())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// This device's current LAN candidates, for the control channel.
    pub fn lan_candidates(&self) -> Vec<String> {
        self.snapshot()
            .ok()
            .and_then(|snapshot| snapshot.addressing)
            .map(|addressing| device_channel::lan_candidates(&addressing))
            .unwrap_or_default()
    }
}

/// Like `exchange_control`, but keeps the device's error code.
pub(super) async fn exchange_envelope(
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
