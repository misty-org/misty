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
pub use device_signin::{hex as signin_digest_hex, DeviceSignin};

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

fn connect(path: &Path) -> Result<Connection> {
    // The coordinator supplies a directory in native application data. Set
    // owner-only permissions at creation instead of fixing them after a write.
    let mut options = std::fs::OpenOptions::new();
    options.read(true).write(true).create(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
        .open(path)
        .map_err(|_| Error::Storage(rusqlite::Error::InvalidPath(path.into())))?;
    let connection = Connection::open(path)?;
    connection.busy_timeout(Duration::from_secs(5))?;
    migrate_names(&connection)?;
    connection.execute_batch(
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS sync_identity (
            singleton INTEGER PRIMARY KEY CHECK(singleton=1), scope BLOB NOT NULL,
            grant_json TEXT NOT NULL, device_key TEXT NOT NULL,
            next_counter INTEGER NOT NULL CHECK(next_counter>0),
            applied_sequence INTEGER NOT NULL CHECK(applied_sequence>=0), snapshot TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_outbox (
            operation_id TEXT PRIMARY KEY, device_counter INTEGER NOT NULL UNIQUE,
            mutation TEXT NOT NULL, accepted_sequence INTEGER UNIQUE
        );
        CREATE TABLE IF NOT EXISTS sync_local_intents (
            operation_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_discarded (
            operation_id TEXT PRIMARY KEY, sequence INTEGER NOT NULL, mutation TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_applied (
            sequence INTEGER PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE, digest BLOB NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_browser_imports (
            profile_id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>0),
            journal TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_browser_capture (
            profile_id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>0),
            observation TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_browser_profiles (
            profile_id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>0),
            binding TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_high_watermark (
            singleton INTEGER PRIMARY KEY CHECK(singleton=1), observed_head INTEGER NOT NULL CHECK(observed_head>=0)
        );
        INSERT OR IGNORE INTO sync_high_watermark VALUES(1,0);
        CREATE TABLE IF NOT EXISTS sync_workspace_cache (
            workspace_id TEXT PRIMARY KEY, version INTEGER NOT NULL CHECK(version>=0), snapshot TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_workspace_desired (
            workspace_id TEXT PRIMARY KEY, desired TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_workspace_inflight (
            workspace_id TEXT PRIMARY KEY, request_id TEXT NOT NULL, op TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_workspace_counter (
            singleton INTEGER PRIMARY KEY CHECK(singleton=1), next_counter INTEGER NOT NULL CHECK(next_counter>0)
        );
        INSERT OR IGNORE INTO sync_workspace_counter VALUES(1,1);
        CREATE TABLE IF NOT EXISTS sync_workspace_roster (
            singleton INTEGER PRIMARY KEY CHECK(singleton=1), roster TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_workspace_local (
            singleton INTEGER PRIMARY KEY CHECK(singleton=1), state TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_workspace_retired (
            id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL,
            retired_at INTEGER NOT NULL, desired TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_device_signin (
            workspace_id TEXT PRIMARY KEY, binding TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_collections (
            collection TEXT PRIMARY KEY, state TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_vault (
            singleton INTEGER PRIMARY KEY CHECK(singleton=1),
            vault TEXT NOT NULL,
            bootstrap_pending INTEGER NOT NULL CHECK(bootstrap_pending IN (0,1)),
            enrollment_pending INTEGER NOT NULL CHECK(enrollment_pending IN (0,1))
        );",
    )?;
    Ok(connection)
}

/// Local schema version 1 renamed trees to workspaces, the sync workspace to
/// the vault and the records tier to collections. Stored JSON keeps loading
/// through serde aliases, except in-flight ops, which carry both the vault and
/// the workspace ID and are rewritten here.
fn migrate_names(connection: &Connection) -> Result<()> {
    let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version >= 1 {
        return Ok(());
    }
    let exists = |table: &str| -> Result<bool> {
        Ok(connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
            [table],
            |row| row.get(0),
        )?)
    };
    let has_column = |table: &str, column: &str| -> Result<bool> {
        Ok(connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info(?1) WHERE name=?2)",
            [table, column],
            |row| row.get(0),
        )?)
    };
    let tx = connection.unchecked_transaction()?;
    for (old, new) in [
        ("sync_tree_cache", "sync_workspace_cache"),
        ("sync_tree_desired", "sync_workspace_desired"),
        ("sync_tree_inflight", "sync_workspace_inflight"),
        ("sync_tree_counter", "sync_workspace_counter"),
        ("sync_tree_roster", "sync_workspace_roster"),
        ("sync_tree_local", "sync_workspace_local"),
        ("sync_tree_retired", "sync_workspace_retired"),
        ("sync_records", "sync_collections"),
    ] {
        if exists(old)? && !exists(new)? {
            tx.execute_batch(&format!("ALTER TABLE {old} RENAME TO {new}"))?;
        }
    }
    for table in [
        "sync_workspace_cache",
        "sync_workspace_desired",
        "sync_workspace_inflight",
        "sync_workspace_retired",
        "sync_device_signin",
    ] {
        if exists(table)? && has_column(table, "tree_id")? {
            tx.execute_batch(&format!(
                "ALTER TABLE {table} RENAME COLUMN tree_id TO workspace_id"
            ))?;
        }
    }
    if exists("sync_vault")? && has_column("sync_vault", "workspace")? {
        tx.execute_batch("ALTER TABLE sync_vault RENAME COLUMN workspace TO vault")?;
    }
    if exists("sync_workspace_inflight")? {
        let rows: Vec<(String, String)> = {
            let mut stmt = tx.prepare("SELECT workspace_id, op FROM sync_workspace_inflight")?;
            let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
            rows.collect::<std::result::Result<_, _>>()?
        };
        for (workspace, op) in rows {
            let op = legacy_op(serde_json::from_str(&op)?);
            tx.execute(
                "UPDATE sync_workspace_inflight SET op=?2 WHERE workspace_id=?1",
                [workspace, serde_json::to_string(&op)?],
            )?;
        }
    }
    tx.execute_batch("PRAGMA user_version=1")?;
    tx.commit()?;
    Ok(())
}

/// A pre-rename op: `workspace_id` was the vault and `tree_id` the workspace.
fn legacy_op(mut op: serde_json::Value) -> serde_json::Value {
    let Some(object) = op.as_object_mut() else {
        return op;
    };
    if let Some(tree) = object.remove("tree_id") {
        if let Some(vault) = object.remove("workspace_id") {
            object.insert("vault_id".into(), vault);
        }
        object.insert("workspace_id".into(), tree);
    }
    if let Some(base) = object.remove("base_tree_version") {
        object.insert("base_workspace_version".into(), base);
    }
    op
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
