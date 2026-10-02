//! Which native browser store holds each device's sign-in data on this
//! machine, and which published sign-in slots that store reflects. A store may
//! be captured from only while it reflects the device's current slots; any
//! other difference means another session wrote the device, and the store must
//! be restored before this session publishes again.
use std::collections::BTreeMap;

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::Store;
use crate::{
    crypto::VaultRoot,
    document::entities,
    protocol::{valid_id, Envelope},
    workspace::signin::is_signin_slot,
    Error, Result,
};

const MAX_DEVICES: u64 = 1024;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeviceSignin {
    /// Native browser store for this device's sign-in data on this machine.
    pub physical_id: String,
    /// Content hashes (hex) of the device's sign-in slots this store reflects.
    pub applied: BTreeMap<i16, String>,
    /// Plaintext digests (hex) of the shards last restored or queued.
    pub written: BTreeMap<i16, String>,
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn valid_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

impl DeviceSignin {
    pub fn validate(&self) -> Result<()> {
        if !entities::profile_id(&self.physical_id) {
            return Err(Error::Invalid);
        }
        for map in [&self.applied, &self.written] {
            if map
                .iter()
                .any(|(kind, digest)| !is_signin_slot(*kind) || !valid_digest(digest))
            {
                return Err(Error::Invalid);
            }
        }
        Ok(())
    }

    /// Whether this store reflects exactly the device's current slots.
    pub fn reflects(&self, server: &BTreeMap<i16, [u8; 32]>) -> bool {
        self.applied.len() == server.len()
            && server
                .iter()
                .all(|(kind, hash)| self.applied.get(kind) == Some(&hex(hash)))
    }
}

fn record(workspace: &str) -> String {
    format!("device-signin:v1:{workspace}")
}

impl Store {
    pub fn device_signin(&self, root: &VaultRoot, workspace: &str) -> Result<Option<DeviceSignin>> {
        if !valid_id(workspace) {
            return Err(Error::Invalid);
        }
        let sealed: Option<String> = self
            .connection
            .query_row(
                "SELECT binding FROM sync_device_signin WHERE workspace_id=?1",
                [workspace],
                |r| r.get(0),
            )
            .optional()?;
        let Some(sealed) = sealed else {
            return Ok(None);
        };
        let envelope: Envelope = serde_json::from_str(&sealed)?;
        let plain = root.open_local(
            &self.scope,
            &self.grant.device_id,
            &record(workspace),
            &envelope,
        )?;
        let binding: DeviceSignin = serde_json::from_slice(&plain)?;
        binding.validate()?;
        Ok(Some(binding))
    }

    pub fn set_device_signin(
        &mut self,
        root: &VaultRoot,
        workspace: &str,
        binding: &DeviceSignin,
    ) -> Result<()> {
        if !valid_id(workspace) {
            return Err(Error::Invalid);
        }
        binding.validate()?;
        let known: bool = self.connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM sync_device_signin WHERE workspace_id=?1)",
            [workspace],
            |r| r.get(0),
        )?;
        if !known {
            let count: u64 =
                self.connection
                    .query_row("SELECT count(*) FROM sync_device_signin", [], |r| r.get(0))?;
            if count >= MAX_DEVICES {
                return Err(Error::TooLarge);
            }
        }
        let plain = zeroize::Zeroizing::new(serde_json::to_vec(binding)?);
        let sealed = serde_json::to_string(&root.seal_local(
            &self.scope,
            &self.grant.device_id,
            &record(workspace),
            &plain,
        )?)?;
        self.connection.execute(
            "INSERT INTO sync_device_signin VALUES(?1,?2) ON CONFLICT(workspace_id) DO UPDATE SET binding=excluded.binding",
            params![workspace, sealed],
        )?;
        Ok(())
    }

    /// Records sign-in slots this machine published and the server accepted:
    /// the local store now reflects them. `None` records a deleted slot.
    pub fn mark_signin_applied(
        &mut self,
        root: &VaultRoot,
        workspace: &str,
        slots: &[(i16, Option<[u8; 32]>)],
    ) -> Result<()> {
        let Some(mut binding) = self.device_signin(root, workspace)? else {
            return Ok(());
        };
        for (kind, hash) in slots {
            match hash {
                Some(hash) => binding.applied.insert(*kind, hex(hash)),
                None => binding.applied.remove(kind),
            };
        }
        self.set_device_signin(root, workspace, &binding)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        crypto::{DeviceKey, VaultRoot, VaultScope},
        document::Document,
    };

    fn store() -> (Store, VaultRoot, tempfile::TempDir) {
        let root = VaultRoot::generate();
        let scope = VaultScope {
            deployment: "https://sync.example.test".into(),
            account_id: "account".into(),
            vault_id: "01951d32-40ac-7000-8000-000000000001".into(),
        };
        let key = DeviceKey::generate();
        let grant = root
            .grant(&scope, "01951d32-40ac-7000-8000-000000000002", 1, &key)
            .unwrap();
        let dir = tempfile::tempdir().unwrap();
        let store = Store::initialize_vault(
            &dir.path().join("w.sqlite"),
            scope,
            grant,
            &root,
            &key,
            &Document::default().encode().unwrap(),
            None,
        )
        .unwrap();
        (store, root, dir)
    }

    #[test]
    fn a_store_reflects_a_device_only_when_every_slot_matches() {
        let hash = [7u8; 32];
        let mut binding = DeviceSignin {
            physical_id: "c".repeat(64),
            ..Default::default()
        };
        assert!(binding.reflects(&BTreeMap::new()));
        assert!(!binding.reflects(&BTreeMap::from([(4, hash)])));
        binding.applied.insert(4, hex(&hash));
        assert!(binding.reflects(&BTreeMap::from([(4, hash)])));
        // A slot the server no longer has, or a different version, is a change.
        assert!(!binding.reflects(&BTreeMap::new()));
        assert!(!binding.reflects(&BTreeMap::from([(4, [8u8; 32])])));
    }

    #[test]
    fn bindings_are_sealed_validated_and_track_accepted_slots() {
        let (mut store, root, _dir) = store();
        let workspace = "01951d32-40ac-7000-8000-000000000003";
        assert!(store.device_signin(&root, workspace).unwrap().is_none());
        // Nothing to record for a device this machine has never bound.
        store
            .mark_signin_applied(&root, workspace, &[(4, Some([1; 32]))])
            .unwrap();
        assert!(store.device_signin(&root, workspace).unwrap().is_none());
        let binding = DeviceSignin {
            physical_id: "d".repeat(64),
            ..Default::default()
        };
        store.set_device_signin(&root, workspace, &binding).unwrap();
        store
            .mark_signin_applied(&root, workspace, &[(4, Some([1; 32])), (5, Some([2; 32]))])
            .unwrap();
        store
            .mark_signin_applied(&root, workspace, &[(5, None)])
            .unwrap();
        let saved = store.device_signin(&root, workspace).unwrap().unwrap();
        assert_eq!(saved.applied, BTreeMap::from([(4, hex(&[1; 32]))]));
        // Invalid bindings are refused before they reach storage.
        for bad in [
            DeviceSignin {
                physical_id: "../escape".into(),
                ..Default::default()
            },
            DeviceSignin {
                physical_id: "d".repeat(64),
                applied: BTreeMap::from([(2, hex(&[1; 32]))]),
                ..Default::default()
            },
            DeviceSignin {
                physical_id: "d".repeat(64),
                written: BTreeMap::from([(4, "not-a-digest".into())]),
                ..Default::default()
            },
        ] {
            assert!(store.set_device_signin(&root, workspace, &bad).is_err());
        }
        assert!(store.set_device_signin(&root, "../tree", &binding).is_err());
    }
}
