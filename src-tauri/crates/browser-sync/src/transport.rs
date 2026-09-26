//! Bounded authenticated HTTP + WebSocket transport. Errors never include a
//! request URL: its query may contain a one-use connection ticket.
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};

use futures_util::{SinkExt, StreamExt};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tokio::{
    net::TcpStream,
    time::{timeout, Instant},
};
use tokio_tungstenite::{
    connect_async_tls_with_config,
    tungstenite::{protocol::WebSocketConfig, Message},
    Connector, MaybeTlsStream, WebSocketStream,
};
use url::Url;

use crate::{
    crypto::{DeviceKey, VaultScope},
    protocol::*,
    Error, Result,
};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const WRITE_TIMEOUT: Duration = Duration::from_secs(10);
const READ_TIMEOUT: Duration = Duration::from_secs(45);
const MAX_HTTP_BYTES: usize = 1 << 20;
const MAX_FRAME_BYTES: usize = 6 << 20;

/// Sync WebSocket application bytes, excluding HTTP, TLS and frame overhead.
/// Owned by an account session and shared across its reconnects.
#[derive(Default)]
pub struct TrafficCounters {
    uploaded: AtomicU64,
    downloaded: AtomicU64,
}
#[derive(Clone, Serialize)]
pub struct TrafficSnapshot {
    pub uploaded_bytes: u64,
    pub downloaded_bytes: u64,
}
impl TrafficCounters {
    pub fn snapshot(&self) -> TrafficSnapshot {
        TrafficSnapshot {
            uploaded_bytes: self.uploaded.load(Ordering::Relaxed),
            downloaded_bytes: self.downloaded.load(Ordering::Relaxed),
        }
    }
}

/// The host passes its native account-cookie client, configured with redirects
/// disabled. Account cookies and vault keys are never sent to a web renderer.
#[derive(Clone)]
pub struct SyncApi {
    base: Url,
    http: reqwest::Client,
    refreshed: Option<Arc<dyn Fn() -> Result<()> + Send + Sync>>,
    refresh_lock: Option<Arc<tokio::sync::Mutex<()>>>,
    traffic: Arc<TrafficCounters>,
}

impl SyncApi {
    pub fn new(base: &str, http: reqwest::Client) -> Result<Self> {
        let base = Url::parse(base).map_err(|_| Error::Invalid)?;
        let loopback = match base.host() {
            Some(url::Host::Domain("localhost")) => true,
            Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
            Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
            _ => false,
        };
        if !(base.scheme() == "https" || (base.scheme() == "http" && loopback))
            || base.host_str().is_none()
            || !base.username().is_empty()
            || base.password().is_some()
            || base.query().is_some()
            || base.fragment().is_some()
        {
            return Err(Error::Invalid);
        }
        Ok(Self {
            base,
            http,
            refreshed: None,
            refresh_lock: None,
            traffic: Arc::new(TrafficCounters::default()),
        })
    }

    /// Runs after the shared cookie jar accepts a rotated session. Hosts use
    /// this to persist the new refresh cookie in OS-protected storage.
    pub fn with_refresh_hook(
        mut self,
        refreshed: impl Fn() -> Result<()> + Send + Sync + 'static,
    ) -> Self {
        self.refreshed = Some(Arc::new(refreshed));
        self
    }

    /// Serializes refreshes with every other user of the same cookie jar. The
    /// server treats two concurrent uses of one refresh cookie as a replay and
    /// revokes the whole session; sequential refreshes each send the current
    /// cookie and rotate cleanly.
    pub fn with_refresh_lock(mut self, lock: Arc<tokio::sync::Mutex<()>>) -> Self {
        self.refresh_lock = Some(lock);
        self
    }

    pub fn traffic(&self) -> Arc<TrafficCounters> {
        self.traffic.clone()
    }

    pub fn deployment(&self) -> String {
        self.base.as_str().trim_end_matches('/').to_owned()
    }

    fn endpoint(&self, path: &str) -> Url {
        let mut endpoint = self.base.clone();
        endpoint.set_path(&format!(
            "{}/sync/{path}",
            self.base.path().trim_end_matches('/')
        ));
        endpoint
    }

