use std::process::Command;

use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use rand::RngCore;

use crate::error::{ApiError, ApiResult};

const RCLONE_CONFIG_SERVICE: &str = "misty.rclone.config";
const RCLONE_CONFIG_ACCOUNT: &str = "default";

pub fn rclone_config_password() -> Option<String> {
    find_generic_password(RCLONE_CONFIG_SERVICE, RCLONE_CONFIG_ACCOUNT).ok()
}

pub fn has_rclone_config_password() -> bool {
    rclone_config_password()
        .map(|password| !password.trim().is_empty())
        .unwrap_or(false)
}

pub fn ensure_rclone_config_password() -> ApiResult<String> {
    if let Some(password) = rclone_config_password().filter(|value| !value.trim().is_empty()) {
        return Ok(password);
    }
    let password = generate_password();
    store_generic_password(RCLONE_CONFIG_SERVICE, RCLONE_CONFIG_ACCOUNT, &password)?;
    Ok(password)
}

pub fn store_rclone_config_password(password: &str) -> ApiResult<()> {
    if password.trim().is_empty() {
        return Err(ApiError::Message(
            "Config password cannot be empty.".to_owned(),
        ));
    }
    store_generic_password(RCLONE_CONFIG_SERVICE, RCLONE_CONFIG_ACCOUNT, password)
}

fn generate_password() -> String {
    let mut bytes = [0_u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    STANDARD_NO_PAD.encode(bytes)
}

#[cfg(target_os = "macos")]
fn find_generic_password(service: &str, account: &str) -> ApiResult<String> {
    let output = Command::new("/usr/bin/security")
        .args(["find-generic-password", "-w", "-s", service, "-a", account])
        .output()
        .map_err(|error| ApiError::Message(format!("Could not read macOS Keychain: {error}")))?;
    if !output.status.success() {
        return Err(ApiError::Message(
            "Misty config password was not found in macOS Keychain.".to_owned(),
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .trim_end()
        .to_owned())
}

#[cfg(not(target_os = "macos"))]
fn find_generic_password(_service: &str, _account: &str) -> ApiResult<String> {
    Err(ApiError::Message(
        "Native config unlock is only available on macOS right now.".to_owned(),
    ))
}

#[cfg(target_os = "macos")]
fn store_generic_password(service: &str, account: &str, password: &str) -> ApiResult<()> {
    let status = Command::new("/usr/bin/security")
        .args([
            "add-generic-password",
            "-U",
            "-s",
            service,
            "-a",
            account,
            "-w",
            password,
        ])
        .status()
        .map_err(|error| {
            ApiError::Message(format!("Could not write macOS Keychain item: {error}"))
        })?;
    if status.success() {
        Ok(())
    } else {
        Err(ApiError::Message(
            "Could not store Misty config password in macOS Keychain.".to_owned(),
        ))
    }
}

#[cfg(not(target_os = "macos"))]
fn store_generic_password(_service: &str, _account: &str, _password: &str) -> ApiResult<()> {
    Err(ApiError::Message(
        "Native config hardening is only available on macOS right now.".to_owned(),
    ))
}
