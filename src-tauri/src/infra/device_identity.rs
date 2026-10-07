//! One device key for sync trust, agents and LAN file sharing
//! (docs/design/devices/BRIEF.md). It is the Connected Devices endpoint seed
//! in the OS keychain, so the device's iroh endpoint ID is its public key. The
//! private key never leaves native code: every signature here prefixes an
//! allow-listed domain, so one made for one purpose is never valid for another.
use base64::{engine::general_purpose::STANDARD, Engine as _};
use ed25519_dalek::{Signer, SigningKey, Verifier, VerifyingKey};

use crate::{
    error::{ApiError, ApiResult},
    infra::peer_identity,
};

pub const REQUEST_DOMAIN: &str = "misty.device.request.v1";
pub const REGISTER_DOMAIN: &str = "misty.device.register.v1";
pub const CHANNEL_DOMAIN: &str = "misty.device.channel.v1";
pub const POLICY_DOMAIN: &str = "misty.device.policy.v1";
pub const RUN_GRANT_DOMAIN: &str = "misty.device.run-grant.v1";
pub const ADMISSION_DOMAIN: &str = "misty.device.admission.v1";

/// Records this key may sign as JSON arrays, by their leading domain.
const RECORD_DOMAINS: [&str; 4] = [
    REGISTER_DOMAIN,
    POLICY_DOMAIN,
    RUN_GRANT_DOMAIN,
    ADMISSION_DOMAIN,
];

pub struct DeviceIdentity {
    signing: SigningKey,
}

impl DeviceIdentity {
    /// Loads (or creates) this install's key for an account.
    pub fn load(account_id: &str, local_device_id: &str) -> ApiResult<Self> {
        let seed = peer_identity::load_or_create(account_id, local_device_id)?;
        Ok(Self {
            signing: SigningKey::from_bytes(&seed),
        })
    }

    pub fn public_key(&self) -> String {
        STANDARD.encode(self.signing.verifying_key().as_bytes())
    }

    /// The iroh endpoint ID: the same public key, in hex.
    pub fn endpoint_id(&self) -> String {
        hex::encode(self.signing.verifying_key().as_bytes())
    }

    /// Signs a record whose bytes are a JSON array starting with an allowed
    /// domain string.
    pub fn sign_record(&self, payload: &[u8]) -> ApiResult<String> {
        let allowed = RECORD_DOMAINS
            .iter()
            .any(|domain| payload.starts_with(format!("[\"{domain}\",").as_bytes()));
        if !allowed || payload.len() > 65536 {
            return Err(ApiError::Message(
                "This device does not sign that record.".to_owned(),
            ));
        }
        Ok(STANDARD.encode(self.signing.sign(payload).to_bytes()))
    }

    /// Signs one HTTP request's canonical form for the server.
    pub fn sign_request(&self, canonical: &str) -> String {
        let message = format!("{REQUEST_DOMAIN}\n{canonical}");
        STANDARD.encode(self.signing.sign(message.as_bytes()).to_bytes())
    }

    /// Answers the device channel's challenge.
    pub fn channel_proof(
        &self,
        account_id: &str,
        device_id: &str,
        instance: &str,
        challenge: &str,
    ) -> ApiResult<String> {
        let message =
            serde_json::to_vec(&(CHANNEL_DOMAIN, account_id, device_id, instance, challenge))?;
        Ok(STANDARD.encode(self.signing.sign(&message).to_bytes()))
    }

    /// Proves possession of this key when registering it.
    pub fn registration_proof(&self, account_id: &str, issued_at: i64) -> ApiResult<String> {
        let message = serde_json::to_vec(&(
            REGISTER_DOMAIN,
            account_id,
            self.public_key(),
            self.endpoint_id(),
            issued_at,
        ))?;
        self.sign_record(&message)
    }
}

/// Verifies a device-signed record against a base64 public key.
pub fn verify_device_signature(public_key: &str, payload: &[u8], signature: &str) -> bool {
    let (Ok(key), Ok(signature)) = (STANDARD.decode(public_key), STANDARD.decode(signature)) else {
        return false;
    };
    let (Ok(key), Ok(signature)) = (<[u8; 32]>::try_from(key), <[u8; 64]>::try_from(signature))
    else {
        return false;
    };
    let Ok(key) = VerifyingKey::from_bytes(&key) else {
        return false;
    };
    key.verify(payload, &ed25519_dalek::Signature::from_bytes(&signature))
        .is_ok()
}

/// The canonical request form the server checks: method, full path, time,
/// nonce and body digest.
pub fn canonical_request(
    method: &str,
    path: &str,
    timestamp: &str,
    nonce: &str,
    body_digest: &str,
) -> String {
    format!(
        "{}\n{}\n{}\n{}\n{}",
        method.to_uppercase(),
        path,
        timestamp,
        nonce,
        body_digest.to_lowercase()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signs_only_allowed_record_domains() {
        let identity = DeviceIdentity {
            signing: SigningKey::from_bytes(&[3; 32]),
        };
        let policy = serde_json::to_vec(&(POLICY_DOMAIN, "acct", 1)).unwrap();
        let signature = identity.sign_record(&policy).unwrap();
        assert!(verify_device_signature(
            &identity.public_key(),
            &policy,
            &signature
        ));
        for domain in [
            "misty.device.grant.v2",
            "misty.device.list.v1",
            "misty.sync.device.v1",
        ] {
            let payload = serde_json::to_vec(&(domain, "acct")).unwrap();
            assert!(identity.sign_record(&payload).is_err());
        }
        assert_eq!(identity.endpoint_id().len(), 64);
    }
}
