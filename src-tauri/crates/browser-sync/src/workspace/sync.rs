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
    protocol::{
        content_hash, Slot, Workspace, WorkspaceClaim, WorkspaceDelta, WorkspaceOp,
        WorkspaceReceipt, WorkspaceSnapshot,
    },
    seal::{self, Position},
    signin::is_signin_slot,
    state::{Verifier, WorkspaceState},
};
use crate::{
    batch::{BatchPolicy, Batcher, Lane},
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
#[path = "sync_events.rs"]
mod events;
#[path = "sync_view.rs"]
mod view_ops;
use view_ops::tombstones;

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
    /// Every active device understands nested bookmark folders. Set by the
    /// worker; bookmark tree fields sync only then.
    pub nested_bookmarks: bool,
    /// Every active device understands pinned tabs. Set by the worker; the
    /// pinned fields of tab records sync only then.
    pub pinned_tabs: bool,
    /// Records with changes the server has not confirmed yet (queued or in
    /// flight), one entry per record, so the renderer can name them per tab.
    pub unsynced: Vec<UnsyncedRecord>,
    /// Edits an older version set aside unsent: kept for recovery, never replayed.
    pub retired_edits: usize,
    /// Per natively applied collection (`collections::NATIVE_APPLIED`), a
    /// count that moves when another device's change arrives, so native code
    /// knows to re-read it. Never sent to a renderer.
    #[serde(skip)]
    pub revisions: BTreeMap<String, u64>,
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
    /// When each workspace's queue is due to publish.
    batch: Batcher,
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
            batch: Batcher::default(),
        }
    }

    /// Takes the server's batching policy; false if it is not newer.
    pub fn set_batch_policy(&mut self, policy: BatchPolicy) -> bool {
        self.batch.set_policy(policy)
    }

    /// Publishes every queue on the next tick, regardless of batching, until
    /// `flush_settled`.
    pub fn flush(&mut self) {
        self.batch.flush();
    }

    pub fn flush_settled(&mut self) {
        self.batch.settled();
    }

    /// Nothing waits on the server and nothing publishable is queued: a
    /// flush has done all it can on this connection.
    pub fn flushed(&self, store: &Store) -> Result<bool> {
        if !self.inflight.is_empty() {
            return Ok(false);
        }
        for workspace in self.publish_targets() {
            if self.current.contains(&workspace) && store.workspace_desired_exists(&workspace)? {
                return Ok(false);
            }
        }
        Ok(true)
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
            .filter(|workspace| {
                self.roster
                    .iter()
                    .any(|t| !t.shared && t.workspace_id == *workspace)
            })
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
        if !self
            .roster
            .iter()
            .any(|t| !t.shared && t.workspace_id == workspace)
        {
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
        self.on_workspace()
            .is_some_and(|workspace| self.states.contains_key(workspace))
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
                super::stats::add(&super::stats::OPS_DEFERRED, 1);
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
                super::stats::add(&super::stats::OPS_DEFERRED, 1);
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
                    super::stats::add(
                        &super::stats::EDITS_COALESCED,
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
