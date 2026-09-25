//! On macOS, one OS-protected device key wraps all remembered roots locally.
//! Other platforms use their operating system's credential store directly.
//! No plaintext fallback to the application's file credential helper is permitted.
//! These blocking APIs belong on the native coordinator's blocking worker.
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::{
    crypto::{VaultRoot, VaultScope},
    Error, Result,
};

const SERVICE: &str = "com.misty.browser-sync.root.v1";

#[cfg(any(target_os = "macos", test))]
mod device_store;

/// Configure the shared, device-local directory before accepting native IPC.
/// This does not open Keychain; the first blocking read unlocks the device key.
#[cfg(target_os = "macos")]
pub fn configure_device_store(directory: std::path::PathBuf) -> Result<()> {
    platform::configure(directory)
}

fn account(scope: &VaultScope) -> Result<String> {
    scope.validate()?;
    let digest = Sha256::digest(serde_json::to_vec(&(
        &scope.deployment,
        &scope.account_id,
        &scope.workspace_id,
    ))?);
    Ok(digest.iter().map(|b| format!("{b:02x}")).collect())
}

pub fn remember(scope: &VaultScope, root: &VaultRoot) -> Result<()> {
    let mut bytes = Zeroizing::new(Vec::with_capacity(33));
    bytes.push(1);
    bytes.extend_from_slice(root.protected_bytes());
    platform::write(&account(scope)?, &bytes)
}

pub fn recall(scope: &VaultScope, expected_public_key: &str) -> Result<Option<VaultRoot>> {
    let Some(bytes) = platform::read(&account(scope)?)? else {
        return Ok(None);
    };
    if bytes.len() != 33 || bytes[0] != 1 {
        return Err(Error::Invalid);
    }
    let root = VaultRoot::from_protected(&bytes[1..])?;
    if root.public_key()? != expected_public_key {
        return Err(Error::Identity);
    }
    Ok(Some(root))
}

pub fn forget(scope: &VaultScope) -> Result<()> {
    platform::delete(&account(scope)?)
}

/// A separate device-local key for workspace recovery while the sync vault is
/// locked. Call under the recovery database's exclusive process lock. Never
/// replace a missing key when a database already contains recoverable records.
pub fn workspace_recovery_root(scope: &VaultScope, create: bool) -> Result<VaultRoot> {
    let name = format!("workspace-recovery:v1:{}", account(scope)?);
    #[cfg(target_os = "macos")]
    {
        let bytes = platform::recovery(&name, create)?;
        return VaultRoot::from_protected(&bytes[1..]);
    }
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(bytes) = platform::read(&name)? {
            if bytes.len() != 33 || bytes[0] != 1 {
                return Err(Error::SecureStorage);
            }
            return VaultRoot::from_protected(&bytes[1..]);
        }
        if !create {
            return Err(Error::SecureStorage);
        }
        let root = VaultRoot::generate();
        let mut bytes = Zeroizing::new(Vec::with_capacity(33));
        bytes.push(1);
        bytes.extend_from_slice(root.protected_bytes());
        platform::write(&name, &bytes)?;
        Ok(root)
    }
}

pub fn forget_workspace_recovery_root(scope: &VaultScope) -> Result<()> {
    platform::delete(&format!("workspace-recovery:v1:{}", account(scope)?))
}

#[cfg(target_os = "macos")]
mod platform {
    use super::device_store::{Backend, DeviceStore};
    use super::*;
    use security_framework::item::{ItemClass, ItemSearchOptions, Limit};
    use security_framework::passwords::{
        delete_generic_password, get_generic_password, set_generic_password,
    };
    use std::{
        path::PathBuf,
        sync::{Mutex, OnceLock},
    };
    const ITEM_NOT_FOUND: i32 = -25300; // errSecItemNotFound

    static DIRECTORY: OnceLock<PathBuf> = OnceLock::new();
    static STORE: Mutex<Option<DeviceStore>> = Mutex::new(None);