    async fn request<T: DeserializeOwned>(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<&impl Serialize>,
    ) -> Result<T> {
        let endpoint = self.endpoint(path);
        let mut response = self.request_once(method.clone(), &endpoint, body).await?;
        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            self.refresh_session().await?;
            response = self.request_once(method, &endpoint, body).await?;
        }
        if response.url() != &endpoint {
            return Err(Error::Identity);
        }
        match response.status().as_u16() {
            200 | 201 => {}
            401 | 403 => return Err(Error::Authentication),
            409 | 426 => return Err(Error::Recovery),
            _ => return Err(Error::Network),
        }
        decode_response(response).await
    }

    async fn request_once(
        &self,
        method: reqwest::Method,
        endpoint: &Url,
        body: Option<&impl Serialize>,
    ) -> Result<reqwest::Response> {
        let mut request = self
            .http
            .request(method, endpoint.clone())
            .timeout(REQUEST_TIMEOUT)
            .header("X-Misty-CSRF", "1");
        if let Some(body) = body {
            request = request.json(body);
        }
        request.send().await.map_err(|_| Error::Network)
    }

    async fn refresh_session(&self) -> Result<()> {
        let _refresh_guard = match &self.refresh_lock {
            Some(lock) => Some(lock.lock().await),
            None => None,
        };
        let mut endpoint = self.base.clone();
        endpoint.set_path(&format!(
            "{}/auth/refresh",
            self.base.path().trim_end_matches('/')
        ));
        let response = self
            .http
            .post(endpoint.clone())
            .timeout(REQUEST_TIMEOUT)
            .header("X-Misty-CSRF", "1")
            .send()
            .await
            .map_err(|_| Error::Network)?;
        if response.url() != &endpoint {
            return Err(Error::Identity);
        }
        match response.status().as_u16() {
            200 | 204 => {
                if let Some(refreshed) = &self.refreshed {
                    refreshed()?;
                }
                Ok(())
            }
            401 | 403 => Err(Error::Authentication),
            _ => Err(Error::Network),
        }
    }

    pub async fn workspace(&self) -> Result<Option<Workspace>> {
        #[derive(Deserialize)]
        struct Response {
            workspace: Option<Workspace>,
        }
        let response: Response = self
            .request(reqwest::Method::GET, "workspace", None::<&()>)
            .await?;
        Ok(response.workspace)
    }

    pub async fn bootstrap(
        &self,
        root_public_key: &str,
        key_envelope: &KeyEnvelope,
        device: &DeviceGrant,
    ) -> Result<()> {
        #[derive(Serialize)]
        struct Body<'a> {
            root_public_key: &'a str,
            key_envelope: &'a KeyEnvelope,
            device: &'a DeviceGrant,
        }
        #[derive(Deserialize)]
        struct Response {
            workspace_id: String,
        }
        let response: Response = self
            .request(
                reqwest::Method::POST,
                "workspace",
                Some(&Body {
                    root_public_key,
                    key_envelope,
                    device,
                }),
            )
            .await?;
        if response.workspace_id != device.workspace_id {
            return Err(Error::Identity);
        }
        Ok(())
    }

    pub async fn enroll(&self, grant: &DeviceGrant) -> Result<()> {
        #[derive(Deserialize)]
        struct Response {
            device_id: String,
        }
        let response: Response = self
            .request(reqwest::Method::POST, "devices", Some(grant))
            .await?;
        if response.device_id != grant.device_id {
            return Err(Error::Identity);
        }
        Ok(())
    }

    pub async fn devices(&self) -> Result<Vec<Device>> {
        #[derive(Deserialize)]
        struct Response {
            devices: Vec<Device>,
        }
        let response: Response = self
            .request(reqwest::Method::GET, "devices", None::<&()>)
            .await?;
        Ok(response.devices)
    }

    /// `tree_id` asks an activated device to claim that tree instead of its own.
    pub async fn control_device(
        &self,
        device_id: &str,
        full_sync: Option<bool>,
        activate: bool,
        tree_id: Option<&str>,
    ) -> Result<String> {
        let mut body = serde_json::json!({
            "device_id": device_id, "full_sync": full_sync, "activate": activate,
        });
        if let Some(tree) = tree_id {
            body["tree_id"] = tree.into();
        }
        let response: serde_json::Value = self
            .request(reqwest::Method::POST, "control", Some(&body))
            .await?;
        Ok(response["operation_id"]
            .as_str()
            .unwrap_or_default()
            .to_owned())
    }

    /// Announces this device's controls and OS. The name is the user's to
    /// choose (`rename_device`), so it is never overwritten here.
    pub async fn advertise_controls(&self, device_id: &str, os_version: &str) -> Result<()> {
        let _: serde_json::Value = self
            .request(
                reqwest::Method::POST,
                "control",
                Some(&serde_json::json!({
                    "device_id": device_id, "control_version": 1,
                    "platform": std::env::consts::OS,
                    "os_version": os_version.chars().take(64).collect::<String>(),
                })),
            )
            .await?;
        Ok(())
    }

    pub async fn rename_device(&self, device_id: &str, name: &str) -> Result<()> {
        let _: serde_json::Value = self
            .request(
                reqwest::Method::POST,
                "control",
                Some(&serde_json::json!({ "device_id": device_id, "display_name": name })),
            )
            .await?;
        Ok(())
    }

    async fn ticket(&self, scope: &VaultScope, device_id: &str) -> Result<String> {
        #[derive(Serialize)]
        struct Body<'a> {
            workspace_id: &'a str,
            device_id: &'a str,
            protocol_version: u8,
        }
        #[derive(Deserialize)]
        struct Response {
            ticket: String,
            expires_in: u32,
        }
        let response: Response = self
            .request(
                reqwest::Method::POST,
                "ticket",
                Some(&Body {
                    workspace_id: &scope.workspace_id,
                    device_id,
                    protocol_version: PROTOCOL_VERSION,
                }),
            )
            .await?;
        if !(32..=128).contains(&response.ticket.len())
            || response.expires_in == 0
            || response.expires_in > 60
            || !response
                .ticket
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            return Err(Error::Invalid);
        }
        Ok(response.ticket)
    }
}

