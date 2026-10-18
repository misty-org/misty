//! Server events on `WorkspaceSync`: roster, current, snapshot, delta, ack, error and slots.

use super::*;

impl WorkspaceSync {
    pub fn on_roster(
        &mut self,
        store: &mut Store,
        root: &VaultRoot,
        workspaces: Vec<Workspace>,
    ) -> Result<Vec<Outgoing>> {
        if workspaces.len() > 1025
            || workspaces
                .iter()
                .any(|t| !crate::protocol::valid_id(&t.workspace_id) || t.version > MAX_COUNTER)
        {
            return Err(Error::Invalid);
        }
        let seat = |roster: &[Workspace], device: &str| {
            roster
                .iter()
                .find(|t| !t.shared && t.driver_device_id.as_deref() == Some(device))
                .map(|t| (t.workspace_id.clone(), t.driver_epoch.clone()))
        };
        let before_seat = seat(&self.roster, &self.device_id);
        store.save_workspace_roster(&workspaces)?;
        self.roster = workspaces;
        self.roster_confirmed = true;
        let after = self.driving().map(str::to_owned);
        // A new claim epoch means the lock changed hands, even if it came back
        // to this device: another session may have written the device since.
        if let Some((lost, _)) = before_seat
            .clone()
            .filter(|previous| seat(&self.roster, &self.device_id).as_ref() != Some(previous))
        {
            self.drop_signin_writes(store, root, &lost)?;
        }
        // Losing the lease never loses edits: they rebase onto whatever the
        // new holder wrote, like any concurrent edit. Only sign-in writes
        // (dropped above) belong to the lease.
        // The workspace this machine is on changes only when the user opens
        // another; a lease moving (either way) leaves it where it is.
        self.displaced_with_edits = false;
        if self.local.following.is_none() {
            if let Some(workspace) = after {
                self.follow(store, Some(workspace))?;
            }
        }
        if self.local.following.as_ref().is_some_and(|workspace| {
            !self
                .roster
                .iter()
                .any(|t| !t.shared && &t.workspace_id == workspace)
        }) {
            self.follow(store, None)?;
        }
        self.refresh_ready(store)?;
        Ok(self.rewatch())
    }

    /// `remote`: the new state may contain other machines' changes, so
    /// records it no longer has were deleted by them (tombstoned). Our own
    /// acked op is not remote: our own later edits are ordered by the user.
    pub(super) fn accept(
        &mut self,
        store: &mut Store,
        v: &Verifier<'_>,
        mut state: WorkspaceState,
        remote: bool,
    ) -> Result<()> {
        if state.version < store.workspace_high_watermark(&state.workspace_id)? {
            return Err(Error::Recovery);
        }
        if let Some(previous) = self.states.get(&state.workspace_id) {
            state.tombstones = tombstones(previous, &state, remote);
        }
        let author = state
            .last_change
            .as_ref()
            .and_then(|c| v.grants.get(&c.device_id));
        store.save_workspace_cache(v.root, &state.to_snapshot(), author)?;
        self.current.insert(state.workspace_id.clone());
        self.states.insert(state.workspace_id.clone(), state);
        self.refresh_ready(store)
    }

    /// The server says our copy is current. A brand-new workspace (version 0) has
    /// nothing to send; any mismatch asks for a snapshot instead.
    pub fn on_current(
        &mut self,
        store: &mut Store,
        workspace_id: &str,
        version: u64,
    ) -> Result<Vec<Outgoing>> {
        if !self.watched.contains(workspace_id) {
            return Ok(Vec::new());
        }
        let local = self.states.get(workspace_id).map_or(0, |s| s.version);
        if local != version {
            return Ok(vec![Outgoing::Watch {
                workspace_id: workspace_id.to_owned(),
                after: MAX_COUNTER,
            }]);
        }
        self.states
            .entry(workspace_id.to_owned())
            .or_insert_with(|| WorkspaceState::empty(workspace_id));
        self.current.insert(workspace_id.to_owned());
        self.refresh_ready(store)?;
        Ok(Vec::new())
    }

