//! SQLite contains ciphertext and routing metadata only, including its WAL.
//! A local edit is its durable outbox entry. UI projections overlay that entry on
//! the committed snapshot; acknowledgments never prematurely remove the edit.
use std::{path::Path, time::Duration};

use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::{
    crypto::{DeviceKey, VaultRoot, VaultScope},
    protocol::*,
    Error, Result,
};

mod vault;
pub use vault::CachedVault;
mod browser_profiles;
pub use browser_profiles::{BrowserGeneration, BrowserProfileBinding};
mod browser_capture;
pub use browser_capture::{BrowserCaptureState, BrowserObservation};
pub(crate) mod browser_import;
pub use browser_import::{BrowserImportJournal, BrowserImportReceipt};
mod workspaces;
pub use workspaces::{Batch, Desired, WorkspaceLocal};
mod collections;
mod device_signin;
mod schema;
pub use device_signin::{hex as signin_digest_hex, DeviceSignin};
use schema::connect;

/// Whether two sets of credential records hold the same data, ignoring engine
/// enumeration order, a cookie domain's leading dot, and expired cookies.
pub fn credentials_equivalent(
    a: &[crate::document::CredentialRecord],
    b: &[crate::document::CredentialRecord],
) -> Result<bool> {
    browser_import::equivalent(a, b)
}

const MAX_PENDING_COUNT: u64 = 10_000;
const MAX_PENDING_BYTES: u64 = 32 << 20;

/// Never expose this raw snapshot to webviews: it can contain credentials.
pub struct PendingSnapshot {
    pub committed_sequence: u64,
    pub operation_ids: Vec<String>,
    pub snapshot: Zeroizing<Vec<u8>>,
}

pub struct Store {
    connection: Connection,
    scope: VaultScope,
    grant: DeviceGrant,
}

fn fingerprint(scope: &VaultScope) -> Result<Vec<u8>> {
    scope.validate()?;
    Ok(Sha256::digest(serde_json::to_vec(&(
        &scope.deployment,
        &scope.account_id,
        &scope.vault_id,
    ))?)
    .to_vec())
}

impl Store {
    /// Idempotent creation also checks the existing key and identity, so a
    /// restart cannot silently replace a device and reset its counter.
    pub fn initialize(
        path: &Path,
        scope: VaultScope,
        grant: DeviceGrant,
        root: &VaultRoot,
        device: &DeviceKey,
        initial_snapshot: &[u8],
    ) -> Result<Self> {
        Self::initialize_vault(path, scope, grant, root, device, initial_snapshot, None)
    }

