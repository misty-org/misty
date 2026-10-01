//! Socket-agnostic workspace synchronization owned by the worker. It watches the
//! workspace this device drives plus the shared workspace, verifies everything it
//! receives, and turns the local desired state into signed CAS ops.
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    time::{Duration, Instant},
};

use serde::Serialize;
use tokio::sync::oneshot;
use uuid::Uuid;

use super::{
    codec::{self, Padding},
    model::{self, belongs_to_shared},
    protocol::{content_hash, Slot, Workspace, WorkspaceClaim, WorkspaceDelta, WorkspaceOp, WorkspaceReceipt, WorkspaceSnapshot},
    seal::{self, Position},
    signin::is_signin_slot,
    state::{WorkspaceState, Verifier},
};
use crate::{
    crypto::{DeviceKey, VaultRoot, VaultScope},
    document::{Change, Resume, ViewRecord},
    protocol::{DeviceGrant, MAX_COUNTER},
    store::{Desired, Store, WorkspaceLocal},
    Error, Result,
};

const OP_TIMEOUT: Duration = Duration::from_secs(20);
/// Slot ciphertext per op. The server caps an op at 1400 KiB in total, and
/// node upserts share that budget.
const OP_SLOT_BUDGET: usize = 1100 << 10;
/// AES-GCM nonce and tag around each sealed frame.
const SEAL_OVERHEAD: usize = 28;

#[path = "sync_signin.rs"]
mod signin_ops;
pub use signin_ops::SigninStatus;

/// Renderer-safe projection of one workspace. Records never include credentials.
#[derive(Clone, Serialize, PartialEq)]
pub struct WorkspaceContent {
    pub version: u64,
    pub records: Vec<ViewRecord>,
    pub resume: Option<Resume>,
    /// Device that wrote the current version, if any.
    pub author: Option<String>,
}

#[derive(Clone, Default, Serialize, PartialEq)]
pub struct SyncState {
    pub device_id: String,
    pub shared_workspace_id: String,
    /// The workspace whose sign-in lease this device holds; `None` while another
    /// machine holds it. Not a lock: editing follows `on_workspace`.
    pub driving_workspace: Option<String>,
    pub workspaces: Vec<Workspace>,
    /// Verified content of the workspace this machine is on and the shared workspace.
    pub contents: BTreeMap<String, WorkspaceContent>,
    /// Workspaces with local edits not yet accepted by the server.
    pub pending: BTreeSet<String>,
    /// Set when this device lost its seat while holding unpublished edits;
    /// they stay in local storage and the choose screen says so.
    pub displaced_with_edits: bool,
    /// The server confirmed `driving_workspace` on the current connection. A
    /// cached seat is not proof: another device may have taken it meanwhile.
    pub seat_confirmed: bool,
    /// The workspace kept current while this session drives none (the one it drove
    /// last), so taking it back starts from the server's latest copy.
    pub following: Option<String>,
    /// Edits from this machine can be queued for `on_workspace`.
    pub writable: bool,
    /// The workspace this machine shows and edits (see `WorkspaceSync::on_workspace`).
    pub on_workspace: Option<String>,
    /// Collections as shown (pending writes on top), by name. Set by the
    /// worker; bookmarks here replace the shared workspace's folders/bookmarks.
    pub collections: BTreeMap<String, Vec<ViewRecord>>,
    /// Every active device understands tab groups and collections.
    /// Set by the worker; tab groups sync only then.
    pub all_upgraded: bool,
    /// Records with changes the server has not confirmed yet (queued or in
    /// flight), one entry per record, so the renderer can name them per tab.
    pub unsynced: Vec<UnsyncedRecord>,
    /// Edits an older version set aside unsent: kept for recovery, never replayed.
    pub retired_edits: usize,
}

/// One record waiting to sync. Crosses to the renderer as `{kind, id}`, so it
/// gets renderer kind names like every other record.
#[derive(Clone, Serialize, PartialEq)]
pub struct UnsyncedRecord {
    pub workspace_id: String,
    pub kind: crate::document::entities::Kind,
    pub id: String,
    /// The newest waiting change removes the record (a closed tab).
    pub deleted: bool,
    /// The newest title a waiting change gave it, for records already gone here.
    pub title: Option<String>,
}

pub enum Outgoing {
    Watch {
        workspace_id: String,
        after: u64,
    },
    Unwatch {
        workspace_id: String,
    },
    Publish {
        request_id: String,
        op: WorkspaceOp,
    },
    Claim {
        request_id: String,
        claim: WorkspaceClaim,
    },
    SlotGet {
        request_id: String,
        workspace_id: String,
        view_node_id: String,
        slot: i16,
    },
}

