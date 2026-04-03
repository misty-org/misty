use std::sync::Mutex;

use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use rand::RngCore;

use crate::error::{ApiError, ApiResult};

const RCLONE_CONFIG_SERVICE: &str = "misty.rclone.config";
const RCLONE_CONFIG_ACCOUNT: &str = "default";
enum PasswordCache {
    Unchecked,
    Missing,
    Present(String),
    Unavailable(String),
}

static RCLONE_CONFIG_PASSWORD_CACHE: Mutex<PasswordCache> = Mutex::new(PasswordCache::Unchecked);

pub fn rclone_config_password() -> Option<String> {
    rclone_config_password_result().ok().flatten()
}

fn rclone_config_password_result() -> ApiResult<Option<String>> {
    let mut cache = RCLONE_CONFIG_PASSWORD_CACHE.lock().map_err(|_| {
        ApiError::Message("Could not access the Misty config credential cache.".to_owned())
    })?;
    match &*cache {
        PasswordCache::Present(password) => return Ok(Some(password.clone())),
        PasswordCache::Missing => return Ok(None),
        PasswordCache::Unavailable(error) => return Err(ApiError::Message(error.clone())),
        PasswordCache::Unchecked => {}
    }

    match find_generic_password(RCLONE_CONFIG_SERVICE, RCLONE_CONFIG_ACCOUNT) {
        Ok(Some(password)) => {
            *cache = PasswordCache::Present(password.clone());
            Ok(Some(password))
        }
        Ok(None) => {
            *cache = PasswordCache::Missing;
            Ok(None)
        }
        Err(error) => {
            // Do not hammer macOS Keychain after the user denies or dismisses
            // an access request. An explicit repair action can still write a
            // value and replace this process-local negative cache.
            let message = error.to_string();
            *cache = PasswordCache::Unavailable(message.clone());
            Err(ApiError::Message(message))
        }
    }
}

pub fn has_rclone_config_password() -> bool {
    rclone_config_password()
        .map(|password| !password.trim().is_empty())
        .unwrap_or(false)
}

pub fn ensure_rclone_config_password() -> ApiResult<String> {
    if let Some(password) =
        rclone_config_password_result()?.filter(|value| !value.trim().is_empty())
    {
        return Ok(password);
    }
    let password = generate_password();
    store_generic_password(RCLONE_CONFIG_SERVICE, RCLONE_CONFIG_ACCOUNT, &password)?;
    cache_rclone_config_password(password.clone());
    Ok(password)
}

pub fn store_rclone_config_password(password: &str) -> ApiResult<()> {
    if password.trim().is_empty() {
        return Err(ApiError::Message(
            "Config password cannot be empty.".to_owned(),
        ));
    }
    store_generic_password(RCLONE_CONFIG_SERVICE, RCLONE_CONFIG_ACCOUNT, password)?;
    cache_rclone_config_password(password.to_owned());
    Ok(())
}

fn generate_password() -> String {
    let mut bytes = [0_u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    STANDARD_NO_PAD.encode(bytes)
}

fn cache_rclone_config_password(password: String) {
    if let Ok(mut cache) = RCLONE_CONFIG_PASSWORD_CACHE.lock() {
        *cache = PasswordCache::Present(password);
    }
}

#[cfg(target_os = "macos")]
fn find_generic_password(service: &str, account: &str) -> ApiResult<Option<String>> {
    let entry = keyring::Entry::new(service, account)
        .map_err(|error| ApiError::Message(format!("Could not access macOS Keychain: {error}")))?;
    match entry.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(ApiError::Message(format!(
            "Could not read Misty config password from macOS Keychain: {error}"
        ))),
    }
}

#[cfg(not(target_os = "macos"))]
fn find_generic_password(_service: &str, _account: &str) -> ApiResult<Option<String>> {
    Err(ApiError::Message(
        "Native config unlock is only available on macOS right now.".to_owned(),
    ))
}

#[cfg(target_os = "macos")]
fn store_generic_password(service: &str, account: &str, password: &str) -> ApiResult<()> {
    let entry = keyring::Entry::new(service, account)
        .map_err(|error| ApiError::Message(format!("Could not access macOS Keychain: {error}")))?;
    entry.set_password(password).map_err(|error| {
        ApiError::Message(format!(
            "Could not store Misty config password in macOS Keychain: {error}"
        ))
    })
}

#[cfg(not(target_os = "macos"))]
fn store_generic_password(_service: &str, _account: &str, _password: &str) -> ApiResult<()> {
    Err(ApiError::Message(
        "Native config hardening is only available on macOS right now.".to_owned(),
    ))
}