    pub fn configure(directory: PathBuf) -> Result<()> {
        if let Some(existing) = DIRECTORY.get() {
            return if existing == &directory {
                Ok(())
            } else {
                Err(Error::SecureStorage)
            };
        }
        DIRECTORY.set(directory).map_err(|_| Error::SecureStorage)
    }

    fn with_store<T>(action: impl FnOnce(&mut DeviceStore) -> Result<T>) -> Result<T> {
        let mut store = STORE.lock().map_err(|_| Error::SecureStorage)?;
        if store.is_none() {
            *store = Some(DeviceStore::open(
                DIRECTORY.get().ok_or(Error::SecureStorage)?,
                &Keychain,
            )?);
        }
        action(store.as_mut().ok_or(Error::SecureStorage)?)
    }

    pub fn write(account: &str, bytes: &[u8]) -> Result<()> {
        with_store(|store| store.put(account, bytes))
    }
    pub fn read(account: &str) -> Result<Option<Zeroizing<Vec<u8>>>> {
        with_store(|store| store.get(account))
    }
    pub fn delete(account: &str) -> Result<()> {
        with_store(|store| store.delete(account))
    }
    pub fn recovery(account: &str, create: bool) -> Result<Zeroizing<Vec<u8>>> {
        with_store(|store| store.recovery(account, create))
    }

    struct Keychain;
    impl Backend for Keychain {
        fn write(&self, account: &str, bytes: &[u8]) -> Result<()> {
            set_generic_password(SERVICE, account, bytes).map_err(|_| Error::SecureStorage)
        }
        fn read(&self, account: &str) -> Result<Option<Zeroizing<Vec<u8>>>> {
            match get_generic_password(SERVICE, account) {
                Ok(bytes) => Ok(Some(Zeroizing::new(bytes))),
                Err(e) if e.code() == ITEM_NOT_FOUND => Ok(None),
                Err(_) => Err(Error::SecureStorage),
            }
        }
        fn delete(&self, account: &str) -> Result<()> {
            match delete_generic_password(SERVICE, account) {
                Ok(()) => Ok(()),
                Err(e) if e.code() == ITEM_NOT_FOUND => Ok(()),
                Err(_) => Err(Error::SecureStorage),
            }
        }
        fn legacy_accounts(&self) -> Result<Vec<String>> {
            // Attributes only: never turn secret data into an ordinary String.
            let results = match ItemSearchOptions::new()
                .class(ItemClass::generic_password())
                .service(SERVICE)
                .load_attributes(true)
                .limit(Limit::All)
                .search()
            {
                Ok(items) => items,
                Err(e) if e.code() == ITEM_NOT_FOUND => return Ok(Vec::new()),
                Err(_) => return Err(Error::SecureStorage),
            };
            results
                .into_iter()
                .map(|item| {
                    item.simplify_dict()
                        .and_then(|mut attrs| attrs.remove("acct"))
                        .ok_or(Error::SecureStorage)
                })
                .collect()
        }
    }
}

#[cfg(windows)]
mod platform {
    use super::*;
    use windows_sys::Win32::{
        Foundation::{GetLastError, ERROR_NOT_FOUND},
        Security::Credentials::*,
    };
    use zeroize::Zeroize;

    fn target(account: &str) -> Vec<u16> {
        format!("{SERVICE}:{account}")
            .encode_utf16()
            .chain(Some(0))
            .collect()
    }

    pub fn write(account: &str, bytes: &[u8]) -> Result<()> {
        let mut name = target(account);
        let mut protected = Zeroizing::new(bytes.to_vec());
        // The system copies the blob during CredWriteW and retains no pointers.
        let mut credential: CREDENTIALW = unsafe { std::mem::zeroed() };
        credential.Type = CRED_TYPE_GENERIC;
        credential.TargetName = name.as_mut_ptr();
        credential.CredentialBlob = protected.as_mut_ptr();
        credential.CredentialBlobSize = protected.len() as u32;
        credential.Persist = CRED_PERSIST_LOCAL_MACHINE;
        if unsafe { CredWriteW(&credential, 0) } == 0 {
            return Err(Error::SecureStorage);
        }
        Ok(())
    }

