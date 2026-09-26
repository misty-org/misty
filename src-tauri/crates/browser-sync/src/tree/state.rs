//! Verified local copy of one tree, and building signed ops against it.
use std::collections::{BTreeMap, HashMap};

use uuid::Uuid;

use super::{
    merkle::{self, Leaf},
    model::{self, NodeBody},
    protocol::{content_hash, NodeWrite, SlotMeta, SlotWrite, TreeChange, TreeDelta, TreeNode, TreeOp, TreeSnapshot},
    seal::{self, Position},
};
use crate::{
    crypto::{DeviceKey, VaultRoot, VaultScope},
    document::{Resume, ViewRecord},
    protocol::DeviceGrant,
    Error, Result,
};

#[derive(Clone)]
pub struct StoredNode {
    pub parent_id: Option<String>,
    pub version: u64,
    pub key_epoch: u64,
    pub ciphertext: Vec<u8>,
}

/// Decryption keys and device grants needed to verify a tree.
pub struct Verifier<'a> {
    pub root: &'a VaultRoot,
    pub scope: &'a VaultScope,
    pub grants: &'a HashMap<String, DeviceGrant>,
}

#[derive(Clone, Default)]
pub struct TreeState {
    pub tree_id: String,
    pub version: u64,
    pub nodes: BTreeMap<String, StoredNode>,
    pub slots: BTreeMap<(String, i16), SlotMeta>,
    /// Decrypted records and resume; rebuilt after every verified update.
    pub records: Vec<ViewRecord>,
    pub resume: Option<Resume>,
    /// The signed change the current state was verified against.
    pub last_change: Option<TreeChange>,
}

fn leaves(tree_id: &str, nodes: &BTreeMap<String, StoredNode>, slots: &BTreeMap<(String, i16), SlotMeta>) -> Result<Vec<Leaf>> {
    let mut out = Vec::with_capacity(nodes.len() + slots.len());
    for (id, n) in nodes {
        if id == tree_id {
            continue;
        }
        out.push(Leaf::Node {
            node_id: id.clone(),
            parent_id: n.parent_id.clone().unwrap_or_default(),
            version: n.version,
            hash: content_hash(&n.ciphertext),
        });
    }
    for ((tab, slot), meta) in slots {
        out.push(Leaf::Slot {
            tab_node_id: tab.clone(),
            slot: *slot,
            version: meta.version,
            hash: meta.content_hash.as_slice().try_into().map_err(|_| Error::Invalid)?,
        });
    }
    Ok(out)
}

impl TreeState {
    pub fn empty(tree_id: &str) -> Self {
        Self { tree_id: tree_id.into(), ..Default::default() }
    }

    fn open(&self, v: &Verifier<'_>, id: &str, n: &StoredNode) -> Result<NodeBody> {
        let plain = seal::open(
            v.root,
            v.scope,
            Position { tree_id: &self.tree_id, node_id: id, parent_id: n.parent_id.as_deref(), slot: 0, version: n.version, key_epoch: n.key_epoch },
            &n.ciphertext,
        )?;
        Ok(serde_json::from_slice(&plain)?)
    }

