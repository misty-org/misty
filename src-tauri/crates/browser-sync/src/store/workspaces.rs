//! Durable workspace-protocol state: verified workspace caches (re-verified on load),
//! the local desired state still to publish, one in-flight op per workspace, and
//! the device's workspace counter. Everything readable is sealed with the vault's
//! local key except in-flight ops, which already hold only ciphertext.
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};

use super::Store;
use crate::{
    crypto::VaultRoot,
    document::{Change, Resume},
    protocol::{valid_id, DeviceGrant, Envelope, MAX_COUNTER},
    workspace::protocol::{Workspace, WorkspaceOp, WorkspaceSnapshot},
    Error, Result,
};

/// Local edits still to publish. They survive restarts and offline periods
/// and are rebuilt into a fresh op against whatever version the server holds
/// when the device can publish. Changes are replayed onto the latest server
/// records (a rebase), so concurrent edits to the shared workspace from other
/// devices are never overwritten by a stale full copy.
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Desired {
    pub changes: Vec<Change>,
    /// Written by older versions, which synced focus. Read so their queues
    /// still load; never sent.
    pub resume: Option<Resume>,
    /// Pending slot writes keyed by `(tab node, slot)`; `None` deletes.
    pub slots: Vec<(String, i16, Option<Vec<u8>>)>,
    pub blob_refs: Vec<Vec<u8>>,
    /// One entry per user edit, in order, covering `changes`: how many
    /// changes it holds and the verified workspace version it was made against.
    /// Queues written before batches existed have none (see `batches`).
    #[serde(default)]
    pub batches: Vec<Batch>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Batch {
    pub len: usize,
    /// The verified workspace version when the edit was made. A record another
    /// machine deleted after this version is not recreated by the edit.
    pub base: u64,
}

impl Desired {
    pub fn is_empty(&self) -> bool {
        self.changes.is_empty()
            && self.resume.is_none()
            && self.slots.is_empty()
            && self.blob_refs.is_empty()
    }

    pub fn push_batch(&mut self, changes: Vec<Change>, base: u64) {
        if changes.is_empty() {
            return;
        }
        self.batches.push(Batch {
            len: changes.len(),
            base,
        });
        self.changes.extend(changes);
    }

    /// The queued edits in order with their base versions. Changes queued
    /// before batches were recorded come first, as one edit of unknown base
    /// (0): stale creates in it are dropped rather than risk resurrection.
    pub fn batches(&self) -> Vec<(u64, &[Change])> {
        let tracked: usize = self.batches.iter().map(|b| b.len).sum();
        let untracked = self.changes.len().saturating_sub(tracked);
        let mut out = Vec::with_capacity(self.batches.len() + 1);
        let mut at = 0;
        if untracked > 0 {
            out.push((0, &self.changes[..untracked]));
            at = untracked;
        }
        for batch in &self.batches {
            let end = (at + batch.len).min(self.changes.len());
            if end > at {
                out.push((batch.base, &self.changes[at..end]));
            }
            at = end;
        }
        out
    }

    /// Removes the first `n` changes (what an accepted op carried), keeping
    /// the batch bookkeeping aligned with what remains.
    pub fn drain_changes(&mut self, n: usize) {
        let n = n.min(self.changes.len());
        let tracked: usize = self.batches.iter().map(|b| b.len).sum();
        let mut remove = n.saturating_sub(self.changes.len().saturating_sub(tracked));
        self.changes.drain(..n);
        while remove > 0 {
            let Some(first) = self.batches.first_mut() else {
                break;
            };
            if first.len <= remove {
                remove -= first.len;
                self.batches.remove(0);
            } else {
                first.len -= remove;
                remove = 0;
            }
        }
    }

    /// Drops the oldest edit. A rejected op is retried without it, so one
    /// bad edit costs only itself, never the edits queued behind it.
    pub fn drop_first_batch(&mut self) {
        let first = self
            .batches()
            .first()
            .map_or(0, |(_, changes)| changes.len());
        self.drain_changes(first);
    }
}

/// This session's standing toward the workspaces, kept across restarts. Only IDs
/// and epochs; nothing here is workspace content.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkspaceLocal {
    /// The workspace kept current while this session drives none: the one it
    /// drove last, so taking it back continues from the server's latest copy.
    pub following: Option<String>,
    /// `(workspace, driver epoch)` under which this session's copy of the driven
    /// workspace reached the server's version. Edits are accepted only then.
    pub ready: Option<(String, String)>,
}

