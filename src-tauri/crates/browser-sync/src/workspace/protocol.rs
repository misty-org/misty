//! Workspace-protocol (v2) wire types. Field names and signing-byte order must
//! match `server/internal/sync/workspace_types.go` exactly; the shared fixture
//! `tests/fixtures/workspace-v3.json` pins both implementations.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    protocol::{counter, valid_id},
    Error, Result,
};

pub const PAGE_HISTORY: i16 = 1;
pub const PAGE_STATE: i16 = 2;
pub const PAGE_STORAGE: i16 = 3;

/// Go encodes `[]byte` as standard base64; mirror that on the wire.
pub mod b64 {
    use super::*;
    use serde::{Deserializer, Serializer};

    pub fn serialize<S: Serializer>(v: &[u8], s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&STANDARD.encode(v))
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> std::result::Result<Vec<u8>, D::Error> {
        let s = String::deserialize(d)?;
        STANDARD.decode(s).map_err(serde::de::Error::custom)
    }
    pub mod option {
        use super::*;
        pub fn serialize<S: Serializer>(
            v: &Option<Vec<u8>>,
            s: S,
        ) -> std::result::Result<S::Ok, S::Error> {
            match v {
                Some(v) => s.serialize_str(&STANDARD.encode(v)),
                None => s.serialize_none(),
            }
        }
        pub fn deserialize<'de, D: Deserializer<'de>>(
            d: D,
        ) -> std::result::Result<Option<Vec<u8>>, D::Error> {
            Option::<String>::deserialize(d)?
                .map(|s| STANDARD.decode(s).map_err(serde::de::Error::custom))
                .transpose()
        }
    }
    pub mod list {
        use super::*;
        pub fn serialize<S: Serializer>(
            v: &[Vec<u8>],
            s: S,
        ) -> std::result::Result<S::Ok, S::Error> {
            s.collect_seq(v.iter().map(|b| STANDARD.encode(b)))
        }
        pub fn deserialize<'de, D: Deserializer<'de>>(
            d: D,
        ) -> std::result::Result<Vec<Vec<u8>>, D::Error> {
            Vec::<String>::deserialize(d)?
                .into_iter()
                .map(|s| STANDARD.decode(s).map_err(serde::de::Error::custom))
                .collect()
        }
    }
}

