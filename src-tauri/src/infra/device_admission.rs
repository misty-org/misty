//! Adding and removing devices (docs/design/devices/BRIEF.md). Every change to
//! the device list is signed by the vault root, which only devices that
//! unlocked the vault hold; the server verifies but cannot produce it.
//! Approval from another device lives in `device_approval`.
use base64::{engine::general_purpose::STANDARD, Engine as _};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::infra::{
    device_http::{DeviceHttp, DeviceHttpError},
    device_identity::DeviceIdentity,
    device_records::{
        grant_payload, DeviceList, DevicePolicy, ListMember, RunGrant, SharedFolder, SignedRecord,
    },
    device_trust,
};
use misty_browser_sync::crypto::VaultRoot;

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
    pub local_device_id: String,
    pub server_device_id: String,
}

impl DeviceContext {
    pub fn open(api_base: &str, account_id: &str, local_device_id: &str) -> Result<Self, String> {
        let http = DeviceHttp::new(api_base, account_id)?;
        device_trust::open(&http.deployment(), account_id, local_device_id)
            .map_err(|error| error.to_string())?;
        let identity =
            DeviceIdentity::load(account_id, local_device_id).map_err(|error| error.to_string())?;
        let server_device_id = device_trust::server_device_id().unwrap_or_default();
        Ok(Self {
            http,
            identity,
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
    device_trust::set_server_device_id(&device.id).map_err(|error| error.to_string())?;
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
pub async fn refresh_trust(context: &DeviceContext) -> Result<device_trust::ListOutcome, String> {
    let trust: TrustResponse = context
        .http
        .session(reqwest::Method::GET, "devices/trust", None::<&()>)
        .await?;
    if let Some((root, scope, _)) = admission_authority(context).await {
        let derived = root.public_key().map_err(|error| error.to_string())?;
        device_trust::pin_root(&derived, &scope.vault_id).map_err(|error| error.to_string())?;
    }
    if let (Some(vault), Some(pinned)) = (&trust.vault, device_trust::pinned_root()) {
        if vault.root_public_key != pinned {
            return Err("Misty named a different sync vault than this device trusts.".to_owned());
        }
    }
    device_trust::apply_server_list(trust.list.as_ref()).map_err(|error| error.to_string())
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

/// Path A: with the vault open (sync password and secret, or a key this device
/// saved), the device signs its own grant and the list that adds it.
pub async fn admit_self(context: &DeviceContext) -> Result<(), String> {
    let own = context.require_registered()?.to_owned();
    let (root, scope, sync_device_id) = admission_authority(context)
        .await
        .ok_or("Unlock sync on this device to add it.")?;
    let derived = root.public_key().map_err(|error| error.to_string())?;
    device_trust::pin_root(&derived, &scope.vault_id).map_err(|error| error.to_string())?;
    for attempt in 0..2 {
        let (vault, list) = fetch_trust(context).await?;
        if vault.root_public_key != derived || vault.vault_id != scope.vault_id {
            return Err("Misty named a different sync vault than this device holds.".to_owned());
        }
        let grant = grant_payload(
            context.account(),
            &vault.vault_id,
            &own,
            vault.key_epoch,
            &context.identity.public_key(),
            &sync_device_id,
            now(),
            "",
        )
        .map_err(|error| error.to_string())?;
        let grant = SignedRecord::new(
            &grant,
            root.sign_device_record(&grant)
                .map_err(|error| error.to_string())?,
        );
        let member = ListMember {
            device_id: own.clone(),
            public_key: context.identity.public_key(),
        };
        let new_list = next_list(
            context.account(),
            &vault,
            list.as_ref(),
            Some(member),
            None,
            &root,
        )?;
        let result: Result<Value, DeviceHttpError> = context
            .http
            .signed(
                &context.identity,
                reqwest::Method::POST,
                &format!("devices/{own}/admit"),
                Some(&json!({"grant": grant, "list": new_list})),
            )
            .await;
        match result {
            Ok(_) => {
                device_trust::apply_server_list(Some(&new_list))
                    .map_err(|error| error.to_string())?;
                return Ok(());
            }
            Err(DeviceHttpError::Status(409, code))
                if code == "device_list_conflict" && attempt == 0 =>
            {
                continue
            }
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("Your devices changed while adding this one. Try again.".to_owned())
}

/// Removes a device everywhere. An added device needs the root-signed list
/// that drops it, so this device must have sync unlocked.
pub async fn remove(context: &DeviceContext, target: &str) -> Result<(), String> {
    let own = context.require_registered()?.to_owned();
    let (_, list) = fetch_trust(context).await?;
    let admitted = list
        .as_ref()
        .is_some_and(|list| list.admitted_key(target).is_some());
    let mut body = json!({"targetDeviceId": target});
    let mut signed_list = None;
    if admitted {
        let (root, _, _) = admission_authority(context)
            .await
            .ok_or("Unlock sync on this device to remove another.")?;
        let (vault, list) = fetch_trust(context).await?;
        let record = next_list(
            context.account(),
            &vault,
            list.as_ref(),
            None,
            Some(target),
            &root,
        )?;
        body["list"] = serde_json::to_value(&record).map_err(|error| error.to_string())?;
        signed_list = Some(record);
    }
    let _: Value = context
        .http
        .signed(
            &context.identity,
            reqwest::Method::POST,
            &format!("devices/{own}/remove-device"),
            Some(&body),
        )
        .await?;
    if let Some(record) = signed_list {
        device_trust::apply_server_list(Some(&record)).map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub async fn rename(context: &DeviceContext, target: &str, name: &str) -> Result<(), String> {
    let own = context.require_registered()?.to_owned();
    let _: Value = context
        .http
        .signed(
            &context.identity,
            reqwest::Method::PUT,
            &format!("devices/{own}/devices/{target}/name"),
            Some(&json!({"name": name})),
        )
        .await?;
    Ok(())
}

/// Signs and publishes this device's own policy. Only this device can.
pub async fn publish_policy(
    context: &DeviceContext,
    files: &str,
    clipboard: bool,
    agent_surfaces: Vec<String>,
    shared_folders: Vec<SharedFolder>,
) -> Result<DevicePolicy, String> {
    let own = context.require_registered()?.to_owned();
    if !matches!(files, "off" | "view" | "edit")
        || agent_surfaces
            .iter()
            .any(|surface| !matches!(surface.as_str(), "folders" | "browser" | "terminal"))
    {
        return Err("Those device settings aren't valid.".to_owned());
    }
    let previous = device_trust::own_policy()
        .map(|(policy, _)| policy.version)
        .unwrap_or_default();
    let mut surfaces = agent_surfaces;
    surfaces.sort();
    surfaces.dedup();
    let policy = DevicePolicy {
        version: previous.max(now() as u64).max(previous + 1),
        files: files.to_owned(),
        clipboard,
        agent_surfaces: surfaces,
        shared_folders,
    };
    let payload = policy
        .payload(context.account(), &own, now())
        .map_err(|error| error.to_string())?;
    let record = SignedRecord::new(
        &payload,
        context
            .identity
            .sign_record(&payload)
            .map_err(|error| error.to_string())?,
    );
    // Enforced locally first: the server copy is only for display.
    device_trust::store_own_policy(policy.clone(), record.clone())
        .map_err(|error| error.to_string())?;
    let _: Value = context
        .http
        .signed(
            &context.identity,
            reqwest::Method::PUT,
            &format!("devices/{own}/policy"),
            Some(&json!({"policy": record})),
        )
        .await?;
    Ok(policy)
}

/// Signs a grant letting one run use named scopes on a target device. Never
/// longer than a day.
pub fn sign_run_grant(
    context: &DeviceContext,
    target_device_id: &str,
    agent_id: &str,
    capabilities: Vec<String>,
    scopes: Vec<String>,
    ttl_seconds: i64,
) -> Result<SignedRecord, String> {
    let own = context.require_registered()?.to_owned();
    let issued_at = now();
    let grant = RunGrant {
        account_id: context.account().to_owned(),
        grant_id: format!("rungrant_{}", uuid::Uuid::new_v4()),
        requester_device_id: own,
        target_device_id: target_device_id.to_owned(),
        agent_id: agent_id.to_owned(),
        capabilities,
        scopes,
        issued_at,
        expires_at: issued_at + ttl_seconds.clamp(60, 24 * 3600),
    };
    if grant.capabilities.is_empty()
        || grant.scopes.is_empty()
        || grant.capabilities.len() > 64
        || grant.scopes.len() > 64
    {
        return Err("That grant isn't valid.".to_owned());
    }
    let payload = grant.payload().map_err(|error| error.to_string())?;
    Ok(SignedRecord::new(
        &payload,
        context
            .identity
            .sign_record(&payload)
            .map_err(|error| error.to_string())?,
    ))
}
