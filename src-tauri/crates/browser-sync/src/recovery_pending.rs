//! Encrypted pending saves for workspace recovery. When the database cannot
//! take a write, the value waits in one sealed file per key beside it, so a
//! retry replaces the earlier attempt instead of adding a duplicate. A slot
//! records the database revision it was based on: it replays only onto that
//! revision, and any newer database copy wins over it.
use crate::{
    recovery::{validate_key, RecoveryRecord, RecoveryStore, MAX_BYTES},
    Error, Result,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, io::Write, path::PathBuf};
use zeroize::Zeroizing;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Slot {
    key: String,
    base: u64,
    envelope: serde_json::Value,
}

fn aad(key: &str, base: u64) -> String {
    format!("workspace-recovery:pending:v1:{key}:{base}")
}

/// Failures the pending slot can outlast: the database itself, or its capacity.
/// Stale revisions and invalid keys stay errors for the caller to resolve.
fn retryable(error: &Error) -> bool {
    matches!(error, Error::Storage(_) | Error::TooLarge)
}

impl RecoveryStore {
    /// The newest local value: a pending save if one waits, else the database copy.
    pub fn read(&self, key: &str) -> Result<Option<RecoveryRecord>> {
        let saved = self.read_saved(key);
        let Some((base, value)) = self.pending_slot(key)? else {
            return saved;
        };
        let revision = match &saved {
            Ok(record) => record.as_ref().map_or(0, |r| r.revision),
            Err(_) => base,
        };
        // A database copy newer than the slot's base already superseded it.
        if revision != base {
            return saved;
        }
        Ok(Some(RecoveryRecord {
            revision,
            value,
            pending: true,
        }))
    }

    /// Saves `value` over revision `expected`. If the database cannot take it,
    /// the value waits in its key's pending slot and the result says so.
    pub fn write(&mut self, key: &str, expected: u64, value: &str) -> Result<RecoveryRecord> {
        validate_key(key)?;
        if value.len() > MAX_BYTES {
            return Err(Error::TooLarge);
        }
        let _ = self.replay_pending();
        match self.write_saved(key, expected, value) {
            Ok(record) => {
                self.remove_slot(key)?;
                Ok(record)
            }
            Err(error) if retryable(&error) => {
                self.save_slot(key, expected, value)?;
                Ok(RecoveryRecord {
                    revision: expected,
                    value: value.into(),
                    pending: true,
                })
            }
            Err(error) => Err(error),
        }
    }

    /// Keys whose newest value is waiting in a pending slot.
    pub fn pending_keys(&self) -> Result<Vec<String>> {
        let mut keys = Vec::new();
        for path in self.slot_paths()? {
            if let Some(slot) = read_slot(&path)? {
                keys.push(slot.key);
            }
        }
        keys.sort();
        Ok(keys)
    }

    /// Moves every pending save into the database that can go there now. A slot
    /// the database already holds, or has moved past, is dropped.
    pub(crate) fn replay_pending(&mut self) -> Result<()> {
        for path in self.slot_paths()? {
            let Some(slot) = read_slot(&path)? else {
                continue;
            };
            let value = self.open_slot(&slot)?;
            let saved = self.read_saved(&slot.key)?;
            let revision = saved.as_ref().map_or(0, |r| r.revision);
            let landed = saved.as_ref().is_some_and(|r| r.value == value);
            if landed || revision != slot.base {
                remove(&path)?;
                continue;
            }
            match self.write_saved(&slot.key, slot.base, &value) {
                Ok(_) => remove(&path)?,
                Err(error) if retryable(&error) => return Err(error),
                // The slot can never apply (for example an immutable archive).
                Err(_) => remove(&path)?,
            }
        }
        Ok(())
    }

    fn pending_slot(&self, key: &str) -> Result<Option<(u64, String)>> {
        let Some(slot) = read_slot(&self.slot_path(key))? else {
            return Ok(None);
        };
        if slot.key != key {
            return Err(Error::Identity);
        }
        Ok(Some((slot.base, self.open_slot(&slot)?)))
    }

