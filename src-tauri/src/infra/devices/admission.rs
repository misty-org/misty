//! Adding and removing devices (docs/sync/devices.md). Every change to
//! the device list is signed by the vault root, which only devices that
//! unlocked the vault hold; the server verifies but cannot produce it.
//! Approval from another device lives in `device_approval`.
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::{
    http::{DeviceHttp, DeviceHttpError},
    identity::DeviceIdentity,
    records::{
        grant_payload, DeviceList, DevicePolicy, ListMember, RunGrant, SharedFolder, SignedRecord,
    },
    trust,
};
use misty_browser_sync::crypto::VaultRoot;

mod changes;
pub use changes::{admit_self, publish_policy, remove, rename, sign_run_grant};

pub(crate) fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or_default()
}

pub(crate) fn random32() -> [u8; 32] {
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes
}

pub struct DeviceContext {
    pub http: DeviceHttp,
    pub identity: DeviceIdentity,
    /// Keys the test stand-in for an open sync vault.
    #[cfg(test)]
    pub local_device_id: String,
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
            #[cfg(test)]
            local_device_id: local_device_id.to_owned(),
            server_device_id,
        })
    }

    pub(crate) fn account(&self) -> &str {
        self.http.account_id()
    }

    pub(crate) fn require_registered(&self) -> Result<&str, String> {
        if self.server_device_id.is_empty() {
            return Err("This device isn't registered with Misty yet.".to_owned());
        }
        Ok(&self.server_device_id)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisteredDevice {
    pub id: String,
    pub admission_state: String,
    #[serde(default)]
    pub sync_device_id: String,
}

/// Registers this install's device key with the server (as pending until it
/// is added), proving it holds the key.
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
        "capabilities": {"device_list": true, "lan_files": true, "agent_jobs": true},
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrustVault {
    pub vault_id: String,
    pub root_public_key: String,
    pub key_epoch: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrustResponse {
    vault: Option<TrustVault>,
    list: Option<SignedRecord>,
}

/// Pins the vault root this device holds (if the vault is open) and applies
/// the server's list. A server root that differs from the pinned one is refused.
pub async fn refresh_trust(context: &DeviceContext) -> Result<trust::ListOutcome, String> {
    let trust: TrustResponse = context
        .http
        .session(reqwest::Method::GET, "devices/trust", None::<&()>)
        .await?;
    if let Some((root, scope, _)) = admission_authority(context).await {
        let derived = root.public_key().map_err(|error| error.to_string())?;
        trust::pin_root(&derived, &scope.vault_id).map_err(|error| error.to_string())?;
    }
    if let (Some(vault), Some(pinned)) = (&trust.vault, trust::pinned_root()) {
        if vault.root_public_key != pinned {
            return Err("Misty named a different sync vault than this device trusts.".to_owned());
        }
    }
    trust::apply_server_list(trust.list.as_ref()).map_err(|error| error.to_string())
}

pub(crate) async fn fetch_trust(
    context: &DeviceContext,
) -> Result<(TrustVault, Option<DeviceList>), String> {
    let trust: TrustResponse = context
        .http
        .session(reqwest::Method::GET, "devices/trust", None::<&()>)
        .await?;
    let vault = trust.vault.ok_or("Set up sync to add devices.")?;
    let list = match trust.list {
        Some(record) => Some(
            DeviceList::verify(&record, &vault.root_public_key)
                .ok_or("Misty sent a device list that didn't verify.")?,
        ),
        None => None,
    };
    Ok((vault, list))
}

/// The next list: the current one plus or minus a device, signed by the root.
pub(crate) fn next_list(
    account_id: &str,
    vault: &TrustVault,
    current: Option<&DeviceList>,
    add: Option<ListMember>,
    remove: Option<&str>,
    root: &VaultRoot,
) -> Result<SignedRecord, String> {
    let mut admitted: Vec<ListMember> = current
        .map(|list| list.admitted.clone())
        .unwrap_or_default();
    let mut revoked: Vec<ListMember> = current.map(|list| list.revoked.clone()).unwrap_or_default();
    if let Some(member) = add {
        admitted.retain(|existing| existing.device_id != member.device_id);
        admitted.push(member);
    }
    if let Some(target) = remove {
        if let Some(position) = admitted
            .iter()
            .position(|member| member.device_id == target)
        {
            revoked.push(admitted.remove(position));
        }
    }
    let version = current.map(|list| list.version).unwrap_or_default() + 1;
    let payload = DeviceList::next_payload(
        account_id,
        &vault.vault_id,
        version,
        vault.key_epoch,
        &admitted,
        &revoked,
        now(),
    )
    .map_err(|error| error.to_string())?;
    let signature = root
        .sign_device_record(&payload)
        .map_err(|error| error.to_string())?;
    Ok(SignedRecord::new(&payload, signature))
}

/// The open vault's root, scope and sync identity when this device holds it.
/// Tests stand in for an open sync vault with `set_test_authority`.
pub(crate) async fn admission_authority(
    context: &DeviceContext,
) -> Option<(VaultRoot, misty_browser_sync::crypto::VaultScope, String)> {
    #[cfg(test)]
    if let Some((root, vault, sync)) = TEST_AUTHORITY.lock().ok().and_then(|map| {
        map.get(&context.local_device_id)
            .map(|(r, v, s)| (r.duplicate(), v.clone(), s.clone()))
    }) {
        let scope = misty_browser_sync::crypto::VaultScope {
            deployment: context.http.deployment(),
            account_id: context.account().to_owned(),
            vault_id: vault,
        };
        return Some((root, scope, sync));
    }
    crate::infra::browser_sync::device_admission_authority(context.account()).await
}

#[cfg(test)]
static TEST_AUTHORITY: std::sync::LazyLock<
    std::sync::Mutex<std::collections::HashMap<String, (VaultRoot, String, String)>>,
> = std::sync::LazyLock::new(Default::default);

/// Tests: this local device holds the vault root, as if sync were unlocked.
#[cfg(test)]
pub(crate) fn set_test_authority(
    local_device_id: &str,
    root: &VaultRoot,
    vault_id: &str,
    sync_device_id: &str,
) {
    TEST_AUTHORITY.lock().unwrap().insert(
        local_device_id.to_owned(),
        (
            root.duplicate(),
            vault_id.to_owned(),
            sync_device_id.to_owned(),
        ),
    );
}