type Reply<T> = oneshot::Sender<Result<T>>;
/// Pending slot read: workspace, tab node, slot kind, reply.
type SlotRequest = (String, String, i16, Reply<Option<Vec<u8>>>);

/// Portion of a workspace's desired state an in-flight op carried. Unknown after a
/// restart; the replayed changes are idempotent, so nothing is trimmed then.
#[derive(Clone, Default)]
struct Carried {
    changes: usize,
    slots: usize,
}

pub struct WorkspaceSync {
    device_id: String,
    shared_id: String,
    /// Every device keeps bookmarks in collections (see `retire_shared`).
    shared_retired: bool,
    roster: Vec<Workspace>,
    states: HashMap<String, WorkspaceState>,
    /// Workspaces whose server state arrived on this connection.
    current: BTreeSet<String>,
    watched: BTreeSet<String>,
    /// Per workspace: request ID, op, send time, and how much of the desired state
    /// it carried (changes, slots, resume) to trim once accepted.
    inflight: HashMap<String, (String, WorkspaceOp, Instant, Carried)>,
    claims: HashMap<String, (String, Option<Reply<()>>)>,
    slots: HashMap<String, SlotRequest>,
    displaced_with_edits: bool,
    /// A roster arrived on the current connection.
    roster_confirmed: bool,
    /// Persisted: the followed workspace and the seat this session caught up under.
    local: WorkspaceLocal,
}

impl WorkspaceSync {
    pub fn new(scope: &VaultScope, grant: &DeviceGrant) -> Self {
        Self {
            device_id: grant.device_id.clone(),
            shared_id: scope.vault_id.clone(),
            shared_retired: false,
            roster: Vec::new(),
            states: HashMap::new(),
            current: BTreeSet::new(),
            watched: BTreeSet::new(),
            inflight: HashMap::new(),
            claims: HashMap::new(),
            slots: HashMap::new(),
            displaced_with_edits: false,
            roster_confirmed: false,
            local: WorkspaceLocal::default(),
        }
    }

    /// Until the server's roster arrives again, the cached seat is unverified.
    pub fn on_disconnect(&mut self) {
        self.roster_confirmed = false;
        // A reply can no longer arrive on this connection.
        for (_, (_, _, _, reply)) in self.slots.drain() {
            let _ = reply.send(Err(Error::Network));
        }
    }

    /// No claim or op awaits the server, so its counter view is complete.
    pub fn idle(&self) -> bool {
        self.claims.is_empty() && self.inflight.is_empty()
    }

    pub fn driving(&self) -> Option<&str> {
        self.roster
            .iter()
            .find(|t| !t.shared && t.driver_device_id.as_deref() == Some(self.device_id.as_str()))
            .map(|t| t.workspace_id.as_str())
    }

    /// The workspace uses workspaces: a roster has been seen (now or cached).
    pub fn workspace_mode(&self) -> bool {
        !self.roster.is_empty()
    }

    /// The driven workspace and the claim epoch this session holds it under.
    fn seat(&self) -> Option<(String, String)> {
        let workspace = self.roster.iter().find(|t| {
            !t.shared && t.driver_device_id.as_deref() == Some(self.device_id.as_str())
        })?;
        Some((
            workspace.workspace_id.clone(),
            workspace.driver_epoch.clone().unwrap_or_default(),
        ))
    }

    /// The workspace this machine shows and edits: the one it holds the
    /// sign-in lease on, else the one it was last on. Any number of machines
    /// may be on (and edit) the same workspace; the server orders their edits.
    pub fn on_workspace(&self) -> Option<&str> {
        self.local
            .following
            .as_deref()
            .filter(|workspace| self.roster.iter().any(|t| !t.shared && t.workspace_id == *workspace))
            .or_else(|| self.driving())
    }

    /// The shared workspace's verified records (bookmark folders and links kept
    /// there before collections existed).
    pub fn shared_records(&self) -> Vec<ViewRecord> {
        self.states
            .get(&self.shared_id)
            .map(|s| s.records.clone())
            .unwrap_or_default()
    }

    /// Shows and edits `workspace` on this machine, without taking its lease (that
    /// follows activity). Returns the watch changes for the connection.
    pub fn open(&mut self, store: &mut Store, workspace: &str) -> Result<Vec<Outgoing>> {
        if !self.roster.iter().any(|t| !t.shared && t.workspace_id == workspace) {
            return Err(Error::Invalid);
        }
        self.follow(store, Some(workspace.to_owned()))?;
        Ok(self.rewatch())
    }

    /// Aligns the watched set with `watch_targets`.
    fn rewatch(&mut self) -> Vec<Outgoing> {
        let targets = self.watch_targets();
        let mut out = Vec::new();
        for workspace in self.watched.difference(&targets) {
            out.push(Outgoing::Unwatch {
                workspace_id: workspace.clone(),
            });
            self.current.remove(workspace);
        }
        for workspace in targets.difference(&self.watched) {
            out.push(self.watch(workspace));
        }
        self.watched = targets;
        out
    }

