//! Turning queued local state into signed ops, one per workspace per tick.
use super::*;

impl WorkspaceSync {
    /// Publishes at most one op per workspace, only once the workspace's server state
    /// has arrived on this connection, for the workspace this machine is on and
    /// the shared workspace. Sign-in writes go only with the lease.
    pub fn tick(
        &mut self,
        store: &mut Store,
        root: &VaultRoot,
        scope: &VaultScope,
        grant: &DeviceGrant,
        device: &DeviceKey,
    ) -> Result<Vec<Outgoing>> {
        if self
            .inflight
            .values()
            .any(|(_, _, sent, _)| sent.elapsed() >= OP_TIMEOUT)
        {
            return Err(Error::Network);
        }
        let now = Instant::now();
        let mut out = Vec::new();
        let writable: Vec<String> = self
            .publish_targets()
            .into_iter()
            .filter(|t| self.current.contains(t) && !self.inflight.contains_key(t))
            .collect();
        for workspace in writable {
            // Sign-in writes need the lease; without it they would get the
            // whole op rejected. The holder publishes its own.
            if workspace != self.shared_id
                && !(self.driving() == Some(workspace.as_str()) && self.lease_ready())
            {
                self.drop_signin_writes(store, root, &workspace)?;
            }
            if !store.workspace_desired_exists(&workspace)? {
                continue;
            }
            // A queue still inside its batch is not decrypted on every tick.
            if !self.batch.due(&workspace, Lane::Workspace, now)
                && !self.batch.due(&workspace, Lane::Slots, now)
            {
                crate::workspace::stats::add(&crate::workspace::stats::OPS_DEFERRED, 1);
                continue;
            }
            let Some(desired) = store.workspace_desired(root, &workspace)? else {
                continue;
            };
            let lane = if desired.changes.is_empty() {
                Lane::Slots
            } else {
                Lane::Workspace
            };
            if !self.batch.due(&workspace, lane, now) {
                crate::workspace::stats::add(&crate::workspace::stats::OPS_DEFERRED, 1);
                continue;
            }
            let state = self
                .states
                .get(&workspace)
                .cloned()
                .unwrap_or_else(|| WorkspaceState::empty(&workspace));
            let records =
                model::rebase_batches(&state.records, &desired.batches(), &state.tombstones)?;
            // Focus is local to each machine: new ops carry none.
            let resume: Option<Resume> = None;
            // Oldest slot writes first, within the op's size budget; the rest
            // stay queued for the next op. The first write always fits alone.
            let mut take = 0;
            let mut bytes = 0;
            for (_, _, value) in &desired.slots {
                let size = match value {
                    Some(plain) => codec::encode(plain, Padding::Bucket)?.len() + SEAL_OVERHEAD,
                    None => 0,
                };
                if take > 0 && bytes + size > OP_SLOT_BUDGET {
                    break;
                }
                bytes += size;
                take += 1;
            }
            // Last write per slot wins within one op.
            let mut slots: Vec<(String, i16, Option<Vec<u8>>)> = Vec::new();
            for (tab, kind, value) in &desired.slots[..take] {
                slots.retain(|(t, k, _)| !(t == tab && k == kind));
                slots.push((tab.clone(), *kind, value.clone()));
            }
            // Slots of tabs that no longer exist are dropped, not errors.
            let placed = model::place(&workspace, &records);
            slots.retain(|(tab, kind, _)| {
                placed.contains_key(tab) || (*tab == workspace && is_signin_slot(*kind))
            });
            let request_id = Uuid::new_v4().to_string();
            let mut built = None;
            let result = store.begin_workspace_op(&workspace, &request_id, |counter| {
                let op = state
                    .build_op(
                        root,
                        scope,
                        grant,
                        device,
                        counter,
                        &records,
                        resume.as_ref(),
                        slots,
                        desired.blob_refs.clone(),
                    )?
                    .ok_or(Error::Sequence)?;
                built = Some(op.clone());
                Ok(op)
            });
            let carried = Carried {
                changes: desired.changes.len(),
                slots: take,
            };
            // The queue is spoken for; edits from now on start the next batch.
            self.batch.published(&workspace);
            if take < desired.slots.len() {
                // Writes beyond one op's size already waited their turn.
                self.batch.retry(&workspace);
            }
            match result {
                Ok(op) => {
                    let written = op.upserts.len() + op.deletes.len();
                    crate::workspace::stats::add(
                        &crate::workspace::stats::EDITS_COALESCED,
                        carried.changes.saturating_sub(written) as u64,
                    );
                    self.inflight.insert(
                        workspace.clone(),
                        (request_id.clone(), op.clone(), Instant::now(), carried),
                    );
                    out.push(Outgoing::Publish { request_id, op });
                }
                // Nothing to publish: the workspace already matches. Slot writes
                // beyond this op's budget are still queued.
                Err(Error::Sequence) if built.is_none() && take == desired.slots.len() => {
                    store.clear_workspace_desired(&workspace)?
                }
                Err(Error::Sequence) if built.is_none() => {
                    Self::drain_carried(store, root, &workspace, &carried)?
                }
                Err(error) => return Err(error),
            }
        }
        Ok(out)
    }
}
