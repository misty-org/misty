//! Durable tree-protocol state: verified tree caches (re-verified on load),
//! the local desired state still to publish, one in-flight op per tree, and
//! the device's tree counter. Everything readable is sealed with the vault's
//! local key except in-flight ops, which already hold only ciphertext.
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};

use super::Store;
use crate::{
    crypto::VaultRoot,
    document::{Change, Resume},
    protocol::{valid_id, DeviceGrant, Envelope, MAX_COUNTER},
    tree::protocol::{Tree, TreeOp, TreeSnapshot},
    Error, Result,
};

/// Local edits still to publish. They survive restarts and offline periods
/// and are rebuilt into a fresh op against whatever version the server holds
/// when the device can publish. Changes are replayed onto the latest server
/// records (a rebase), so concurrent edits to the shared tree from other
/// devices are never overwritten by a stale full copy.
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Desired {
    pub changes: Vec<Change>,
    /// `Some` replaces the tree's resume/focus record.
    pub resume: Option<Resume>,
    /// Pending slot writes keyed by `(tab node, slot)`; `None` deletes.
    pub slots: Vec<(String, i16, Option<Vec<u8>>)>,
    pub blob_refs: Vec<Vec<u8>>,
}

impl Desired {
    pub fn is_empty(&self) -> bool {
        self.changes.is_empty() && self.resume.is_none() && self.slots.is_empty() && self.blob_refs.is_empty()
    }
}

impl Store {
    fn seal_tree(&self, root: &VaultRoot, record: &str, value: &impl Serialize) -> Result<String> {
        let plain = zeroize::Zeroizing::new(serde_json::to_vec(value)?);
        Ok(serde_json::to_string(&root.seal_local(&self.scope, &self.grant.device_id, record, &plain)?)?)
    }

    fn open_tree<T: for<'de> Deserialize<'de>>(&self, root: &VaultRoot, record: &str, sealed: &str) -> Result<T> {
        let envelope: Envelope = serde_json::from_str(sealed)?;
        let plain = root.open_local(&self.scope, &self.grant.device_id, record, &envelope)?;
        Ok(serde_json::from_slice(&plain)?)
    }

    /// Cached snapshots are stored as received, with the vault-signed grant
    /// of the last change's author, so callers can re-verify them offline.
    pub fn tree_cache(&self, root: &VaultRoot, tree_id: &str) -> Result<Option<(TreeSnapshot, Option<DeviceGrant>)>> {
        let sealed: Option<String> = self
            .connection
            .query_row("SELECT snapshot FROM sync_tree_cache WHERE tree_id=?1", [tree_id], |r| r.get(0))
            .optional()?;
        sealed.map(|s| self.open_tree(root, &format!("tree-cache:{tree_id}"), &s)).transpose()
    }

    pub fn save_tree_cache(&mut self, root: &VaultRoot, snapshot: &TreeSnapshot, author: Option<&DeviceGrant>) -> Result<()> {
        if !valid_id(&snapshot.tree_id) || snapshot.version > MAX_COUNTER {
            return Err(Error::Invalid);
        }
        let sealed = self.seal_tree(root, &format!("tree-cache:{}", snapshot.tree_id), &(snapshot, author))?;
        // Never let a stale write replace a newer verified cache.
        self.connection.execute(
            "INSERT INTO sync_tree_cache VALUES(?1,?2,?3)
             ON CONFLICT(tree_id) DO UPDATE SET version=excluded.version,snapshot=excluded.snapshot
             WHERE excluded.version>=sync_tree_cache.version",
            params![snapshot.tree_id, snapshot.version, sealed],
        )?;
        Ok(())
    }

    /// Highest tree version this device ever verified; a server offering less
    /// is rolling the tree back.
    pub fn tree_high_watermark(&self, tree_id: &str) -> Result<u64> {
        Ok(self
            .connection
            .query_row("SELECT version FROM sync_tree_cache WHERE tree_id=?1", [tree_id], |r| r.get(0))
            .optional()?
            .unwrap_or(0))
    }

    pub fn tree_desired(&self, root: &VaultRoot, tree_id: &str) -> Result<Option<Desired>> {
        let sealed: Option<String> = self
            .connection
            .query_row("SELECT desired FROM sync_tree_desired WHERE tree_id=?1", [tree_id], |r| r.get(0))
            .optional()?;
        sealed.map(|s| self.open_tree(root, &format!("tree-desired:{tree_id}"), &s)).transpose()
    }

    pub fn set_tree_desired(&mut self, root: &VaultRoot, tree_id: &str, desired: &Desired) -> Result<()> {
        if !valid_id(tree_id) || desired.changes.len() > 20_000 {
            return Err(Error::Invalid);
        }
        let sealed = self.seal_tree(root, &format!("tree-desired:{tree_id}"), desired)?;
        if sealed.len() > 32 << 20 {
            return Err(Error::TooLarge);
        }
        self.connection.execute(
            "INSERT INTO sync_tree_desired VALUES(?1,?2) ON CONFLICT(tree_id) DO UPDATE SET desired=excluded.desired",
            params![tree_id, sealed],
        )?;
        Ok(())
    }

