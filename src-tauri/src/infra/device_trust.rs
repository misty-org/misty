//! What this device trusts (docs/design/devices/BRIEF.md): the vault root it
//! pinned when it unlocked the vault, the newest device list that verifies
//! against that root, and its own signed policy. Peers are trusted only
//! through this list, never through anything the server asserts.
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Mutex, OnceLock},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    error::{ApiError, ApiResult},
    infra::device_records::{DeviceList, DevicePolicy, RunGrant, SignedRecord},
};

/// A peer refuses new LAN connections when its newest verified list is older
/// than this and nothing fresher can be reached.
pub const LIST_FRESHNESS_SECONDS: i64 = 24 * 3600;
const MAX_CACHED_ADDRESSES: usize = 8;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrustFile {
    version: u32,
    deployment: String,
    account_id: String,
    local_device_id: String,
    server_device_id: Option<String>,
    /// This device's own endpoint, never treated as a peer.
    #[serde(default)]
    own_endpoint: Option<String>,
    root_public_key: Option<String>,
    vault_id: Option<String>,
    list: Option<SignedRecord>,
    /// "server" or "peer": a list learned from a peer only carried removals.
    list_source: String,
    list_fresh_at: i64,
    own_policy: Option<SignedRecord>,
    own_policy_state: Option<DevicePolicy>,
    known_addresses: HashMap<String, Vec<String>>,
}

pub struct TrustState {
    path: PathBuf,
    file: TrustFile,
    list: Option<DeviceList>,
}

static ROOT: OnceLock<PathBuf> = OnceLock::new();
static STATE: OnceLock<Mutex<Option<TrustState>>> = OnceLock::new();

fn state() -> &'static Mutex<Option<TrustState>> {
    STATE.get_or_init(|| Mutex::new(None))
}

/// Where trust files live; set once at startup.
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
    let path = root
        .join("device-trust")
        .join(format!("{}.json", &name[..32]));
    let mut file: TrustFile = std::fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
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
            list_source: "server".to_owned(),
            ..Default::default()
        };
    }
    let list = match (&file.list, &file.root_public_key) {
        (Some(record), Some(root_key)) => {
            DeviceList::verify(record, root_key).filter(|list| list.account_id == account_id)
        }
        _ => None,
    };
    *guard = Some(TrustState { path, file, list });
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
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let temporary = self.path.with_extension("json.tmp");
        std::fs::write(&temporary, serde_json::to_vec(&self.file)?)?;
        std::fs::rename(&temporary, &self.path)?;
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

pub fn set_own_endpoint(endpoint: &str) -> ApiResult<()> {
    with_state(|current| {
        if current.file.own_endpoint.as_deref() != Some(endpoint) {
            current.file.own_endpoint = Some(endpoint.to_owned());
            current.save()?;
        }
        Ok(())
    })
}

pub fn server_device_id() -> Option<String> {
    state().lock().ok()?.as_ref()?.file.server_device_id.clone()
}

pub fn account() -> Option<(String, String, String)> {
    let guard = state().lock().ok()?;
    let current = guard.as_ref()?;
    Some((
        current.file.deployment.clone(),
        current.file.account_id.clone(),
        current.file.local_device_id.clone(),
    ))
}

/// Pins the vault root public key, derived from the root this device holds.
/// A different root later is refused: the vault key never silently changes.
pub fn pin_root(root_public_key: &str, vault_id: &str) -> ApiResult<()> {
    with_state(|current| {
        match current.file.root_public_key.as_deref() {
            Some(pinned) if pinned != root_public_key => {
                return Err(ApiError::Message(
                    "Your sync vault key changed. Remove this device and add it again.".to_owned(),
                ))
            }
            Some(_) => return Ok(()),
            None => {}
        }
        current.file.root_public_key = Some(root_public_key.to_owned());
        current.file.vault_id = Some(vault_id.to_owned());
        current.save()
    })
}

