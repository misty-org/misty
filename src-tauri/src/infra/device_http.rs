//! Native calls to the device endpoints. Session cookies stay in the native
//! cookie jar; device-signed calls add a fresh signature by the device key.
use std::{sync::Arc, time::Duration};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use rand::RngCore;
use serde::{de::DeserializeOwned, Serialize};
use sha2::{Digest, Sha256};

use crate::infra::{
    auth_cookies::{self, AccountClient},
    device_identity::{canonical_request, DeviceIdentity},
};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_RESPONSE_BYTES: usize = 1 << 20;

#[derive(Debug)]
pub enum DeviceHttpError {
    /// The server answered with this status and its `code`, if any.
    Status(u16, String),
    Network,
    Invalid,
}

impl std::fmt::Display for DeviceHttpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Status(401, _) => write!(f, "Sign in again to manage devices."),
            Self::Status(403, code) if code == "device_removed" => {
                write!(f, "This device was removed from your account.")
            }
            Self::Status(403, _) => write!(f, "This device isn't allowed to do that."),
            Self::Status(409, code) if code == "sync_setup_required" => {
                write!(f, "Set up sync to add devices.")
            }
            Self::Status(409, _) => write!(f, "Your devices changed. Try again."),
            Self::Status(status, _) => write!(f, "Misty couldn't update devices ({status})."),
            Self::Network => write!(f, "Can't reach Misty right now."),
            Self::Invalid => write!(f, "Misty sent an unexpected device response."),
        }
    }
}

impl From<DeviceHttpError> for String {
    fn from(error: DeviceHttpError) -> Self {
        error.to_string()
    }
}

#[derive(Clone)]
pub struct DeviceHttp {
    base: url::Url,
    account_id: String,
    client: Arc<AccountClient>,
}

impl DeviceHttp {
    pub fn new(api_base: &str, account_id: &str) -> Result<Self, String> {
        let base = auth_cookies::server(api_base)?;
        let client = auth_cookies::current(&base)?;
        client.require_account(&base, account_id)?;
        Ok(Self {
            base,
            account_id: account_id.to_owned(),
            client,
        })
    }

    pub fn account_id(&self) -> &str {
        &self.account_id
    }

    pub fn deployment(&self) -> String {
        self.base.as_str().trim_end_matches('/').to_owned()
    }

    /// The full request path the server sees, used in device signatures.
    pub fn path(&self, path: &str) -> String {
        format!(
            "{}/{}",
            self.base.path().trim_end_matches('/'),
            path.trim_start_matches('/')
        )
    }

    pub fn url(&self, path: &str) -> url::Url {
        let mut url = self.base.clone();
        url.set_path(&self.path(path));
        url
    }

    pub fn websocket_url(&self, path: &str) -> Result<url::Url, DeviceHttpError> {
        let mut url = self.url(path);
        let scheme = if url.scheme() == "https" { "wss" } else { "ws" };
        url.set_scheme(scheme)
            .map_err(|_| DeviceHttpError::Invalid)?;
        Ok(url)
    }

    /// A session-authenticated call (no device signature).
    pub async fn session<T: DeserializeOwned>(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<&impl Serialize>,
    ) -> Result<T, DeviceHttpError> {
        let body = body
            .map(serde_json::to_vec)
            .transpose()
            .map_err(|_| DeviceHttpError::Invalid)?;
        self.send(method, path, body, None).await
    }

    /// A call signed by this device's key over the exact request.
    pub async fn signed<T: DeserializeOwned>(
        &self,
        identity: &DeviceIdentity,
        method: reqwest::Method,
        path: &str,
        body: Option<&impl Serialize>,
    ) -> Result<T, DeviceHttpError> {
        let body = body
            .map(serde_json::to_vec)
            .transpose()
            .map_err(|_| DeviceHttpError::Invalid)?;
        self.send(method, path, body, Some(identity)).await
    }

    async fn send<T: DeserializeOwned>(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Vec<u8>>,
        identity: Option<&DeviceIdentity>,
    ) -> Result<T, DeviceHttpError> {
        let mut response = self
            .once(method.clone(), path, body.clone(), identity)
            .await?;
        if response.status() == reqwest::StatusCode::UNAUTHORIZED && self.refresh().await {
            // A fresh signature too: the first nonce was consumed.
            response = self.once(method, path, body, identity).await?;
        }
        let status = response.status().as_u16();
        let bytes = read_limited(response).await?;
        if !(200..300).contains(&status) {
            let code = serde_json::from_slice::<serde_json::Value>(&bytes)
                .ok()
                .and_then(|value| value["code"].as_str().map(str::to_owned))
                .unwrap_or_default();
            return Err(DeviceHttpError::Status(status, code));
        }
        serde_json::from_slice(&bytes).map_err(|_| DeviceHttpError::Invalid)
    }

    async fn once(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Vec<u8>>,
        identity: Option<&DeviceIdentity>,
    ) -> Result<reqwest::Response, DeviceHttpError> {
        let url = self.url(path);
        let mut request = self
            .client
            .http
            .request(method.clone(), url.clone())
            .timeout(REQUEST_TIMEOUT)
            .header("X-Misty-CSRF", "1");
        let payload = body.unwrap_or_default();
        if let Some(identity) = identity {
            let timestamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|_| DeviceHttpError::Invalid)?
                .as_secs()
                .to_string();
            let mut nonce = [0u8; 16];
            rand::thread_rng().fill_bytes(&mut nonce);
            let nonce = STANDARD.encode(nonce);
            let digest = hex::encode(Sha256::digest(&payload));
            let canonical =
                canonical_request(method.as_str(), url.path(), &timestamp, &nonce, &digest);
            request = request
                .header("X-Misty-Device-Timestamp", timestamp)
                .header("X-Misty-Device-Nonce", nonce)
                .header(
                    "X-Misty-Device-Signature",
                    identity.sign_request(&canonical),
                );
        }
        if !payload.is_empty() {
            request = request
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .body(payload);
        }
        let response = request.send().await.map_err(|_| DeviceHttpError::Network)?;
        if response.url() != &url {
            return Err(DeviceHttpError::Invalid);
        }
        Ok(response)
    }

    /// Rotates the account session once, serialized with every other user of
    /// the same cookie jar.
    async fn refresh(&self) -> bool {
        let _guard = self.client.refresh_lock.lock().await;
        let mut url = self.base.clone();
        url.set_path(&format!(
            "{}/auth/refresh",
            self.base.path().trim_end_matches('/')
        ));
        let Ok(response) = self
            .client
            .http
            .post(url)
            .timeout(REQUEST_TIMEOUT)
            .header("X-Misty-CSRF", "1")
            .send()
            .await
        else {
            return false;
        };
        if !matches!(response.status().as_u16(), 200 | 204) {
            return false;
        }
        self.client.persist(&self.base).is_ok()
    }
}

async fn read_limited(mut response: reqwest::Response) -> Result<Vec<u8>, DeviceHttpError> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| DeviceHttpError::Network)?
    {
        if bytes.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err(DeviceHttpError::Invalid);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
