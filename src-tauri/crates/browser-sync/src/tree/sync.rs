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
    codec::{self, Padding},
    model::{self, belongs_to_shared},
    protocol::{content_hash, Slot, Tree, TreeClaim, TreeDelta, TreeOp, TreeReceipt, TreeSnapshot},
    seal::{self, Position},
    signin::is_signin_slot,
    state::{TreeState, Verifier},
};
use crate::{
    crypto::{DeviceKey, VaultRoot, VaultScope},
    document::{Change, Resume, ViewRecord},
    protocol::{DeviceGrant, MAX_COUNTER},
    store::{Desired, Store, TreeLocal},
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
    /// The server confirmed `driving_tree` on the current connection. A
    /// cached seat is not proof: another device may have taken it meanwhile.
    pub seat_confirmed: bool,
    /// The tree kept current while this session drives none (the one it drove
    /// last), so taking it back starts from the server's latest copy.
    pub following: Option<String>,
    /// This session's copy of `driving_tree` has reached the server's version
    /// under the current seat. Until then nothing may be written to it.
    pub writable: bool,
}

pub enum Outgoing {
    Watch {
        tree_id: String,
        after: u64,
    },
    Unwatch {
        tree_id: String,
    },
    Publish {
        request_id: String,
        op: TreeOp,
    },
    Claim {
        request_id: String,
        claim: TreeClaim,
    },
    SlotGet {
        request_id: String,
        tree_id: String,
        tab_node_id: String,
        slot: i16,
    },
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
    /// A roster arrived on the current connection.
    roster_confirmed: bool,
    /// Persisted: the followed tree and the seat this session caught up under.
    local: TreeLocal,
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
            roster_confirmed: false,
            local: TreeLocal::default(),
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
            .map(|t| t.tree_id.as_str())
    }

    /// The workspace uses device trees: a roster has been seen (now or cached).
    pub fn tree_mode(&self) -> bool {
        !self.roster.is_empty()
    }

    /// The driven tree and the claim epoch this session holds it under.
    fn seat(&self) -> Option<(String, String)> {
        let tree = self.roster.iter().find(|t| {
            !t.shared && t.driver_device_id.as_deref() == Some(self.device_id.as_str())
        })?;
        Some((
            tree.tree_id.clone(),
            tree.driver_epoch.clone().unwrap_or_default(),
        ))
    }

    /// Whether edits may be queued for the driven tree: only once this
    /// session's copy has caught up with the server under the current seat.
    /// A seat held since before a restart stays writable offline; no other
    /// session can have written under the same epoch.
    pub fn writable(&self) -> bool {
        self.seat()
            .is_some_and(|seat| self.local.ready.as_ref() == Some(&seat))
    }

    /// Marks the driven tree ready once the verified copy received on this
    /// connection is at least the version the server's roster reports.
    fn refresh_ready(&mut self, store: &mut Store) -> Result<()> {
        let Some((tree, epoch)) = self.seat() else {
            return Ok(());
        };
        if !self.roster_confirmed
            || !self.current.contains(&tree)
            || self.local.ready.as_ref() == Some(&(tree.clone(), epoch.clone()))
        {
            return Ok(());
        }
        let server = self
            .roster
            .iter()
            .find(|t| t.tree_id == tree)
            .map_or(0, |t| t.version);
        let local = self.states.get(&tree).map_or(0, |s| s.version);
        if local < server {
            return Ok(());
        }
        let mut next = self.local.clone();
        next.ready = Some((tree, epoch));
        store.set_tree_local(&next)?;
        self.local = next;
        Ok(())
    }

    /// Drops this session's copy of a tree so the next watch fetches the
    /// server's copy from scratch. A driven tree is read-only until it has.
    pub fn forget(&mut self, store: &mut Store, tree: &str) -> Result<()> {
        self.states.remove(tree);
        self.current.remove(tree);
        if self
            .local
            .ready
            .as_ref()
            .is_some_and(|(ready, _)| ready == tree)
        {
            let mut next = self.local.clone();
            next.ready = None;
            store.set_tree_local(&next)?;
            self.local = next;
        }
        Ok(())
    }

    fn follow(&mut self, store: &mut Store, tree: Option<String>) -> Result<()> {
        if self.local.following == tree {
            return Ok(());
        }
        let mut next = self.local.clone();
        next.following = tree;
        store.set_tree_local(&next)?;
        self.local = next;
        Ok(())
    }

    /// Loads verified caches and the last roster, so the UI renders and edits
    /// keep queuing while offline; a cache that no longer verifies is dropped
    /// and refetched. Publishing still waits for fresh server state.
    pub fn load(&mut self, store: &Store, v: &Verifier<'_>) -> Result<()> {
        self.roster = store.tree_roster()?;
        self.local = store.tree_local()?;
        let mut cached = vec![self.shared_id.clone(), self.device_id.clone()];
        if let Some(driven) = self.driving() {
            cached.push(driven.to_owned());
        }
        if let Some(followed) = self.local.following.clone() {
            cached.push(followed);
        }
        cached.sort();
        cached.dedup();
        for tree in cached {
            if let Some((snapshot, author)) = store.tree_cache(v.root, &tree)? {
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
                if let Ok(state) = TreeState::from_snapshot(&offline, snapshot) {
                    self.states.insert(tree, state);
                }
            }
        }
        for (request, op) in store.tree_inflight()? {
            self.inflight.insert(
                op.tree_id.clone(),
                (request, op, Instant::now(), Carried::default()),
            );
        }
        Ok(())
    }

    /// Trees kept current on the connection: the shared tree, the driven
    /// tree, and while driving none, the tree this session drove last. A
    /// session without the lock keeps receiving its changes instead of
    /// sleeping on an old copy.
    fn watch_targets(&self) -> BTreeSet<String> {
        let mut out = BTreeSet::from([self.shared_id.clone()]);
        if let Some(tree) = self.driving() {
            out.insert(tree.to_owned());
        }
        if let Some(tree) = &self.local.following {
            if self.roster.iter().any(|t| !t.shared && &t.tree_id == tree) {
                out.insert(tree.clone());
            }
        }
        out
    }

    /// Trees this session may publish to: the shared tree, and the driven
    /// tree once it is writable. A followed tree is only ever read.
    fn publish_targets(&self) -> BTreeSet<String> {
        let mut out = BTreeSet::from([self.shared_id.clone()]);
        if let Some(tree) = self.driving().filter(|_| self.writable()) {
            out.insert(tree.to_owned());
        }
        out
    }

    fn watch(&self, tree: &str) -> Outgoing {
        Outgoing::Watch {
            tree_id: tree.to_owned(),
            after: self.states.get(tree).map_or(0, |s| s.version),
        }
    }

    /// A fresh connection re-watches and resends in-flight ops verbatim, so
    /// a lost acknowledgment is resolved by the server's receipt.
    pub fn on_connect(&mut self) -> Vec<Outgoing> {
        self.roster_confirmed = false;
        self.current.clear();
        self.watched.clear();
        let mut out = Vec::new();
        for tree in self.watch_targets() {
            out.push(self.watch(&tree));
            self.watched.insert(tree);
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
        trees: Vec<Tree>,
    ) -> Result<Vec<Outgoing>> {
        if trees.len() > 1025
            || trees
                .iter()
                .any(|t| !crate::protocol::valid_id(&t.tree_id) || t.version > MAX_COUNTER)
        {
            return Err(Error::Invalid);
        }
        let seat = |roster: &[Tree], device: &str| {
            roster
                .iter()
                .find(|t| !t.shared && t.driver_device_id.as_deref() == Some(device))
                .map(|t| (t.tree_id.clone(), t.driver_epoch.clone()))
        };
        let before_seat = seat(&self.roster, &self.device_id);
        let before = self.driving().map(str::to_owned);
        store.save_tree_roster(&trees)?;
        self.roster = trees;
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
        if before.is_some() && after != before {
            let lost = before.as_deref().unwrap();
            self.displaced_with_edits =
                store.tree_desired_exists(lost)? || self.inflight.contains_key(lost);
        }
        if after.is_some() {
            self.displaced_with_edits = false;
        }
        let after_seat = seat(&self.roster, &self.device_id);
        if let Some((tree, _)) = after_seat.clone() {
            // A seat taken (or taken back) under a new epoch: edits queued in
            // an earlier tenure were made against an older copy, and another
            // session may have written since. The server's state wins; the old
            // edits are kept aside for recovery, never replayed.
            if before_seat != after_seat && self.local.ready != self.seat() {
                store.retire_tree_desired(root, &tree)?;
                if let Some(old) = before.as_deref().filter(|old| *old != tree) {
                    store.retire_tree_desired(root, old)?;
                }
            }
            self.follow(store, Some(tree))?;
        } else if let Some(lost) = before {
            self.follow(store, Some(lost))?;
        }
        if self
            .local
            .following
            .as_ref()
            .is_some_and(|tree| !self.roster.iter().any(|t| !t.shared && &t.tree_id == tree))
        {
            self.follow(store, None)?;
        }
        self.refresh_ready(store)?;
        let targets = self.watch_targets();
        let mut out = Vec::new();
        for tree in self.watched.difference(&targets) {
            out.push(Outgoing::Unwatch {
                tree_id: tree.clone(),
            });
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
        let author = state
            .last_change
            .as_ref()
            .and_then(|c| v.grants.get(&c.device_id));
        store.save_tree_cache(v.root, &state.to_snapshot(), author)?;
        self.current.insert(state.tree_id.clone());
        self.states.insert(state.tree_id.clone(), state);
        self.refresh_ready(store)
    }

    /// The server says our copy is current. A brand-new tree (version 0) has
    /// nothing to send; any mismatch asks for a snapshot instead.
    pub fn on_current(
        &mut self,
        store: &mut Store,
        tree_id: &str,
        version: u64,
    ) -> Result<Vec<Outgoing>> {
        if !self.watched.contains(tree_id) {
            return Ok(Vec::new());
        }
        let local = self.states.get(tree_id).map_or(0, |s| s.version);
        if local != version {
            return Ok(vec![Outgoing::Watch {
                tree_id: tree_id.to_owned(),
                after: MAX_COUNTER,
            }]);
        }
        self.states
            .entry(tree_id.to_owned())
            .or_insert_with(|| TreeState::empty(tree_id));
        self.current.insert(tree_id.to_owned());
        self.refresh_ready(store)?;
        Ok(Vec::new())
    }

    pub fn on_snapshot(
        &mut self,
        store: &mut Store,
        v: &Verifier<'_>,
        snapshot: TreeSnapshot,
    ) -> Result<()> {
        if !self.watched.contains(&snapshot.tree_id) {
            return Ok(());
        }
        let state = TreeState::from_snapshot(v, snapshot)?;
        self.accept(store, v, state)
    }

    /// A delta that does not verify against our copy asks for a snapshot
    /// (a watch past the server's head always returns one).
    pub fn on_delta(
        &mut self,
        store: &mut Store,
        v: &Verifier<'_>,
        delta: TreeDelta,
    ) -> Result<Vec<Outgoing>> {
        if !self.watched.contains(&delta.tree_id) {
            return Ok(Vec::new());
        }
        let mut state = self
            .states
            .get(&delta.tree_id)
            .cloned()
            .unwrap_or_else(|| TreeState::empty(&delta.tree_id));
        let tree = delta.tree_id.clone();
        match state.apply_delta(v, delta) {
            Ok(()) => {
                self.accept(store, v, state)?;
                Ok(Vec::new())
            }
            Err(Error::Identity) => Err(Error::Identity),
            Err(_) => Ok(vec![Outgoing::Watch {
                tree_id: tree,
                after: MAX_COUNTER,
            }]),
        }
    }

    pub fn on_ack(
        &mut self,
        store: &mut Store,
        v: &Verifier<'_>,
        request: Option<&str>,
        receipt: TreeReceipt,
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
        let Some(tree) = self
            .inflight
            .iter()
            .find(|(_, (_, op, _, _))| op.operation_id == receipt.operation_id)
            .map(|(t, _)| t.clone())
        else {
            return Ok(());
        };
        let (_, op, _, carried) = self.inflight.remove(&tree).expect("present");
        store.finish_tree_op(&tree, &op.operation_id)?;
        if receipt.discarded {
            // Version conflicts rebase onto the next delta; a lost seat keeps
            // the edits locally for the choose screen.
            return Ok(());
        }
        let mut state = self
            .states
            .get(&tree)
            .cloned()
            .unwrap_or_else(|| TreeState::empty(&tree));
        if state.version == op.base_tree_version {
            state.apply_own(v, &op)?;
            self.accept(store, v, state)?;
        }
        // The server holds exactly what this machine's browser store produced.
        let signin: Vec<(i16, Option<[u8; 32]>)> = op
            .slots
            .iter()
            .filter(|s| s.tab_node_id == tree && is_signin_slot(s.slot))
            .map(|s| (s.slot, s.ciphertext.as_deref().map(content_hash)))
            .collect();
        if !signin.is_empty() {
            store.mark_signin_applied(v.root, &tree, &signin)?;
        }
        Self::drain_carried(store, v.root, &tree, &carried)
    }

    /// Removes what an accepted (or empty) op carried from the desired state.
    fn drain_carried(
        store: &mut Store,
        root: &VaultRoot,
        tree: &str,
        carried: &Carried,
    ) -> Result<()> {
        if let Some(mut desired) = store.tree_desired(root, tree)? {
            desired
                .changes
                .drain(..carried.changes.min(desired.changes.len()));
            desired
                .slots
                .drain(..carried.slots.min(desired.slots.len()));
            // A resume changed after this op was built stays queued.
            if carried.resume.is_some()
                && carried.resume
                    == desired
                        .resume
                        .as_ref()
                        .map(serde_json::to_value)
                        .transpose()?
            {
                desired.resume = None;
            }
            if desired.is_empty() {
                store.clear_tree_desired(tree)?;
            } else {
                store.set_tree_desired(root, tree, &desired)?;
            }
        }
        Ok(())
    }

    pub fn on_error(
        &mut self,
        store: &mut Store,
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
        if let Some((tree, _, _, reply)) = request.and_then(|r| self.slots.remove(r)) {
            let _ = reply.send(Err(Error::Invalid));
            let _ = tree;
            return Ok(());
        }
        let tree = operation.and_then(|id| {
            self.inflight
                .iter()
                .find(|(_, (_, op, _, _))| op.operation_id == id)
                .map(|(t, _)| t.clone())
        });
        match (tree, code) {
            (_, "sync_unavailable") => Err(Error::Network),
            (_, "sync_device_forbidden") => Err(Error::DeviceForbidden),
            // A structurally rejected op can never succeed; drop it and the
            // edit that produced it rather than retrying forever. The tree
            // itself is still the server's, so sync carries on from there.
            (Some(tree), _) => {
                let (_, op, _, _) = self.inflight.remove(&tree).expect("present");
                store.finish_tree_op(&tree, &op.operation_id)?;
                store.clear_tree_desired(&tree)?;
                Ok(())
            }
            (None, _) => Ok(()),
        }
    }

    fn queue(
        &self,
        store: &mut Store,
        root: &VaultRoot,
        tree: &str,
        edit: impl FnOnce(&mut Desired),
    ) -> Result<()> {
        let mut desired = store.tree_desired(root, tree)?.unwrap_or_default();
        edit(&mut desired);
        store.set_tree_desired(root, tree, &desired)
    }

    /// Queues renderer edits: groups and websites go to the shared tree,
    /// everything else to the tree this device drives.
    /// The driven tree, if edits may be queued for it now. While this
    /// session is still catching up with the server's copy it is treated as
    /// following: nothing it saw before is written back.
    fn writable_tree(&self) -> Result<String> {
        self.driving()
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
        let tree = self.writable_tree()?;
        if changes.is_empty() || changes.len() > 256 {
            return Err(Error::Invalid);
        }
        let (shared, own): (Vec<_>, Vec<_>) = changes
            .into_iter()
            .partition(|c| belongs_to_shared(model::change_kind(c)));
        let shared_id = self.shared_id.clone();
        for (target, batch) in [(tree, own), (shared_id, shared)] {
            if batch.is_empty() {
                continue;
            }
            // Reject an invalid edit now, before it can wedge the publisher.
            let mut desired = store.tree_desired(root, &target)?.unwrap_or_default();
            desired.changes.extend(batch);
            let base = self
                .states
                .get(&target)
                .map(|s| s.records.as_slice())
                .unwrap_or(&[]);
            model::rebase(base, &desired.changes)?;
            store.set_tree_desired(root, &target, &desired)?;
        }
        Ok(())
    }

    pub fn set_resume(
        &mut self,
        store: &mut Store,
        root: &VaultRoot,
        resume: Resume,
    ) -> Result<()> {
        let tree = self.writable_tree()?;
        self.queue(store, root, &tree, |d| d.resume = Some(resume))
    }

    pub fn write_slot(
        &mut self,
        store: &mut Store,
        root: &VaultRoot,
        tab_record: &str,
        slot: i16,
        plaintext: Option<Vec<u8>>,
    ) -> Result<()> {
        let tree = self.writable_tree()?;
        let tab = model::node_id(&tree, crate::document::entities::Kind::Tab, tab_record);
        // Keep write order: an in-flight op may already carry an older value.
        self.queue(store, root, &tree, |d| d.slots.push((tab, slot, plaintext)))
    }

    #[allow(clippy::too_many_arguments)]
    pub fn claim(
        &mut self,
        store: &mut Store,
        scope: &VaultScope,
        grant: &DeviceGrant,
        device: &DeviceKey,
        tree_id: &str,
        request: Option<String>,
        reply: Option<Reply<()>>,
    ) -> Result<Outgoing> {
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
        self.claims
            .insert(request_id.clone(), (tree_id.to_owned(), reply));
        Ok(Outgoing::Claim { request_id, claim })
    }

    pub fn read_slot(
        &mut self,
        tree_id: &str,
        tab_record: &str,
        slot: i16,
        reply: Reply<Option<Vec<u8>>>,
    ) -> Outgoing {
        let tab = model::node_id(tree_id, crate::document::entities::Kind::Tab, tab_record);
        let request_id = Uuid::new_v4().to_string();
        self.slots.insert(
            request_id.clone(),
            (tree_id.to_owned(), tab.clone(), slot, reply),
        );
        Outgoing::SlotGet {
            request_id,
            tree_id: tree_id.to_owned(),
            tab_node_id: tab,
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
        let Some((tree, tab, kind, reply)) = request.and_then(|r| self.slots.remove(r)) else {
            return;
        };
        // Sign-in data must be exactly the verified slot, never an older copy.
        let expected = (tab == tree && is_signin_slot(kind)).then(|| {
            self.states
                .get(&tree)
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
            Some(s) if s.tree_id != tree || s.tab_node_id != tab || s.slot != kind => {
                Err(Error::Identity)
            }
            Some(s) => seal::open(
                root,
                scope,
                Position {
                    tree_id: &tree,
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

    /// Publishes at most one op per tree, only once the tree's server state
    /// has arrived on this connection, and only for trees this device may
    /// write (its driven tree, and the shared tree).
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
        for tree in writable {
            let Some(desired) = store.tree_desired(root, &tree)? else {
                continue;
            };
            let state = self
                .states
                .get(&tree)
                .cloned()
                .unwrap_or_else(|| TreeState::empty(&tree));
            let records = model::rebase(&state.records, &desired.changes)?;
            let resume = desired.resume.clone().or_else(|| state.resume.clone());
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
            let placed = model::place(&tree, &records);
            slots.retain(|(tab, kind, _)| {
                placed.contains_key(tab) || (*tab == tree && is_signin_slot(*kind))
            });
            let request_id = Uuid::new_v4().to_string();
            let mut built = None;
            let result = store.begin_tree_op(&tree, &request_id, |counter| {
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
                resume: desired
                    .resume
                    .as_ref()
                    .map(serde_json::to_value)
                    .transpose()?,
            };
            match result {
                Ok(op) => {
                    self.inflight.insert(
                        tree.clone(),
                        (request_id.clone(), op.clone(), Instant::now(), carried),
                    );
                    out.push(Outgoing::Publish { request_id, op });
                }
                // Nothing to publish: the tree already matches. Slot writes
                // beyond this op's budget are still queued.
                Err(Error::Sequence) if built.is_none() && take == desired.slots.len() => {
                    store.clear_tree_desired(&tree)?
                }
                Err(Error::Sequence) if built.is_none() => {
                    Self::drain_carried(store, root, &tree, &carried)?
                }
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
            seat_confirmed: self.roster_confirmed,
            following: self.local.following.clone(),
            writable: self.writable(),
        })
    }

    /// Seeds this device's own tree (and the shared tree, if still empty)
    /// from the legacy shared workspace the first time it speaks v2.
    pub fn seed_from_legacy(
        &mut self,
        store: &mut Store,
        root: &VaultRoot,
        legacy: &[ViewRecord],
        resume: Option<Resume>,
    ) -> Result<()> {
        if legacy.is_empty()
            || store.tree_high_watermark(&self.device_id)? > 0
            || store.tree_desired(root, &self.device_id)?.is_some()
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
        store.set_tree_desired(
            root,
            &self.device_id,
            &Desired {
                changes: own.into_iter().map(create).collect(),
                resume,
                ..Default::default()
            },
        )?;
        // Idempotent creates: a shared tree another device already seeded
        // keeps its records.
        if store.tree_desired(root, &self.shared_id)?.is_none() {
            store.set_tree_desired(
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