    pub fn on_snapshot(
        &mut self,
        store: &mut Store,
        v: &Verifier<'_>,
        snapshot: WorkspaceSnapshot,
    ) -> Result<()> {
        if !self.watched.contains(&snapshot.workspace_id) {
            return Ok(());
        }
        let remote = snapshot
            .last_change
            .as_ref()
            .is_some_and(|c| c.device_id != self.device_id);
        let state = WorkspaceState::from_snapshot(v, snapshot)?;
        self.accept(store, v, state, remote)
    }

    /// A delta that does not verify against our copy asks for a snapshot
    /// (a watch past the server's head always returns one).
    pub fn on_delta(
        &mut self,
        store: &mut Store,
        v: &Verifier<'_>,
        delta: WorkspaceDelta,
    ) -> Result<Vec<Outgoing>> {
        if !self.watched.contains(&delta.workspace_id) {
            return Ok(Vec::new());
        }
        let mut state = self
            .states
            .get(&delta.workspace_id)
            .cloned()
            .unwrap_or_else(|| WorkspaceState::empty(&delta.workspace_id));
        let workspace = delta.workspace_id.clone();
        let remote = delta.changes.iter().any(|c| c.device_id != self.device_id);
        match state.apply_delta(v, delta) {
            Ok(()) => {
                if remote {
                    self.batch.contend(&workspace, Instant::now());
                }
                self.accept(store, v, state, remote)?;
                Ok(Vec::new())
            }
            Err(Error::Identity) => Err(Error::Identity),
            Err(_) => Ok(vec![Outgoing::Watch {
                workspace_id: workspace,
                after: MAX_COUNTER,
            }]),
        }
    }

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

    pub(super) fn queue(
        &self,
        store: &mut Store,
        root: &VaultRoot,
        workspace: &str,
        edit: impl FnOnce(&mut Desired),
    ) -> Result<()> {
        let mut desired = store
            .workspace_desired(root, workspace)?
            .unwrap_or_default();
        edit(&mut desired);
        store.set_workspace_desired(root, workspace, &desired)
    }

    /// Queues renderer edits: folders and bookmarks go to the shared workspace,
    /// everything else to the workspace this device drives.
    /// The driven workspace, if edits may be queued for it now. While this
    /// session is still catching up with the server's copy it is treated as
    /// following: nothing it saw before is written back.
    /// The workspace an edit from this machine goes to: the one it is on.
    pub(super) fn writable_workspace(&self) -> Result<String> {
        self.on_workspace()
            .filter(|_| self.writable())
            .map(str::to_owned)
            .ok_or(Error::InactiveDevice)
    }

    pub fn apply_changes(
        &mut self,
        store: &mut Store,
        root: &VaultRoot,
        changes: Vec<Change>,
    ) -> Result<()> {
        let workspace = self.writable_workspace()?;
        if changes.is_empty() || changes.len() > 256 {
            return Err(Error::Invalid);
        }
        super::super::stats::add(&super::super::stats::EDIT_BATCHES, 1);
        let (shared, own): (Vec<_>, Vec<_>) = changes
            .into_iter()
            .partition(|c| belongs_to_shared(model::change_kind(c)));
        let shared_id = self.shared_id.clone();
        for (target, batch) in [(workspace, own), (shared_id, shared)] {
            if batch.is_empty() {
                continue;
            }
            // Reject an invalid edit now, before it can wedge the publisher.
            let mut desired = store.workspace_desired(root, &target)?.unwrap_or_default();
            let empty = WorkspaceState::empty(&target);
            let state = self.states.get(&target).unwrap_or(&empty);
            let edits = batch.len();
            desired.push_batch(batch, state.version);
            model::rebase_batches(&state.records, &desired.batches(), &state.tombstones)?;
            // What an in-flight op carried is drained by count when it is
            // acknowledged, so only the edits behind it fold.
            let carried = self.inflight.get(&target).map_or(0, |(_, _, _, c)| c.changes);
            let folded = super::super::fold::fold(&mut desired, carried);
            super::super::stats::add(&super::super::stats::EDITS_COALESCED, folded as u64);
            store.set_workspace_desired(root, &target, &desired)?;
            self.batch.edited(&target, edits, Instant::now());
        }
        Ok(())
    }