/// Retired desired states kept for recovery.
const RETIRED_KEPT: i64 = 16;

impl Store {
    pub(super) fn seal_workspace(
        &self,
        root: &VaultRoot,
        record: &str,
        value: &impl Serialize,
    ) -> Result<String> {
        let plain = zeroize::Zeroizing::new(serde_json::to_vec(value)?);
        Ok(serde_json::to_string(&root.seal_local(
            &self.scope,
            &self.grant.device_id,
            record,
            &plain,
        )?)?)
    }

    pub(super) fn open_workspace<T: for<'de> Deserialize<'de>>(
        &self,
        root: &VaultRoot,
        record: &str,
        sealed: &str,
    ) -> Result<T> {
        let envelope: Envelope = serde_json::from_str(sealed)?;
        let plain = root.open_local(&self.scope, &self.grant.device_id, record, &envelope)?;
        Ok(serde_json::from_slice(&plain)?)
    }

    /// Cached snapshots are stored as received, with the vault-signed grant
    /// of the last change's author, so callers can re-verify them offline.
    pub fn workspace_cache(
        &self,
        root: &VaultRoot,
        workspace_id: &str,
    ) -> Result<Option<(WorkspaceSnapshot, Option<DeviceGrant>)>> {
        let sealed: Option<String> = self
            .connection
            .query_row(
                "SELECT snapshot FROM sync_workspace_cache WHERE workspace_id=?1",
                [workspace_id],
                |r| r.get(0),
            )
            .optional()?;
        sealed
            .map(|s| self.open_workspace(root, &format!("tree-cache:{workspace_id}"), &s))
            .transpose()
    }

    pub fn save_workspace_cache(
        &mut self,
        root: &VaultRoot,
        snapshot: &WorkspaceSnapshot,
        author: Option<&DeviceGrant>,
    ) -> Result<()> {
        if !valid_id(&snapshot.workspace_id) || snapshot.version > MAX_COUNTER {
            return Err(Error::Invalid);
        }
        let sealed = self.seal_workspace(
            root,
            &format!("tree-cache:{}", snapshot.workspace_id),
            &(snapshot, author),
        )?;
        // Never let a stale write replace a newer verified cache.
        self.connection.execute(
            "INSERT INTO sync_workspace_cache VALUES(?1,?2,?3)
             ON CONFLICT(workspace_id) DO UPDATE SET version=excluded.version,snapshot=excluded.snapshot
             WHERE excluded.version>=sync_workspace_cache.version",
            params![snapshot.workspace_id, snapshot.version, sealed],
        )?;
        Ok(())
    }

    /// Highest workspace version this device ever verified; a server offering less
    /// is rolling the workspace back.
    pub fn workspace_high_watermark(&self, workspace_id: &str) -> Result<u64> {
        Ok(self
            .connection
            .query_row(
                "SELECT version FROM sync_workspace_cache WHERE workspace_id=?1",
                [workspace_id],
                |r| r.get(0),
            )
            .optional()?
            .unwrap_or(0))
    }

    pub fn workspace_desired(
        &self,
        root: &VaultRoot,
        workspace_id: &str,
    ) -> Result<Option<Desired>> {
        let sealed: Option<String> = self
            .connection
            .query_row(
                "SELECT desired FROM sync_workspace_desired WHERE workspace_id=?1",
                [workspace_id],
                |r| r.get(0),
            )
            .optional()?;
        sealed
            .map(|s| self.open_workspace(root, &format!("tree-desired:{workspace_id}"), &s))
            .transpose()
    }

    pub fn set_workspace_desired(
        &mut self,
        root: &VaultRoot,
        workspace_id: &str,
        desired: &Desired,
    ) -> Result<()> {
        if !valid_id(workspace_id) || desired.changes.len() > 20_000 {
            return Err(Error::Invalid);
        }
        let sealed = self.seal_workspace(root, &format!("tree-desired:{workspace_id}"), desired)?;
        if sealed.len() > 32 << 20 {
            return Err(Error::TooLarge);
        }
        self.connection.execute(
            "INSERT INTO sync_workspace_desired VALUES(?1,?2) ON CONFLICT(workspace_id) DO UPDATE SET desired=excluded.desired",
            params![workspace_id, sealed],
        )?;
        Ok(())
    }

