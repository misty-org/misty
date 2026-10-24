//! Local edits, sign-in lease claims and slot reads on `WorkspaceSync`.
use super::*;

impl WorkspaceSync {
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
            let carried = self
                .inflight
                .get(&target)
                .map_or(0, |(_, _, _, c)| c.changes);
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
