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

mod edits;
mod events;
mod projection;
mod receipts;
mod signin_ops;
mod tick;
mod view_ops;
mod watching;

pub use projection::{SyncState, UnsyncedRecord, WorkspaceContent};
pub use signin_ops::SigninStatus;
use view_ops::tombstones;

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
}
