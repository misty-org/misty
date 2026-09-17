//! Shared file storage for native credentials; never contacts macOS Keychain.
use sha2::{Digest, Sha256};
use std::io;

pub type CredentialStoreError = io::Error;

pub fn load(service: &str, account: &str) -> io::Result<Option<String>> {
    if let Some(value) = misty_credential_store::load(service, account)? {
        return Ok(Some(value));
    }
    // Import existing debug-build files, without opening an OS credential vault.
    #[cfg(target_os = "macos")]
    if let Some(root) = dirs::data_local_dir() {
        let profile = std::env::var("MISTY_PROFILE")
            .or_else(|_| std::env::var("MISTY_DESKTOP_PROFILE"))
            .ok();
        let path = root
            .join("com.misty.desktop")
            .join("development-credentials")
            .join(legacy_file_name(service, account, profile.as_deref()));
        if let Some(value) = misty_credential_store::read_private_file(&path)? {
            misty_credential_store::store(service, account, &value)?;
            std::fs::remove_file(path)?;
            return Ok(Some(value));
        }
    }
    Ok(None)
}

pub fn store(service: &str, account: &str, value: &str) -> io::Result<()> {
    misty_credential_store::store(service, account, value)?;
    remove_legacy(service, account)
}

pub fn delete(service: &str, account: &str) -> io::Result<()> {
    remove_legacy(service, account)?;
    misty_credential_store::delete(service, account)
}

#[cfg(target_os = "macos")]
fn legacy_file_name(service: &str, account: &str, profile: Option<&str>) -> String {
    let mut digest = Sha256::new();
    digest.update(profile.unwrap_or("default").as_bytes());
    digest.update([0]);
    digest.update(service.as_bytes());
    digest.update([0]);
    digest.update(account.as_bytes());
    format!("{}.secret", hex::encode(digest.finalize()))
}

fn remove_legacy(service: &str, account: &str) -> io::Result<()> {
    #[cfg(target_os = "macos")]
    if let Some(root) = dirs::data_local_dir() {
        let profile = std::env::var("MISTY_PROFILE")
            .or_else(|_| std::env::var("MISTY_DESKTOP_PROFILE"))
            .ok();
        let path = root
            .join("com.misty.desktop")
            .join("development-credentials")
            .join(legacy_file_name(service, account, profile.as_deref()));
        match std::fs::remove_file(path) {
            Ok(()) => (),
            Err(error) if error.kind() == io::ErrorKind::NotFound => (),
            Err(error) => return Err(error),
        }
    }
    Ok(())
}
