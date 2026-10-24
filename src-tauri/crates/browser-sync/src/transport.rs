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
    /// Workspace publication counters for this process (see `workspace::stats`).
    pub workspace_edit_batches: u64,
    pub workspace_records_unchanged: u64,
    pub workspace_records_written: u64,
    pub workspace_ops_suppressed: u64,
    pub workspace_ops_built: u64,
    pub workspace_ops_deferred: u64,
    pub workspace_edits_coalesced: u64,
}
impl TrafficCounters {
    pub fn snapshot(&self) -> TrafficSnapshot {
        use crate::workspace::stats;
        TrafficSnapshot {
            uploaded_bytes: self.uploaded.load(Ordering::Relaxed),
            downloaded_bytes: self.downloaded.load(Ordering::Relaxed),
            workspace_edit_batches: stats::read(&stats::EDIT_BATCHES),
            workspace_records_unchanged: stats::read(&stats::RECORDS_UNCHANGED),
            workspace_records_written: stats::read(&stats::RECORDS_WRITTEN),
            workspace_ops_suppressed: stats::read(&stats::OPS_SUPPRESSED),
            workspace_ops_built: stats::read(&stats::OPS_BUILT),
            workspace_ops_deferred: stats::read(&stats::OPS_DEFERRED),
            workspace_edits_coalesced: stats::read(&stats::EDITS_COALESCED),
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
    /// A Space vault this client serves. Device lists without one mean the
    /// personal vault.
    vault_id: Option<String>,
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
            vault_id: None,
        })
    }

    /// The same account client, answering for one Space vault: its device
    /// roster instead of the personal vault's.
    pub fn for_vault(&self, vault_id: &str) -> Self {
        let mut api = self.clone();
        api.vault_id = Some(vault_id.to_owned());
        api
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
        self.request_to(method, self.endpoint(path), body).await
    }

    async fn request_to<T: DeserializeOwned>(
        &self,
        method: reqwest::Method,
        endpoint: Url,
        body: Option<&impl Serialize>,
    ) -> Result<T> {
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
            401 => return Err(Error::Authentication),
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

mod endpoints;
mod socket;
pub use socket::*;

#[cfg(test)]
mod traffic_tests;
