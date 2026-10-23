//! The sync WebSocket to a vault's stream, and the device channel's socket.
use super::*;

pub struct SyncSocket {
    stream: WebSocketStream<MaybeTlsStream<TcpStream>>,
    pub vault: Vault,
    pub connection_id: String,
    last_received: Instant,
    traffic: Arc<TrafficCounters>,
}

impl SyncSocket {
    pub async fn connect(
        api: &SyncApi,
        scope: &VaultScope,
        grant: &DeviceGrant,
        device: &DeviceKey,
        expected_root: &str,
        after: u64,
    ) -> Result<Self> {
        scope.validate()?;
        if scope.deployment != api.deployment()
            || scope.vault_id != grant.vault_id
            || device.public_key() != grant.public_key
            || after > MAX_COUNTER
        {
            return Err(Error::Identity);
        }
        let ticket = api.ticket(scope, &grant.device_id).await?;
        let mut endpoint = api.endpoint("ws");
        let scheme = if endpoint.scheme() == "https" {
            "wss"
        } else {
            "ws"
        };
        endpoint.set_scheme(scheme).map_err(|_| Error::Invalid)?;
        endpoint
            .query_pairs_mut()
            .append_pair("ticket", &ticket)
            .append_pair("protocol", &PROTOCOL_VERSION.to_string())
            .append_pair("batching", BATCHING);
        let connector = if scheme == "wss" {
            Some(tls_connector()?)
        } else {
            None
        };
        let config = WebSocketConfig::default()
            .read_buffer_size(8192)
            .write_buffer_size(8192)
            .max_write_buffer_size(2 << 20)
            .max_message_size(Some(MAX_FRAME_BYTES))
            .max_frame_size(Some(MAX_FRAME_BYTES));
        let (mut stream, _) = timeout(
            REQUEST_TIMEOUT,
            connect_async_tls_with_config(endpoint.as_str(), Some(config), false, connector),
        )
        .await
        .map_err(|_| Error::Network)?
        .map_err(|_| Error::Network)?;
        let mut last_received = Instant::now();
        let challenge = match timeout(
            WRITE_TIMEOUT,
            receive(&mut stream, &mut last_received, &api.traffic),
        )
        .await
        .map_err(|_| Error::Network)??
        {
            ServerFrame::Challenge {
                protocol_version: PROTOCOL_VERSION,
                challenge,
            } => challenge,
            _ => return Err(Error::Invalid),
        };
        let signature = device.connection_proof(scope, &grant.device_id, &challenge)?;
        send(
            &mut stream,
            &api.traffic,
            &ClientFrame::Authenticate {
                after,
                signature: &signature,
            },
        )
        .await?;
        let (vault, connection_id) = match timeout(
            WRITE_TIMEOUT,
            receive(&mut stream, &mut last_received, &api.traffic),
        )
        .await
        .map_err(|_| Error::Network)??
        {
            ServerFrame::Welcome {
                vault,
                connection_id,
            } => (vault, connection_id),
            _ => return Err(Error::Identity),
        };
        if vault.vault_id != scope.vault_id
            || vault.root_public_key != expected_root
            || vault.key_epoch != grant.key_epoch
            || vault.head_sequence < after
            || vault.head_sequence > MAX_COUNTER
            || !valid_id(&connection_id)
        {
            return Err(Error::Identity);
        }
        Ok(Self {
            stream,
            vault,
            connection_id,
            last_received,
            traffic: api.traffic(),
        })
    }

    pub async fn receive(&mut self) -> Result<ServerFrame> {
        timeout(
            READ_TIMEOUT,
            receive(&mut self.stream, &mut self.last_received, &self.traffic),
        )
        .await
        .map_err(|_| Error::Network)?
    }

    pub fn stale(&self) -> bool {
        self.last_received.elapsed() >= READ_TIMEOUT
    }

    pub async fn send(&mut self, frame: &ClientFrame<'_>) -> Result<()> {
        send(&mut self.stream, &self.traffic, frame).await
    }

    pub async fn close(&mut self) {
        let _ = timeout(Duration::from_secs(1), self.stream.close(None)).await;
    }
}

pub(super) async fn send(
    stream: &mut WebSocketStream<MaybeTlsStream<TcpStream>>,
    traffic: &TrafficCounters,
    frame: &ClientFrame<'_>,
) -> Result<()> {
    let data = serde_json::to_string(frame)?;
    // A maximal workspace op is 1400 KiB of ciphertext, base64 encoded.
    if data.len() > 2 << 20 {
        return Err(Error::TooLarge);
    }
    let bytes = data.len() as u64;
    timeout(WRITE_TIMEOUT, stream.send(Message::Text(data.into())))
        .await
        .map_err(|_| Error::Network)?
        .map_err(|_| Error::Network)?;
    traffic.uploaded.fetch_add(bytes, Ordering::Relaxed);
    Ok(())
}

pub(super) async fn receive(
    stream: &mut WebSocketStream<MaybeTlsStream<TcpStream>>,
    last_received: &mut Instant,
    traffic: &TrafficCounters,
) -> Result<ServerFrame> {
    loop {
        let message = stream
            .next()
            .await
            .ok_or(Error::Network)?
            .map_err(|_| Error::Network)?;
        *last_received = Instant::now();
        match message {
            Message::Text(text) => {
                traffic
                    .downloaded
                    .fetch_add(text.len() as u64, Ordering::Relaxed);
                return Ok(serde_json::from_str(&text)?);
            }
            Message::Ping(_) => {
                stream.flush().await.map_err(|_| Error::Network)?;
            }
            Message::Pong(_) => {}
            _ => return Err(Error::Network),
        }
    }
}

/// Opens an authenticated-elsewhere WebSocket (the URL carries a one-use
/// ticket) with the same TLS roots and frame bounds as the sync socket. Used
/// by the device channel.
pub async fn open_device_socket(
    url: &Url,
    max_frame: usize,
) -> Result<WebSocketStream<MaybeTlsStream<TcpStream>>> {
    let connector = if url.scheme() == "wss" {
        Some(tls_connector()?)
    } else if url.scheme() == "ws"
        && matches!(url.host(), Some(url::Host::Domain("localhost")))
            | matches!(url.host(), Some(url::Host::Ipv4(ip)) if ip.is_loopback())
    {
        None
    } else {
        return Err(Error::Invalid);
    };
    let config = WebSocketConfig::default()
        .read_buffer_size(8192)
        .write_buffer_size(8192)
        .max_write_buffer_size(1 << 20)
        .max_message_size(Some(max_frame))
        .max_frame_size(Some(max_frame));
    let (stream, _) = timeout(
        REQUEST_TIMEOUT,
        connect_async_tls_with_config(url.as_str(), Some(config), false, connector),
    )
    .await
    .map_err(|_| Error::Network)?
    .map_err(|_| Error::Network)?;
    Ok(stream)
}

pub use tokio_tungstenite::tungstenite::{Error as SocketError, Message as SocketMessage};

fn tls_connector() -> Result<Connector> {
    let mut roots = rustls::RootCertStore::empty();
    for certificate in rustls_native_certs::load_native_certs().certs {
        roots.add(certificate).map_err(|_| Error::Network)?;
    }
    if roots.is_empty() {
        return Err(Error::Network);
    }
    let config = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .map_err(|_| Error::Network)?
    .with_root_certificates(roots)
    .with_no_client_auth();
    Ok(Connector::Rustls(Arc::new(config)))
}
