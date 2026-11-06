//! This session's standing and its own policy, and the grants it checks before
//! acting on a device job.
use super::*;

/// Whether this session is trusted, which it is as soon as it's registered.
pub fn self_admitted() -> bool {
    server_device_id().is_some()
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

/// Forgets this account's registration after this session was removed.
pub fn forget_after_removal() {
    let _ = with_state(|current| {
        current.file.server_device_id = None;
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