    /// Last roster seen from the server, so this device still knows which
    /// workspace it drives while offline. The server's next roster replaces it.
    pub fn workspace_roster(&self) -> Result<Vec<Workspace>> {
        let raw: Option<String> = self
            .connection
            .query_row(
                "SELECT roster FROM sync_workspace_roster WHERE singleton=1",
                [],
                |r| r.get(0),
            )
            .optional()?;
        Ok(raw
            .map(|r| serde_json::from_str(&r))
            .transpose()?
            .unwrap_or_default())
    }

    pub fn save_workspace_roster(&mut self, roster: &[Workspace]) -> Result<()> {
        self.connection.execute(
            "INSERT INTO sync_workspace_roster VALUES(1,?1) ON CONFLICT(singleton) DO UPDATE SET roster=excluded.roster",
            [serde_json::to_string(roster)?],
        )?;
        Ok(())
    }

    pub fn workspace_local(&self) -> Result<WorkspaceLocal> {
        let raw: Option<String> = self
            .connection
            .query_row(
                "SELECT state FROM sync_workspace_local WHERE singleton=1",
                [],
                |r| r.get(0),
            )
            .optional()?;
        Ok(raw
            .map(|r| serde_json::from_str(&r))
            .transpose()?
            .unwrap_or_default())
    }

    pub fn set_workspace_local(&mut self, local: &WorkspaceLocal) -> Result<()> {
        if local
            .following
            .as_deref()
            .is_some_and(|workspace| !valid_id(workspace))
            || local
                .ready
                .as_ref()
                .is_some_and(|(workspace, _)| !valid_id(workspace))
        {
            return Err(Error::Invalid);
        }
        self.connection.execute(
            "INSERT INTO sync_workspace_local VALUES(1,?1) ON CONFLICT(singleton) DO UPDATE SET state=excluded.state",
            [serde_json::to_string(local)?],
        )?;
        Ok(())
    }