    /// Whether edits may be queued for the workspace this machine is on: it has a
    /// verified copy (current or cached) to replay them against. Publishing
    /// still waits until the copy is current on this connection.
    pub fn writable(&self) -> bool {
        self.on_workspace().is_some_and(|workspace| self.states.contains_key(workspace))
    }

    /// Whether this machine may write the device's sign-in data: it holds the
    /// lease and its copy caught up with the server under that lease, so it
    /// never publishes over sign-ins written by the previous holder.
    pub(super) fn lease_ready(&self) -> bool {
        self.seat()
            .is_some_and(|seat| self.local.ready.as_ref() == Some(&seat))
    }

    /// Marks the driven workspace ready once the verified copy received on this
    /// connection is at least the version the server's roster reports.
    fn refresh_ready(&mut self, store: &mut Store) -> Result<()> {
        let Some((workspace, epoch)) = self.seat() else {
            return Ok(());
        };
        if !self.roster_confirmed
            || !self.current.contains(&workspace)
            || self.local.ready.as_ref() == Some(&(workspace.clone(), epoch.clone()))
        {
            return Ok(());
        }
        let server = self
            .roster
            .iter()
            .find(|t| t.workspace_id == workspace)
            .map_or(0, |t| t.version);
        let local = self.states.get(&workspace).map_or(0, |s| s.version);
        if local < server {
            return Ok(());
        }
        let mut next = self.local.clone();
        next.ready = Some((workspace, epoch));
        store.set_workspace_local(&next)?;
        self.local = next;
        Ok(())
    }

    /// Drops this session's copy of a workspace so the next watch fetches the
    /// server's copy from scratch. A driven workspace is read-only until it has.
    pub fn forget(&mut self, store: &mut Store, workspace: &str) -> Result<()> {
        self.states.remove(workspace);
        self.current.remove(workspace);
        if self
            .local
            .ready
            .as_ref()
            .is_some_and(|(ready, _)| ready == workspace)
        {
            let mut next = self.local.clone();
            next.ready = None;
            store.set_workspace_local(&next)?;
            self.local = next;
        }
        Ok(())
    }

    fn follow(&mut self, store: &mut Store, workspace: Option<String>) -> Result<()> {
        if self.local.following == workspace {
            return Ok(());
        }
        let mut next = self.local.clone();
        next.following = workspace;
        store.set_workspace_local(&next)?;
        self.local = next;
        Ok(())
    }

    /// Loads verified caches and the last roster, so the UI renders and edits
    /// keep queuing while offline; a cache that no longer verifies is dropped
    /// and refetched. Publishing still waits for fresh server state.
    pub fn load(&mut self, store: &Store, v: &Verifier<'_>) -> Result<()> {
        self.roster = store.workspace_roster()?;
        self.local = store.workspace_local()?;
        let mut cached = vec![self.shared_id.clone(), self.device_id.clone()];
        if let Some(driven) = self.driving() {
            cached.push(driven.to_owned());
        }
        if let Some(followed) = self.local.following.clone() {
            cached.push(followed);
        }
        cached.sort();
        cached.dedup();
        for workspace in cached {
            if let Some((snapshot, author)) = store.workspace_cache(v.root, &workspace)? {
                // The author's grant is vault-signed; verify it like any other.
                let mut grants = v.grants.clone();
                if let Some(grant) = author {
                    grants.entry(grant.device_id.clone()).or_insert(grant);
                }
                let offline = Verifier {
                    root: v.root,
                    scope: v.scope,
                    grants: &grants,
                };
                if let Ok(state) = WorkspaceState::from_snapshot(&offline, snapshot) {
                    self.states.insert(workspace, state);
                }
            }
        }
        for (request, op) in store.workspace_inflight()? {
            self.inflight.insert(
                op.workspace_id.clone(),
                (request, op, Instant::now(), Carried::default()),
            );
        }
        Ok(())
    }

    /// Once every device keeps bookmarks in collections, nothing
    /// reads or writes the shared workspace: it is no longer watched or published.
    pub fn retire_shared(&mut self, retired: bool) -> Vec<Outgoing> {
        if self.shared_retired == retired {
            return Vec::new();
        }
        self.shared_retired = retired;
        self.rewatch()
    }

    /// Workspaces kept current on the connection: the shared workspace (until it
    /// retires) and the workspace this machine is on (with or without its lease).
    fn watch_targets(&self) -> BTreeSet<String> {
        let mut out = BTreeSet::new();
        if !self.shared_retired {
            out.insert(self.shared_id.clone());
        }
        if let Some(workspace) = self.on_workspace() {
            out.insert(workspace.to_owned());
        }
        out
    }

