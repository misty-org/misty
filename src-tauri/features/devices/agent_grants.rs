//! What an agent may reach on this computer. A run is signed for and
//! checked here, by a key of this computer's own that no account or server is part of, so a run works
//! signed out and with the server blocked. Native code signs when a person's window asks, and checks
//! before every action, so nothing a page or the model sends can widen a grant.
use super::{
    identity::DeviceIdentity,
    records::{RunGrant, SignedRecord},
};

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or_default()
}

/// What a grant files under. It's fixed, so a chat keeps its shell workspace across signing in and out.
pub const AGENT_SCOPE: &str = "local";
/// What a grant lasts. The app asks again for each run.
const GRANT_SECONDS: i64 = 6 * 3600;

pub struct GrantRequest {
    pub agent_id: String,
    pub chat_key: String,
    pub capabilities: Vec<String>,
    pub scopes: Vec<String>,
}

/// Signs one grant, from this computer to itself.
pub fn sign(device_id: &str, request: GrantRequest) -> Result<SignedRecord, String> {
    let identity =
        DeviceIdentity::load(AGENT_SCOPE, device_id).map_err(|error| error.to_string())?;
    sign_with(&identity, device_id, request, now())
}

fn sign_with(
    identity: &DeviceIdentity,
    device_id: &str,
    request: GrantRequest,
    issued_at: i64,
) -> Result<SignedRecord, String> {
    if request.capabilities.is_empty()
        || request.scopes.is_empty()
        || request.capabilities.len() > 64
        || request.scopes.len() > 64
    {
        return Err("That grant isn't valid.".to_owned());
    }
    let grant = RunGrant {
        account_id: AGENT_SCOPE.to_owned(),
        grant_id: format!("rungrant_{}", uuid::Uuid::new_v4()),
        requester_device_id: device_id.to_owned(),
        target_device_id: device_id.to_owned(),
        agent_id: request.agent_id,
        chat_key: request.chat_key,
        capabilities: request.capabilities,
        scopes: request.scopes,
        issued_at,
        expires_at: issued_at + GRANT_SECONDS,
    };
    let payload = grant.payload().map_err(|error| error.to_string())?;
    let signature = identity
        .sign_record(&payload)
        .map_err(|error| error.to_string())?;
    Ok(SignedRecord::new(&payload, signature))
}

/// A job's grant, checked before this computer acts: signed by this computer, naming it, covering the
/// scope and the operation, and unexpired.
pub fn verify(
    device_id: &str,
    record: &SignedRecord,
    scope_id: &str,
    capability: &str,
) -> Result<RunGrant, String> {
    let identity = DeviceIdentity::load(AGENT_SCOPE, device_id)
        .map_err(|_| "device_grant_invalid".to_owned())?;
    check(
        &identity.public_key(),
        device_id,
        record,
        scope_id,
        capability,
        now(),
    )
}

fn check(
    public_key: &str,
    device_id: &str,
    record: &SignedRecord,
    scope_id: &str,
    capability: &str,
    at: i64,
) -> Result<RunGrant, String> {
    let denied = || "device_grant_invalid".to_owned();
    let grant = RunGrant::verify(record, public_key, at).ok_or_else(denied)?;
    if grant.account_id != AGENT_SCOPE
        || grant.requester_device_id != device_id
        || grant.target_device_id != device_id
        || !grant.allows(scope_id, capability)
    {
        return Err(denied());
    }
    Ok(grant)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DEVICE: &str = "device_0123456789abcdef0123456789abcdef";

    fn identity() -> DeviceIdentity {
        DeviceIdentity::from_bytes([7; 32])
    }

    fn grant() -> GrantRequest {
        GrantRequest {
            agent_id: "agent".into(),
            chat_key: "chat".into(),
            capabilities: vec!["shell.run".into()],
            scopes: vec!["workspace:one".into()],
        }
    }

    #[test]
    fn a_grant_covers_exactly_what_it_names() {
        let record = sign_with(&identity(), DEVICE, grant(), 1000).unwrap();
        let key = identity().public_key();
        let checked = check(&key, DEVICE, &record, "workspace:one", "shell.run", 1000).unwrap();
        assert_eq!(checked.chat_key, "chat");
        assert_eq!(checked.account_id, AGENT_SCOPE);
        assert!(check(&key, DEVICE, &record, "workspace:other", "shell.run", 1000).is_err());
        assert!(check(&key, DEVICE, &record, "workspace:one", "folder.send", 1000).is_err());
    }

    #[test]
    fn another_key_a_late_check_or_another_computer_is_refused() {
        let record = sign_with(&identity(), DEVICE, grant(), 1000).unwrap();
        let key = identity().public_key();
        let other = DeviceIdentity::from_bytes([9; 32]).public_key();
        assert!(check(&other, DEVICE, &record, "workspace:one", "shell.run", 1000).is_err());
        assert!(check(
            &key,
            DEVICE,
            &record,
            "workspace:one",
            "shell.run",
            1000 + GRANT_SECONDS + 1
        )
        .is_err());
        let elsewhere = "device_ffffffffffffffffffffffffffffffff";
        assert!(check(&key, elsewhere, &record, "workspace:one", "shell.run", 1000).is_err());
    }

    #[test]
    fn an_empty_grant_is_never_signed() {
        let empty = GrantRequest {
            scopes: Vec::new(),
            ..grant()
        };
        assert!(sign_with(&identity(), DEVICE, empty, 1000).is_err());
    }
}
