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
