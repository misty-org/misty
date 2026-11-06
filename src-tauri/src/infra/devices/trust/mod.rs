//! What this session keeps about itself (docs/sync/devices.md): its id on the
//! server and its own signed policy.
use std::{
    path::PathBuf,
    sync::{Mutex, OnceLock},
};

use super::super::store::Store;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    error::{ApiError, ApiResult},
    infra::devices::records::{DevicePolicy, RunGrant, SignedRecord},
};

mod policy;
pub use policy::{
    effective_policy, forget_after_removal, own_policy, self_admitted, store_own_policy,
    verify_job_grant,
};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrustFile {
    version: u32,
    deployment: String,
    account_id: String,
    local_device_id: String,
    server_device_id: Option<String>,
    own_policy: Option<SignedRecord>,
    own_policy_state: Option<DevicePolicy>,
}

pub struct TrustState {
    store: Store,
    key: String,
    file: TrustFile,
}

static ROOT: OnceLock<PathBuf> = OnceLock::new();
static STATE: OnceLock<Mutex<Option<TrustState>>> = OnceLock::new();

fn state() -> &'static Mutex<Option<TrustState>> {
    STATE.get_or_init(|| Mutex::new(None))
}

/// The folder that holds `misty.db`, where trust records live; set once at startup.
pub fn set_storage_root(path: PathBuf) {
    let _ = ROOT.set(path);
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or_default()
}

fn lock_error<T>(_: std::sync::PoisonError<T>) -> ApiError {
    ApiError::Message("Device trust is unavailable.".to_owned())
}

/// Opens the trust state for one signed-in account on this install. Another
/// account's state is dropped first; nothing carries over between accounts.
pub fn open(deployment: &str, account_id: &str, local_device_id: &str) -> ApiResult<()> {
    let root = ROOT
        .get()
        .ok_or_else(|| ApiError::Message("Device trust storage is not ready.".to_owned()))?;
    let mut guard = state().lock().map_err(lock_error)?;
    if guard.as_ref().is_some_and(|current| {
        current.file.deployment == deployment
            && current.file.account_id == account_id
            && current.file.local_device_id == local_device_id
    }) {
        return Ok(());
    }
    let name = hex::encode(Sha256::digest(
        format!("{deployment}\n{account_id}\n{local_device_id}").as_bytes(),
    ));
    let store = Store::at(root.join("misty.db"));
    let key = name[..32].to_owned();
    let mut file: TrustFile = store
        .connect()
        .ok()
        .and_then(|connection| {
            connection
                .query_row(
                    "SELECT document FROM device_trust WHERE key = ?1",
                    [&key],
                    |row| row.get::<_, String>(0),
                )
                .ok()
        })
        .and_then(|document| serde_json::from_str(&document).ok())
        .unwrap_or_default();
    if file.deployment != deployment
        || file.account_id != account_id
        || file.local_device_id != local_device_id
    {
        file = TrustFile {
            version: 1,
            deployment: deployment.to_owned(),
            account_id: account_id.to_owned(),
            local_device_id: local_device_id.to_owned(),
            ..Default::default()
        };
    }
    *guard = Some(TrustState { store, key, file });
    Ok(())
}

pub fn close() {
    if let Ok(mut guard) = state().lock() {
        *guard = None;
    }
}

fn with_state<T>(apply: impl FnOnce(&mut TrustState) -> ApiResult<T>) -> ApiResult<T> {
    let mut guard = state().lock().map_err(lock_error)?;
    let current = guard
        .as_mut()
        .ok_or_else(|| ApiError::Unavailable("Sign in to use your devices.".to_owned()))?;
    apply(current)
}

impl TrustState {
    fn save(&self) -> ApiResult<()> {
        let document = serde_json::to_string(&self.file)?;
        let connection = self.store.connect().map_err(|error| {
            ApiError::Message(format!("Device trust could not be saved: {error}"))
        })?;
        connection
            .execute(
                "INSERT INTO device_trust (key, document) VALUES (?1, ?2)
                 ON CONFLICT (key) DO UPDATE SET document = excluded.document",
                rusqlite::params![self.key, document],
            )
            .map_err(|error| {
                ApiError::Message(format!("Device trust could not be saved: {error}"))
            })?;
        Ok(())
    }
}

pub fn set_server_device_id(device_id: &str) -> ApiResult<()> {
    with_state(|current| {
        if current.file.server_device_id.as_deref() != Some(device_id) {
            current.file.server_device_id = Some(device_id.to_owned());
            current.save()?;
        }
        Ok(())
    })
}

pub fn server_device_id() -> Option<String> {
    state().lock().ok()?.as_ref()?.file.server_device_id.clone()
}

#[cfg(test)]
mod tests;
