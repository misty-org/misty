use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use hkdf::Hkdf;
use rand::RngCore;
use sha2::Sha256;

use crate::{
    error::{ApiError, ApiResult},
    infra::credential_store,
};

const PEER_IDENTITY_SERVICE: &str = "com.misty.connected-devices.endpoint";
static PEER_IDENTITY_CACHE: LazyLock<Mutex<HashMap<String, [u8; 32]>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn load_or_create(account_id: &str, local_device_id: &str) -> ApiResult<[u8; 32]> {
    validate_identity_scope(account_id, local_device_id)?;
    let scope = format!("{account_id}:{local_device_id}");
    if let Some(bytes) = PEER_IDENTITY_CACHE
        .lock()
        .ok()
        .and_then(|cache| cache.get(&scope).copied())
    {
        return Ok(bytes);
    }
    let bytes = match credential_store::load(PEER_IDENTITY_SERVICE, &scope).map_err(|error| {
        ApiError::Message(format!(
            "Could not read the Connected Devices identity: {error}"
        ))
    })? {
        Some(encoded) => {
            let decoded = STANDARD_NO_PAD.decode(encoded).map_err(|_| {
                ApiError::Message("The Connected Devices identity is damaged.".to_owned())
            })?;
            decoded.try_into().map_err(|_| {
                ApiError::Message("The Connected Devices identity is damaged.".to_owned())
            })?
        }
        None => {
            let mut bytes = [0u8; 32];
            rand::thread_rng().fill_bytes(&mut bytes);
            credential_store::store(
                PEER_IDENTITY_SERVICE,
                &scope,
                &STANDARD_NO_PAD.encode(bytes),
            )
            .map_err(|error| {
                ApiError::Message(format!(
                    "Could not secure the Connected Devices identity: {error}"
                ))
            })?;
            bytes
        }
    };
    if let Ok(mut cache) = PEER_IDENTITY_CACHE.lock() {
        cache.insert(scope, bytes);
    }
    Ok(bytes)
}

fn validate_identity_scope(account_id: &str, device_id: &str) -> ApiResult<()> {
    let valid_account = (1..=128).contains(&account_id.len())
        && account_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "_-".contains(character));
    let valid_device = device_id.starts_with("device_")
        && (14..=80).contains(&device_id.len())
        && device_id[7..]
            .chars()
            .all(|character| character.is_ascii_hexdigit() || character == '-');
    if valid_account && valid_device {
        Ok(())
    } else {
        Err(ApiError::Message(
            "Connected Devices identity scope is invalid.".to_owned(),
        ))
    }
}

/// Personal pairing keys stay in the credential store. A Space worker receives
/// only a domain-separated child key for its deployment and installation.
#[derive(Clone, Copy)]
pub(crate) struct SpacePeerIdentity<'a> {
    pub deployment: &'a str,
    pub account_id: &'a str,
    pub device_id: &'a str,
    pub space_id: &'a str,
    pub installed_version: &'a str,
    pub authority_generation: i64,
}
impl SpacePeerIdentity<'_> {
    fn info(&self) -> ApiResult<Vec<u8>> {
        validate_identity_scope(self.account_id, self.device_id)?;
        if self.deployment.len() > 4096
            || self.space_id.is_empty()
            || self.space_id.len() > 128
            || !self
                .space_id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"_-".contains(&c))
            || self.installed_version.is_empty()
            || self.installed_version.len() > 128
            || self.authority_generation < 1
        {
            return Err(ApiError::Message(
                "Invalid Space peer identity scope.".into(),
            ));
        }
        let url = url::Url::parse(self.deployment)
            .map_err(|_| ApiError::Message("Invalid peer deployment.".into()))?;
        if !matches!(url.scheme(), "https" | "http")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(ApiError::Message("Invalid peer deployment.".into()));
        }
        Ok(serde_json::to_vec(&(
            url.as_str().trim_end_matches('/'),
            self.account_id,
            self.device_id,
            self.space_id,
            "files",
            self.installed_version,
            self.authority_generation,
        ))?)
    }
}
pub(crate) fn load_for_space(scope: SpacePeerIdentity<'_>) -> ApiResult<[u8; 32]> {
    let info = scope.info()?;
    let root = load_or_create(scope.account_id, scope.device_id)?;
    derive_space_key(&root, &info)
}
fn derive_space_key(root: &[u8; 32], info: &[u8]) -> ApiResult<[u8; 32]> {
    let mut output = [0u8; 32];
    Hkdf::<Sha256>::new(Some(b"misty-space-peer-endpoint/v2"), root)
        .expand(info, &mut output)
        .map_err(|_| ApiError::Message("Could not derive Space peer identity.".into()))?;
    Ok(output)
}
#[cfg(test)]
mod space_identity_tests {
    use super::*;
    #[test]
    fn keys_are_stable_and_isolated_without_changing_the_personal_root() {
        let root = [7u8; 32];
        let scope = SpacePeerIdentity {
            deployment: "https://misty.test/",
            account_id: "member",
            device_id: "device_1234567890abcdef",
            space_id: "family",
            installed_version: "1.2.3",
            authority_generation: 1,
        };
        let key = derive_space_key(&root, &scope.info().unwrap()).unwrap();
        assert_eq!(
            key,
            derive_space_key(&root, &scope.info().unwrap()).unwrap()
        );
        assert_eq!(root, [7u8; 32]);
        assert_ne!(key, root);
        assert_eq!(
            key,
            derive_space_key(
                &root,
                &SpacePeerIdentity {
                    deployment: "https://misty.test",
                    ..scope
                }
                .info()
                .unwrap()
            )
            .unwrap()
        );
        for other in [
            SpacePeerIdentity {
                deployment: "https://other.test",
                ..scope
            },
            SpacePeerIdentity {
                account_id: "another-member",
                ..scope
            },
            SpacePeerIdentity {
                device_id: "device_abcdef1234567890",
                ..scope
            },
            SpacePeerIdentity {
                space_id: "work",
                ..scope
            },
            SpacePeerIdentity {
                installed_version: "1.2.4",
                ..scope
            },
            SpacePeerIdentity {
                authority_generation: 2,
                ..scope
            },
        ] {
            assert_ne!(
                key,
                derive_space_key(&root, &other.info().unwrap()).unwrap()
            );
        }
        assert!(SpacePeerIdentity {
            deployment: "https://user:password@misty.test",
            ..scope
        }
        .info()
        .is_err());
        assert!(SpacePeerIdentity {
            authority_generation: 0,
            ..scope
        }
        .info()
        .is_err());
        assert!(SpacePeerIdentity {
            space_id: "",
            ..scope
        }
        .info()
        .is_err());
    }
}
