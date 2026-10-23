//! Building signed ops against the verified state, and applying this
//! device's own accepted ops.
use super::*;

impl WorkspaceState {
    /// Builds and signs the op that turns this workspace into `records` + `resume`.
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
    ) -> Result<Option<WorkspaceOp>> {
        let version = self.version + 1;
        let key_epoch = grant.key_epoch;
        let placed = model::place(&self.workspace_id, records);
        let current: BTreeMap<(crate::document::entities::Kind, &str), &ViewRecord> = self
            .records
            .iter()
            .map(|r| ((r.kind, r.id.as_str()), r))
            .collect();
        let mut nodes = self.nodes.clone();
        let mut upserts = Vec::new();
        for (id, (parent, record)) in &placed {
            let unchanged = current
                .get(&(record.kind, record.id.as_str()))
                .is_some_and(|c| c.fields == record.fields)
                && nodes.get(id).is_some_and(|n| n.parent_id == *parent);
            if unchanged {
                crate::workspace::stats::add(&crate::workspace::stats::RECORDS_UNCHANGED, 1);
                continue;
            }
            crate::workspace::stats::add(&crate::workspace::stats::RECORDS_WRITTEN, 1);
            let body = serde_json::to_vec(&NodeBody::Record {
                kind: record.kind,
                id: record.id.clone(),
                fields: record.fields.clone(),
            })?;
            let ciphertext = seal::seal(
                root,
                scope,
                Position {
                    workspace_id: &self.workspace_id,
                    node_id: id,
                    parent_id: parent.as_deref(),
                    slot: 0,
                    version,
                    key_epoch,
                },
                &body,
            )?;
            nodes.insert(
                id.clone(),
                StoredNode {
                    parent_id: parent.clone(),
                    version,
                    key_epoch,
                    ciphertext: ciphertext.clone(),
                },
            );
            upserts.push(NodeWrite {
                node_id: id.clone(),
                parent_id: parent.clone(),
                ciphertext,
            });
        }
        let deletes: Vec<String> = self
            .nodes
            .keys()
            .filter(|id| **id != self.workspace_id && !placed.contains_key(*id))
            .cloned()
            .collect();
        let mut next_slots = self.slots.clone();
        for id in &deletes {
            nodes.remove(id);
            next_slots.retain(|(tab, _), _| tab != id);
        }
        let mut slot_writes = Vec::new();
        for (tab, slot, plaintext) in slots {
            // Tab slots hang off tab records; sign-in slots off the root node,
            // which every op rewrites and therefore always exists.
            if !(placed.contains_key(&tab)
                || (tab == self.workspace_id && crate::workspace::signin::is_signin_slot(slot)))
            {
                return Err(Error::Invalid);
            }
            match plaintext {
                Some(plain) => {
                    let ciphertext = seal::seal(
                        root,
                        scope,
                        Position {
                            workspace_id: &self.workspace_id,
                            node_id: &tab,
                            parent_id: None,
                            slot,
                            version,
                            key_epoch,
                        },
                        &plain,
                    )?;
                    next_slots.insert(
                        (tab.clone(), slot),
                        SlotMeta {
                            view_node_id: tab.clone(),
                            slot,
                            version,
                            content_hash: content_hash(&ciphertext).to_vec(),
                        },
                    );
                    slot_writes.push(SlotWrite {
                        view_node_id: tab,
                        slot,
                        ciphertext: Some(ciphertext),
                    });
                }
                None => {
                    if next_slots.remove(&(tab.clone(), slot)).is_some() {
                        slot_writes.push(SlotWrite {
                            view_node_id: tab,
                            slot,
                            ciphertext: None,
                        });
                    }
                }
            }
        }
        let same_resume =
            serde_json::to_value(resume)? == serde_json::to_value(self.resume.as_ref())?;
        if upserts.is_empty()
            && deletes.is_empty()
            && slot_writes.is_empty()
            && same_resume
            && self.version > 0
        {
            crate::workspace::stats::add(&crate::workspace::stats::OPS_SUPPRESSED, 1);
            return Ok(None);
        }
        crate::workspace::stats::add(&crate::workspace::stats::OPS_BUILT, 1);
        let merkle_root = merkle::root(leaves(&self.workspace_id, &nodes, &next_slots)?).to_vec();
        let body = serde_json::to_vec(&NodeBody::Root {
            workspace_version: version,
            merkle_root: merkle_root.clone(),
            resume: resume.cloned(),
        })?;
        let ciphertext = seal::seal(
            root,
            scope,
            Position {
                workspace_id: &self.workspace_id,
                node_id: &self.workspace_id,
                parent_id: None,
                slot: 0,
                version,
                key_epoch,
            },
            &body,
        )?;
        upserts.insert(
            0,
            NodeWrite {
                node_id: self.workspace_id.clone(),
                parent_id: None,
                ciphertext,
            },
        );
        let mut op = WorkspaceOp {
            vault_id: scope.vault_id.clone(),
            workspace_id: self.workspace_id.clone(),
            operation_id: Uuid::new_v4().to_string(),
            device_id: grant.device_id.clone(),
            device_counter,
            key_epoch,
            base_workspace_version: self.version,
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
    pub fn apply_own(&mut self, v: &Verifier<'_>, op: &WorkspaceOp) -> Result<()> {
        let change = WorkspaceChange {
            workspace_version: op.workspace_version(),
            sequence: 0,
            operation_id: op.operation_id.clone(),
            device_id: op.device_id.clone(),
            device_counter: op.device_counter,
            key_epoch: op.key_epoch,
            merkle_root: op.merkle_root.clone(),
            manifest: op.manifest(),
            signature: op.signature.clone(),
        };
        let delta = WorkspaceDelta {
            workspace_id: self.workspace_id.clone(),
            version: op.workspace_version(),
            changes: vec![change],
            nodes: op
                .upserts
                .iter()
                .map(|n| WorkspaceNode {
                    node_id: n.node_id.clone(),
                    parent_id: n.parent_id.clone(),
                    version: op.workspace_version(),
                    key_epoch: op.key_epoch,
                    ciphertext: n.ciphertext.clone(),
                })
                .collect(),
            slots: op
                .slots
                .iter()
                .filter_map(|s| {
                    s.ciphertext.as_ref().map(|c| SlotMeta {
                        view_node_id: s.view_node_id.clone(),
                        slot: s.slot,
                        version: op.workspace_version(),
                        content_hash: content_hash(c).to_vec(),
                    })
                })
                .collect(),
            deleted: op.deletes.clone(),
        };
        self.apply_delta(v, delta)
    }
}
