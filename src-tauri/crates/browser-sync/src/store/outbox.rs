//! The outbox: local edits waiting for the server, their acknowledgment, and
//! applying the vault's events onto the committed snapshot.
use super::*;

impl Store {
    pub fn pending_count(&self) -> Result<u64> {
        Ok(self
            .connection
            .query_row("SELECT count(*) FROM sync_outbox", [], |r| r.get(0))?)
    }

    pub fn committed_snapshot(&self, root: &VaultRoot) -> Result<Zeroizing<Vec<u8>>> {
        let (cursor, snapshot): (u64, String) = self.connection.query_row(
            "SELECT applied_sequence,snapshot FROM sync_identity WHERE singleton=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        root.open_local(
            &self.scope,
            &self.grant.device_id,
            &format!("snapshot:{cursor}"),
            &serde_json::from_str(&snapshot)?,
        )
    }

    /// A native-only, tentative view of durable local edits. Its reducer sequence
    /// is synthetic and must never be used as a replay/import cursor or persisted
    /// as committed state. Rebuild after replay to rebase pending edits.
    pub fn pending_snapshot<F>(&self, root: &VaultRoot, mut reduce: F) -> Result<PendingSnapshot>
    where
        F: FnMut(&[u8], &[u8], &EventContext) -> Result<Zeroizing<Vec<u8>>>,
    {
        let committed_sequence = self.applied_sequence()?;
        let mut snapshot = self.committed_snapshot(root)?;
        let mut operation_ids = Vec::new();
        let mut query = self
            .connection
            .prepare("SELECT mutation FROM sync_outbox ORDER BY device_counter")?;
        let rows = query.query_map([], |r| r.get::<_, String>(0))?;
        for row in rows {
            if operation_ids.len() >= MAX_PENDING_COUNT as usize {
                return Err(Error::TooLarge);
            }
            let mutation: Mutation = serde_json::from_str(&row?)?;
            let payload = root.open_mutation(&self.scope, &self.grant, &mutation)?;
            let sequence = committed_sequence + operation_ids.len() as u64 + 1;
            if sequence > MAX_COUNTER {
                return Err(Error::TooLarge);
            }
            snapshot = reduce(
                &snapshot,
                &payload,
                &EventContext {
                    sequence,
                    operation_id: mutation.operation_id.clone(),
                    device_id: mutation.device_id,
                },
            )?;
            operation_ids.push(mutation.operation_id);
        }
        Ok(PendingSnapshot {
            committed_sequence,
            operation_ids,
            snapshot,
        })
    }

    pub fn enqueue(
        &mut self,
        root: &VaultRoot,
        device: &DeviceKey,
        plaintext: &[u8],
    ) -> Result<Mutation> {
        self.enqueue_identified(root, device, &Uuid::new_v4().to_string(), plaintext)?
            .ok_or(Error::Identity)
    }

    /// None means this exact edit was already accepted locally, possibly applied
    /// and removed from the outbox. It must not be submitted again after an IPC
    /// acknowledgment was lost. Reusing an ID with different bytes is rejected.
    pub fn enqueue_identified(
        &mut self,
        root: &VaultRoot,
        device: &DeviceKey,
        operation_id: &str,
        plaintext: &[u8],
    ) -> Result<Option<Mutation>> {
        if !valid_id(operation_id) {
            return Err(Error::Invalid);
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if received_intent(
            &tx,
            root,
            &self.scope,
            &self.grant.device_id,
            operation_id,
            plaintext,
        )? {
            return Ok(None);
        }
        let (count, bytes): (u64, u64) = tx.query_row(
            "SELECT count(*),coalesce(sum(length(mutation)),0) FROM sync_outbox",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        if count >= MAX_PENDING_COUNT {
            return Err(Error::TooLarge);
        }
        let next_counter: u64 = tx.query_row(
            "SELECT next_counter FROM sync_identity WHERE singleton=1",
            [],
            |r| r.get(0),
        )?;
        let mutation = root.seal_mutation(
            &self.scope,
            &self.grant,
            device,
            operation_id,
            next_counter,
            plaintext,
        )?;
        let encoded = serde_json::to_string(&mutation)?;
        if bytes + encoded.len() as u64 > MAX_PENDING_BYTES {
            return Err(Error::TooLarge);
        }
        tx.execute(
            "INSERT INTO sync_outbox(operation_id,device_counter,mutation) VALUES(?1,?2,?3)",
            params![mutation.operation_id, mutation.device_counter, encoded],
        )?;
        let digest = Zeroizing::new(Sha256::digest(plaintext).to_vec());
        let protected = root.seal_local(
            &self.scope,
            &self.grant.device_id,
            &format!("intent:{operation_id}"),
            &digest,
        )?;
        tx.execute(
            "INSERT INTO sync_local_intents VALUES(?1,?2)",
            params![operation_id, serde_json::to_string(&protected)?],
        )?;
        tx.execute(
            "UPDATE sync_identity SET next_counter=next_counter+1 WHERE singleton=1",
            [],
        )?;
        tx.commit()?;
        Ok(Some(mutation))
    }

    pub fn received_intent(
        &self,
        root: &VaultRoot,
        operation_id: &str,
        plaintext: &[u8],
    ) -> Result<bool> {
        received_intent(
            &self.connection,
            root,
            &self.scope,
            &self.grant.device_id,
            operation_id,
            plaintext,
        )
    }

    /// Small ordered pages prevent an offline backlog becoming an unbounded
    /// socket write buffer. A lost acknowledgment resends the exact same bytes.
    pub fn pending(&self, unacknowledged_only: bool, limit: usize) -> Result<Vec<Mutation>> {
        if limit == 0 || limit > 200 {
            return Err(Error::Invalid);
        }
        let mut query = self.connection.prepare(
            "SELECT mutation FROM sync_outbox
            WHERE (?1=0 OR accepted_sequence IS NULL) ORDER BY device_counter LIMIT ?2",
        )?;
        let rows = query.query_map(params![unacknowledged_only, limit as u32], |r| {
            r.get::<_, String>(0)
        })?;
        rows.map(|row| Ok(serde_json::from_str(&row?)?)).collect()
    }

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

fn received_intent(
    connection: &Connection,
    root: &VaultRoot,
    scope: &VaultScope,
    device_id: &str,
    operation_id: &str,
    plaintext: &[u8],
) -> Result<bool> {
    if !valid_id(operation_id) {
        return Err(Error::Invalid);
    }
    let encoded: Option<String> = connection
        .query_row(
            "SELECT fingerprint FROM sync_local_intents WHERE operation_id=?1",
            [operation_id],
            |r| r.get(0),
        )
        .optional()?;
    let Some(encoded) = encoded else {
        return Ok(false);
    };
    let fingerprint = root.open_local(
        scope,
        device_id,
        &format!("intent:{operation_id}"),
        &serde_json::from_str(&encoded)?,
    )?;
    let expected = Zeroizing::new(Sha256::digest(plaintext).to_vec());
    if fingerprint.as_slice() != expected.as_slice() {
        return Err(Error::Identity);
    }
    Ok(true)
}
