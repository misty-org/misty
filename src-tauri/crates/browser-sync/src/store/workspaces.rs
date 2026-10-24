//! Durable workspace-protocol state: verified workspace caches (re-verified on load),
//! the local desired state still to publish, one in-flight op per workspace, and
//! the device's workspace counter. Everything readable is sealed with the vault's
//! local key except in-flight ops, which already hold only ciphertext.
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};

use super::Store;
use crate::{
    crypto::VaultRoot,
    protocol::{valid_id, DeviceGrant, Envelope, MAX_COUNTER},
    workspace::protocol::{Workspace, WorkspaceOp, WorkspaceSnapshot},
    Error, Result,
};

mod desired;
mod ops;
pub use desired::{Batch, Desired};

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
}
