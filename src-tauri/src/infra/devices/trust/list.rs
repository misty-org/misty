//! The device list this device holds, its own policy, and the grants it checks
//! before acting on a device job.
use super::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ListOutcome {
    Adopted,
    Unchanged,
    /// The server sent an older list than one already held; its removals stay.
    ServerBehind,
}

/// Applies the server's list. It is authoritative for admissions, but never
/// rolls back a newer list this device already holds (older builds also
/// learned removal-only lists from peers; those removals stay).
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

pub fn current_list() -> Option<DeviceList> {
    state().lock().ok()?.as_ref()?.list.clone()
}

pub fn list_version() -> u64 {
    current_list().map(|list| list.version).unwrap_or_default()
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

/// Forgets everything for this account after the device was removed.
pub fn forget_after_removal() {
    let _ = with_state(|current| {
        current.file.list = None;
        current.list = None;
        current.file.list_fresh_at = 0;
        current.save()
    });
}

/// A device job's grant, checked before this device acts: signed by this
/// device itself, naming it, covering the scope and the operation, and
/// unexpired. An agent run works on the device the person sent it from, so a
/// grant another device signed is refused.
pub fn verify_job_grant(
    record: &SignedRecord,
    scope_id: &str,
    capability: &str,
) -> ApiResult<RunGrant> {
    let denied = || ApiError::Message("device_grant_invalid".to_owned());
    let guard = state().lock().map_err(lock_error)?;
    let current = guard.as_ref().ok_or_else(denied)?;
    let own_id = current.file.server_device_id.clone().ok_or_else(denied)?;
    let requester = RunGrant::claimed_requester(record).ok_or_else(denied)?;
    if requester != own_id {
        return Err(denied());
    }
    let own_key = crate::infra::devices::identity::DeviceIdentity::load(
        &current.file.account_id,
        &current.file.local_device_id,
    )
    .map_err(|_| denied())?
    .public_key();
    let grant = RunGrant::verify(record, &own_key, now()).ok_or_else(denied)?;
    if grant.account_id != current.file.account_id
        || grant.requester_device_id != own_id
        || grant.target_device_id != own_id
        || !grant.allows(scope_id, capability)
    {
        return Err(denied());
    }
    Ok(grant)
}