pub fn content_hash(data: &[u8]) -> [u8; 32] {
    Sha256::digest(data).into()
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct NodeWrite {
    pub node_id: String,
    pub parent_id: Option<String>,
    #[serde(with = "b64")]
    pub ciphertext: Vec<u8>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct SlotWrite {
    #[serde(alias = "tab_node_id")]
    pub view_node_id: String,
    pub slot: i16,
    /// `None` deletes the slot.
    #[serde(with = "b64::option")]
    pub ciphertext: Option<Vec<u8>>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct Manifest {
    pub upserts: Vec<[String; 3]>,
    pub slots: Vec<[String; 3]>,
    pub deletes: Vec<String>,
    pub blob_refs: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WorkspaceOp {
    pub vault_id: String,
    #[serde(alias = "tree_id")]
    pub workspace_id: String,
    pub operation_id: String,
    pub device_id: String,
    pub device_counter: u64,
    pub key_epoch: u64,
    #[serde(alias = "base_tree_version")]
    pub base_workspace_version: u64,
    #[serde(with = "b64")]
    pub merkle_root: Vec<u8>,
    pub upserts: Vec<NodeWrite>,
    pub slots: Vec<SlotWrite>,
    pub deletes: Vec<String>,
    #[serde(with = "b64::list")]
    pub blob_refs: Vec<Vec<u8>>,
    #[serde(with = "b64")]
    pub signature: Vec<u8>,
}

impl WorkspaceOp {
    pub fn workspace_version(&self) -> u64 {
        self.base_workspace_version + 1
    }

    pub fn manifest(&self) -> Manifest {
        Manifest {
            upserts: self
                .upserts
                .iter()
                .map(|n| {
                    [
                        n.node_id.clone(),
                        n.parent_id.clone().unwrap_or_default(),
                        STANDARD.encode(content_hash(&n.ciphertext)),
                    ]
                })
                .collect(),
            slots: self
                .slots
                .iter()
                .map(|s| {
                    [
                        s.view_node_id.clone(),
                        s.slot.to_string(),
                        s.ciphertext
                            .as_ref()
                            .map(|c| STANDARD.encode(content_hash(c)))
                            .unwrap_or_default(),
                    ]
                })
                .collect(),
            deletes: self.deletes.clone(),
            blob_refs: self.blob_refs.iter().map(|b| STANDARD.encode(b)).collect(),
        }
    }

    pub fn signing_bytes(&self) -> Result<Vec<u8>> {
        signing_bytes(
            &self.vault_id,
            &self.workspace_id,
            &self.operation_id,
            &self.device_id,
            self.device_counter,
            self.key_epoch,
            self.base_workspace_version,
            &self.merkle_root,
            &self.manifest(),
        )
    }
}

#[allow(clippy::too_many_arguments)]
pub fn signing_bytes(
    vault: &str,
    workspace: &str,
    operation: &str,
    device: &str,
    device_counter: u64,
    key_epoch: u64,
    base: u64,
    merkle: &[u8],
    manifest: &Manifest,
) -> Result<Vec<u8>> {
    if !valid_id(vault)
        || !valid_id(workspace)
        || !valid_id(operation)
        || !valid_id(device)
        || !counter(device_counter)
        || !counter(key_epoch)
        || !counter(base + 1)
        || merkle.len() != 32
    {
        return Err(Error::Invalid);
    }
    Ok(serde_json::to_vec(&(
        "misty.sync.tree-op.v2",
        vault,
        workspace,
        operation,
        device,
        device_counter,
        key_epoch,
        base,
        base + 1,
        STANDARD.encode(merkle),
        &manifest.upserts,
        &manifest.slots,
        &manifest.deletes,
        &manifest.blob_refs,
    ))?)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WorkspaceClaim {
    pub vault_id: String,
    #[serde(alias = "tree_id")]
    pub workspace_id: String,
    pub operation_id: String,
    pub device_id: String,
    pub device_counter: u64,
    pub key_epoch: u64,
    #[serde(with = "b64")]
    pub signature: Vec<u8>,
}

impl WorkspaceClaim {
    pub fn signing_bytes(&self) -> Result<Vec<u8>> {
        if !valid_id(&self.vault_id)
            || !valid_id(&self.workspace_id)
            || self.workspace_id == self.vault_id
            || !valid_id(&self.operation_id)
            || !valid_id(&self.device_id)
            || !counter(self.device_counter)
            || !counter(self.key_epoch)
        {
            return Err(Error::Invalid);
        }
        Ok(serde_json::to_vec(&(
            "misty.sync.tree-claim.v2",
            &self.vault_id,
            &self.workspace_id,
            &self.operation_id,
            &self.device_id,
            self.device_counter,
            self.key_epoch,
        ))?)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Workspace {
    #[serde(alias = "tree_id")]
    pub workspace_id: String,
    pub shared: bool,
    pub driver_device_id: Option<String>,
    pub driver_epoch: Option<String>,
    pub driver_seen_at: Option<i64>,
    pub version: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspaceNode {
    pub node_id: String,
    pub parent_id: Option<String>,
    pub version: u64,
    pub key_epoch: u64,
    #[serde(with = "b64")]
    pub ciphertext: Vec<u8>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct SlotMeta {
    #[serde(alias = "tab_node_id")]
    pub view_node_id: String,
    pub slot: i16,
    pub version: u64,
    #[serde(with = "b64")]
    pub content_hash: Vec<u8>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WorkspaceChange {
    #[serde(alias = "tree_version")]
    pub workspace_version: u64,
    pub sequence: u64,
    pub operation_id: String,
    pub device_id: String,
    pub device_counter: u64,
    pub key_epoch: u64,
    #[serde(with = "b64")]
    pub merkle_root: Vec<u8>,
    pub manifest: Manifest,
    #[serde(with = "b64")]
    pub signature: Vec<u8>,
}

impl WorkspaceChange {
    pub fn signing_bytes(&self, vault: &str, workspace: &str) -> Result<Vec<u8>> {
        if self.workspace_version == 0 {
            return Err(Error::Invalid);
        }
        signing_bytes(
            vault,
            workspace,
            &self.operation_id,
            &self.device_id,
            self.device_counter,
            self.key_epoch,
            self.workspace_version - 1,
            &self.merkle_root,
            &self.manifest,
        )
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WorkspaceDelta {
    #[serde(alias = "tree_id")]
    pub workspace_id: String,
    pub version: u64,
    pub changes: Vec<WorkspaceChange>,
    pub nodes: Vec<WorkspaceNode>,
    pub slots: Vec<SlotMeta>,
    pub deleted: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WorkspaceSnapshot {
    #[serde(alias = "tree_id")]
    pub workspace_id: String,
    pub version: u64,
    pub nodes: Vec<WorkspaceNode>,
    pub slots: Vec<SlotMeta>,
    pub last_change: Option<WorkspaceChange>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Slot {
    #[serde(alias = "tree_id")]
    pub workspace_id: String,
    #[serde(alias = "tab_node_id")]
    pub view_node_id: String,
    pub slot: i16,
    pub version: u64,
    pub key_epoch: u64,
    #[serde(with = "b64")]
    pub ciphertext: Vec<u8>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Blob {
    #[serde(with = "b64")]
    pub hash: Vec<u8>,
    #[serde(with = "b64")]
    pub ciphertext: Vec<u8>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WorkspaceReceipt {
    pub operation_id: String,
    pub sequence: u64,
    #[serde(default)]
    pub discarded: bool,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    #[serde(alias = "tree_version")]
    pub workspace_version: Option<u64>,
}
