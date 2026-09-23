//! Bounded authenticated HTTP + WebSocket transport. Errors never include a
//! request URL: its query may contain a one-use connection ticket.
use std::{sync::Arc, time::Duration};

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

/// The host passes its native account-cookie client, configured with redirects
/// disabled. Account cookies and vault keys are never sent to a web renderer.
#[derive(Clone)]
pub struct SyncApi {
    base: Url,
    http: reqwest::Client,
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
        Ok(Self { base, http })
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
        let mut request = self
            .http
            .request(method, endpoint.clone())
            .timeout(REQUEST_TIMEOUT)
            .header("X-Misty-CSRF", "1");
        if let Some(body) = body {
            request = request.json(body);
        }
        let response = request.send().await.map_err(|_| Error::Network)?;
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
                    protocol_version: 1,
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
        endpoint.query_pairs_mut().append_pair("ticket", &ticket);
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
        let challenge = match timeout(WRITE_TIMEOUT, receive(&mut stream, &mut last_received))
            .await
            .map_err(|_| Error::Network)??
        {
            ServerFrame::Challenge {
                protocol_version: 1,
                challenge,
            } => challenge,
            _ => return Err(Error::Invalid),
        };
        let signature = device.connection_proof(scope, &grant.device_id, &challenge)?;
        send(
            &mut stream,
            &ClientFrame::Authenticate {
                after,
                signature: &signature,
            },
        )
        .await?;
        let (workspace, connection_id) =
            match timeout(WRITE_TIMEOUT, receive(&mut stream, &mut last_received))
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
        })
    }

    pub async fn receive(&mut self) -> Result<ServerFrame> {
        timeout(
            READ_TIMEOUT,
            receive(&mut self.stream, &mut self.last_received),
        )
        .await
        .map_err(|_| Error::Network)?
    }

    pub fn stale(&self) -> bool {
        self.last_received.elapsed() >= READ_TIMEOUT
    }

    pub async fn send(&mut self, frame: &ClientFrame<'_>) -> Result<()> {
        send(&mut self.stream, frame).await
    }

    pub async fn close(&mut self) {
        let _ = timeout(Duration::from_secs(1), self.stream.close(None)).await;
    }
}

async fn send(
    stream: &mut WebSocketStream<MaybeTlsStream<TcpStream>>,
    frame: &ClientFrame<'_>,
) -> Result<()> {
    let data = serde_json::to_string(frame)?;
    if data.len() > 1500 << 10 {
        return Err(Error::TooLarge);
    }
    timeout(WRITE_TIMEOUT, stream.send(Message::Text(data.into())))
        .await
        .map_err(|_| Error::Network)?
        .map_err(|_| Error::Network)
}

async fn receive(
    stream: &mut WebSocketStream<MaybeTlsStream<TcpStream>>,
    last_received: &mut Instant,
) -> Result<ServerFrame> {
    loop {
        let message = stream
            .next()
            .await
            .ok_or(Error::Network)?
            .map_err(|_| Error::Network)?;
        *last_received = Instant::now();
        match message {
            Message::Text(text) => return Ok(serde_json::from_str(&text)?),
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