    /// Last roster seen from the server, so this device still knows which
    /// tree it drives while offline. The server's next roster replaces it.
    pub fn tree_roster(&self) -> Result<Vec<Tree>> {
        let raw: Option<String> = self
            .connection
            .query_row("SELECT roster FROM sync_tree_roster WHERE singleton=1", [], |r| r.get(0))
            .optional()?;
        Ok(raw.map(|r| serde_json::from_str(&r)).transpose()?.unwrap_or_default())
    }

    pub fn save_tree_roster(&mut self, roster: &[Tree]) -> Result<()> {
        self.connection.execute(
            "INSERT INTO sync_tree_roster VALUES(1,?1) ON CONFLICT(singleton) DO UPDATE SET roster=excluded.roster",
            [serde_json::to_string(roster)?],
        )?;
        Ok(())
    }

    pub fn tree_desired_exists(&self, tree_id: &str) -> Result<bool> {
        Ok(self
            .connection
            .query_row("SELECT 1 FROM sync_tree_desired WHERE tree_id=?1", [tree_id], |_| Ok(()))
            .optional()?
            .is_some())
    }

    pub fn clear_tree_desired(&mut self, tree_id: &str) -> Result<()> {
        self.connection.execute("DELETE FROM sync_tree_desired WHERE tree_id=?1", [tree_id])?;
        Ok(())
    }

    /// Allocates the next tree counter and records the op as in flight in one
    /// transaction, so a lost acknowledgment resends the identical op.
    pub fn begin_tree_op(&mut self, tree_id: &str, request_id: &str, build: impl FnOnce(u64) -> Result<TreeOp>) -> Result<TreeOp> {
        let tx = self.connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let existing: Option<String> =
            tx.query_row("SELECT op FROM sync_tree_inflight WHERE tree_id=?1", [tree_id], |r| r.get(0)).optional()?;
        if existing.is_some() {
            return Err(Error::Sequence);
        }
        let counter: u64 = tx.query_row("SELECT next_counter FROM sync_tree_counter WHERE singleton=1", [], |r| r.get(0))?;
        let op = build(counter)?;
        if op.device_counter != counter || op.tree_id != tree_id {
            return Err(Error::Invalid);
        }
        tx.execute("INSERT INTO sync_tree_inflight VALUES(?1,?2,?3)", params![tree_id, request_id, serde_json::to_string(&op)?])?;
        tx.execute("UPDATE sync_tree_counter SET next_counter=next_counter+1 WHERE singleton=1", [])?;
        tx.commit()?;
        Ok(op)
    }

    /// Claims share the tree counter but are not tree-scoped ops, so they are
    /// never stored; a lost claim is simply re-signed with a new counter.
    pub fn allocate_tree_counter(&mut self) -> Result<u64> {
        let tx = self.connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let counter: u64 = tx.query_row("SELECT next_counter FROM sync_tree_counter WHERE singleton=1", [], |r| r.get(0))?;
        tx.execute("UPDATE sync_tree_counter SET next_counter=next_counter+1 WHERE singleton=1", [])?;
        tx.commit()?;
        Ok(counter)
    }

    /// The server's roster reports our tree counter; never reuse one it saw.
    pub fn observe_tree_counter(&mut self, last: u64) -> Result<()> {
        if last >= MAX_COUNTER {
            return Err(Error::Invalid);
        }
        self.connection.execute(
            "UPDATE sync_tree_counter SET next_counter=max(next_counter,?1) WHERE singleton=1",
            [last + 1],
        )?;
        Ok(())
    }

    /// With nothing in flight, the server's last accepted tree counter is the
    /// truth: realign to it, including downward after claims that failed
    /// before the server consumed their counter.
    pub fn resync_tree_counter(&mut self, last: u64) -> Result<()> {
        if last >= MAX_COUNTER {
            return Err(Error::Invalid);
        }
        self.connection.execute(
            "UPDATE sync_tree_counter SET next_counter=?1 WHERE singleton=1 AND NOT EXISTS(SELECT 1 FROM sync_tree_inflight)",
            [last + 1],
        )?;
        Ok(())
    }

    pub fn tree_inflight(&self) -> Result<Vec<(String, TreeOp)>> {
        let mut query = self.connection.prepare("SELECT request_id,op FROM sync_tree_inflight ORDER BY tree_id")?;
        let rows = query.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        rows.map(|row| {
            let (request, op) = row?;
            Ok((request, serde_json::from_str(&op)?))
        })
        .collect()
    }

    pub fn finish_tree_op(&mut self, tree_id: &str, operation_id: &str) -> Result<()> {
        let removed = self.connection.execute(
            "DELETE FROM sync_tree_inflight WHERE tree_id=?1 AND json_extract(op,'$.operation_id')=?2",
            params![tree_id, operation_id],
        )?;
        if removed != 1 {
            return Err(Error::Sequence);
        }
        Ok(())
    }
}
