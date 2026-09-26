//! Socket-agnostic tree synchronization owned by the worker. It watches the
//! tree this device drives plus the shared tree, verifies everything it
//! receives, and turns the local desired state into signed CAS ops.
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    time::{Duration, Instant},
};

use serde::Serialize;
use tokio::sync::oneshot;
use uuid::Uuid;

use super::{
    model::{self, belongs_to_shared},
    protocol::{Slot, Tree, TreeClaim, TreeDelta, TreeOp, TreeReceipt, TreeSnapshot},
    seal::{self, Position},
    state::{TreeState, Verifier},
};
use crate::{
    crypto::{DeviceKey, VaultRoot, VaultScope},
    document::{Change, Resume, ViewRecord},
    protocol::{DeviceGrant, MAX_COUNTER},
    store::{Desired, Store},
    Error, Result,
};

const OP_TIMEOUT: Duration = Duration::from_secs(20);

/// Renderer-safe projection of one tree. Records never include credentials.
#[derive(Clone, Serialize, PartialEq)]
pub struct TreeWorkspace {
    pub version: u64,
    pub records: Vec<ViewRecord>,
    pub resume: Option<Resume>,
    /// Device that wrote the current version, if any.
    pub author: Option<String>,
}

#[derive(Clone, Default, Serialize, PartialEq)]
pub struct TreeView {
    pub device_id: String,
    pub shared_tree_id: String,
    /// The tree this device drives; `None` after another device took it.
    pub driving_tree: Option<String>,
    pub trees: Vec<Tree>,
    /// Verified content of the driven tree and the shared tree.
    pub workspaces: BTreeMap<String, TreeWorkspace>,
    /// Trees with local edits not yet accepted by the server.
    pub pending: BTreeSet<String>,
    /// Set when this device lost its seat while holding unpublished edits;
    /// they stay in local storage and the choose screen says so.
    pub displaced_with_edits: bool,
}

pub enum Outgoing {
    Watch { tree_id: String, after: u64 },
    Unwatch { tree_id: String },
    Publish { request_id: String, op: TreeOp },
    Claim { request_id: String, claim: TreeClaim },
    SlotGet { request_id: String, tree_id: String, tab_node_id: String, slot: i16 },
}

type Reply<T> = oneshot::Sender<Result<T>>;
/// Pending slot read: tree, tab node, slot kind, reply.
type SlotRequest = (String, String, i16, Reply<Option<Vec<u8>>>);

/// Portion of a tree's desired state an in-flight op carried. Unknown after a
/// restart; the replayed changes are idempotent, so nothing is trimmed then.
#[derive(Clone, Default)]
struct Carried {
    changes: usize,
    slots: usize,
    resume: Option<serde_json::Value>,
}

pub struct TreeSync {
    device_id: String,
    shared_id: String,
    roster: Vec<Tree>,
    states: HashMap<String, TreeState>,
    /// Trees whose server state arrived on this connection.
    current: BTreeSet<String>,
    watched: BTreeSet<String>,
    /// Per tree: request ID, op, send time, and how much of the desired state
    /// it carried (changes, slots, resume) to trim once accepted.
    inflight: HashMap<String, (String, TreeOp, Instant, Carried)>,
    claims: HashMap<String, (String, Option<Reply<()>>)>,
    slots: HashMap<String, SlotRequest>,
    displaced_with_edits: bool,
}

