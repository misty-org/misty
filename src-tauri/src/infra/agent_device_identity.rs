use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
};

use crate::{
    error::{ApiError, ApiResult},
    infra::credential_store,
};

const DEVICE_IDENTITY_SERVICE: &str = "com.misty.agents.device-identity";
type DeviceIdentityCache = HashMap<String, Result<Option<String>, String>>;

static DEVICE_IDENTITY_CACHE: LazyLock<Mutex<DeviceIdentityCache>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn load(local_device_id: &str) -> ApiResult<Option<String>> {
    validate_device_id(local_device_id)?;
    let mut cache = DEVICE_IDENTITY_CACHE.lock().map_err(|_| {
        ApiError::Message("Could not access the agent device credential cache.".to_owned())
    })?;
    if let Some(cached) = cache.get(local_device_id) {
        return cached.clone().map_err(ApiError::Message);
    }
    let loaded = credential_store::load(DEVICE_IDENTITY_SERVICE, local_device_id)
        .map_err(|error| format!("Could not read the agent device credential: {error}"));
    cache.insert(local_device_id.to_owned(), loaded.clone());
    loaded.map_err(ApiError::Message)
}

pub fn store(local_device_id: &str, encoded_identity: &str) -> ApiResult<()> {
    validate_device_id(local_device_id)?;
    if encoded_identity.len() < 80 || encoded_identity.len() > 4096 {
        return Err(ApiError::Message(
            "Agent device identity is invalid.".to_owned(),
        ));
    }
    credential_store::store(DEVICE_IDENTITY_SERVICE, local_device_id, encoded_identity).map_err(
        |error| {
            ApiError::Message(format!(
                "Could not secure the agent device credential: {error}"
            ))
        },
    )?;
    if let Ok(mut cache) = DEVICE_IDENTITY_CACHE.lock() {
        cache.insert(
            local_device_id.to_owned(),
            Ok(Some(encoded_identity.to_owned())),
        );
    }
    Ok(())
}

fn validate_device_id(value: &str) -> ApiResult<()> {
    if (value.len() == 39 || value.len() == 43)
        && value.starts_with("device_")
        && value[7..]
            .chars()
            .all(|character| character.is_ascii_hexdigit() || character == '-')
    {
        Ok(())
    } else {
        Err(ApiError::Message("Agent device id is invalid.".to_owned()))
    }
}
