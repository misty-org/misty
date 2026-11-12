//! The local records key and workspace recovery key, kept in Misty's credential
//! store: encrypted rows in `misty.db` under the one master key the OS keychain holds
//! (service `com.misty.auth`), on every platform. These blocking APIs belong on the
//! native coordinator's blocking worker.
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::{
    crypto::{RecoveryKey, RecoveryScope},
    Error, Result,
};

const SERVICE: &str = "com.misty.browser-sync.root.v1";

fn account(scope: &RecoveryScope) -> Result<String> {
    scope.validate()?;
    let digest = Sha256::digest(serde_json::to_vec(&(
        &scope.deployment,
        &scope.account_id,
        &scope.id,
    ))?);
    Ok(digest.iter().map(|b| format!("{b:02x}")).collect())
}

/// A separate key on this computer for workspace recovery. Call under the recovery database's exclusive process lock. Never
/// replace a missing key when a database already contains recoverable records.
pub fn workspace_recovery_root(scope: &RecoveryScope, create: bool) -> Result<RecoveryKey> {
    let name = format!("workspace-recovery:v1:{}", account(scope)?);
    if let Some(bytes) = platform::read(&name)? {
        if bytes.len() != 33 || bytes[0] != 1 {
            return Err(Error::SecureStorage);
        }
        return RecoveryKey::from_protected(&bytes[1..]);
    }
    if !create {
        return Err(Error::SecureStorage);
    }
    let root = RecoveryKey::generate();
    let mut bytes = Zeroizing::new(Vec::with_capacity(33));
    bytes.push(1);
    bytes.extend_from_slice(root.protected_bytes());
    platform::write(&name, &bytes)?;
    Ok(root)
}

pub fn forget_workspace_recovery_root(scope: &RecoveryScope) -> Result<()> {
    platform::delete(&format!("workspace-recovery:v1:{}", account(scope)?))
}

/// The key that seals an install's local records. `Ok(None)` is confirmed missing; a read that
/// failed (a locked keychain) is an error, so a passing problem never reads as a lost key.
pub fn local_records_key(identity: &str) -> Result<Option<crate::local::LocalKey>> {
    platform::read(&format!("local-records:v1:{identity}"))?
        .map(|bytes| crate::local::LocalKey::from_bytes(&bytes))
        .transpose()
}

/// Makes the key for a new local database. Only call after `local_records_key` confirmed none.
pub fn create_local_records_key(identity: &str) -> Result<crate::local::LocalKey> {
    let key = crate::local::LocalKey::generate();
    platform::write(&format!("local-records:v1:{identity}"), key.bytes())?;
    Ok(key)
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
        let mut scope = RecoveryScope {
            deployment: "https://sync.example.test".into(),
            account_id: "user@example.test".into(),
            id: "01951d32-40ac-7000-8000-000000000001".into(),
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