    /// Workspaces this machine publishes to: the shared workspace and the workspace it is
    /// on. `tick` publishes each only once its copy is current.
    fn publish_targets(&self) -> BTreeSet<String> {
        self.watch_targets()
    }

    fn watch(&self, workspace: &str) -> Outgoing {
        Outgoing::Watch {
            workspace_id: workspace.to_owned(),
            after: self.states.get(workspace).map_or(0, |s| s.version),
        }
    }

    /// A fresh connection re-watches and resends in-flight ops verbatim, so
    /// a lost acknowledgment is resolved by the server's receipt.
    pub fn on_connect(&mut self) -> Vec<Outgoing> {
        self.roster_confirmed = false;
        self.current.clear();
        self.watched.clear();
        let mut out = Vec::new();
        for workspace in self.watch_targets() {
            out.push(self.watch(&workspace));
            self.watched.insert(workspace);
        }
        for (request, op, sent, _) in self.inflight.values_mut() {
            *sent = Instant::now();
            out.push(Outgoing::Publish {
                request_id: request.clone(),
                op: op.clone(),
            });
        }
        out
    }

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
        if self
            .local
            .following
            .as_ref()
            .is_some_and(|workspace| !self.roster.iter().any(|t| !t.shared && &t.workspace_id == workspace))
        {
            self.follow(store, None)?;
        }
        self.refresh_ready(store)?;
        Ok(self.rewatch())
    }

    /// `remote`: the new state may contain other machines' changes, so
    /// records it no longer has were deleted by them (tombstoned). Our own
    /// acked op is not remote: our own later edits are ordered by the user.
    fn accept(
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
            // Version conflicts rebase onto the next delta and are retried.
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
    fn drain_carried(
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
                Ok(())
            }
            (None, _) => Ok(()),
        }
    }

    fn queue(
        &self,
        store: &mut Store,
        root: &VaultRoot,
        workspace: &str,
        edit: impl FnOnce(&mut Desired),
    ) -> Result<()> {
        let mut desired = store.workspace_desired(root, workspace)?.unwrap_or_default();
        edit(&mut desired);
        store.set_workspace_desired(root, workspace, &desired)
    }

    /// Queues renderer edits: folders and bookmarks go to the shared workspace,
    /// everything else to the workspace this device drives.
    /// The driven workspace, if edits may be queued for it now. While this
    /// session is still catching up with the server's copy it is treated as
    /// following: nothing it saw before is written back.
    /// The workspace an edit from this machine goes to: the one it is on.
    fn writable_workspace(&self) -> Result<String> {
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
        super::stats::add(&super::stats::EDIT_BATCHES, 1);
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
            desired.push_batch(batch, state.version);
            model::rebase_batches(&state.records, &desired.batches(), &state.tombstones)?;
            store.set_workspace_desired(root, &target, &desired)?;
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
        let tab = model::node_id(&workspace, crate::document::entities::Kind::View, tab_record);
        // Keep write order: an in-flight op may already carry an older value.
        self.queue(store, root, &workspace, |d| d.slots.push((tab, slot, plaintext)))
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
        let tab = model::node_id(workspace_id, crate::document::entities::Kind::View, tab_record);
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
        let mut out = Vec::new();
        let writable: Vec<String> = self
            .publish_targets()
            .into_iter()
            .filter(|t| self.current.contains(t) && !self.inflight.contains_key(t))
            .collect();
        for workspace in writable {
            // Sign-in writes need the lease; without it they would get the
            // whole op rejected. The holder publishes its own.
            if workspace != self.shared_id && !(self.driving() == Some(workspace.as_str()) && self.lease_ready()) {
                self.drop_signin_writes(store, root, &workspace)?;
            }
            let Some(desired) = store.workspace_desired(root, &workspace)? else {
                continue;
            };
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
            match result {
                Ok(op) => {
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

    fn view_with(&self, store: &Store, root: Option<&VaultRoot>) -> Result<SyncState> {
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
            if self.inflight.contains_key(&workspace) || store.workspace_desired_exists(&workspace)? {
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
            unsynced: unsynced.into_values().collect(),
            retired_edits: store.retired_workspace_count()?,
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
const MAX_TOMBSTONES: usize = 4096;

fn tombstones(
    previous: &WorkspaceState,
    next: &WorkspaceState,
    remote: bool,
) -> BTreeMap<(crate::document::entities::Kind, String), u64> {
    let mut out = previous.tombstones.clone();
    if remote {
        let live: BTreeSet<_> = next.records.iter().map(|r| (r.kind, r.id.as_str())).collect();
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
