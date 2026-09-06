//! Backup repository identity and credentials are bound to a native Host owner.
//! The package receives neither this record's vault key nor its password.
use cap_std::fs::{Dir, OpenOptions};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use zeroize::Zeroizing;
const MARKER: &str = "misty-backup.json";
const SERVICE: &str = "misty.native-app.backups";
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Record {
    schema: u8,
    id: String,
    owner: String,
    name: String,
    format: String,
}
pub struct RepositoryIdentity {
    pub name: String,
    pub password: Zeroizing<String>,
}
pub struct PendingIdentity {
    id: String,
    owner: String,
    name: String,
    pub password: Zeroizing<String>,
}
pub(super) trait Vault {
    fn load(&self, key: &str) -> Result<Option<String>, String>;
    fn store(&self, key: &str, value: &str) -> Result<(), String>;
    fn delete(&self, key: &str) -> Result<(), String>;
}
pub(super) struct OsVault;
impl Vault for OsVault {
    fn load(&self, key: &str) -> Result<Option<String>, String> {
        match keyring::Entry::new(SERVICE, key)
            .map_err(|_| "The OS credential vault is unavailable.")?
            .get_password()
        {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("Could not read this repository's OS credential.".into()),
        }
    }
    fn store(&self, key: &str, value: &str) -> Result<(), String> {
        keyring::Entry::new(SERVICE, key)
            .map_err(|_| "The OS credential vault is unavailable.")?
            .set_password(value)
            .map_err(|_| "Could not save this repository's OS credential.".into())
    }
    fn delete(&self, key: &str) -> Result<(), String> {
        keyring::Entry::new(SERVICE, key)
            .map_err(|_| "The OS credential vault is unavailable.")?
            .delete_credential()
            .map_err(|_| "Could not remove the unused repository credential.".into())
    }
}
fn valid_owner(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn key(owner: &str, id: &str) -> String {
    format!("{owner}:{id}")
}
pub(super) fn prepare(
    dir: &Dir,
    owner: &str,
    create: bool,
    name: &str,
    vault: &dyn Vault,
) -> Result<RepositoryIdentity, String> {
    if !valid_owner(owner) {
        return Err("Sign in before opening an encrypted backup repository.".into());
    }
    if !create {
        let mut options = OpenOptions::new();
        options.read(true);
        #[cfg(unix)]
        {
            use cap_std::fs::OpenOptionsExt;
            options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
        }
        let file = dir
            .open_with(MARKER, &options)
            .map_err(|_| "This folder needs a repository import or setup.")?;
        let metadata = file
            .metadata()
            .map_err(|_| "Repository identity is unavailable.")?;
        if !metadata.is_file() || metadata.len() > 4096 {
            return Err("Invalid repository identity.".into());
        }
        let mut bytes = Vec::new();
        file.take(4097)
            .read_to_end(&mut bytes)
            .map_err(|_| "Repository identity could not be read.")?;
        if bytes.len() > 4096 {
            return Err("Invalid repository identity.".into());
        }
        let record: Record =
            serde_json::from_slice(&bytes).map_err(|_| "Invalid repository identity.")?;
        if record.schema != 1
            || record.format != "misty-tar-v1"
            || record.owner != owner
            || uuid::Uuid::parse_str(&record.id).is_err()
            || !valid_name(&record.name)
        {
            return Err("This repository is not registered to this account, App, and Space, or needs migration.".into());
        }
        let password = vault
            .load(&key(owner, &record.id))?
            .ok_or("This repository's credential is missing from the OS vault.")?;
        if password.len() < 24 || password.len() > 256 {
            return Err("Invalid repository credential.".into());
        }
        return Ok(RepositoryIdentity {
            name: record.name,
            password: Zeroizing::new(password),
        });
    }
    let pending = pending(dir, owner, name)?;
    commit(dir, pending, vault)
}

/// Generates a transient password before Restic initialization. Nothing is
/// written to the vault or repository until `commit` is called after init.
pub(super) fn pending(dir: &Dir, owner: &str, name: &str) -> Result<PendingIdentity, String> {
    if !valid_owner(owner) {
        return Err("Sign in before creating an encrypted backup repository.".into());
    }
    if !valid_name(name) {
        return Err("Use a repository name of 1–64 characters.".into());
    }
    if dir
        .entries()
        .map_err(|_| "The chosen folder cannot be read.")?
        .next()
        .is_some()
    {
        return Err(
            "Choose an empty folder for a new repository. Existing files will not be replaced."
                .into(),
        );
    }
    use base64::Engine;
    use rand::RngCore;
    let id = uuid::Uuid::new_v4().to_string();
    let mut random = Zeroizing::new([0u8; 32]);
    rand::thread_rng().fill_bytes(&mut *random);
    let password =
        Zeroizing::new(base64::engine::general_purpose::STANDARD_NO_PAD.encode(&*random));
    Ok(PendingIdentity {
        id,
        owner: owner.into(),
        name: name.into(),
        password,
    })
}

pub(super) fn commit(
    dir: &Dir,
    pending: PendingIdentity,
    vault: &dyn Vault,
) -> Result<RepositoryIdentity, String> {
    let record = Record {
        schema: 1,
        id: pending.id.clone(),
        owner: pending.owner.clone(),
        name: pending.name.clone(),
        format: "misty-tar-v1".into(),
    };
    let vault_key = key(&pending.owner, &pending.id);
    vault.store(&vault_key, &pending.password)?;
    let temp = format!(".misty-repository-{}", uuid::Uuid::new_v4());
    let saved = (|| -> Result<(), String> {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        let mut file = dir
            .open_with(&temp, &options)
            .map_err(|_| "Could not prepare the repository identity.")?;
        let bytes = serde_json::to_vec(&record)
            .map_err(|_| "Could not prepare the repository identity.")?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "Could not save the repository identity.")?;
        dir.hard_link(&temp, dir, MARKER)
            .map_err(|_| "The repository folder changed during setup.")?;
        Ok(())
    })();
    let _ = dir.remove_file(&temp);
    if let Err(error) = saved {
        let cleanup = vault.delete(&vault_key);
        return Err(cleanup.err().unwrap_or(error));
    }
    Ok(RepositoryIdentity {
        name: pending.name,
        password: pending.password,
    })
}
fn valid_name(name: &str) -> bool {
    !name.trim().is_empty() && name.chars().count() <= 64 && !name.chars().any(char::is_control)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::RefCell, collections::HashMap};
    #[derive(Default)]
    struct MemoryVault {
        values: RefCell<HashMap<String, String>>,
        reads: RefCell<usize>,
    }
    impl Vault for MemoryVault {
        fn load(&self, key: &str) -> Result<Option<String>, String> {
            *self.reads.borrow_mut() += 1;
            Ok(self.values.borrow().get(key).cloned())
        }
        fn store(&self, key: &str, value: &str) -> Result<(), String> {
            self.values.borrow_mut().insert(key.into(), value.into());
            Ok(())
        }
        fn delete(&self, key: &str) -> Result<(), String> {
            self.values.borrow_mut().remove(key);
            Ok(())
        }
    }
    #[test]
    fn credential_lookup_requires_the_same_native_owner_and_never_stores_the_password_in_the_repository(
    ) {
        let fixture = tempfile::tempdir().unwrap();
        let dir = Dir::open_ambient_dir(fixture.path(), cap_std::ambient_authority()).unwrap();
        let vault = MemoryVault::default();
        let owner = "ab".repeat(32);
        let created = prepare(&dir, &owner, true, "Studio archive", &vault).unwrap();
        let reopened = prepare(&dir, &owner, false, "", &vault).unwrap();
        assert_eq!(*created.password, *reopened.password);
        let marker = std::fs::read_to_string(fixture.path().join(MARKER)).unwrap();
        assert!(!marker.contains(created.password.as_str()));
        let reads = *vault.reads.borrow();
        assert!(prepare(&dir, &"cd".repeat(32), false, "", &vault).is_err());
        assert_eq!(*vault.reads.borrow(), reads);
        assert!(prepare(&dir, &owner, true, "Replacement", &vault).is_err());
        assert_eq!(vault.values.borrow().len(), 1);
        vault.values.borrow_mut().clear();
        assert!(prepare(&dir, &owner, false, "", &vault).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn unsafe_or_foreign_markers_cannot_select_another_vault_record() {
        let fixture = tempfile::tempdir().unwrap();
        let dir = Dir::open_ambient_dir(fixture.path(), cap_std::ambient_authority()).unwrap();
        let vault = MemoryVault::default();
        std::os::unix::fs::symlink("/outside/secret", fixture.path().join(MARKER)).unwrap();
        assert!(prepare(&dir, &"ab".repeat(32), false, "", &vault).is_err());
        assert_eq!(*vault.reads.borrow(), 0);
        assert!(prepare(&dir, "../owner", false, "", &vault).is_err());
        assert_eq!(*vault.reads.borrow(), 0);
    }
}
