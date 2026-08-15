use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use iroh::SecretKey;

use crate::error::{ApiError, ApiResult};

const PEER_IDENTITY_SERVICE: &str = "com.misty.connected-devices.endpoint";
static PEER_IDENTITY_CACHE: LazyLock<Mutex<HashMap<String, [u8; 32]>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn load_or_create(account_id: &str, local_device_id: &str) -> ApiResult<SecretKey> {
    validate_identity_scope(account_id, local_device_id)?;
    let scope = format!("{account_id}:{local_device_id}");
    if let Some(bytes) = PEER_IDENTITY_CACHE
        .lock()
        .ok()
        .and_then(|cache| cache.get(&scope).copied())
    {
        return Ok(SecretKey::from_bytes(&bytes));
    }
    let entry = keyring::Entry::new(PEER_IDENTITY_SERVICE, &scope).map_err(|error| {
        ApiError::Message(format!(
            "Could not access the Connected Devices identity: {error}"
        ))
    })?;
    let bytes = match entry.get_password() {
        Ok(encoded) => {
            let decoded = STANDARD_NO_PAD.decode(encoded).map_err(|_| {
                ApiError::Message("The Connected Devices identity is damaged.".to_owned())
            })?;
            decoded.try_into().map_err(|_| {
                ApiError::Message("The Connected Devices identity is damaged.".to_owned())
            })?
        }
        Err(keyring::Error::NoEntry) => {
            let key = SecretKey::generate();
            let bytes = key.to_bytes();
            entry
                .set_password(&STANDARD_NO_PAD.encode(bytes))
                .map_err(|error| {
                    ApiError::Message(format!(
                        "Could not secure the Connected Devices identity: {error}"
                    ))
                })?;
            bytes
        }
        Err(error) => {
            return Err(ApiError::Message(format!(
                "Could not read the Connected Devices identity: {error}"
            )))
        }
    };
    if let Ok(mut cache) = PEER_IDENTITY_CACHE.lock() {
        cache.insert(scope, bytes);
    }
    Ok(SecretKey::from_bytes(&bytes))
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
