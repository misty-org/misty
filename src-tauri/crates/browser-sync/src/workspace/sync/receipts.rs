//! Server receipts on `WorkspaceSync`: op acknowledgments and errors.
use super::*;

impl WorkspaceSync {
    pub fn on_ack(
        &mut self,
        store: &mut Store,
        v: &Verifier<'_>,
        request: Option<&str>,
        receipt: WorkspaceReceipt,
    ) -> Result<()> {
        if let Some((_, reply)) = request.and_then(|r| self.claims.remove(r)) {
            let result = if receipt.discarded {
                Err(Error::InactiveDevice)
            } else {
                Ok(())
            };
            if let Some(reply) = reply {
                let _ = reply.send(result);
            }
            return Ok(());
        }
        let Some(workspace) = self
            .inflight
            .iter()
            .find(|(_, (_, op, _, _))| op.operation_id == receipt.operation_id)
            .map(|(t, _)| t.clone())
        else {
            return Ok(());
        };
        let (_, op, _, carried) = self.inflight.remove(&workspace).expect("present");
        store.finish_workspace_op(&workspace, &op.operation_id)?;
        if receipt.discarded && receipt.reason.as_deref() == Some("shared_retired") {
            // Bookmarks live in collections now; nothing queued here applies.
            store.clear_workspace_desired(&workspace)?;
            return Ok(());
        }
        if receipt.discarded {
            // The lease moved after this op was built: its sign-in writes
            // belong to the new holder. Everything else is retried.
            if receipt.reason.as_deref() == Some("not_driver") {
                self.drop_signin_writes(store, v.root, &workspace)?;
            }
            // Version conflicts rebase onto the next delta and are retried
            // without waiting for another batch.
            self.batch.retry(&workspace);
            return Ok(());
        }
        let mut state = self
            .states
            .get(&workspace)
            .cloned()
            .unwrap_or_else(|| WorkspaceState::empty(&workspace));
        if state.version == op.base_workspace_version {
            state.apply_own(v, &op)?;
            self.accept(store, v, state, false)?;
        }
        // The server holds exactly what this machine's browser store produced.
        let signin: Vec<(i16, Option<[u8; 32]>)> = op
            .slots
            .iter()
            .filter(|s| s.view_node_id == workspace && is_signin_slot(s.slot))
            .map(|s| (s.slot, s.ciphertext.as_deref().map(content_hash)))
            .collect();
        if !signin.is_empty() {
            store.mark_signin_applied(v.root, &workspace, &signin)?;
        }
        Self::drain_carried(store, v.root, &workspace, &carried)
    }

    /// Removes what an accepted (or empty) op carried from the desired state.
    pub(super) fn drain_carried(
        store: &mut Store,
        root: &VaultRoot,
        workspace: &str,
        carried: &Carried,
    ) -> Result<()> {
        if let Some(mut desired) = store.workspace_desired(root, workspace)? {
            desired.drain_changes(carried.changes);
            desired
                .slots
                .drain(..carried.slots.min(desired.slots.len()));
            // Written by older versions, which synced focus; never sent.
            desired.resume = None;
            if desired.is_empty() {
                store.clear_workspace_desired(workspace)?;
            } else {
                store.set_workspace_desired(root, workspace, &desired)?;
            }
        }
        Ok(())
    }

    pub fn on_error(
        &mut self,
        store: &mut Store,
        root: &VaultRoot,
        request: Option<&str>,
        operation: Option<&str>,
        code: &str,
        retry_after: Option<Duration>,
    ) -> Result<()> {
        if let Some((_, reply)) = request.and_then(|r| self.claims.remove(r)) {
            if let Some(reply) = reply {
                let _ = reply.send(Err(Error::Invalid));
            }
            return Ok(());
        }
        if let Some((workspace, _, _, reply)) = request.and_then(|r| self.slots.remove(r)) {
            let _ = reply.send(Err(Error::Invalid));
            let _ = workspace;
            return Ok(());
        }
        let workspace = operation.and_then(|id| {
            self.inflight
                .iter()
                .find(|(_, (_, op, _, _))| op.operation_id == id)
                .map(|(t, _)| t.clone())
        });
        match (workspace, code) {
            (_, "sync_unavailable") => Err(Error::Network),
            (_, "sync_device_forbidden") => Err(Error::DeviceForbidden),
            // Too many ops from this device: the server applied nothing. Keep
            // every queued edit and wait as long as it asks before sending again.
            (Some(workspace), "sync_rate_limited") => {
                let (_, op, _, _) = self.inflight.remove(&workspace).expect("present");
                store.finish_workspace_op(&workspace, &op.operation_id)?;
                self.batch.hold(
                    &workspace,
                    retry_after.unwrap_or(Duration::from_secs(5)),
                    Instant::now(),
                );
                Ok(())
            }
            // A structurally rejected op can never succeed as built. Drop its
            // oldest edit and retry the rest: repeated rejections isolate the
            // bad edit, and every other queued edit still reaches the server.
            (Some(workspace), _) => {
                let (_, op, _, _) = self.inflight.remove(&workspace).expect("present");
                store.finish_workspace_op(&workspace, &op.operation_id)?;
                if let Some(mut desired) = store.workspace_desired(root, &workspace)? {
                    desired.drop_first_batch();
                    if desired.changes.is_empty() {
                        // Slots and resume carry no edit to isolate.
                        store.clear_workspace_desired(&workspace)?;
                    } else {
                        store.set_workspace_desired(root, &workspace, &desired)?;
                    }
                }
                self.batch.retry(&workspace);
                Ok(())
            }
            (None, _) => Ok(()),
        }
    }
}
