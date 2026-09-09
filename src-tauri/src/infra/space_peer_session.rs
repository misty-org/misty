//! Space ticket authorization around package-owned transport. The package never
//! verifies tickets or decides which local resources a peer may access.
use super::{
    document_intelligence::ServiceLease,
    peer_transport_worker::{Connection, Endpoint, RecvStream, Relay, SendStream},
};
use crate::domain::connected_devices::{
    decode_control_frame, encode_control_frame, verify_space_peer_ticket, PeerRequest,
    PeerRequestEnvelope, PeerResponse, PeerResponseEnvelope, SpacePeerAuthority,
    SpacePeerTicketClaims,
};
use ed25519_dalek::VerifyingKey;
use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
const HANDSHAKE_LIMIT: usize = 20 * 1024;
const REQUEST_LIMIT: usize = 64 * 1024;

pub(crate) struct Session {
    endpoint: Arc<Endpoint>,
    space: String,
    version: String,
    generation: i64,
    device: String,
    keys: HashMap<String, VerifyingKey>,
    used: Mutex<HashMap<String, i64>>,
}
impl Session {
    #[cfg(test)]
    pub(crate) fn fixture(
        endpoint: Arc<Endpoint>,
        device: &str,
        keys: HashMap<String, VerifyingKey>,
    ) -> Self {
        Self {
            endpoint,
            space: "family".into(),
            version: "1".into(),
            generation: 7,
            device: device.into(),
            keys,
            used: Mutex::new(HashMap::new()),
        }
    }
    pub(crate) async fn start(
        lease: Arc<ServiceLease>,
        local_device: String,
        server_device: String,
        keys: HashMap<String, VerifyingKey>,
        relay: Relay,
    ) -> Result<Self, String> {
        let identity = lease.peer_identity(&local_device)?;
        let (space, version, generation) = (
            identity.space_id.to_owned(),
            identity.installed_version.to_owned(),
            identity.authority_generation,
        );
        if server_device.is_empty() || server_device.len() > 128 || keys.is_empty() {
            return Err("Peer device authority is unavailable.".into());
        }
        let endpoint = Endpoint::initialize_space(lease, local_device, relay).await?;
        Ok(Self {
            endpoint,
            space,
            version,
            generation,
            device: server_device,
            keys,
            used: Mutex::new(HashMap::new()),
        })
    }
    pub(crate) async fn snapshot(&self) -> Result<super::peer_transport_worker::Snapshot, String> {
        self.endpoint.snapshot().await
    }
    pub(crate) fn is_closed(&self) -> bool {
        self.endpoint.is_closed()
    }
    pub(crate) fn close(&self) {
        self.endpoint.close();
    }
    fn verify(
        &self,
        ticket: &str,
        source_device: &str,
        target_device: &str,
        source_endpoint: &str,
        target_endpoint: &str,
    ) -> Result<SpacePeerTicketClaims, String> {
        let expected = SpacePeerAuthority {
            space_id: &self.space,
            installed_version: &self.version,
            authority_generation: self.generation,
            source_device_id: source_device,
            target_device_id: target_device,
            source_endpoint_id: source_endpoint,
            target_endpoint_id: target_endpoint,
        };
        let mut used = self
            .used
            .lock()
            .map_err(|_| "Peer replay state unavailable.")?;
        verify_space_peer_ticket(ticket, &self.keys, &expected, now(), &mut used)
            .map_err(|error| error.to_string())
    }
    /// The device and endpoint come from this Space's authenticated peer listing.
    pub(crate) async fn connect(
        &self,
        device: &str,
        endpoint: &str,
        address: Value,
        ticket: &str,
    ) -> Result<AuthorizedPeer, String> {
        let claims = self.verify(ticket, &self.device, device, self.endpoint.id(), endpoint)?;
        let connection = tokio::time::timeout(
            Duration::from_secs(15),
            self.endpoint.connect(address, endpoint),
        )
        .await
        .map_err(|_| "Peer connection timed out.")??;
        let request_id = uuid::Uuid::new_v4().to_string();
        let response: PeerResponseEnvelope = tokio::time::timeout(Duration::from_secs(10), async {
            let (mut send, mut receive) = connection.open_bi().await?;
            write_frame(
                &mut send,
                &PeerRequestEnvelope {
                    request_id: request_id.clone(),
                    request: PeerRequest::Hello {
                        ticket: ticket.into(),
                    },
                },
                true,
            )
            .await?;
            read_frame(&mut receive, HANDSHAKE_LIMIT).await
        })
        .await
        .map_err(|_| "Peer authorization timed out.")??;
        if response.request_id != request_id
            || response.response
                != Ok(PeerResponse::Authorized {
                    expires_at: claims.peer.exp,
                })
        {
            return Err("Peer authorization did not match its ticket.".into());
        }
        AuthorizedPeer::new(connection, claims)
    }
    /// Resolve the authenticated network endpoint against the current Space peer
    /// listing before accepting its ticket. A device-global listing is insufficient.
    pub(crate) async fn accept(
        &self,
        peers: &HashMap<String, String>,
    ) -> Result<AuthorizedPeer, String> {
        self.accept_resolving(|endpoint| peers.get(endpoint).cloned())
            .await
    }
    pub(crate) async fn accept_current(
        &self,
        peers: &std::sync::RwLock<HashMap<String, String>>,
    ) -> Result<AuthorizedPeer, String> {
        self.accept_resolving(|endpoint| peers.read().ok()?.get(endpoint).cloned())
            .await
    }
    async fn accept_resolving(
        &self,
        resolve: impl Fn(&str) -> Option<String>,
    ) -> Result<AuthorizedPeer, String> {
        let connection = self.endpoint.accept().await?;
        let remote = connection.remote_id();
        let device = resolve(remote).ok_or("Peer is unavailable in this Space.")?;
        let (mut send, receive, hello) = tokio::time::timeout(Duration::from_secs(10), async {
            let (send, mut receive) = connection.accept_bi().await?;
            let hello: PeerRequestEnvelope = read_frame(&mut receive, HANDSHAKE_LIMIT).await?;
            Ok::<_, String>((send, receive, hello))
        })
        .await
        .map_err(|_| "Peer authorization timed out.")??;
        let PeerRequest::Hello { ticket } = hello.request else {
            return Err("Peer must authorize before making requests.".into());
        };
        let claims = self.verify(&ticket, &device, &self.device, remote, self.endpoint.id())?;
        write_frame(
            &mut send,
            &PeerResponseEnvelope {
                request_id: hello.request_id,
                response: Ok(PeerResponse::Authorized {
                    expires_at: claims.peer.exp,
                }),
            },
            true,
        )
        .await?;
        drop(receive);
        AuthorizedPeer::new(connection, claims)
    }
}
impl Drop for Session {
    fn drop(&mut self) {
        self.endpoint.close();
    }
}