    /// Checks the whole tree against the latest signed change: the change's
    /// signature, the root node it wrote, and the recomputed Merkle root.
    fn verify(&mut self, v: &Verifier<'_>, last: Option<&TreeChange>) -> Result<()> {
        if self.version == 0 {
            if !self.nodes.is_empty() || !self.slots.is_empty() || last.is_some() {
                return Err(Error::Identity);
            }
            self.records.clear();
            self.resume = None;
            self.last_change = None;
            return Ok(());
        }
        let last = last.ok_or(Error::Identity)?;
        if last.tree_version != self.version {
            return Err(Error::Sequence);
        }
        let grant = v.grants.get(&last.device_id).ok_or(Error::Identity)?;
        seal::verify_change(v.root, v.scope, &self.tree_id, grant, last)?;
        let computed = merkle::root(leaves(&self.tree_id, &self.nodes, &self.slots)?);
        if last.merkle_root != computed {
            return Err(Error::Identity);
        }
        let root = self.nodes.get(&self.tree_id).ok_or(Error::Identity)?;
        let root_hash = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, content_hash(&root.ciphertext));
        if root.version != self.version || !last.manifest.upserts.iter().any(|u| u[0] == self.tree_id && u[2] == root_hash) {
            return Err(Error::Identity);
        }
        let mut records = Vec::new();
        let mut resume = None;
        for (id, n) in &self.nodes {
            match (self.open(v, id, n)?, id == &self.tree_id) {
                (NodeBody::Root { tree_version, merkle_root, resume: r }, true) => {
                    if tree_version != self.version || merkle_root != computed {
                        return Err(Error::Identity);
                    }
                    resume = r;
                }
                (NodeBody::Record { kind, id: record_id, fields }, false) => {
                    if model::node_id(&self.tree_id, kind, &record_id) != *id {
                        return Err(Error::Identity);
                    }
                    records.push(ViewRecord { kind, id: record_id, fields });
                }
                _ => return Err(Error::Identity),
            }
        }
        self.records = records;
        self.resume = resume;
        self.last_change = Some(last.clone());
        Ok(())
    }

    /// The durable cache format is the server snapshot format, so a cached
    /// tree is re-verified exactly like a fresh one when it is loaded.
    pub fn to_snapshot(&self) -> TreeSnapshot {
        TreeSnapshot {
            tree_id: self.tree_id.clone(),
            version: self.version,
            nodes: self
                .nodes
                .iter()
                .map(|(id, n)| TreeNode { node_id: id.clone(), parent_id: n.parent_id.clone(), version: n.version, key_epoch: n.key_epoch, ciphertext: n.ciphertext.clone() })
                .collect(),
            slots: self.slots.values().cloned().collect(),
            last_change: self.last_change.clone(),
        }
    }

    pub fn from_snapshot(v: &Verifier<'_>, snapshot: TreeSnapshot) -> Result<Self> {
        let mut state = Self::empty(&snapshot.tree_id);
        state.version = snapshot.version;
        for n in snapshot.nodes {
            state.nodes.insert(n.node_id, StoredNode { parent_id: n.parent_id, version: n.version, key_epoch: n.key_epoch, ciphertext: n.ciphertext });
        }
        for s in snapshot.slots {
            state.slots.insert((s.tab_node_id.clone(), s.slot), s);
        }
        state.verify(v, snapshot.last_change.as_ref())?;
        Ok(state)
    }

    /// Applies a delta atomically: on any verification failure the current
    /// state is left untouched and the caller falls back to a snapshot.
    pub fn apply_delta(&mut self, v: &Verifier<'_>, delta: TreeDelta) -> Result<()> {
        if delta.tree_id != self.tree_id || delta.changes.is_empty() {
            return Err(Error::Invalid);
        }
        let mut next = self.clone();
        for (i, change) in delta.changes.iter().enumerate() {
            if change.tree_version != self.version + 1 + i as u64 {
                return Err(Error::Sequence);
            }
            let grant = v.grants.get(&change.device_id).ok_or(Error::Identity)?;
            seal::verify_change(v.root, v.scope, &self.tree_id, grant, change)?;
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
            next.nodes.insert(n.node_id, StoredNode { parent_id: n.parent_id, version: n.version, key_epoch: n.key_epoch, ciphertext: n.ciphertext });
        }
        // Touched slot keys absent from the delta no longer exist.
        for change in &delta.changes {
            for s in &change.manifest.slots {
                let slot: i16 = s[1].parse().map_err(|_| Error::Invalid)?;
                next.slots.remove(&(s[0].clone(), slot));
            }
        }
        for s in delta.slots {
            next.slots.insert((s.tab_node_id.clone(), s.slot), s);
        }
        next.version = delta.version;
        next.verify(v, delta.changes.last())?;
        *self = next;
        Ok(())
    }

    /// Builds and signs the op that turns this tree into `records` + `resume`.
    /// Returns `None` when nothing would change.
    #[allow(clippy::too_many_arguments)]
    pub fn build_op(
        &self,
        root: &VaultRoot,
        scope: &VaultScope,
        grant: &DeviceGrant,
        device: &DeviceKey,
        device_counter: u64,
        records: &[ViewRecord],
        resume: Option<&Resume>,
        slots: Vec<(String, i16, Option<Vec<u8>>)>,
        blob_refs: Vec<Vec<u8>>,
    ) -> Result<Option<TreeOp>> {
        let version = self.version + 1;
        let key_epoch = grant.key_epoch;
        let placed = model::place(&self.tree_id, records);
        let current: BTreeMap<(crate::document::entities::Kind, &str), &ViewRecord> =
            self.records.iter().map(|r| ((r.kind, r.id.as_str()), r)).collect();
        let mut nodes = self.nodes.clone();
        let mut upserts = Vec::new();
        for (id, (parent, record)) in &placed {
            let unchanged = current.get(&(record.kind, record.id.as_str())).is_some_and(|c| c.fields == record.fields)
                && nodes.get(id).is_some_and(|n| n.parent_id == *parent);
            if unchanged {
                continue;
            }
            let body = serde_json::to_vec(&NodeBody::Record { kind: record.kind, id: record.id.clone(), fields: record.fields.clone() })?;
            let ciphertext = seal::seal(root, scope, Position { tree_id: &self.tree_id, node_id: id, parent_id: parent.as_deref(), slot: 0, version, key_epoch }, &body)?;
            nodes.insert(id.clone(), StoredNode { parent_id: parent.clone(), version, key_epoch, ciphertext: ciphertext.clone() });
            upserts.push(NodeWrite { node_id: id.clone(), parent_id: parent.clone(), ciphertext });
        }
        let deletes: Vec<String> = self.nodes.keys().filter(|id| **id != self.tree_id && !placed.contains_key(*id)).cloned().collect();
        let mut next_slots = self.slots.clone();
        for id in &deletes {
            nodes.remove(id);
            next_slots.retain(|(tab, _), _| tab != id);
        }
        let mut slot_writes = Vec::new();
        for (tab, slot, plaintext) in slots {
            if !placed.contains_key(&tab) {
                return Err(Error::Invalid);
            }
            match plaintext {
                Some(plain) => {
                    let ciphertext = seal::seal(root, scope, Position { tree_id: &self.tree_id, node_id: &tab, parent_id: None, slot, version, key_epoch }, &plain)?;
                    next_slots.insert((tab.clone(), slot), SlotMeta { tab_node_id: tab.clone(), slot, version, content_hash: content_hash(&ciphertext).to_vec() });
                    slot_writes.push(SlotWrite { tab_node_id: tab, slot, ciphertext: Some(ciphertext) });
                }
                None => {
                    if next_slots.remove(&(tab.clone(), slot)).is_some() {
                        slot_writes.push(SlotWrite { tab_node_id: tab, slot, ciphertext: None });
                    }
                }
            }
        }
        let same_resume = serde_json::to_value(resume)? == serde_json::to_value(self.resume.as_ref())?;
        if upserts.is_empty() && deletes.is_empty() && slot_writes.is_empty() && same_resume && self.version > 0 {
            return Ok(None);
        }
        let merkle_root = merkle::root(leaves(&self.tree_id, &nodes, &next_slots)?).to_vec();
        let body = serde_json::to_vec(&NodeBody::Root { tree_version: version, merkle_root: merkle_root.clone(), resume: resume.cloned() })?;
        let ciphertext = seal::seal(root, scope, Position { tree_id: &self.tree_id, node_id: &self.tree_id, parent_id: None, slot: 0, version, key_epoch }, &body)?;
        upserts.insert(0, NodeWrite { node_id: self.tree_id.clone(), parent_id: None, ciphertext });
        let mut op = TreeOp {
            workspace_id: scope.workspace_id.clone(),
            tree_id: self.tree_id.clone(),
            operation_id: Uuid::new_v4().to_string(),
            device_id: grant.device_id.clone(),
            device_counter,
            key_epoch,
            base_tree_version: self.version,
            merkle_root,
            upserts,
            slots: slot_writes,
            deletes,
            blob_refs,
            signature: Vec::new(),
        };
        seal::sign_op(device, &mut op)?;
        Ok(Some(op))
    }

    /// Applies our own acknowledged op without a round trip. The server's
    /// next delta or snapshot re-verifies the result.
    pub fn apply_own(&mut self, v: &Verifier<'_>, op: &TreeOp) -> Result<()> {
        let change = TreeChange {
            tree_version: op.tree_version(),
            sequence: 0,
            operation_id: op.operation_id.clone(),
            device_id: op.device_id.clone(),
            device_counter: op.device_counter,
            key_epoch: op.key_epoch,
            merkle_root: op.merkle_root.clone(),
            manifest: op.manifest(),
            signature: op.signature.clone(),
        };
        let delta = TreeDelta {
            tree_id: self.tree_id.clone(),
            version: op.tree_version(),
            changes: vec![change],
            nodes: op
                .upserts
                .iter()
                .map(|n| TreeNode { node_id: n.node_id.clone(), parent_id: n.parent_id.clone(), version: op.tree_version(), key_epoch: op.key_epoch, ciphertext: n.ciphertext.clone() })
                .collect(),
            slots: op
                .slots
                .iter()
                .filter_map(|s| {
                    s.ciphertext.as_ref().map(|c| SlotMeta { tab_node_id: s.tab_node_id.clone(), slot: s.slot, version: op.tree_version(), content_hash: content_hash(c).to_vec() })
                })
                .collect(),
            deleted: op.deletes.clone(),
        };
        self.apply_delta(v, delta)
    }

    pub fn tab_node(&self, record_id: &str) -> String {
        model::node_id(&self.tree_id, crate::document::entities::Kind::Tab, record_id)
    }
}
