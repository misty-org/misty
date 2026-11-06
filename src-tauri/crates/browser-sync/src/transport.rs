//! Bounded authenticated HTTP + WebSocket transport. Errors never include a
//! request URL: its query may contain a one-use connection ticket.
use std::{
    future::Future,
    pin::Pin,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};

use serde::{de::DeserializeOwned, Serialize};
use tokio::{net::TcpStream, time::timeout};
use tokio_tungstenite::{
    connect_async_tls_with_config, tungstenite::protocol::WebSocketConfig, Connector,
    MaybeTlsStream, WebSocketStream,
};
use url::Url;

use crate::{Error, Result};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_HTTP_BYTES: usize = 1 << 20;

/// Sync WebSocket application bytes, excluding HTTP, TLS and frame overhead.
/// Owned by an account session and shared across its reconnects.
#[derive(Default)]
pub struct TrafficCounters {
    pub(crate) uploaded: AtomicU64,
    pub(crate) downloaded: AtomicU64,
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

/// The account session a host lends this client. The host holds the tokens and serializes
/// refreshes with everything else using them: the server treats two uses of one refresh token as
/// a replay and ends the whole session.
pub trait SessionAuth: Send + Sync {
    /// The `Authorization` value for the next request.
    fn bearer(&self) -> Option<String>;
    /// Called once after the server refused `used`. Another caller may already have rotated
    /// the session since, in which case there's nothing to do.
    fn refresh<'a>(
        &'a self,
        used: Option<&'a str>,
    ) -> Pin<Box<dyn Future<Output = Result<()>> + Send + 'a>>;
}

/// The host passes its native HTTP client, configured with redirects disabled,
/// and lends its session (`with_session`). Account tokens and vault keys are
/// never sent to a web renderer.
#[derive(Clone)]
pub struct SyncApi {
    base: Url,
    http: reqwest::Client,
    session: Option<Arc<dyn SessionAuth>>,
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
            session: None,
            traffic: Arc::new(TrafficCounters::default()),
        })
    }

    /// Every request carries this session's bearer and survives its expiring by refreshing once.
    pub fn with_session(mut self, session: Arc<dyn SessionAuth>) -> Self {
        self.session = Some(session);
        self
    }

    pub fn traffic(&self) -> Arc<TrafficCounters> {
        self.traffic.clone()
    }

    pub fn deployment(&self) -> String {
        self.base.as_str().trim_end_matches('/').to_owned()
    }

    pub(crate) fn endpoint(&self, path: &str) -> Url {
        let mut endpoint = self.base.clone();
        endpoint.set_path(&format!(
            "{}/sync/{path}",
            self.base.path().trim_end_matches('/')
        ));
        endpoint
    }

    pub(crate) async fn request<T: DeserializeOwned>(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<&impl Serialize>,
    ) -> Result<T> {
        let endpoint = self.endpoint(path);
        let used = self.bearer();
        let mut response = self
            .request_once(method.clone(), &endpoint, body, used.as_deref())
            .await?;
        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            if let Some(session) = &self.session {
                session.refresh(used.as_deref()).await?;
                let bearer = self.bearer();
                response = self
                    .request_once(method, &endpoint, body, bearer.as_deref())
                    .await?;
            }
        }
        if response.url() != &endpoint {
            return Err(Error::Identity);
        }
        match response.status().as_u16() {
            200 | 201 => {}
            204 => return Ok(serde_json::from_slice(b"null")?),
            401 => return Err(Error::Authentication),
            // The password given to confirm a destructive request was wrong.
            412 => return Err(Error::Unlock),
            403 => return Err(Error::DeviceForbidden),
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
        bearer: Option<&str>,
    ) -> Result<reqwest::Response> {
        let mut request = self
            .http
            .request(method, endpoint.clone())
            .timeout(REQUEST_TIMEOUT)
            .header("X-Misty-CSRF", "1");
        if let Some(bearer) = bearer {
            let mut value =
                reqwest::header::HeaderValue::from_str(bearer).map_err(|_| Error::Invalid)?;
            value.set_sensitive(true);
            request = request.header(reqwest::header::AUTHORIZATION, value);
        }
        if let Some(body) = body {
            request = request.json(body);
        }
        request.send().await.map_err(|_| Error::Network)
    }

    fn bearer(&self) -> Option<String> {
        self.session.as_ref()?.bearer()
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

mod socket;
pub use socket::*;
