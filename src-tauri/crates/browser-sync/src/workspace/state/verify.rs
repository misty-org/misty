//! Verifying a workspace's nodes and slots against its signed change.
use super::*;

pub(super) fn leaves(
    workspace_id: &str,
    nodes: &BTreeMap<String, StoredNode>,
    slots: &BTreeMap<(String, i16), SlotMeta>,
) -> Result<Vec<Leaf>> {
    let mut out = Vec::with_capacity(nodes.len() + slots.len());
    for (id, n) in nodes {
        if id == workspace_id {
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
            view_node_id: tab.clone(),
            slot: *slot,
            version: meta.version,
            hash: meta
                .content_hash
                .as_slice()
                .try_into()
                .map_err(|_| Error::Invalid)?,
        });
    }
    Ok(out)
}

impl WorkspaceState {
    pub(super) fn open(&self, v: &Verifier<'_>, id: &str, n: &StoredNode) -> Result<NodeBody> {
        let plain = seal::open(
            v.root,
            v.scope,
            Position {
                workspace_id: &self.workspace_id,
                node_id: id,
                parent_id: n.parent_id.as_deref(),
                slot: 0,
                version: n.version,
                key_epoch: n.key_epoch,
            },
            &n.ciphertext,
        )?;
        Ok(serde_json::from_slice(&plain)?)
    }

    /// Checks the whole workspace against the latest signed change: the change's
    /// signature, the root node it wrote, and the recomputed Merkle root.
    pub(super) fn verify(
        &mut self,
        v: &Verifier<'_>,
        last: Option<&WorkspaceChange>,
    ) -> Result<()> {
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
        if last.workspace_version != self.version {
            return Err(Error::Sequence);
        }
        let grant = v.grants.get(&last.device_id).ok_or(Error::Identity)?;
        seal::verify_change(v.root, v.scope, &self.workspace_id, grant, last)?;
        let computed = merkle::root(leaves(&self.workspace_id, &self.nodes, &self.slots)?);
        if last.merkle_root != computed {
            return Err(Error::Identity);
        }
        let root = self.nodes.get(&self.workspace_id).ok_or(Error::Identity)?;
        let root_hash = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            content_hash(&root.ciphertext),
        );
        if root.version != self.version
            || !last
                .manifest
                .upserts
                .iter()
                .any(|u| u[0] == self.workspace_id && u[2] == root_hash)
        {
            return Err(Error::Identity);
        }
        let mut records = Vec::new();
        let mut resume = None;
        for (id, n) in &self.nodes {
            match (self.open(v, id, n)?, id == &self.workspace_id) {
                (
                    NodeBody::Root {
                        workspace_version,
                        merkle_root,
                        resume: r,
                    },
                    true,
                ) => {
                    if workspace_version != self.version || merkle_root != computed {
                        return Err(Error::Identity);
                    }
                    resume = r;
                }
                (
                    NodeBody::Record {
                        kind,
                        id: record_id,
                        fields,
                    },
                    false,
                ) => {
                    if model::node_id(&self.workspace_id, kind, &record_id) != *id {
                        return Err(Error::Identity);
                    }
                    records.push(ViewRecord {
                        kind,
                        id: record_id,
                        fields,
                    });
                }
                _ => return Err(Error::Identity),
            }
        }
        self.records = records;
        self.resume = resume;
        self.last_change = Some(last.clone());
        Ok(())
    }
}