async fn decode_response<T: DeserializeOwned>(mut response: reqwest::Response) -> Result<T> {
    if response
        .content_length()
        .is_some_and(|n| n > MAX_HTTP_BYTES as u64)
    {
        return Err(Error::TooLarge);
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| Error::Network)? {
        if bytes.len() + chunk.len() > MAX_HTTP_BYTES {
            return Err(Error::TooLarge);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(serde_json::from_slice(&bytes)?)
}

pub struct SyncSocket {
    stream: WebSocketStream<MaybeTlsStream<TcpStream>>,
    pub workspace: Workspace,
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
            || scope.workspace_id != grant.workspace_id
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
            .append_pair("protocol", &PROTOCOL_VERSION.to_string());
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
        let (workspace, connection_id) = match timeout(
            WRITE_TIMEOUT,
            receive(&mut stream, &mut last_received, &api.traffic),
        )
        .await
        .map_err(|_| Error::Network)??
        {
            ServerFrame::Welcome {
                workspace,
                connection_id,
            } => (workspace, connection_id),
            _ => return Err(Error::Identity),
        };
        if workspace.workspace_id != scope.workspace_id
            || workspace.root_public_key != expected_root
            || workspace.key_epoch != grant.key_epoch
            || workspace.head_sequence < after
            || workspace.head_sequence > MAX_COUNTER
            || !valid_id(&connection_id)
        {
            return Err(Error::Identity);
        }
        Ok(Self {
            stream,
            workspace,
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

async fn send(
    stream: &mut WebSocketStream<MaybeTlsStream<TcpStream>>,
    traffic: &TrafficCounters,
    frame: &ClientFrame<'_>,
) -> Result<()> {
    let data = serde_json::to_string(frame)?;
    // A maximal tree op is 1400 KiB of ciphertext, base64 encoded.
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

async fn receive(
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

#[cfg(test)]
mod traffic_tests {
    use super::*;
    #[tokio::test]
    async fn counts_actual_websocket_payloads_and_shares_them_across_reconnect_clients() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (tcp, _) = listener.accept().await.unwrap();
            let mut socket = tokio_tungstenite::accept_async(tcp).await.unwrap();
            let received = socket.next().await.unwrap().unwrap().into_text().unwrap();
            socket
                .send(Message::Ping(vec![1, 2, 3].into()))
                .await
                .unwrap();
            let body = r#"{"type":"presence","devices":[]}"#;
            socket.send(Message::Text(body.into())).await.unwrap();
            (received.len() as u64, body.len() as u64)
        });
        let (mut socket, _) = tokio_tungstenite::connect_async(format!("ws://{addr}"))
            .await
            .unwrap();
        let api = SyncApi::new("http://127.0.0.1", reqwest::Client::new()).unwrap();
        let next_connection = api.clone();
        send(&mut socket, &api.traffic, &ClientFrame::Resume { after: 7 })
            .await
            .unwrap();
        let mut last = Instant::now();
        assert!(matches!(
            receive(&mut socket, &mut last, &api.traffic).await.unwrap(),
            ServerFrame::Presence { .. }
        ));
        let (up, down) = server.await.unwrap();
        assert_eq!(next_connection.traffic().snapshot().uploaded_bytes, up);
        assert_eq!(next_connection.traffic().snapshot().downloaded_bytes, down);
        assert_eq!(
            SyncApi::new("http://127.0.0.1", reqwest::Client::new())
                .unwrap()
                .traffic()
                .snapshot()
                .uploaded_bytes,
            0
        );
    }
}
