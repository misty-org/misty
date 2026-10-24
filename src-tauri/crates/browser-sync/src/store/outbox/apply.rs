//! Acknowledging sent edits and applying the vault's events onto the
//! committed snapshot.
use super::*;

impl Store {
    pub fn acknowledge(&mut self, receipt: &Receipt) -> Result<()> {
        if receipt.discarded {
            if !valid_id(&receipt.operation_id) || receipt.sequence > MAX_COUNTER {
                return Err(Error::Invalid);
            }
            let tx = self
                .connection
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            // Keep the encrypted stale edit for recovery while allowing the
            // already-consumed server counter to drain from our transport queue.
            tx.execute("INSERT OR IGNORE INTO sync_discarded SELECT operation_id,?2,mutation FROM sync_outbox WHERE operation_id=?1 AND accepted_sequence IS NULL",
                params![receipt.operation_id, receipt.sequence])?;
            let sequence: Option<u64> = tx
                .query_row(
                    "SELECT sequence FROM sync_discarded WHERE operation_id=?1",
                    [&receipt.operation_id],
                    |r| r.get(0),
                )
                .optional()?;
            if sequence != Some(receipt.sequence) {
                return Err(Error::Sequence);
            }
            tx.execute(
                "DELETE FROM sync_outbox WHERE operation_id=?1",
                [&receipt.operation_id],
            )?;
            tx.execute("UPDATE sync_high_watermark SET observed_head=max(observed_head,?1) WHERE singleton=1", [receipt.sequence])?;
            tx.commit()?;
            return Ok(());
        }
        if !valid_id(&receipt.operation_id) || !counter(receipt.sequence) {
            return Err(Error::Invalid);
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let row: Option<Option<u64>> = tx
            .query_row(
                "SELECT accepted_sequence FROM sync_outbox WHERE operation_id=?1",
                [&receipt.operation_id],
                |r| r.get(0),
            )
            .optional()?;
        match row {
            Some(Some(sequence)) if sequence != receipt.sequence => return Err(Error::Sequence),
            Some(_) => {
                let cursor: u64 = tx.query_row(
                    "SELECT applied_sequence FROM sync_identity WHERE singleton=1",
                    [],
                    |r| r.get(0),
                )?;
                if receipt.sequence <= cursor {
                    return Err(Error::Sequence);
                }
                tx.execute(
                    "UPDATE sync_outbox SET accepted_sequence=?2 WHERE operation_id=?1",
                    params![receipt.operation_id, receipt.sequence],
                )?;
            }
            None => {
                let sequence: Option<u64> = tx
                    .query_row(
                        "SELECT sequence FROM sync_applied WHERE operation_id=?1",
                        [&receipt.operation_id],
                        |r| r.get(0),
                    )
                    .optional()?;
                if sequence != Some(receipt.sequence) {
                    return Err(Error::Sequence);
                }
            }
        }
        tx.execute(
            "UPDATE sync_high_watermark SET observed_head=max(observed_head,?1) WHERE singleton=1",
            [receipt.sequence],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Validate and reduce a complete contiguous page in one transaction. The
    /// reducer must be pure: publishing UI/native browser changes happens only
    /// after commit. It receives committed state, never the optimistic overlay.
    pub fn apply_events<F>(
        &mut self,
        root: &VaultRoot,
        events: &[(Event, DeviceGrant)],
        mut reduce: F,
    ) -> Result<u64>
    where
        F: FnMut(&[u8], &[u8], &EventContext) -> Result<Zeroizing<Vec<u8>>>,
    {
        if events.is_empty() || events.len() > 200 {
            return Err(Error::Invalid);
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (mut cursor, snapshot): (u64, String) = tx.query_row(
            "SELECT applied_sequence,snapshot FROM sync_identity WHERE singleton=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let mut state = root.open_local(
            &self.scope,
            &self.grant.device_id,
            &format!("snapshot:{cursor}"),
            &serde_json::from_str(&snapshot)?,
        )?;
        let original_cursor = cursor;
        for (event, grant) in events {
            if !counter(event.sequence) {
                return Err(Error::Sequence);
            }
            let plaintext = root.open_mutation(&self.scope, grant, &event.mutation)?;
            let digest = Sha256::digest(event.mutation.signing_bytes()?).to_vec();
            if event.sequence <= cursor {
                let previous: Option<(String, Vec<u8>)> = tx
                    .query_row(
                        "SELECT operation_id,digest FROM sync_applied WHERE sequence=?1",
                        [event.sequence],
                        |r| Ok((r.get(0)?, r.get(1)?)),
                    )
                    .optional()?;
                if previous != Some((event.mutation.operation_id.clone(), digest)) {
                    return Err(Error::Sequence);
                }
                continue;
            }
            if event.sequence != cursor + 1 {
                return Err(Error::Sequence);
            }
            let pending: Option<(String, Option<u64>)> = tx
                .query_row(
                    "SELECT mutation,accepted_sequence FROM sync_outbox WHERE operation_id=?1",
                    [&event.mutation.operation_id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;
            if let Some((mutation_json, accepted)) = pending {
                if serde_json::from_str::<Mutation>(&mutation_json)? != event.mutation
                    || accepted.is_some_and(|s| s != event.sequence)
                {
                    return Err(Error::Sequence);
                }
            }
            state = reduce(
                &state,
                &plaintext,
                &EventContext {
                    sequence: event.sequence,
                    operation_id: event.mutation.operation_id.clone(),
                    device_id: event.mutation.device_id.clone(),
                },
            )?;
            tx.execute(
                "INSERT INTO sync_applied VALUES(?1,?2,?3)",
                params![event.sequence, event.mutation.operation_id, digest],
            )?;
            tx.execute(
                "DELETE FROM sync_outbox WHERE operation_id=?1",
                [&event.mutation.operation_id],
            )?;
            cursor = event.sequence;
        }
        if cursor != original_cursor {
            let envelope = root.seal_local(
                &self.scope,
                &self.grant.device_id,
                &format!("snapshot:{cursor}"),
                &state,
            )?;
            tx.execute(
                "UPDATE sync_identity SET applied_sequence=?1,snapshot=?2 WHERE singleton=1",
                params![cursor, serde_json::to_string(&envelope)?],
            )?;
        }
        tx.commit()?;
        Ok(cursor)
    }
}
