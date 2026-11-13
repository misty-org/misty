//! This computer's key for agent run grants, kept in the credential store. The private key never
//! leaves native code: every signature here prefixes an allow-listed domain, so one made for one
//! purpose is never valid for another.
use base64::{engine::general_purpose::STANDARD, Engine as _};
use ed25519_dalek::{Signer, SigningKey, Verifier, VerifyingKey};

use crate::app::error::{ApiError, ApiResult};
use crate::devices::key;

pub const RUN_GRANT_DOMAIN: &str = "misty.device.run-grant.v1";

/// Records this key may sign as JSON arrays, by their leading domain.
const RECORD_DOMAINS: [&str; 1] = [RUN_GRANT_DOMAIN];

pub struct DeviceIdentity {
    signing: SigningKey,
}

impl DeviceIdentity {
    /// Loads (or creates) this install's key for an account.
    pub fn load(account_id: &str, local_device_id: &str) -> ApiResult<Self> {
        let seed = key::load_or_create(account_id, local_device_id)?;
        Ok(Self {
            signing: SigningKey::from_bytes(&seed),
        })
    }

    #[cfg(test)]
    pub fn from_bytes(seed: [u8; 32]) -> Self {
        Self {
            signing: SigningKey::from_bytes(&seed),
        }
    }

    pub fn public_key(&self) -> String {
        STANDARD.encode(self.signing.verifying_key().as_bytes())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signs_only_allowed_record_domains() {
        let identity = DeviceIdentity {
            signing: SigningKey::from_bytes(&[3; 32]),
        };
        let grant = serde_json::to_vec(&(RUN_GRANT_DOMAIN, "acct", 1)).unwrap();
        let signature = identity.sign_record(&grant).unwrap();
        assert!(verify_device_signature(
            &identity.public_key(),
            &grant,
            &signature
        ));
        for domain in [
            "misty.device.grant.v2",
            "misty.device.list.v1",
            "misty.device.admission.v1",
            "misty.device.register.v1",
            "misty.device.policy.v1",
            "misty.sync.device.v1",
        ] {
            let payload = serde_json::to_vec(&(domain, "acct")).unwrap();
            assert!(identity.sign_record(&payload).is_err());
        }
    }
}
