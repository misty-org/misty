//! Remembered vault roots and the workspace recovery key, kept in Misty's credential
//! store: encrypted rows in `misty.db` under the one master key the OS keychain holds
//! (service `com.misty.auth`), on every platform. These blocking APIs belong on the
//! native coordinator's blocking worker.
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::{
    crypto::{VaultRoot, VaultScope},
    Error, Result,
};

const SERVICE: &str = "com.misty.browser-sync.root.v1";

fn account(scope: &VaultScope) -> Result<String> {
    scope.validate()?;
    let digest = Sha256::digest(serde_json::to_vec(&(
        &scope.deployment,
        &scope.account_id,
        &scope.vault_id,
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

pub fn forget_workspace_recovery_root(scope: &VaultScope) -> Result<()> {
    platform::delete(&format!("workspace-recovery:v1:{}", account(scope)?))
}

/// The root of a local vault: one made on this device for browsing without an account, never
/// wrapped with a sync password because it never reaches a server. Created on first use when
/// `create` is set. The caller checks it against the vault's stored grant (`Store::unlock`),
/// so a wrong or replaced root opens nothing.
pub fn local_vault_root(scope: &VaultScope, create: bool) -> Result<VaultRoot> {
    let name = format!("local-vault:v1:{}", account(scope)?);
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

pub fn forget_local_vault_root(scope: &VaultScope) -> Result<()> {
    platform::delete(&format!("local-vault:v1:{}", account(scope)?))
}

mod platform {
    use super::*;

    fn encode(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    fn decode(text: &str) -> Result<Zeroizing<Vec<u8>>> {
        if text.len() % 2 != 0 || !text.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(Error::Invalid);
        }
        (0..text.len())
            .step_by(2)
            .map(|index| {
                u8::from_str_radix(&text[index..index + 2], 16).map_err(|_| Error::Invalid)
            })
            .collect::<Result<Vec<u8>>>()
            .map(Zeroizing::new)
    }

    #[cfg(test)]
    pub fn __encode_for_test(bytes: &[u8]) -> String {
        encode(bytes)
    }
    #[cfg(test)]
    pub fn __decode_for_test(text: &str) -> Result<Zeroizing<Vec<u8>>> {
        decode(text)
    }

    pub fn write(account: &str, bytes: &[u8]) -> Result<()> {
        misty_credential_store::store(SERVICE, account, &encode(bytes))
            .map_err(|_| Error::SecureStorage)
    }

    pub fn read(account: &str) -> Result<Option<Zeroizing<Vec<u8>>>> {
        match misty_credential_store::load(SERVICE, account) {
            Ok(Some(text)) => decode(&text).map(Some),
            Ok(None) => Ok(None),
            Err(_) => Err(Error::SecureStorage),
        }
    }

    pub fn delete(account: &str) -> Result<()> {
        misty_credential_store::delete(SERVICE, account).map_err(|_| Error::SecureStorage)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_names_are_scoped_without_containing_account_identifiers() {
        let mut scope = VaultScope {
            deployment: "https://sync.example.test".into(),
            account_id: "user@example.test".into(),
            vault_id: "01951d32-40ac-7000-8000-000000000001".into(),
        };
        let original = account(&scope).unwrap();
        assert_eq!(original.len(), 64);
        assert!(!original.contains("example"));
        scope.account_id.push('2');
        assert_ne!(account(&scope).unwrap(), original);
        scope.account_id.pop();
        scope.deployment.push_str("/other");
        assert_ne!(account(&scope).unwrap(), original);
    }

    #[test]
    fn roots_round_trip_through_hex() {
        let bytes: Vec<u8> = (0u8..33).collect();
        let text = platform::__encode_for_test(&bytes);
        assert_eq!(
            platform::__decode_for_test(&text).unwrap().as_slice(),
            &bytes[..]
        );
        assert!(platform::__decode_for_test("zz").is_err());
        assert!(platform::__decode_for_test("abc").is_err());
    }
}
