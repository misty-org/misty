//! What the server sends back: workspaces, their changes, slots and receipts.
use super::*;

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