    /// Moves a workspace's unpublished desired state out of the publishing path,
    /// sealed as before, so it is kept for recovery but never replayed.
    pub fn retire_workspace_desired(
        &mut self,
        root: &VaultRoot,
        workspace_id: &str,
    ) -> Result<bool> {
        let Some(desired) = self.workspace_desired(root, workspace_id)? else {
            return Ok(false);
        };
        let sealed =
            self.seal_workspace(root, &format!("tree-desired:{workspace_id}"), &desired)?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_millis() as i64);
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute(
            "INSERT INTO sync_workspace_retired(workspace_id,retired_at,desired) VALUES(?1,?2,?3)",
            params![workspace_id, now, sealed],
        )?;
        tx.execute("DELETE FROM sync_workspace_retired WHERE id NOT IN (SELECT id FROM sync_workspace_retired ORDER BY id DESC LIMIT ?1)", [RETIRED_KEPT])?;
        tx.execute(
            "DELETE FROM sync_workspace_desired WHERE workspace_id=?1",
            [workspace_id],
        )?;
        tx.commit()?;
        Ok(true)
    }

    /// How many set-aside desired states are kept for recovery.
    pub fn retired_workspace_count(&self) -> Result<usize> {
        let count: i64 =
            self.connection
                .query_row("SELECT count(*) FROM sync_workspace_retired", [], |r| {
                    r.get(0)
                })?;
        Ok(count.max(0) as usize)
    }

    #[cfg(test)]
    pub(crate) fn retired_workspace_desired(
        &self,
        root: &VaultRoot,
        workspace_id: &str,
    ) -> Result<Vec<Desired>> {
        let mut query = self.connection.prepare(
            "SELECT desired FROM sync_workspace_retired WHERE workspace_id=?1 ORDER BY id",
        )?;
        let rows = query.query_map([workspace_id], |r| r.get::<_, String>(0))?;
        rows.map(|row| self.open_workspace(root, &format!("tree-desired:{workspace_id}"), &row?))
            .collect()
    }

    pub fn workspace_desired_exists(&self, workspace_id: &str) -> Result<bool> {
        Ok(self
            .connection
            .query_row(
                "SELECT 1 FROM sync_workspace_desired WHERE workspace_id=?1",
                [workspace_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some())
    }

    pub fn clear_workspace_desired(&mut self, workspace_id: &str) -> Result<()> {
        self.connection.execute(
            "DELETE FROM sync_workspace_desired WHERE workspace_id=?1",
            [workspace_id],
        )?;
        Ok(())
    }

    /// Allocates the next workspace counter and records the op as in flight in one
    /// transaction, so a lost acknowledgment resends the identical op.
    pub fn begin_workspace_op(
        &mut self,
        workspace_id: &str,
        request_id: &str,
        build: impl FnOnce(u64) -> Result<WorkspaceOp>,
    ) -> Result<WorkspaceOp> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let existing: Option<String> = tx
            .query_row(
                "SELECT op FROM sync_workspace_inflight WHERE workspace_id=?1",
                [workspace_id],
                |r| r.get(0),
            )
            .optional()?;
        if existing.is_some() {
            return Err(Error::Sequence);
        }
        let counter: u64 = tx.query_row(
            "SELECT next_counter FROM sync_workspace_counter WHERE singleton=1",
            [],
            |r| r.get(0),
        )?;
        let op = build(counter)?;
        if op.device_counter != counter || op.workspace_id != workspace_id {
            return Err(Error::Invalid);
        }
        tx.execute(
            "INSERT INTO sync_workspace_inflight VALUES(?1,?2,?3)",
            params![workspace_id, request_id, serde_json::to_string(&op)?],
        )?;
        tx.execute(
            "UPDATE sync_workspace_counter SET next_counter=next_counter+1 WHERE singleton=1",
            [],
        )?;
        tx.commit()?;
        Ok(op)
    }

    /// Claims share the workspace counter but are not workspace-scoped ops, so they are
    /// never stored; a lost claim is simply re-signed with a new counter.
    pub fn allocate_workspace_counter(&mut self) -> Result<u64> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let counter: u64 = tx.query_row(
            "SELECT next_counter FROM sync_workspace_counter WHERE singleton=1",
            [],
            |r| r.get(0),
        )?;
        tx.execute(
            "UPDATE sync_workspace_counter SET next_counter=next_counter+1 WHERE singleton=1",
            [],
        )?;
        tx.commit()?;
        Ok(counter)
    }

    /// The server's roster reports our workspace counter; never reuse one it saw.
    pub fn observe_workspace_counter(&mut self, last: u64) -> Result<()> {
        if last >= MAX_COUNTER {
            return Err(Error::Invalid);
        }
        self.connection.execute(
            "UPDATE sync_workspace_counter SET next_counter=max(next_counter,?1) WHERE singleton=1",
            [last + 1],
        )?;
        Ok(())
    }

    /// With nothing in flight, the server's last accepted workspace counter is the
    /// truth: realign to it, including downward after claims that failed
    /// before the server consumed their counter.
    pub fn resync_workspace_counter(&mut self, last: u64) -> Result<()> {
        if last >= MAX_COUNTER {
            return Err(Error::Invalid);
        }
        self.connection.execute(
            "UPDATE sync_workspace_counter SET next_counter=?1 WHERE singleton=1 AND NOT EXISTS(SELECT 1 FROM sync_workspace_inflight)",
            [last + 1],
        )?;
        Ok(())
    }

    pub fn workspace_inflight(&self) -> Result<Vec<(String, WorkspaceOp)>> {
        let mut query = self
            .connection
            .prepare("SELECT request_id,op FROM sync_workspace_inflight ORDER BY workspace_id")?;
        let rows = query.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        rows.map(|row| {
            let (request, op) = row?;
            Ok((request, serde_json::from_str(&op)?))
        })
        .collect()
    }

    pub fn finish_workspace_op(&mut self, workspace_id: &str, operation_id: &str) -> Result<()> {
        let removed = self.connection.execute(
            "DELETE FROM sync_workspace_inflight WHERE workspace_id=?1 AND json_extract(op,'$.operation_id')=?2",
            params![workspace_id, operation_id],
        )?;
        if removed != 1 {
            return Err(Error::Sequence);
        }
        Ok(())
    }
}
