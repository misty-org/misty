//! Private transport for the supervising host. Peer tickets and resource access
//! remain host decisions; establishing a QUIC connection grants neither.
use base64::{engine::general_purpose::STANDARD, Engine};
use iroh::{
    endpoint::{presets, Connection, RecvStream, SendStream},
    Endpoint, EndpointAddr, RelayMode, SecretKey,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tokio::sync::{watch, Mutex, OnceCell, OwnedSemaphorePermit, Semaphore};

pub const ALPN: &[u8] = b"misty-device/2";
pub const MAX_CHUNK: usize = 64 * 1024;
const MAX_CONNECTIONS: usize = 32;
const MAX_STREAMS: usize = 128;
#[derive(Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase", deny_unknown_fields)]
pub enum Relay {
    Disabled,
    Default,
    Managed { url: String },
}
#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
pub enum Command {
    Initialize { secret: [u8; 32], relay: Relay },
    InitializeLegacy { secret: [u8; 32], relay: Relay },
    Snapshot,
    Connect { address: EndpointAddr },
    Accept,
    OpenStream { connection: String },
    AcceptStream { connection: String },
    Read { stream: String, maximum: usize },
    Write { stream: String, data: String },
    Finish { stream: String },
    ReleaseStream { stream: String },
    CloseConnection { connection: String },
}
struct Peer {
    connection: Connection,
    _permit: OwnedSemaphorePermit,
}
struct Stream {
    connection: String,
    send: Mutex<SendStream>,
    receive: Mutex<RecvStream>,
    _permit: OwnedSemaphorePermit,
    released: watch::Sender<bool>,
}
impl Stream {
    fn release(&self) {
        self.released.send_replace(true);
    }
    async fn access<T>(
        &self,
        operation: impl std::future::Future<Output = Result<T, String>>,
    ) -> Result<T, String> {
        let mut released = self.released.subscribe();
        if *released.borrow() {
            return Err("Peer stream is closed.".into());
        }
        tokio::select! { biased;
            _=released.changed()=>Err("Peer stream is closed.".into()),
            result=operation=> { if *released.borrow() {Err("Peer stream is closed.".into())} else {result} }
        }
    }
}
pub struct Transport {
    endpoint: OnceCell<Endpoint>,
    alpn: OnceCell<&'static [u8]>,
    initialize: Mutex<()>,
    closed: AtomicBool,
    peers: Mutex<HashMap<String, Arc<Peer>>>,
    streams: Mutex<HashMap<String, Arc<Stream>>>,
    peer_slots: Arc<Semaphore>,
    stream_slots: Arc<Semaphore>,
}
impl Default for Transport {
    fn default() -> Self {
        Self {
            endpoint: OnceCell::new(),
            alpn: OnceCell::new(),
            initialize: Mutex::new(()),
            closed: AtomicBool::new(false),
            peers: Mutex::new(HashMap::new()),
            streams: Mutex::new(HashMap::new()),
            peer_slots: Arc::new(Semaphore::new(MAX_CONNECTIONS)),
            stream_slots: Arc::new(Semaphore::new(MAX_STREAMS)),
        }
    }
}
impl Transport {
    fn endpoint(&self) -> Result<&Endpoint, String> {
        self.endpoint
            .get()
            .ok_or("Peer transport is not initialized.".into())
    }
    async fn peer(&self, id: &str) -> Result<Arc<Peer>, String> {
        self.peers
            .lock()
            .await
            .get(id)
            .cloned()
            .ok_or("Peer connection is closed.".into())
    }
    async fn stream(&self, id: &str) -> Result<Arc<Stream>, String> {
        self.streams
            .lock()
            .await
            .get(id)
            .cloned()
            .ok_or("Peer stream is closed.".into())
    }
    async fn retain_peer(
        &self,
        connection: Connection,
        permit: OwnedSemaphorePermit,
    ) -> Result<Value, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let remote = connection.remote_id().to_string();
        let mut peers = self.peers.lock().await;
        if self.closed.load(Ordering::Acquire) {
            connection.close(0u8.into(), b"host closed");
            return Err("Peer transport is closed.".into());
        }
        peers.insert(
            id.clone(),
            Arc::new(Peer {
                connection,
                _permit: permit,
            }),
        );
        Ok(json!({"connection":id,"remoteEndpoint":remote}))
    }
    async fn retain_stream(
        &self,
        connection: String,
        pair: (SendStream, RecvStream),
        permit: OwnedSemaphorePermit,
    ) -> Value {
        let id = uuid::Uuid::new_v4().to_string();
        self.streams.lock().await.insert(
            id.clone(),
            Arc::new(Stream {
                connection,
                send: Mutex::new(pair.0),
                receive: Mutex::new(pair.1),
                _permit: permit,
                released: watch::channel(false).0,
            }),
        );
        json!({"stream":id})
    }
    async fn initialize(
        &self,
        secret: [u8; 32],
        relay: Relay,
        alpn: &'static [u8],
    ) -> Result<Value, String> {
        let _initializing = self.initialize.lock().await;
        if self.endpoint.get().is_some() {
            return Err("Peer transport is already initialized.".into());
        }
        let relay = match relay {
            Relay::Disabled => RelayMode::Disabled,
            Relay::Default => RelayMode::Default,
            Relay::Managed { url } => {
                if url.len() > 4096 {
                    return Err("Invalid relay URL.".into());
                }
                RelayMode::custom([url.parse().map_err(|_| "Invalid relay URL.")?])
            }
        };
        self.alpn
            .set(alpn)
            .map_err(|_| "Peer protocol is already selected.")?;
        self.endpoint
            .get_or_try_init(|| async {
                Endpoint::builder(presets::N0)
                    .secret_key(SecretKey::from_bytes(&secret))
                    .relay_mode(relay)
                    .alpns(vec![alpn.to_vec()])
                    .bind()
                    .await
                    .map_err(|e| e.to_string())
            })
            .await?;
        if self.closed.load(Ordering::Acquire) {
            self.endpoint()?.close().await;
            return Err("Peer transport is closed.".into());
        }
        self.snapshot()
    }
    pub async fn execute(&self, command: Command) -> Result<Value, String> {
        if self.closed.load(Ordering::Acquire) {
            return Err("Peer transport is closed.".into());
        }
        match command {
            Command::Initialize { secret, relay } => self.initialize(secret, relay, ALPN).await,
            Command::InitializeLegacy { secret, relay } => {
                self.initialize(secret, relay, b"misty-device/1").await
            }
            Command::Snapshot => self.snapshot(),
            Command::Connect { address } => {
                let permit = self
                    .peer_slots
                    .clone()
                    .try_acquire_owned()
                    .map_err(|_| "Too many peer connections.")?;
                let connection = self
                    .endpoint()?
                    .connect(
                        address,
                        self.alpn
                            .get()
                            .copied()
                            .ok_or("Peer protocol is unavailable.")?,
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                self.retain_peer(connection, permit).await
            }
            Command::Accept => {
                let permit = self
                    .peer_slots
                    .clone()
                    .try_acquire_owned()
                    .map_err(|_| "Too many peer connections.")?;
                let incoming = self
                    .endpoint()?
                    .accept()
                    .await
                    .ok_or("Peer endpoint closed.")?;
                let connection = incoming.await.map_err(|e| e.to_string())?;
                self.retain_peer(connection, permit).await
            }
            Command::OpenStream { connection } => self.open_stream(connection, false).await,
            Command::AcceptStream { connection } => self.open_stream(connection, true).await,
            Command::Read { stream, maximum } => {
                if maximum == 0 || maximum > MAX_CHUNK {
                    return Err("Invalid peer read size.".into());
                }
                let stream = self.stream(&stream).await?;
                stream
                    .access(async {
                        let mut receive = stream.receive.lock().await;
                        let mut bytes = vec![0; maximum];
                        let count = tokio::io::AsyncReadExt::read(&mut *receive, &mut bytes)
                            .await
                            .map_err(|e| e.to_string())?;
                        bytes.truncate(count);
                        Ok(json!({"data":STANDARD.encode(bytes),"eof":count==0}))
                    })
                    .await
            }
            Command::Write { stream, data } => {
                if data.len() > MAX_CHUNK.div_ceil(3) * 4 {
                    return Err("Peer chunk exceeds its limit.".into());
                }
                let bytes = STANDARD.decode(data).map_err(|_| "Invalid peer chunk.")?;
                if bytes.len() > MAX_CHUNK {
                    return Err("Peer chunk exceeds its limit.".into());
                }
                let stream = self.stream(&stream).await?;
                stream
                    .access(async {
                        stream
                            .send
                            .lock()
                            .await
                            .write_all(&bytes)
                            .await
                            .map_err(|e| e.to_string())?;
                        Ok(Value::Null)
                    })
                    .await
            }
            Command::Finish { stream } => {
                let stream = self.stream(&stream).await?;
                stream
                    .access(async {
                        stream
                            .send
                            .lock()
                            .await
                            .finish()
                            .map_err(|e| e.to_string())?;
                        Ok(Value::Null)
                    })
                    .await
            }
            Command::ReleaseStream { stream } => {
                if let Some(stream) = self.streams.lock().await.remove(&stream) {
                    stream.release();
                }
                Ok(Value::Null)
            }
            Command::CloseConnection { connection } => {
                if let Some(peer) = self.peers.lock().await.remove(&connection) {
                    peer.connection.close(0u8.into(), b"host closed");
                }
                self.streams.lock().await.retain(|_, stream| {
                    if stream.connection == connection {
                        stream.release();
                        false
                    } else {
                        true
                    }
                });
                Ok(Value::Null)
            }
        }
    }
    async fn open_stream(&self, connection: String, accept: bool) -> Result<Value, String> {
        let permit = self
            .stream_slots
            .clone()
            .try_acquire_owned()
            .map_err(|_| "Too many peer streams.")?;
        let peer = self.peer(&connection).await?;
        let pair = if accept {
            peer.connection.accept_bi().await
        } else {
            peer.connection.open_bi().await
        }
        .map_err(|e| e.to_string())?;
        let peers = self.peers.lock().await;
        if self.closed.load(Ordering::Acquire)
            || !peers
                .get(&connection)
                .is_some_and(|current| Arc::ptr_eq(current, &peer))
        {
            return Err("Peer connection is closed.".into());
        }
        Ok(self.retain_stream(connection, pair, permit).await)
    }
    fn snapshot(&self) -> Result<Value, String> {
        let endpoint = self.endpoint()?;
        Ok(json!({"endpointId":endpoint.id().to_string(),"address":endpoint.addr()}))
    }
    pub async fn shutdown(&self) {
        self.closed.store(true, Ordering::Release);
        if let Some(endpoint) = self.endpoint.get() {
            endpoint.close().await;
        }
        for (_, stream) in self.streams.lock().await.drain() {
            stream.release();
        }
        self.peers.lock().await.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Ipv4Addr, SocketAddr};
    use tokio::time::{timeout, Duration};
    async fn local(secret: u8) -> Arc<Transport> {
        local_protocol(secret, false).await
    }
    async fn local_protocol(secret: u8, legacy: bool) -> Arc<Transport> {
        let transport = Arc::new(Transport::default());
        transport
            .execute(if legacy {
                Command::InitializeLegacy {
                    secret: [secret; 32],
                    relay: Relay::Disabled,
                }
            } else {
                Command::Initialize {
                    secret: [secret; 32],
                    relay: Relay::Disabled,
                }
            })
            .await
            .unwrap();
        transport
    }
    async fn pair(legacy: bool) -> (Arc<Transport>, String, Arc<Transport>, String) {
        let left = local_protocol(1, legacy).await;
        let right = local_protocol(2, legacy).await;
        let endpoint = right.endpoint().unwrap();
        let port = endpoint
            .bound_sockets()
            .into_iter()
            .find(SocketAddr::is_ipv4)
            .unwrap()
            .port();
        let address =
            EndpointAddr::new(endpoint.id()).with_ip_addr((Ipv4Addr::LOCALHOST, port).into());
        let (sent, received) = timeout(Duration::from_secs(10), async {
            tokio::join!(
                left.execute(Command::Connect { address }),
                right.execute(Command::Accept)
            )
        })
        .await
        .unwrap();
        let sent = sent.unwrap();
        let received = received.unwrap();
        assert_eq!(
            sent["remoteEndpoint"],
            right.endpoint().unwrap().id().to_string()
        );
        assert_eq!(
            received["remoteEndpoint"],
            left.endpoint().unwrap().id().to_string()
        );
        (
            left,
            sent["connection"].as_str().unwrap().into(),
            right,
            received["connection"].as_str().unwrap().into(),
        )
    }
    #[tokio::test]
    async fn owned_streams_round_trip_binary_and_close_without_reinitializing() {
        round_trip(false).await;
    }
    #[tokio::test]
    async fn legacy_clipboard_and_handoff_transport_round_trip() {
        round_trip(true).await;
    }
    async fn round_trip(legacy: bool) {
        let (left, connection, right, remote) = pair(legacy).await;
        let opened = left
            .execute(Command::OpenStream {
                connection: connection.clone(),
            })
            .await
            .unwrap();
        let stream = opened["stream"].as_str().unwrap().to_string();
        let data = vec![0, 1, 255, 128, 0, 10];
        left.execute(Command::Write {
            stream: stream.clone(),
            data: STANDARD.encode(&data),
        })
        .await
        .unwrap();
        let accepted = timeout(
            Duration::from_secs(5),
            right.execute(Command::AcceptStream {
                connection: remote.clone(),
            }),
        )
        .await
        .unwrap()
        .unwrap();
        let accepted = accepted["stream"].as_str().unwrap().to_string();
        let value = right
            .execute(Command::Read {
                stream: accepted.clone(),
                maximum: MAX_CHUNK,
            })
            .await
            .unwrap();
        assert_eq!(
            STANDARD.decode(value["data"].as_str().unwrap()).unwrap(),
            data
        );
        assert_eq!(value["eof"], false);
        assert!(right
            .execute(Command::Read {
                stream: stream.clone(),
                maximum: 1
            })
            .await
            .is_err());
        assert!(left
            .execute(Command::Read {
                stream: stream.clone(),
                maximum: MAX_CHUNK + 1
            })
            .await
            .is_err());
        left.execute(Command::Finish {
            stream: stream.clone(),
        })
        .await
        .unwrap();
        assert_eq!(
            right
                .execute(Command::Read {
                    stream: accepted.clone(),
                    maximum: 1
                })
                .await
                .unwrap()["eof"],
            true
        );
        // Release cancels an outstanding read without closing other connections.
        let waiting = left.clone();
        let reading = stream.clone();
        let pending = tokio::spawn(async move {
            waiting
                .execute(Command::Read {
                    stream: reading,
                    maximum: 1,
                })
                .await
        });
        tokio::task::yield_now().await;
        left.execute(Command::ReleaseStream { stream })
            .await
            .unwrap();
        assert!(timeout(Duration::from_secs(5), pending)
            .await
            .unwrap()
            .unwrap()
            .is_err());
        left.shutdown().await;
        assert!(left
            .execute(Command::Initialize {
                secret: [3; 32],
                relay: Relay::Disabled
            })
            .await
            .is_err());
        assert!(timeout(
            Duration::from_secs(5),
            right.execute(Command::AcceptStream { connection: remote })
        )
        .await
        .unwrap()
        .is_err());
        right.shutdown().await;
    }
    #[tokio::test]
    async fn rejects_uninitialized_endpoints_and_excessive_chunks_before_network_work() {
        let transport = Transport::default();
        assert!(transport.execute(Command::Snapshot).await.is_err());
        assert!(transport.execute(Command::Accept).await.is_err());
        assert!(transport
            .execute(Command::Write {
                stream: "missing".into(),
                data: "x".repeat(128 * 1024)
            })
            .await
            .is_err());
        assert!(transport
            .execute(Command::Read {
                stream: "missing".into(),
                maximum: 0
            })
            .await
            .is_err());
        assert!(serde_json::from_value::<Command>(
            json!({"operation":"read","stream":"x","maximum":1,"path":"/private"})
        )
        .is_err());
    }
}
