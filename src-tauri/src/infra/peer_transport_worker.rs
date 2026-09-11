//! Transport handles backed by a verified Files service. These handles confer no
//! file authority: the caller must still validate its Space ticket and resources.
use super::{document_intelligence::ServiceLease, native_process_worker::ProcessWorker};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

const CHUNK: usize = 64 * 1024;
#[derive(Serialize)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub(crate) enum Relay {
    Disabled,
    Default,
    Managed { url: String },
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Snapshot {
    pub endpoint_id: String,
    pub address: Value,
}
pub(crate) struct Endpoint {
    worker: Arc<ProcessWorker>,
    id: String,
    address: std::sync::RwLock<Value>,
}
impl Drop for Endpoint {
    fn drop(&mut self) {
        self.worker.close();
    }
}
impl Endpoint {
    pub(crate) async fn initialize_space(
        lease: Arc<ServiceLease>,
        device_id: String,
        relay: Relay,
    ) -> Result<Arc<Self>, String> {
        let authority = lease.clone();
        let secret = tokio::task::spawn_blocking(move || {
            let scope = authority.peer_identity(&device_id)?;
            super::peer_identity::load_for_space(scope).map_err(|error| error.to_string())
        })
        .await
        .map_err(|_| "Peer identity task stopped.")??;
        Self::initialize_with_key(lease, secret, relay, false).await
    }
    #[cfg(test)]
    pub(crate) async fn initialize(
        lease: Arc<ServiceLease>,
        secret: [u8; 32],
        relay: Relay,
    ) -> Result<Arc<Self>, String> {
        Self::initialize_with_key(lease, secret, relay, false).await
    }
    pub(crate) async fn initialize_legacy(
        lease: Arc<ServiceLease>,
        secret: [u8; 32],
        relay: Relay,
    ) -> Result<Arc<Self>, String> {
        Self::initialize_with_key(lease, secret, relay, true).await
    }
    pub(crate) fn address(&self) -> Value {
        self.address
            .read()
            .map(|value| value.clone())
            .unwrap_or(Value::Null)
    }
    async fn initialize_with_key(
        lease: Arc<ServiceLease>,
        secret: [u8; 32],
        relay: Relay,
        legacy: bool,
    ) -> Result<Arc<Self>, String> {
        let worker = Arc::new(ProcessWorker::launch_peer(lease)?);
        let expected = hex::encode(
            ed25519_dalek::SigningKey::from_bytes(&secret)
                .verifying_key()
                .to_bytes(),
        );
        // Keep a closing guard until initialization is accepted, including if this
        // future is dropped while the network bind is pending.
        let endpoint = Arc::new(Self {
            worker,
            id: expected,
            address: std::sync::RwLock::new(Value::Null),
        });
        let snapshot: Snapshot = serde_json::from_value(
            endpoint
                .worker
                .peer_request(
                    json!({"operation":if legacy {"initializeLegacy"} else {"initialize"}, "secret":secret.to_vec(), "relay":relay}),
                )
                .await?,
        )
        .map_err(|_| "Invalid peer endpoint response.")?;
        if snapshot.endpoint_id != endpoint.id {
            return Err("Peer endpoint identity did not match.".into());
        }
        *endpoint
            .address
            .write()
            .map_err(|_| "Peer address unavailable.")? = snapshot.address;
        Ok(endpoint)
    }
    pub(crate) fn id(&self) -> &str {
        &self.id
    }
    pub(crate) async fn snapshot(&self) -> Result<Snapshot, String> {
        let snapshot: Snapshot = serde_json::from_value(
            self.worker
                .peer_request(json!({"operation":"snapshot"}))
                .await?,
        )
        .map_err(|_| "Invalid peer snapshot.")?;
        if snapshot.endpoint_id != self.id {
            return Err("Peer endpoint identity changed.".into());
        }
        *self
            .address
            .write()
            .map_err(|_| "Peer address unavailable.")? = snapshot.address.clone();
        Ok(snapshot)
    }
    pub(crate) async fn connect(
        self: &Arc<Self>,
        address: Value,
        expected_remote: &str,
    ) -> Result<Connection, String> {
        let response = self
            .worker
            .peer_request(json!({"operation":"connect", "address":address}))
            .await?;
        let connection = self.connection(response)?;
        if connection.remote_id() != expected_remote {
            return Err("Peer identity did not match its ticket.".into());
        }
        Ok(connection)
    }
    pub(crate) async fn accept(self: &Arc<Self>) -> Result<Connection, String> {
        self.connection(
            self.worker
                .peer_request(json!({"operation":"accept"}))
                .await?,
        )
    }
    fn connection(self: &Arc<Self>, response: Value) -> Result<Connection, String> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Connected {
            connection: String,
            remote_endpoint: String,
        }
        let connected: Connected =
            serde_json::from_value(response).map_err(|_| "Invalid peer connection response.")?;
        let connection = Connection(Arc::new(ConnectionInner {
            endpoint: self.clone(),
            id: connected.connection,
            remote: connected.remote_endpoint,
            closed: AtomicBool::new(false),
        }));
        if uuid::Uuid::parse_str(&connection.0.id).is_err()
            || connection.0.remote.len() != 64
            || !connection.0.remote.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err("Invalid peer connection identity.".into());
        }
        Ok(connection)
    }
    pub(crate) fn is_closed(&self) -> bool {
        self.worker.is_closed()
    }
    pub(crate) fn close(&self) {
        self.worker.close();
    }
}
struct ConnectionInner {
    endpoint: Arc<Endpoint>,
    id: String,
    remote: String,
    closed: AtomicBool,
}
impl Drop for ConnectionInner {
    fn drop(&mut self) {
        self.endpoint
            .worker
            .release_peer_handle("closeConnection", &self.id);
    }
}
#[derive(Clone)]
pub(crate) struct Connection(Arc<ConnectionInner>);
impl Connection {
    pub(crate) fn remote_id(&self) -> &str {
        &self.0.remote
    }
    pub(crate) fn is_closed(&self) -> bool {
        self.0.closed.load(Ordering::Acquire) || self.0.endpoint.worker.is_closed()
    }
    pub(crate) fn close(&self) {
        self.0.closed.store(true, Ordering::Release);
        self.0
            .endpoint
            .worker
            .release_peer_handle("closeConnection", &self.0.id);
    }
    pub(crate) async fn open_bi(&self) -> Result<(SendStream, RecvStream), String> {
        self.stream("openStream").await
    }
    pub(crate) async fn accept_bi(&self) -> Result<(SendStream, RecvStream), String> {
        self.stream("acceptStream").await
    }
    async fn stream(&self, operation: &str) -> Result<(SendStream, RecvStream), String> {
        if self.is_closed() {
            return Err("Peer connection closed.".into());
        }
        let response = self
            .0
            .endpoint
            .worker
            .peer_request(json!({"operation":operation,"connection":self.0.id}))
            .await?;
        let id = response["stream"]
            .as_str()
            .ok_or("Invalid peer stream response.")?
            .to_owned();
        let stream = Arc::new(Stream {
            connection: self.clone(),
            id,
        });
        if uuid::Uuid::parse_str(&stream.id).is_err() {
            return Err("Invalid peer stream handle.".into());
        }
        Ok((
            SendStream {
                stream: stream.clone(),
                finished: false,
            },
            RecvStream { stream, eof: false },
        ))
    }
}
struct CancelStream<'a>(Option<&'a Stream>);
impl Drop for CancelStream<'_> {
    fn drop(&mut self) {
        if let Some(stream) = self.0 {
            stream
                .connection
                .0
                .endpoint
                .worker
                .release_peer_handle("releaseStream", &stream.id);
        }
    }
}
struct Stream {
    connection: Connection,
    id: String,
}
impl Stream {
    async fn request(&self, mut command: Value) -> Result<Value, String> {
        if self.connection.is_closed() {
            return Err("Peer connection closed.".into());
        }
        command["stream"] = self.id.clone().into();
        let mut cancellation = CancelStream(Some(self));
        let result = self
            .connection
            .0
            .endpoint
            .worker
            .peer_request(command)
            .await?;
        cancellation.0 = None;
        Ok(result)
    }
}
impl Drop for Stream {
    fn drop(&mut self) {
        self.connection
            .0
            .endpoint
            .worker
            .release_peer_handle("releaseStream", &self.id);
    }
}
pub(crate) struct SendStream {
    stream: Arc<Stream>,
    finished: bool,
}
impl SendStream {
    pub(crate) fn is_closed(&self) -> bool { self.stream.connection.is_closed() }
    pub(crate) async fn write_all(&mut self, bytes: &[u8]) -> Result<(), String> {
        if self.finished {
            return Err("Peer send stream is finished.".into());
        }
        for chunk in bytes.chunks(CHUNK) {
            self.stream
                .request(json!({"operation":"write","data":STANDARD.encode(chunk)}))
                .await?;
        }
        Ok(())
    }
    pub(crate) async fn finish(&mut self) -> Result<(), String> {
        if !self.finished {
            self.stream.request(json!({"operation":"finish"})).await?;
            self.finished = true;
        }
        Ok(())
    }
}
pub(crate) struct RecvStream {
    stream: Arc<Stream>,
    eof: bool,
}
impl RecvStream {
    pub(crate) async fn read(&mut self, destination: &mut [u8]) -> Result<usize, String> {
        if destination.is_empty() || self.eof {
            return Ok(0);
        }
        let maximum = destination.len().min(CHUNK);
        let value = self
            .stream
            .request(json!({"operation":"read","maximum":maximum}))
            .await?;
        let encoded = value["data"]
            .as_str()
            .filter(|data| data.len() <= CHUNK.div_ceil(3) * 4)
            .ok_or("Invalid peer chunk.")?;
        let bytes = STANDARD
            .decode(encoded)
            .map_err(|_| "Invalid peer chunk.")?;
        let eof = value["eof"].as_bool().ok_or("Invalid peer EOF response.")?;
        if bytes.len() > maximum || eof != bytes.is_empty() {
            return Err("Invalid peer read length.".into());
        }
        destination[..bytes.len()].copy_from_slice(&bytes);
        self.eof = eof;
        Ok(bytes.len())
    }
    pub(crate) async fn read_exact(&mut self, mut destination: &mut [u8]) -> Result<(), String> {
        while !destination.is_empty() {
            let count = self.read(destination).await?;
            if count == 0 {
                return Err("Peer stream ended before the requested bytes arrived.".into());
            }
            destination = &mut destination[count..];
        }
        Ok(())
    }
}
