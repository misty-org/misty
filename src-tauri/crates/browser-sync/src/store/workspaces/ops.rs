//! In-flight workspace ops and the device's workspace counter.
use super::*;

impl Store {
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
