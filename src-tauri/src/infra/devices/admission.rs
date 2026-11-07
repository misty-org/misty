//! Registering this session with the server, and the changes it signs
//! Registering with proof of its key makes it trusted at once.
use serde::Deserialize;
use serde_json::{json, Value};

use super::{
    http::DeviceHttp,
    identity::DeviceIdentity,
    records::{DevicePolicy, SharedFolder, SignedRecord},
    trust,
};

mod changes;
pub use changes::publish_policy;

pub(crate) fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or_default()
}

pub struct DeviceContext {
    pub http: DeviceHttp,
    pub identity: DeviceIdentity,
    pub server_device_id: String,
}

impl DeviceContext {
    pub fn open(api_base: &str, account_id: &str, local_device_id: &str) -> Result<Self, String> {
        let http = DeviceHttp::new(api_base, account_id)?;
        trust::open(&http.deployment(), account_id, local_device_id)
            .map_err(|error| error.to_string())?;
        let identity =
            DeviceIdentity::load(account_id, local_device_id).map_err(|error| error.to_string())?;
        let server_device_id = trust::server_device_id().unwrap_or_default();
        Ok(Self {
            http,
            identity,
            server_device_id,
        })
    }

    pub(crate) fn account(&self) -> &str {
        self.http.account_id()
    }

    pub(crate) fn require_registered(&self) -> Result<&str, String> {
        if self.server_device_id.is_empty() {
            return Err("This session isn't registered with Misty yet.".to_owned());
        }
        Ok(&self.server_device_id)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisteredDevice {
    pub id: String,
}

/// Registers this install's key with the server, proving it holds the key.
pub async fn register(
    context: &mut DeviceContext,
    name: &str,
    platform: &str,
    os_version: &str,
    app_version: &str,
) -> Result<RegisteredDevice, String> {
    let issued_at = now();
    let proof = context
        .identity
        .registration_proof(context.account(), issued_at)
        .map_err(|error| error.to_string())?;
    let body = json!({
        "name": name, "publicKey": context.identity.public_key(), "platform": platform,
        "p2pEndpointId": context.identity.endpoint_id(), "osVersion": os_version, "appVersion": app_version,
        "capabilities": {"lan_files": true, "agent_jobs": true},
        "issuedAt": issued_at, "proof": proof,
    });
    let device: RegisteredDevice = context
        .http
        .session(reqwest::Method::POST, "devices", Some(&body))
        .await?;
    trust::set_server_device_id(&device.id).map_err(|error| error.to_string())?;
    context.server_device_id = device.id.clone();
    Ok(device)
}
