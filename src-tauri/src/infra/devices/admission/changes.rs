//! Changes to the device list and records this device signs: adding itself,
//! removing and renaming devices, its policy and run grants.
use super::*;

/// Path A: with the vault open (sync password and secret, or a key this device
/// saved), the device signs its own grant and the list that adds it.
pub async fn admit_self(context: &DeviceContext) -> Result<(), String> {
    let own = context.require_registered()?.to_owned();
    let (root, scope, sync_device_id) = admission_authority(context)
        .await
        .ok_or("Unlock sync on this device to add it.")?;
    let derived = root.public_key().map_err(|error| error.to_string())?;
    trust::pin_root(&derived, &scope.vault_id).map_err(|error| error.to_string())?;
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
                trust::apply_server_list(Some(&new_list)).map_err(|error| error.to_string())?;
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
        trust::apply_server_list(Some(&record)).map_err(|error| error.to_string())?;
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