    pub fn write_slot(
        &mut self,
        store: &mut Store,
        root: &VaultRoot,
        tab_record: &str,
        slot: i16,
        plaintext: Option<Vec<u8>>,
    ) -> Result<()> {
        let workspace = self.writable_workspace()?;
        let tab = model::node_id(
            &workspace,
            crate::document::entities::Kind::View,
            tab_record,
        );
        // Keep write order: an in-flight op may already carry an older value.
        self.queue(store, root, &workspace, |d| {
            d.slots.push((tab, slot, plaintext))
        })?;
        self.batch.edited(&workspace, 1, Instant::now());
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn claim(
        &mut self,
        store: &mut Store,
        scope: &VaultScope,
        grant: &DeviceGrant,
        device: &DeviceKey,
        workspace_id: &str,
        request: Option<String>,
        reply: Option<Reply<()>>,
    ) -> Result<Outgoing> {
        let operation_id = request.unwrap_or_else(|| Uuid::new_v4().to_string());
        let mut claim = WorkspaceClaim {
            vault_id: scope.vault_id.clone(),
            workspace_id: workspace_id.to_owned(),
            operation_id,
            device_id: grant.device_id.clone(),
            device_counter: store.allocate_workspace_counter()?,
            key_epoch: grant.key_epoch,
            signature: Vec::new(),
        };
        seal::sign_claim(device, &mut claim)?;
        let request_id = Uuid::new_v4().to_string();
        self.claims
            .insert(request_id.clone(), (workspace_id.to_owned(), reply));
        Ok(Outgoing::Claim { request_id, claim })
    }

    pub fn read_slot(
        &mut self,
        workspace_id: &str,
        tab_record: &str,
        slot: i16,
        reply: Reply<Option<Vec<u8>>>,
    ) -> Outgoing {
        let tab = model::node_id(
            workspace_id,
            crate::document::entities::Kind::View,
            tab_record,
        );
        let request_id = Uuid::new_v4().to_string();
        self.slots.insert(
            request_id.clone(),
            (workspace_id.to_owned(), tab.clone(), slot, reply),
        );
        Outgoing::SlotGet {
            request_id,
            workspace_id: workspace_id.to_owned(),
            view_node_id: tab,
            slot,
        }
    }

    pub fn on_slot(
        &mut self,
        root: &VaultRoot,
        scope: &VaultScope,
        request: Option<&str>,
        slot: Option<Slot>,
    ) {
        let Some((workspace, tab, kind, reply)) = request.and_then(|r| self.slots.remove(r)) else {
            return;
        };
        // Sign-in data must be exactly the verified slot, never an older copy.
        let expected = (tab == workspace && is_signin_slot(kind)).then(|| {
            self.states
                .get(&workspace)
                .and_then(|state| state.slots.get(&(tab.clone(), kind)))
                .map(|meta| meta.content_hash.clone())
        });
        let result = match slot {
            Some(s)
                if expected.as_ref().is_some_and(|hash| {
                    hash.as_deref() != Some(content_hash(&s.ciphertext).as_slice())
                }) =>
            {
                Err(Error::Sequence)
            }
            None if expected.as_ref().is_some_and(Option::is_some) => Err(Error::Sequence),
            None => Ok(None),
            Some(s) if s.workspace_id != workspace || s.view_node_id != tab || s.slot != kind => {
                Err(Error::Identity)
            }
            Some(s) => seal::open(
                root,
                scope,
                Position {
                    workspace_id: &workspace,
                    node_id: &tab,
                    parent_id: None,
                    slot: kind,
                    version: s.version,
                    key_epoch: s.key_epoch,
                },
                &s.ciphertext,
            )
            .map(|plain| Some(plain.to_vec())),
        };
        let _ = reply.send(result);
    }
}