    pub fn read(account: &str) -> Result<Option<Zeroizing<Vec<u8>>>> {
        let name = target(account);
        let mut credential: *mut CREDENTIALW = std::ptr::null_mut();
        if unsafe { CredReadW(name.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) } == 0 {
            return if unsafe { GetLastError() } == ERROR_NOT_FOUND {
                Ok(None)
            } else {
                Err(Error::SecureStorage)
            };
        }
        if credential.is_null() {
            return Err(Error::SecureStorage);
        }
        // CredReadW returns one allocation, including the blob, for CredFree.
        // Wipe the plaintext copy before releasing that allocation.
        unsafe {
            let item = &*credential;
            let value = if item.CredentialBlobSize == 33 && !item.CredentialBlob.is_null() {
                let blob = std::slice::from_raw_parts_mut(item.CredentialBlob, 33);
                let bytes = Zeroizing::new(blob.to_vec());
                blob.zeroize();
                Ok(Some(bytes))
            } else {
                Err(Error::Invalid)
            };
            CredFree(credential.cast());
            value
        }
    }

    pub fn delete(account: &str) -> Result<()> {
        let name = target(account);
        if unsafe { CredDeleteW(name.as_ptr(), CRED_TYPE_GENERIC, 0) } == 0
            && unsafe { GetLastError() } != ERROR_NOT_FOUND
        {
            return Err(Error::SecureStorage);
        }
        Ok(())
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
mod platform {
    use super::*;
    pub fn write(_: &str, _: &[u8]) -> Result<()> {
        Err(Error::SecureStorage)
    }
    pub fn read(_: &str) -> Result<Option<Zeroizing<Vec<u8>>>> {
        Err(Error::SecureStorage)
    }
    pub fn delete(_: &str) -> Result<()> {
        Err(Error::SecureStorage)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keychain_targets_are_scoped_without_containing_account_identifiers() {
        let mut scope = VaultScope {
            deployment: "https://sync.example.test".into(),
            account_id: "user@example.test".into(),
            workspace_id: "01951d32-40ac-7000-8000-000000000001".into(),
        };
        let original = account(&scope).unwrap();
        assert_eq!(original.len(), 64);
        assert!(!original.contains("example"));
        scope.account_id.push('2');
        assert_ne!(account(&scope).unwrap(), original);
        scope.account_id.pop();
        scope.deployment.push_str("/self-hosted");
        assert_ne!(account(&scope).unwrap(), original);
    }

    #[test]
    #[cfg(windows)]
    #[ignore = "requires an interactive OS credential store; uses a disposable test entry"]
    fn os_store_roundtrip_and_forget() {
        let scope = VaultScope {
            deployment: "https://credential-store-fixture.invalid".into(),
            account_id: "public-disposable-test".into(),
            workspace_id: uuid::Uuid::new_v4().to_string(),
        };
        struct Cleanup(VaultScope);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = forget(&self.0);
            }
        }
        let cleanup = Cleanup(scope.clone());
        let root = VaultRoot::generate();
        let public = root.public_key().unwrap();
        assert!(recall(&scope, &public).unwrap().is_none());
        remember(&scope, &root).unwrap();
        assert_eq!(
            recall(&scope, &public)
                .unwrap()
                .unwrap()
                .public_key()
                .unwrap(),
            public
        );
        assert!(recall(&scope, &VaultRoot::generate().public_key().unwrap()).is_err());
        forget(&scope).unwrap();
        assert!(recall(&scope, &public).unwrap().is_none());
        drop(cleanup);
    }
}
