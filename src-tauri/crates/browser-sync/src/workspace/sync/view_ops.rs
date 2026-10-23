//! The verified and optimistic views of `WorkspaceSync`, and seeding from the legacy workspace.

use super::*;

impl WorkspaceSync {
    /// Verified content only. Tests and diagnostics; the UI reads `optimistic_view`.
    pub fn view(&self, store: &Store) -> Result<SyncState> {
        self.view_with(store, None)
    }

    /// What the UI shows: each workspace's verified content with this machine's
    /// unacknowledged edits replayed on top, so an edit never disappears while
    /// it waits for the server. A server echo replaces it only once acked.
    pub fn optimistic_view(&self, store: &Store, root: &VaultRoot) -> Result<SyncState> {
        self.view_with(store, Some(root))
    }

    pub(super) fn view_with(&self, store: &Store, root: Option<&VaultRoot>) -> Result<SyncState> {
        let mut contents = BTreeMap::new();
        // With no roster ever seen (a device that never connected in workspace
        // mode), show its own cached workspace; otherwise the persisted seat applies.
        let mut shown = self.watch_targets();
        if self.roster.is_empty() {
            shown.insert(self.device_id.clone());
        }
        let mut unsynced = BTreeMap::new();
        for workspace in shown {
            if let Some(state) = self.states.get(&workspace) {
                let pending = match root {
                    Some(root) => store.workspace_desired(root, &workspace)?,
                    None => None,
                };
                for change in pending.iter().flat_map(|desired| &desired.changes) {
                    let (kind, id, fields, deleted) = match change {
                        Change::Create { kind, id, fields }
                        | Change::Patch { kind, id, fields } => (*kind, id, Some(fields), false),
                        Change::Delete { kind, id } => (*kind, id, None, true),
                    };
                    let entry = unsynced
                        .entry((workspace.clone(), kind, id.clone()))
                        .or_insert_with(|| UnsyncedRecord {
                            workspace_id: workspace.clone(),
                            kind,
                            id: id.clone(),
                            deleted,
                            title: None,
                        });
                    entry.deleted = deleted;
                    if let Some(title) =
                        fields.and_then(|f| f.get("title")).and_then(|t| t.as_str())
                    {
                        entry.title = Some(title.to_owned());
                    }
                }
                // A pending edit that no longer applies shows the verified copy;
                // the next tick rebases or drops it the same way.
                let records = pending
                    .and_then(|desired| {
                        model::rebase_batches(&state.records, &desired.batches(), &state.tombstones)
                            .ok()
                    })
                    .unwrap_or_else(|| state.records.clone());
                contents.insert(
                    workspace,
                    WorkspaceContent {
                        version: state.version,
                        records,
                        resume: state.resume.clone(),
                        author: state.last_change.as_ref().map(|c| c.device_id.clone()),
                    },
                );
            }
        }
        let mut pending = BTreeSet::new();
        for workspace in self.watch_targets() {
            if self.inflight.contains_key(&workspace)
                || store.workspace_desired_exists(&workspace)?
            {
                pending.insert(workspace);
            }
        }
        Ok(SyncState {
            device_id: self.device_id.clone(),
            shared_workspace_id: self.shared_id.clone(),
            driving_workspace: self.driving().map(str::to_owned),
            workspaces: self.roster.clone(),
            contents,
            pending,
            displaced_with_edits: self.displaced_with_edits,
            seat_confirmed: self.roster_confirmed,
            following: self.local.following.clone(),
            writable: self.writable(),
            on_workspace: self.on_workspace().map(str::to_owned),
            collections: BTreeMap::new(),
            all_upgraded: false,
            nested_bookmarks: false,
            pinned_tabs: false,
            unsynced: unsynced.into_values().collect(),
            retired_edits: store.retired_workspace_count()?,
            revisions: BTreeMap::new(),
        })
    }

    /// Seeds this device's own workspace (and the shared workspace, if still empty)
    /// from the legacy shared workspace the first time it speaks v2.
    pub fn seed_from_legacy(
        &mut self,
        store: &mut Store,
        root: &VaultRoot,
        legacy: &[ViewRecord],
        resume: Option<Resume>,
    ) -> Result<()> {
        if legacy.is_empty()
            || store.workspace_high_watermark(&self.device_id)? > 0
            || store.workspace_desired(root, &self.device_id)?.is_some()
        {
            return Ok(());
        }
        let create = |r: ViewRecord| Change::Create {
            kind: r.kind,
            id: r.id,
            fields: r.fields,
        };
        let (shared, own): (Vec<_>, Vec<_>) = legacy
            .iter()
            .cloned()
            .partition(|r| belongs_to_shared(r.kind));
        store.set_workspace_desired(
            root,
            &self.device_id,
            &Desired {
                changes: own.into_iter().map(create).collect(),
                resume,
                ..Default::default()
            },
        )?;
        // Idempotent creates: a shared workspace another device already seeded
        // keeps its records.
        if store.workspace_desired(root, &self.shared_id)?.is_none() {
            store.set_workspace_desired(
                root,
                &self.shared_id,
                &Desired {
                    changes: shared.into_iter().map(create).collect(),
                    ..Default::default()
                },
            )?;
        }
        Ok(())
    }
}

/// Deleted records are remembered this many at a time (newest kept). Enough
/// for any queue of offline edits; older deletes fall to plain rebase rules.
pub(super) const MAX_TOMBSTONES: usize = 4096;

pub(super) fn tombstones(
    previous: &WorkspaceState,
    next: &WorkspaceState,
    remote: bool,
) -> BTreeMap<(crate::document::entities::Kind, String), u64> {
    let mut out = previous.tombstones.clone();
    if remote {
        let live: BTreeSet<_> = next
            .records
            .iter()
            .map(|r| (r.kind, r.id.as_str()))
            .collect();
        for r in &previous.records {
            if !live.contains(&(r.kind, r.id.as_str())) {
                out.insert((r.kind, r.id.clone()), next.version);
            }
        }
    }
    // A record that exists again was restored on purpose.
    for r in &next.records {
        out.remove(&(r.kind, r.id.clone()));
    }
    while out.len() > MAX_TOMBSTONES {
        let oldest = out.iter().min_by_key(|(_, v)| **v).map(|(k, _)| k.clone());
        match oldest {
            Some(key) => out.remove(&key),
            None => break,
        };
    }
    out
}
