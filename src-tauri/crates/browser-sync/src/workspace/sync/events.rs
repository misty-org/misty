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
}
