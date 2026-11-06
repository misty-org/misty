//! What this session signs: its policy and run grants.
use super::*;

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
    let previous = trust::own_policy()
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
    trust::store_own_policy(policy.clone(), record.clone()).map_err(|error| error.to_string())?;
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
    chat_key: &str,
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
        chat_key: chat_key.to_owned(),
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
