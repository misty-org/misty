//! The outbox: local edits waiting for the server, their acknowledgment, and
//! applying the vault's events onto the committed snapshot.
use super::*;

mod apply;

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
