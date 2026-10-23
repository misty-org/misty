//! Verified local copy of one workspace, and building signed ops against it.
use std::collections::{BTreeMap, HashMap};

use uuid::Uuid;

use super::{
    merkle::{self, Leaf},
    model::{self, NodeBody},
    protocol::{
        content_hash, NodeWrite, SlotMeta, SlotWrite, WorkspaceChange, WorkspaceDelta,
        WorkspaceNode, WorkspaceOp, WorkspaceSnapshot,
    },
    seal::{self, Position},
};
use crate::{
    crypto::{DeviceKey, VaultRoot, VaultScope},
    document::{Resume, ViewRecord},
    protocol::DeviceGrant,
    Error, Result,
};

mod build;
mod verify;
use verify::leaves;

#[derive(Clone)]
pub struct StoredNode {
    pub parent_id: Option<String>,
    pub version: u64,
    pub key_epoch: u64,
    pub ciphertext: Vec<u8>,
}

/// Decryption keys and device grants needed to verify a workspace.
pub struct Verifier<'a> {
    pub root: &'a VaultRoot,
    pub scope: &'a VaultScope,
    pub grants: &'a HashMap<String, DeviceGrant>,
}

#[derive(Clone, Default)]
pub struct WorkspaceState {
    pub workspace_id: String,
    pub version: u64,
    pub nodes: BTreeMap<String, StoredNode>,
    pub slots: BTreeMap<(String, i16), SlotMeta>,
    /// Decrypted records and resume; rebuilt after every verified update.
    pub records: Vec<ViewRecord>,
    pub resume: Option<Resume>,
    /// The signed change the current state was verified against.
    pub last_change: Option<WorkspaceChange>,
    /// Records another machine deleted, with the workspace version that removed
    /// them. In memory only and bounded: it keeps a stale queued edit from
    /// recreating what someone else closed.
    pub tombstones: BTreeMap<(crate::document::entities::Kind, String), u64>,
}

impl WorkspaceState {
    pub fn empty(workspace_id: &str) -> Self {
        Self {
            workspace_id: workspace_id.into(),
            ..Default::default()
        }
    }

    /// The durable cache format is the server snapshot format, so a cached
    /// workspace is re-verified exactly like a fresh one when it is loaded.
    pub fn to_snapshot(&self) -> WorkspaceSnapshot {
        WorkspaceSnapshot {
            workspace_id: self.workspace_id.clone(),
            version: self.version,
            nodes: self
                .nodes
                .iter()
                .map(|(id, n)| WorkspaceNode {
                    node_id: id.clone(),
                    parent_id: n.parent_id.clone(),
                    version: n.version,
                    key_epoch: n.key_epoch,
                    ciphertext: n.ciphertext.clone(),
                })
                .collect(),
            slots: self.slots.values().cloned().collect(),
            last_change: self.last_change.clone(),
        }
    }

    pub fn from_snapshot(v: &Verifier<'_>, snapshot: WorkspaceSnapshot) -> Result<Self> {
        let mut state = Self::empty(&snapshot.workspace_id);
        state.version = snapshot.version;
        for n in snapshot.nodes {
            state.nodes.insert(
                n.node_id,
                StoredNode {
                    parent_id: n.parent_id,
                    version: n.version,
                    key_epoch: n.key_epoch,
                    ciphertext: n.ciphertext,
                },
            );
        }
        for s in snapshot.slots {
            state.slots.insert((s.view_node_id.clone(), s.slot), s);
        }
        state.verify(v, snapshot.last_change.as_ref())?;
        Ok(state)
    }

    /// Applies a delta atomically: on any verification failure the current
    /// state is left untouched and the caller falls back to a snapshot.
    pub fn apply_delta(&mut self, v: &Verifier<'_>, delta: WorkspaceDelta) -> Result<()> {
        if delta.workspace_id != self.workspace_id || delta.changes.is_empty() {
            return Err(Error::Invalid);
        }
        let mut next = self.clone();
        for (i, change) in delta.changes.iter().enumerate() {
            if change.workspace_version != self.version + 1 + i as u64 {
                return Err(Error::Sequence);
            }
            let grant = v.grants.get(&change.device_id).ok_or(Error::Identity)?;
            seal::verify_change(v.root, v.scope, &self.workspace_id, grant, change)?;
            for id in &change.manifest.deletes {
                next.nodes.remove(id);
                next.slots.retain(|(tab, _), _| tab != id);
            }
            for s in &change.manifest.slots {
                let slot: i16 = s[1].parse().map_err(|_| Error::Invalid)?;
                if s[2].is_empty() {
                    next.slots.remove(&(s[0].clone(), slot));
                }
            }
        }
        for id in &delta.deleted {
            next.nodes.remove(id);
            next.slots.retain(|(tab, _), _| tab != id);
        }
        for n in delta.nodes {
            next.nodes.insert(
                n.node_id,
                StoredNode {
                    parent_id: n.parent_id,
                    version: n.version,
                    key_epoch: n.key_epoch,
                    ciphertext: n.ciphertext,
                },
            );
        }
        // Touched slot keys absent from the delta no longer exist.
        for change in &delta.changes {
            for s in &change.manifest.slots {
                let slot: i16 = s[1].parse().map_err(|_| Error::Invalid)?;
                next.slots.remove(&(s[0].clone(), slot));
            }
        }
        for s in delta.slots {
            next.slots.insert((s.view_node_id.clone(), s.slot), s);
        }
        next.version = delta.version;
        next.verify(v, delta.changes.last())?;
        *self = next;
        Ok(())
    }

    /// Verified content hashes of this device's sign-in slots, by kind.
    pub fn signin_hashes(&self) -> BTreeMap<i16, [u8; 32]> {
        self.slots
            .iter()
            .filter(|((node, kind), _)| {
                *node == self.workspace_id && super::signin::is_signin_slot(*kind)
            })
            .filter_map(|((_, kind), meta)| {
                Some((*kind, meta.content_hash.as_slice().try_into().ok()?))
            })
            .collect()
    }

    pub fn tab_node(&self, record_id: &str) -> String {
        model::node_id(
            &self.workspace_id,
            crate::document::entities::Kind::View,
            record_id,
        )
    }
}