impl TreeSync {
    pub fn new(scope: &VaultScope, grant: &DeviceGrant) -> Self {
        Self {
            device_id: grant.device_id.clone(),
            shared_id: scope.workspace_id.clone(),
            roster: Vec::new(),
            states: HashMap::new(),
            current: BTreeSet::new(),
            watched: BTreeSet::new(),
            inflight: HashMap::new(),
            claims: HashMap::new(),
            slots: HashMap::new(),
            displaced_with_edits: false,
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
            .map(|t| t.tree_id.as_str())
    }

    /// Loads verified caches and the last roster, so the UI renders and edits
    /// keep queuing while offline; a cache that no longer verifies is dropped
    /// and refetched. Publishing still waits for fresh server state.
    pub fn load(&mut self, store: &Store, v: &Verifier<'_>) -> Result<()> {
        self.roster = store.tree_roster()?;
        let mut cached = vec![self.shared_id.clone(), self.device_id.clone()];
        if let Some(driven) = self.driving() {
            cached.push(driven.to_owned());
        }
        cached.dedup();
        for tree in cached {
            if let Some((snapshot, author)) = store.tree_cache(v.root, &tree)? {
                // The author's grant is vault-signed; verify it like any other.
                let mut grants = v.grants.clone();
                if let Some(grant) = author {
                    grants.entry(grant.device_id.clone()).or_insert(grant);
                }
                let offline = Verifier { root: v.root, scope: v.scope, grants: &grants };
                if let Ok(state) = TreeState::from_snapshot(&offline, snapshot) {
                    self.states.insert(tree, state);
                }
            }
        }
        for (request, op) in store.tree_inflight()? {
            self.inflight.insert(op.tree_id.clone(), (request, op, Instant::now(), Carried::default()));
        }
        Ok(())
    }

    fn watch_targets(&self) -> BTreeSet<String> {
        let mut out = BTreeSet::from([self.shared_id.clone()]);
        if let Some(tree) = self.driving() {
            out.insert(tree.to_owned());
        }
        out
    }

    fn watch(&self, tree: &str) -> Outgoing {
        Outgoing::Watch { tree_id: tree.to_owned(), after: self.states.get(tree).map_or(0, |s| s.version) }
    }

    /// A fresh connection re-watches and resends in-flight ops verbatim, so
    /// a lost acknowledgment is resolved by the server's receipt.
    pub fn on_connect(&mut self) -> Vec<Outgoing> {
        self.current.clear();
        self.watched.clear();
        let mut out = Vec::new();
        for tree in self.watch_targets() {
            out.push(self.watch(&tree));
            self.watched.insert(tree);
        }
        for (request, op, sent, _) in self.inflight.values_mut() {
            *sent = Instant::now();
            out.push(Outgoing::Publish { request_id: request.clone(), op: op.clone() });
        }
        out
    }

    pub fn on_roster(&mut self, store: &mut Store, trees: Vec<Tree>) -> Result<Vec<Outgoing>> {
        if trees.len() > 1025 || trees.iter().any(|t| !crate::protocol::valid_id(&t.tree_id) || t.version > MAX_COUNTER) {
            return Err(Error::Invalid);
        }
        let before = self.driving().map(str::to_owned);
        store.save_tree_roster(&trees)?;
        self.roster = trees;
        let after = self.driving().map(str::to_owned);
        if before.is_some() && after != before {
            let lost = before.as_deref().unwrap();
            self.displaced_with_edits = store.tree_desired_exists(lost)? || self.inflight.contains_key(lost);
        }
        if after.is_some() {
            self.displaced_with_edits = false;
        }
        let targets = self.watch_targets();
        let mut out = Vec::new();
        for tree in self.watched.difference(&targets) {
            out.push(Outgoing::Unwatch { tree_id: tree.clone() });
            self.current.remove(tree);
        }
        for tree in targets.difference(&self.watched) {
            out.push(self.watch(tree));
        }
        self.watched = targets;
        Ok(out)
    }

    fn accept(&mut self, store: &mut Store, v: &Verifier<'_>, state: TreeState) -> Result<()> {
        if state.version < store.tree_high_watermark(&state.tree_id)? {
            return Err(Error::Recovery);
        }
        let author = state.last_change.as_ref().and_then(|c| v.grants.get(&c.device_id));
        store.save_tree_cache(v.root, &state.to_snapshot(), author)?;
        self.current.insert(state.tree_id.clone());
        self.states.insert(state.tree_id.clone(), state);
        Ok(())
    }

    /// The server says our copy is current. A brand-new tree (version 0) has
    /// nothing to send; any mismatch asks for a snapshot instead.
    pub fn on_current(&mut self, tree_id: &str, version: u64) -> Vec<Outgoing> {
        if !self.watched.contains(tree_id) {
            return Vec::new();
        }
        let local = self.states.get(tree_id).map_or(0, |s| s.version);
        if local != version {
            return vec![Outgoing::Watch { tree_id: tree_id.to_owned(), after: MAX_COUNTER }];
        }
        self.states.entry(tree_id.to_owned()).or_insert_with(|| TreeState::empty(tree_id));
        self.current.insert(tree_id.to_owned());
        Vec::new()
    }

    pub fn on_snapshot(&mut self, store: &mut Store, v: &Verifier<'_>, snapshot: TreeSnapshot) -> Result<()> {
        if !self.watched.contains(&snapshot.tree_id) {
            return Ok(());
        }
        let state = TreeState::from_snapshot(v, snapshot)?;
        self.accept(store, v, state)
    }

    /// A delta that does not verify against our copy asks for a snapshot
    /// (a watch past the server's head always returns one).
    pub fn on_delta(&mut self, store: &mut Store, v: &Verifier<'_>, delta: TreeDelta) -> Result<Vec<Outgoing>> {
        if !self.watched.contains(&delta.tree_id) {
            return Ok(Vec::new());
        }
        let mut state = self.states.get(&delta.tree_id).cloned().unwrap_or_else(|| TreeState::empty(&delta.tree_id));
        let tree = delta.tree_id.clone();
        match state.apply_delta(v, delta) {
            Ok(()) => {
                self.accept(store, v, state)?;
                Ok(Vec::new())
            }
            Err(Error::Identity) => Err(Error::Identity),
            Err(_) => Ok(vec![Outgoing::Watch { tree_id: tree, after: MAX_COUNTER }]),
        }
    }

    pub fn on_ack(&mut self, store: &mut Store, v: &Verifier<'_>, request: Option<&str>, receipt: TreeReceipt) -> Result<()> {
        if let Some((_, reply)) = request.and_then(|r| self.claims.remove(r)) {
            let result = if receipt.discarded { Err(Error::InactiveDevice) } else { Ok(()) };
            if let Some(reply) = reply {
                let _ = reply.send(result);
            }
            return Ok(());
        }
        let Some(tree) = self.inflight.iter().find(|(_, (_, op, _, _))| op.operation_id == receipt.operation_id).map(|(t, _)| t.clone()) else {
            return Ok(());
        };
        let (_, op, _, carried) = self.inflight.remove(&tree).expect("present");
        store.finish_tree_op(&tree, &op.operation_id)?;
        if receipt.discarded {
            // Version conflicts rebase onto the next delta; a lost seat keeps
            // the edits locally for the choose screen.
            return Ok(());
        }
        let mut state = self.states.get(&tree).cloned().unwrap_or_else(|| TreeState::empty(&tree));
        if state.version == op.base_tree_version {
            state.apply_own(v, &op)?;
            self.accept(store, v, state)?;
        }
        if let Some(mut desired) = store.tree_desired(v.root, &tree)? {
            desired.changes.drain(..carried.changes.min(desired.changes.len()));
            desired.slots.drain(..carried.slots.min(desired.slots.len()));
            // A resume changed after this op was built stays queued.
            if carried.resume.is_some() && carried.resume == desired.resume.as_ref().map(serde_json::to_value).transpose()? {
                desired.resume = None;
            }
            if desired.is_empty() {
                store.clear_tree_desired(&tree)?;
            } else {
                store.set_tree_desired(v.root, &tree, &desired)?;
            }
        }
        Ok(())
    }

    pub fn on_error(&mut self, store: &mut Store, request: Option<&str>, operation: Option<&str>, code: &str) -> Result<()> {
        if let Some((_, reply)) = request.and_then(|r| self.claims.remove(r)) {
            if let Some(reply) = reply {
                let _ = reply.send(Err(Error::Invalid));
            }
            return Ok(());
        }
        if let Some((tree, _, _, reply)) = request.and_then(|r| self.slots.remove(r)) {
            let _ = reply.send(Err(Error::Invalid));
            let _ = tree;
            return Ok(());
        }
        let tree = operation.and_then(|id| self.inflight.iter().find(|(_, (_, op, _, _))| op.operation_id == id).map(|(t, _)| t.clone()));
        match (tree, code) {
            (_, "sync_unavailable") => Err(Error::Network),
            (_, "sync_device_forbidden") => Err(Error::Authentication),
            // A structurally rejected op can never succeed; drop it and the
            // edit that produced it rather than retrying forever.
            (Some(tree), _) => {
                let (_, op, _, _) = self.inflight.remove(&tree).expect("present");
                store.finish_tree_op(&tree, &op.operation_id)?;
                store.clear_tree_desired(&tree)?;
                Err(Error::Recovery)
            }
            (None, _) => Ok(()),
        }
    }

    fn queue(&self, store: &mut Store, root: &VaultRoot, tree: &str, edit: impl FnOnce(&mut Desired)) -> Result<()> {
        let mut desired = store.tree_desired(root, tree)?.unwrap_or_default();
        edit(&mut desired);
        store.set_tree_desired(root, tree, &desired)
    }

    /// Queues renderer edits: groups and websites go to the shared tree,
    /// everything else to the tree this device drives.
    pub fn apply_changes(&mut self, store: &mut Store, root: &VaultRoot, changes: Vec<Change>) -> Result<()> {
        let tree = self.driving().map(str::to_owned).ok_or(Error::InactiveDevice)?;
        if changes.is_empty() || changes.len() > 256 {
            return Err(Error::Invalid);
        }
        let (shared, own): (Vec<_>, Vec<_>) = changes.into_iter().partition(|c| belongs_to_shared(model::change_kind(c)));
        let shared_id = self.shared_id.clone();
        for (target, batch) in [(tree, own), (shared_id, shared)] {
            if batch.is_empty() {
                continue;
            }
            // Reject an invalid edit now, before it can wedge the publisher.
            let mut desired = store.tree_desired(root, &target)?.unwrap_or_default();
            desired.changes.extend(batch);
            let base = self.states.get(&target).map(|s| s.records.as_slice()).unwrap_or(&[]);
            model::rebase(base, &desired.changes)?;
            store.set_tree_desired(root, &target, &desired)?;
        }
        Ok(())
    }

    pub fn set_resume(&mut self, store: &mut Store, root: &VaultRoot, resume: Resume) -> Result<()> {
        let tree = self.driving().map(str::to_owned).ok_or(Error::InactiveDevice)?;
        self.queue(store, root, &tree, |d| d.resume = Some(resume))
    }

    pub fn write_slot(&mut self, store: &mut Store, root: &VaultRoot, tab_record: &str, slot: i16, plaintext: Option<Vec<u8>>) -> Result<()> {
        let tree = self.driving().map(str::to_owned).ok_or(Error::InactiveDevice)?;
        let tab = model::node_id(&tree, crate::document::entities::Kind::Tab, tab_record);
        // Keep write order: an in-flight op may already carry an older value.
        self.queue(store, root, &tree, |d| d.slots.push((tab, slot, plaintext)))
    }

    #[allow(clippy::too_many_arguments)]
    pub fn claim(&mut self, store: &mut Store, scope: &VaultScope, grant: &DeviceGrant, device: &DeviceKey, tree_id: &str, request: Option<String>, reply: Option<Reply<()>>) -> Result<Outgoing> {
        let operation_id = request.unwrap_or_else(|| Uuid::new_v4().to_string());
        let mut claim = TreeClaim {
            workspace_id: scope.workspace_id.clone(),
            tree_id: tree_id.to_owned(),
            operation_id,
            device_id: grant.device_id.clone(),
            device_counter: store.allocate_tree_counter()?,
            key_epoch: grant.key_epoch,
            signature: Vec::new(),
        };
        seal::sign_claim(device, &mut claim)?;
        let request_id = Uuid::new_v4().to_string();
        self.claims.insert(request_id.clone(), (tree_id.to_owned(), reply));
        Ok(Outgoing::Claim { request_id, claim })
    }

    pub fn read_slot(&mut self, tree_id: &str, tab_record: &str, slot: i16, reply: Reply<Option<Vec<u8>>>) -> Outgoing {
        let tab = model::node_id(tree_id, crate::document::entities::Kind::Tab, tab_record);
        let request_id = Uuid::new_v4().to_string();
        self.slots.insert(request_id.clone(), (tree_id.to_owned(), tab.clone(), slot, reply));
        Outgoing::SlotGet { request_id, tree_id: tree_id.to_owned(), tab_node_id: tab, slot }
    }

    pub fn on_slot(&mut self, root: &VaultRoot, scope: &VaultScope, request: Option<&str>, slot: Option<Slot>) {
        let Some((tree, tab, kind, reply)) = request.and_then(|r| self.slots.remove(r)) else { return };
        let result = match slot {
            None => Ok(None),
            Some(s) if s.tree_id != tree || s.tab_node_id != tab || s.slot != kind => Err(Error::Identity),
            Some(s) => seal::open(root, scope, Position { tree_id: &tree, node_id: &tab, parent_id: None, slot: kind, version: s.version, key_epoch: s.key_epoch }, &s.ciphertext)
                .map(|plain| Some(plain.to_vec())),
        };
        let _ = reply.send(result);
    }

    /// Publishes at most one op per tree, only once the tree's server state
    /// has arrived on this connection, and only for trees this device may
    /// write (its driven tree, and the shared tree).
    pub fn tick(&mut self, store: &mut Store, root: &VaultRoot, scope: &VaultScope, grant: &DeviceGrant, device: &DeviceKey) -> Result<Vec<Outgoing>> {
        if self.inflight.values().any(|(_, _, sent, _)| sent.elapsed() >= OP_TIMEOUT) {
            return Err(Error::Network);
        }
        let mut out = Vec::new();
        let writable: Vec<String> = self.watch_targets().into_iter().filter(|t| self.current.contains(t) && !self.inflight.contains_key(t)).collect();
        for tree in writable {
            let Some(desired) = store.tree_desired(root, &tree)? else { continue };
            let state = self.states.get(&tree).cloned().unwrap_or_else(|| TreeState::empty(&tree));
            let records = model::rebase(&state.records, &desired.changes)?;
            let resume = desired.resume.clone().or_else(|| state.resume.clone());
            // Last write per slot wins within one op.
            let mut slots: Vec<(String, i16, Option<Vec<u8>>)> = Vec::new();
            for (tab, kind, value) in &desired.slots {
                slots.retain(|(t, k, _)| !(t == tab && k == kind));
                slots.push((tab.clone(), *kind, value.clone()));
            }
            // Slots of tabs that no longer exist are dropped, not errors.
            let placed = model::place(&tree, &records);
            slots.retain(|(tab, _, _)| placed.contains_key(tab));
            let request_id = Uuid::new_v4().to_string();
            let mut built = None;
            let result = store.begin_tree_op(&tree, &request_id, |counter| {
                let op = state
                    .build_op(root, scope, grant, device, counter, &records, resume.as_ref(), slots, desired.blob_refs.clone())?
                    .ok_or(Error::Sequence)?;
                built = Some(op.clone());
                Ok(op)
            });
            let carried = Carried {
                changes: desired.changes.len(),
                slots: desired.slots.len(),
                resume: desired.resume.as_ref().map(serde_json::to_value).transpose()?,
            };
            match result {
                Ok(op) => {
                    self.inflight.insert(tree.clone(), (request_id.clone(), op.clone(), Instant::now(), carried));
                    out.push(Outgoing::Publish { request_id, op });
                }
                // Nothing to publish: the tree already matches.
                Err(Error::Sequence) if built.is_none() => store.clear_tree_desired(&tree)?,
                Err(error) => return Err(error),
            }
        }
        Ok(out)
    }

    pub fn view(&self, store: &Store) -> Result<TreeView> {
        let mut workspaces = BTreeMap::new();
        // With no roster ever seen (a device that never connected in tree
        // mode), show its own cached tree; otherwise the persisted seat applies.
        let mut shown = self.watch_targets();
        if self.roster.is_empty() {
            shown.insert(self.device_id.clone());
        }
        for tree in shown {
            if let Some(state) = self.states.get(&tree) {
                workspaces.insert(
                    tree,
                    TreeWorkspace {
                        version: state.version,
                        records: state.records.clone(),
                        resume: state.resume.clone(),
                        author: state.last_change.as_ref().map(|c| c.device_id.clone()),
                    },
                );
            }
        }
        let mut pending = BTreeSet::new();
        for tree in self.watch_targets() {
            if self.inflight.contains_key(&tree) || store.tree_desired_exists(&tree)? {
                pending.insert(tree);
            }
        }
        Ok(TreeView {
            device_id: self.device_id.clone(),
            shared_tree_id: self.shared_id.clone(),
            driving_tree: self.driving().map(str::to_owned),
            trees: self.roster.clone(),
            workspaces,
            pending,
            displaced_with_edits: self.displaced_with_edits,
        })
    }

    /// Seeds this device's own tree (and the shared tree, if still empty)
    /// from the legacy shared workspace the first time it speaks v2.
    pub fn seed_from_legacy(&mut self, store: &mut Store, root: &VaultRoot, legacy: &[ViewRecord], resume: Option<Resume>) -> Result<()> {
        if legacy.is_empty() || store.tree_high_watermark(&self.device_id)? > 0 || store.tree_desired(root, &self.device_id)?.is_some() {
            return Ok(());
        }
        let create = |r: ViewRecord| Change::Create { kind: r.kind, id: r.id, fields: r.fields };
        let (shared, own): (Vec<_>, Vec<_>) = legacy.iter().cloned().partition(|r| belongs_to_shared(r.kind));
        store.set_tree_desired(root, &self.device_id, &Desired { changes: own.into_iter().map(create).collect(), resume, ..Default::default() })?;
        // Idempotent creates: a shared tree another device already seeded
        // keeps its records.
        if store.tree_desired(root, &self.shared_id)?.is_none() {
            store.set_tree_desired(root, &self.shared_id, &Desired { changes: shared.into_iter().map(create).collect(), ..Default::default() })?;
        }
        Ok(())
    }
}
