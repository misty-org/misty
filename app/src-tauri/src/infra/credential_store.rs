use sha2::{Digest, Sha256};
use std::io;

#[cfg(all(target_os = "macos", debug_assertions))]
use std::{
    fs,
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
};

#[derive(Debug, thiserror::Error)]
pub enum CredentialStoreError {
    #[error("{0}")]
    Io(#[from] io::Error),
    #[error("{0}")]
    Keyring(#[from] keyring::Error),
}

pub fn load(service: &str, account: &str) -> Result<Option<String>, CredentialStoreError> {
    #[cfg(all(target_os = "macos", debug_assertions))]
    {
        return load_development_credential(service, account).map_err(Into::into);
    }

    #[cfg(not(all(target_os = "macos", debug_assertions)))]
    {
        let entry = keyring::Entry::new(service, account)?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(error.into()),
        }
    }
}

pub fn store(service: &str, account: &str, value: &str) -> Result<(), CredentialStoreError> {
    #[cfg(all(target_os = "macos", debug_assertions))]
    {
        return store_development_credential(service, account, value).map_err(Into::into);
    }

    #[cfg(not(all(target_os = "macos", debug_assertions)))]
    {
        keyring::Entry::new(service, account)?.set_password(value)?;
        Ok(())
    }
}

pub fn delete(service: &str, account: &str) -> Result<(), CredentialStoreError> {
    #[cfg(all(target_os = "macos", debug_assertions))]
    {
        return delete_development_credential(service, account).map_err(Into::into);
    }

    #[cfg(not(all(target_os = "macos", debug_assertions)))]
    {
        let entry = keyring::Entry::new(service, account)?;
        match entry.delete_password() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.into()),
        }
    }
}

fn credential_file_name(service: &str, account: &str, profile: Option<&str>) -> String {
    let mut digest = Sha256::new();
    digest.update(profile.unwrap_or("default").as_bytes());
    digest.update([0]);
    digest.update(service.as_bytes());
    digest.update([0]);
    digest.update(account.as_bytes());
    format!("{}.secret", hex::encode(digest.finalize()))
}

#[cfg(all(target_os = "macos", debug_assertions))]
fn development_credential_path(service: &str, account: &str) -> io::Result<PathBuf> {
    let root = dirs::data_local_dir()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "app data directory unavailable"))?
        .join("com.misty.desktop")
        .join("development-credentials");
    fs::create_dir_all(&root)?;
    fs::set_permissions(&root, fs::Permissions::from_mode(0o700))?;
    let profile = std::env::var("MISTY_PROFILE")
        .or_else(|_| std::env::var("MISTY_DESKTOP_PROFILE"))
        .ok();
    Ok(root.join(credential_file_name(service, account, profile.as_deref())))
}

#[cfg(all(target_os = "macos", debug_assertions))]
fn load_development_credential(service: &str, account: &str) -> io::Result<Option<String>> {
    let path = development_credential_path(service, account)?;
    match fs::read_to_string(&path) {
        Ok(value) => {
            secure_file(&path)?;
            Ok(Some(value))
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

#[cfg(all(target_os = "macos", debug_assertions))]
fn store_development_credential(service: &str, account: &str, value: &str) -> io::Result<()> {
    let path = development_credential_path(service, account)?;
    let temporary = path.with_extension(format!("tmp-{}", std::process::id()));
    let mut file = fs::OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .mode(0o600)
        .open(&temporary)?;
    file.write_all(value.as_bytes())?;
    file.sync_all()?;
    fs::rename(&temporary, &path)?;
    secure_file(&path)
}

#[cfg(all(target_os = "macos", debug_assertions))]
fn delete_development_credential(service: &str, account: &str) -> io::Result<()> {
    let path = development_credential_path(service, account)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

#[cfg(all(target_os = "macos", debug_assertions))]
fn secure_file(path: &Path) -> io::Result<()> {
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_names_are_stable_scoped_and_opaque() {
        let first = credential_file_name("service-a", "account-a", Some("profile-a"));
        assert_eq!(
            first,
            credential_file_name("service-a", "account-a", Some("profile-a"))
        );
        assert_ne!(
            first,
            credential_file_name("service-a", "account-b", Some("profile-a"))
        );
        assert_ne!(
            first,
            credential_file_name("service-a", "account-a", Some("profile-b"))
        );
        assert!(!first.contains("service"));
        assert!(!first.contains("account"));
    }
}