pub fn pinned_root() -> Option<String> {
    state().lock().ok()?.as_ref()?.file.root_public_key.clone()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ListOutcome {
    Adopted,
    Unchanged,
    /// The server sent an older list than one a peer proved; its removals stay.
    ServerBehind,
}

/// Applies the server's list. It is authoritative for admissions; a newer list
/// learned from a peer survives only if it is a removal-only extension of it.
pub fn apply_server_list(record: Option<&SignedRecord>) -> ApiResult<ListOutcome> {
    with_state(|current| {
        let Some(root) = current.file.root_public_key.clone() else {
            return Err(ApiError::Unavailable(
                "Unlock sync on this device to verify your devices.".to_owned(),
            ));
        };
        let Some(record) = record else {
            return Ok(ListOutcome::Unchanged);
        };
        let list = DeviceList::verify(record, &root)
            .filter(|list| list.account_id == current.file.account_id)
            .ok_or_else(|| {
                ApiError::Message("Misty sent a device list that didn't verify.".to_owned())
            })?;
        if let Some(existing) = &current.list {
            if existing.version > list.version {
                if current.file.list_source == "peer"
                    && existing.is_removal_only_extension_of(&list)
                {
                    current.file.list_fresh_at = now();
                    current.save()?;
                    return Ok(ListOutcome::ServerBehind);
                }
                if current.file.list_source == "server" {
                    // A server list older than one it already served: keep ours.
                    return Ok(ListOutcome::ServerBehind);
                }
            }
        }
        let changed = current.list.as_ref().map(|existing| existing.version) != Some(list.version);
        current.file.list = Some(record.clone());
        current.file.list_source = "server".to_owned();
        current.file.list_fresh_at = now();
        current.list = Some(list);
        current.save()?;
        Ok(if changed {
            ListOutcome::Adopted
        } else {
            ListOutcome::Unchanged
        })
    })
}

/// Applies a list a peer showed during a LAN handshake: accepted only when it
/// is newer, verifies, and only removes devices.
pub fn apply_peer_list(record: &SignedRecord) -> ApiResult<bool> {
    with_state(|current| {
        let (Some(root), Some(existing)) =
            (current.file.root_public_key.clone(), current.list.as_ref())
        else {
            return Ok(false);
        };
        let Some(list) = DeviceList::verify(record, &root)
            .filter(|list| list.account_id == current.file.account_id)
        else {
            return Ok(false);
        };
        if !list.is_removal_only_extension_of(existing) {
            return Ok(false);
        }
        current.file.list = Some(record.clone());
        current.file.list_source = "peer".to_owned();
        current.file.list_fresh_at = now();
        current.list = Some(list);
        current.save()?;
        Ok(true)
    })
}

pub fn current_list() -> Option<DeviceList> {
    state().lock().ok()?.as_ref()?.list.clone()
}

pub fn list_version() -> u64 {
    current_list().map(|list| list.version).unwrap_or_default()
}

fn fresh(current: &TrustState) -> bool {
    now() - current.file.list_fresh_at <= LIST_FRESHNESS_SECONDS
}

/// Marks the current list fresh after the server or a peer confirmed it.
pub fn confirm_fresh() {
    let _ = with_state(|current| {
        current.file.list_fresh_at = now();
        current.save()
    });
}

/// The added device behind an iroh endpoint, if this device may connect to
/// it now: in the current list, not this device, and the list is fresh.
pub fn trusted_peer(endpoint: &str) -> Option<String> {
    let guard = state().lock().ok()?;
    let current = guard.as_ref()?;
    if !fresh(current) {
        return None;
    }
    // This device's own key is never a peer.
    match current.file.own_endpoint.as_deref() {
        Some(own) if own == endpoint => return None,
        Some(_) => {}
        None => {
            let device = current.list.as_ref()?.device_for_endpoint(endpoint)?;
            return (Some(device) != current.file.server_device_id.as_deref())
                .then(|| device.to_owned());
        }
    }
    current
        .list
        .as_ref()?
        .device_for_endpoint(endpoint)
        .map(str::to_owned)
}

/// Whether this device itself is in the current list.
pub fn self_admitted() -> bool {
    let Ok(guard) = state().lock() else {
        return false;
    };
    let Some(current) = guard.as_ref() else {
        return false;
    };
    match (&current.list, &current.file.server_device_id) {
        (Some(list), Some(id)) => list.admitted_key(id).is_some(),
        _ => false,
    }
}

pub fn own_policy() -> Option<(DevicePolicy, Option<SignedRecord>)> {
    let guard = state().lock().ok()?;
    let current = guard.as_ref()?;
    current
        .file
        .own_policy_state
        .clone()
        .map(|policy| (policy, current.file.own_policy.clone()))
}

pub fn store_own_policy(policy: DevicePolicy, record: SignedRecord) -> ApiResult<()> {
    with_state(|current| {
        current.file.own_policy_state = Some(policy);
        current.file.own_policy = Some(record);
        current.save()
    })
}

/// This device's own enforcement of its signed policy; with none yet, the
/// first-run defaults apply (view files, no clipboard).
pub fn effective_policy() -> DevicePolicy {
    own_policy()
        .map(|(policy, _)| policy)
        .unwrap_or_else(|| DevicePolicy::first(Vec::new()))
}

pub fn remember_addresses(device_id: &str, addresses: &[String]) {
    let _ = with_state(|current| {
        let mut kept: Vec<String> = addresses
            .iter()
            .take(MAX_CACHED_ADDRESSES)
            .cloned()
            .collect();
        kept.dedup();
        if current.file.known_addresses.get(device_id) != Some(&kept) {
            current
                .file
                .known_addresses
                .insert(device_id.to_owned(), kept);
            current.save()?;
        }
        Ok(())
    });
}

pub fn known_addresses(device_id: &str) -> Vec<String> {
    state()
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref()?.file.known_addresses.get(device_id).cloned())
        .unwrap_or_default()
}

