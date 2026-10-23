//! This device's private key seed, kept in the credential store and cached in
//! memory. Its public half is the device's identity on the account.
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use rand::RngCore;

use crate::{
    error::{ApiError, ApiResult},
    infra::credential_store,
};

/// The service name predates the device key's current use; it stays so
/// existing devices keep their identity.
const DEVICE_KEY_SERVICE: &str = "com.misty.connected-devices.endpoint";
static DEVICE_KEY_CACHE: LazyLock<Mutex<HashMap<String, [u8; 32]>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn load_or_create(account_id: &str, local_device_id: &str) -> ApiResult<[u8; 32]> {
    validate_identity_scope(account_id, local_device_id)?;
    let scope = format!("{account_id}:{local_device_id}");
    if let Some(bytes) = DEVICE_KEY_CACHE
        .lock()
        .ok()
        .and_then(|cache| cache.get(&scope).copied())
    {
        return Ok(bytes);
    }
    let bytes = match credential_store::load(DEVICE_KEY_SERVICE, &scope).map_err(|error| {
        ApiError::Message(format!("Could not read this device's identity: {error}"))
    })? {
        Some(encoded) => {
            let decoded = STANDARD_NO_PAD
                .decode(encoded)
                .map_err(|_| ApiError::Message("This device's identity is damaged.".to_owned()))?;
            decoded
                .try_into()
                .map_err(|_| ApiError::Message("This device's identity is damaged.".to_owned()))?
        }
        None => {
            let mut bytes = [0u8; 32];
            rand::thread_rng().fill_bytes(&mut bytes);
            credential_store::store(DEVICE_KEY_SERVICE, &scope, &STANDARD_NO_PAD.encode(bytes))
                .map_err(|error| {
                    ApiError::Message(format!("Could not secure this device's identity: {error}"))
                })?;
            bytes
        }
    };
    if let Ok(mut cache) = DEVICE_KEY_CACHE.lock() {
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
            "This device's identity scope is invalid.".to_owned(),
        ))
    }
}