    /// Vault metadata and the encrypted device identity commit together before
    /// bootstrap/enrollment can reach the server. Retrying cannot lose the root
    /// wrapper or allocate a different signing identity after a lost response.
    pub fn initialize_vault(
        path: &Path,
        scope: VaultScope,
        grant: DeviceGrant,
        root: &VaultRoot,
        device: &DeviceKey,
        initial_snapshot: &[u8],
        vault: Option<&CachedVault>,
    ) -> Result<Self> {
        root.verify_grant(&scope, &grant)?;
        if let Some(vault) = vault {
            vault.verify(&scope, root, &grant)?;
        }
        if grant.public_key != device.public_key() {
            return Err(Error::Identity);
        }
        let mut connection = connect(path)?;
        let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let existing: Option<(Vec<u8>, String, String)> = tx
            .query_row(
                "SELECT scope,grant_json,device_key FROM sync_identity WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;
        if let Some((old_scope, old_grant, old_key)) = existing {
            let old_grant: DeviceGrant = serde_json::from_str(&old_grant)?;
            root.verify_grant(&scope, &old_grant)?;
            let key = DeviceKey::restore(
                root,
                &scope,
                &old_grant.device_id,
                &serde_json::from_str(&old_key)?,
            )?;
            if old_scope != fingerprint(&scope)?
                || old_grant.device_id != grant.device_id
                || old_grant.key_epoch != grant.key_epoch
                || key.public_key() != device.public_key()
                || old_grant.public_key != grant.public_key
            {
                return Err(Error::Identity);
            }
        } else {
            let device_key =
                serde_json::to_string(&device.protect(root, &scope, &grant.device_id)?)?;
            let snapshot = serde_json::to_string(&root.seal_local(
                &scope,
                &grant.device_id,
                "snapshot:0",
                initial_snapshot,
            )?)?;
            tx.execute(
                "INSERT INTO sync_identity VALUES(1,?1,?2,?3,1,0,?4)",
                params![
                    fingerprint(&scope)?,
                    serde_json::to_string(&grant)?,
                    device_key,
                    snapshot
                ],
            )?;
        }
        if let Some(vault) = vault {
            let encoded = serde_json::to_string(&vault.vault)?;
            tx.execute(
                "INSERT OR IGNORE INTO sync_vault VALUES(1,?1,?2,?3)",
                params![encoded, vault.bootstrap_pending, vault.enrollment_pending],
            )?;
            let saved: String =
                tx.query_row("SELECT vault FROM sync_vault WHERE singleton=1", [], |r| {
                    r.get(0)
                })?;
            vault.check_remote(&serde_json::from_str(&saved)?)?;
            tx.execute("UPDATE sync_high_watermark SET observed_head=max(observed_head,?1) WHERE singleton=1", [vault.vault.head_sequence])?;
        }
        tx.commit()?;
        Ok(Self {
            connection,
            scope,
            grant,
        })
    }

    pub fn unlock(path: &Path, scope: VaultScope, root: &VaultRoot) -> Result<(Self, DeviceKey)> {
        let connection = connect(path)?;
        let (stored_scope, grant_json, key_json): (Vec<u8>, String, String) = connection
            .query_row(
                "SELECT scope,grant_json,device_key FROM sync_identity WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )?;
        if stored_scope != fingerprint(&scope)? {
            return Err(Error::Identity);
        }
        let grant: DeviceGrant = serde_json::from_str(&grant_json)?;
        root.verify_grant(&scope, &grant)?;
        let device = DeviceKey::restore(
            root,
            &scope,
            &grant.device_id,
            &serde_json::from_str(&key_json)?,
        )?;
        if device.public_key() != grant.public_key {
            return Err(Error::Identity);
        }
        let store = Self {
            connection,
            scope,
            grant,
        };
        // Fail closed on a snapshot copied from another cursor/device/account.
        store.committed_snapshot(root)?;
        if let Some(vault) = store.cached_vault()? {
            vault.verify(&store.scope, root, &store.grant)?;
        }
        Ok((store, device))
    }

    pub fn grant(&self) -> &DeviceGrant {
        &self.grant
    }

    pub fn matches_scope(&self, scope: &VaultScope) -> Result<bool> {
        Ok(fingerprint(&self.scope)? == fingerprint(scope)?)
    }

    pub fn observed_head(&self) -> Result<u64> {
        Ok(self.connection.query_row("SELECT max(observed_head,(SELECT applied_sequence FROM sync_identity WHERE singleton=1)) FROM sync_high_watermark WHERE singleton=1", [], |r| r.get(0))?)
    }

    pub fn observe_head(&mut self, sequence: u64) -> Result<()> {
        if sequence > MAX_COUNTER {
            return Err(Error::Invalid);
        }
        self.connection.execute(
            "UPDATE sync_high_watermark SET observed_head=max(observed_head,?1) WHERE singleton=1",
            [sequence],
        )?;
        Ok(())
    }

    pub fn applied_sequence(&self) -> Result<u64> {
        Ok(self.connection.query_row(
            "SELECT applied_sequence FROM sync_identity WHERE singleton=1",
            [],
            |r| r.get(0),
        )?)
    }

    pub fn allocated_counter(&self) -> Result<u64> {
        let next: u64 = self.connection.query_row(
            "SELECT next_counter FROM sync_identity WHERE singleton=1",
            [],
            |r| r.get(0),
        )?;
        Ok(next - 1)
    }
}

mod outbox;