/// Forgets everything for this account after the device was removed.
pub fn forget_after_removal() {
    let _ = with_state(|current| {
        current.file.list = None;
        current.list = None;
        current.file.known_addresses.clear();
        current.file.list_fresh_at = 0;
        current.save()
    });
}

/// A device job's grant, checked before this device acts: signed by an added
/// device (or this one), naming this device, covering the scope and the
/// operation, unexpired, and, for another device's request, allowed by this
/// device's own policy.
pub fn verify_job_grant(
    record: &SignedRecord,
    scope_id: &str,
    capability: &str,
    surface: &str,
) -> ApiResult<RunGrant> {
    let denied = || ApiError::Message("device_grant_invalid".to_owned());
    let guard = state().lock().map_err(lock_error)?;
    let current = guard.as_ref().ok_or_else(denied)?;
    let own_id = current.file.server_device_id.clone().ok_or_else(denied)?;
    let requester = RunGrant::claimed_requester(record).ok_or_else(denied)?;
    let requester_key = if requester == own_id {
        crate::infra::device_identity::DeviceIdentity::load(
            &current.file.account_id,
            &current.file.local_device_id,
        )
        .map_err(|_| denied())?
        .public_key()
    } else {
        if !fresh(current) {
            return Err(denied());
        }
        current
            .list
            .as_ref()
            .and_then(|list| list.admitted_key(&requester))
            .ok_or_else(denied)?
            .to_owned()
    };
    let grant = RunGrant::verify(record, &requester_key, now()).ok_or_else(denied)?;
    if grant.account_id != current.file.account_id
        || grant.requester_device_id != requester
        || grant.target_device_id != own_id
        || !grant.allows(scope_id, capability)
    {
        return Err(denied());
    }
    if requester != own_id {
        let policy = current
            .file
            .own_policy_state
            .clone()
            .unwrap_or_else(|| DevicePolicy::first(Vec::new()));
        let allowed = policy.allows_surface(surface)
            && (surface != "folders" || policy.shares_folder(scope_id));
        if !allowed {
            return Err(denied());
        }
    }
    Ok(grant)
}

#[cfg(test)]
#[path = "device_trust_tests.rs"]
mod tests;
