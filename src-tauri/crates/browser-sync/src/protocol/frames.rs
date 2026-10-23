//! Frames exchanged on the sync socket.
use super::*;

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerFrame {
    Challenge {
        protocol_version: u8,
        challenge: String,
    },
    Welcome {
        vault: Vault,
        connection_id: String,
    },
    Devices {
        devices: Vec<Device>,
    },
    Presence {
        devices: Vec<Presence>,
    },
    Events {
        replay: Replay,
    },
    Ack {
        receipt: Receipt,
    },
    Error {
        code: String,
        operation_id: Option<String>,
    },
    CheckpointRequired {
        head_sequence: u64,
    },
    AccountEvent {
        event: AccountEvent,
    },
    // Workspace protocol (v2).
    Workspaces {
        workspaces: Vec<crate::workspace::protocol::Workspace>,
    },
    WorkspaceDelta {
        delta: crate::workspace::protocol::WorkspaceDelta,
    },
    WorkspaceSnapshot {
        snapshot: crate::workspace::protocol::WorkspaceSnapshot,
    },
    /// The client's copy of a watched workspace is already at `version`.
    WorkspaceCurrent {
        workspace_id: String,
        version: u64,
    },
    WorkspaceAck {
        request_id: Option<String>,
        receipt: crate::workspace::protocol::WorkspaceReceipt,
    },
    WorkspaceError {
        code: String,
        request_id: Option<String>,
        operation_id: Option<String>,
        workspace_id: Option<String>,
        /// With `sync_rate_limited`: wait this long before sending again.
        #[serde(default)]
        retry_after_ms: Option<u64>,
    },
    /// When to publish batched changes. Sent only to clients that ask for it
    /// (`batching=1`), after `welcome` and whenever it changes.
    BatchPolicy {
        policy: crate::batch::WirePolicy,
    },
    Slot {
        request_id: Option<String>,
        slot: Option<crate::workspace::protocol::Slot>,
    },
    Blobs {
        request_id: Option<String>,
        blobs: Vec<crate::workspace::protocol::Blob>,
    },
    BlobAck {
        request_id: Option<String>,
    },
    // Collections.
    Records {
        request_id: Option<String>,
        listing: crate::collections::wire::Listing,
    },
    RecordsAck {
        request_id: Option<String>,
        collection: String,
        results: Vec<crate::collections::wire::Answer>,
    },
}

#[derive(Clone, Serialize, Deserialize)]
pub struct AccountEvent {
    pub topic: String,
    pub id: Option<String>,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientFrame<'a> {
    Authenticate {
        after: u64,
        signature: &'a str,
    },
    Publish {
        mutation: &'a Mutation,
        #[serde(skip_serializing_if = "Option::is_none")]
        active_epoch: Option<&'a str>,
    },
    Heartbeat {
        applied_sequence: u64,
        ready: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        active_epoch: Option<&'a str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        activation: Option<&'a Mutation>,
    },
    Resume {
        after: u64,
    },
    PublishWorkspace {
        request_id: &'a str,
        workspace_op: &'a crate::workspace::protocol::WorkspaceOp,
    },
    Claim {
        request_id: &'a str,
        claim: &'a crate::workspace::protocol::WorkspaceClaim,
    },
    WatchWorkspace {
        workspace_id: &'a str,
        after: u64,
    },
    UnwatchWorkspace {
        workspace_id: &'a str,
    },
    SlotGet {
        request_id: &'a str,
        workspace_id: &'a str,
        view_node_id: &'a str,
        slot: i16,
    },
    BlobPut {
        request_id: &'a str,
        blob: &'a crate::workspace::protocol::Blob,
    },
    BlobGet {
        request_id: &'a str,
        #[serde(with = "crate::workspace::protocol::b64::list")]
        blob_hashes: &'a [Vec<u8>],
    },
    RecordsPull {
        request_id: &'a str,
        collection: &'a str,
        after: u64,
    },
    RecordsPush {
        request_id: &'a str,
        collection: &'a str,
        writes: &'a [crate::collections::wire::Write],
    },
}