pub(crate) struct AuthorizedPeer {
    connection: Connection,
    claims: SpacePeerTicketClaims,
    expiry: tokio::task::JoinHandle<()>,
}
impl Drop for AuthorizedPeer {
    fn drop(&mut self) {
        self.expiry.abort();
        self.connection.close();
    }
}
impl AuthorizedPeer {
    fn new(connection: Connection, claims: SpacePeerTicketClaims) -> Result<Self, String> {
        let remaining = claims.peer.exp.saturating_sub(now());
        if remaining <= 0 {
            return Err("Peer authorization expired.".into());
        }
        let expiring = connection.clone();
        let expiry = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(remaining as u64)).await;
            expiring.close();
        });
        Ok(Self {
            connection,
            claims,
            expiry,
        })
    }
    pub(crate) fn close(&self) {
        self.connection.close();
    }
    pub(crate) fn expires_at(&self) -> i64 {
        self.claims.peer.exp
    }
    pub(crate) fn incoming_identity(&self) -> (&str, &str) {
        (
            self.connection.remote_id(),
            &self.claims.peer.source_device_id,
        )
    }
    pub(crate) fn check(&self) -> Result<(), String> {
        if self.claims.peer.exp <= now() || self.connection.is_closed() {
            return Err("Peer authorization expired or was revoked.".into());
        }
        Ok(())
    }
    fn authorize(&self, request: &PeerRequest) -> Result<(), String> {
        self.check()?;
        if self.claims.peer.exp <= now() {
            return Err("Peer authorization expired.".into());
        }
        let required = match request {
            PeerRequest::GetRoots => "roots:read",
            PeerRequest::ListDirectory { .. }
            | PeerRequest::Stat { .. }
            | PeerRequest::ReadLink { .. }
            | PeerRequest::ReadFile { .. } => "files:read",
            PeerRequest::SubscribeDirectory { .. } => "directories:subscribe",
            PeerRequest::Ping { .. } => return Ok(()),
            _ => return Err("This request is not authorized by Files.".into()),
        };
        if !self
            .claims
            .peer
            .permissions
            .iter()
            .any(|value| value == required)
        {
            return Err("Peer ticket does not grant this operation.".into());
        }
        Ok(())
    }
    pub(crate) async fn request(
        &self,
        request: PeerRequest,
    ) -> Result<(String, SendStream, RecvStream), String> {
        self.authorize(&request)?;
        let (mut send, receive) = self.connection.open_bi().await?;
        let id = uuid::Uuid::new_v4().to_string();
        write_frame(
            &mut send,
            &PeerRequestEnvelope {
                request_id: id.clone(),
                request,
            },
            true,
        )
        .await?;
        Ok((id, send, receive))
    }
    pub(crate) async fn accept_request(
        &self,
    ) -> Result<(PeerRequestEnvelope, SendStream, RecvStream), String> {
        if self.claims.peer.exp <= now() {
            return Err("Peer authorization expired.".into());
        }
        self.check()?;
        let (send, mut receive) = self.connection.accept_bi().await?;
        let request: PeerRequestEnvelope = read_frame(&mut receive, REQUEST_LIMIT).await?;
        self.authorize(&request.request)?;
        Ok((request, send, receive))
    }
}
pub(crate) async fn read_frame<T: DeserializeOwned>(
    receive: &mut RecvStream,
    limit: usize,
) -> Result<T, String> {
    let mut header = [0; 4];
    receive.read_exact(&mut header).await?;
    let length = u32::from_be_bytes(header) as usize;
    if length > limit {
        return Err("Peer control message exceeds its limit.".into());
    }
    let mut bytes = vec![0; length + 4];
    bytes[..4].copy_from_slice(&header);
    receive.read_exact(&mut bytes[4..]).await?;
    decode_control_frame(&bytes).map_err(|error| error.to_string())
}
pub(crate) async fn write_frame<T: Serialize>(
    send: &mut SendStream,
    value: &T,
    finish: bool,
) -> Result<(), String> {
    send.write_all(&encode_control_frame(value).map_err(|error| error.to_string())?)
        .await?;
    if finish {
        send.finish().await?;
    }
    Ok(())
}
fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