    fn open_slot(&self, slot: &Slot) -> Result<String> {
        validate_key(&slot.key)?;
        let raw = self.root.open_local(
            &self.scope,
            &self.scope.vault_id,
            &aad(&slot.key, slot.base),
            &serde_json::from_value(slot.envelope.clone())?,
        )?;
        String::from_utf8(raw.to_vec()).map_err(|_| Error::Invalid)
    }

    fn save_slot(&self, key: &str, base: u64, value: &str) -> Result<()> {
        let raw = Zeroizing::new(value.as_bytes().to_vec());
        let envelope = serde_json::to_value(self.root.seal_local(
            &self.scope,
            &self.scope.vault_id,
            &aad(key, base),
            &raw,
        )?)?;
        let slot = serde_json::to_vec(&Slot {
            key: key.into(),
            base,
            envelope,
        })?;
        let mut builder = fs::DirBuilder::new();
        builder.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(&self.pending).map_err(|_| Error::Recovery)?;
        // Write beside the slot, then rename over it: a crash leaves either the
        // previous pending save or the new one, never a torn file.
        let path = self.slot_path(key);
        let partial = path.with_extension("partial");
        let mut options = fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&partial).map_err(|_| Error::Recovery)?;
        file.write_all(&slot).map_err(|_| Error::Recovery)?;
        file.sync_all().map_err(|_| Error::Recovery)?;
        fs::rename(&partial, &path).map_err(|_| Error::Recovery)
    }

    fn remove_slot(&self, key: &str) -> Result<()> {
        remove(&self.slot_path(key))
    }

    fn slot_path(&self, key: &str) -> PathBuf {
        let digest = Sha256::digest(key.as_bytes());
        let name: String = digest.iter().map(|b| format!("{b:02x}")).collect();
        self.pending.join(format!("{name}.slot"))
    }

    fn slot_paths(&self) -> Result<Vec<PathBuf>> {
        let entries = match fs::read_dir(&self.pending) {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(_) => return Err(Error::Recovery),
        };
        let mut paths = Vec::new();
        for entry in entries.take(1024) {
            let path = entry.map_err(|_| Error::Recovery)?.path();
            if path.extension().is_some_and(|ext| ext == "slot") {
                paths.push(path);
            }
        }
        Ok(paths)
    }
}

fn read_slot(path: &std::path::Path) -> Result<Option<Slot>> {
    match fs::metadata(path) {
        Ok(meta) if meta.len() > (MAX_BYTES * 2) as u64 => return Err(Error::TooLarge),
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(Error::Recovery),
    }
    let bytes = fs::read(path).map_err(|_| Error::Recovery)?;
    Ok(Some(serde_json::from_slice(&bytes)?))
}

fn remove(path: &std::path::Path) -> Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(Error::Recovery),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::{VaultRoot, VaultScope};

    #[test]
    fn a_slot_behind_the_database_is_dropped_not_replayed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("recovery.sqlite");
        let scope = VaultScope {
            deployment: "https://example.test".into(),
            account_id: "owner".into(),
            vault_id: "d32b3d14-d7b6-4d4c-a674-d36bb5aefb74".into(),
        };
        let mut store = RecoveryStore::open(&path, scope, VaultRoot::generate()).unwrap();
        store.write("workspace", 0, "first").unwrap();
        store.save_slot("workspace", 1, "older pending").unwrap();
        // A database save that landed while removing its slot failed.
        store.write_saved("workspace", 1, "newer").unwrap();
        assert_eq!(store.read("workspace").unwrap().unwrap().value, "newer");
        store.replay_pending().unwrap();
        assert!(store.pending_keys().unwrap().is_empty());
        let read = store.read("workspace").unwrap().unwrap();
        assert_eq!(
            (read.revision, read.value.as_str(), read.pending),
            (2, "newer", false)
        );
    }
}
