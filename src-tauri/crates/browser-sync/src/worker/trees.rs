//! Tree-protocol glue for the worker's connected loop. `TreeSync` holds the
//! logic; this file only moves frames between it, the socket and storage.
use super::*;
use crate::tree::{
    protocol::{Tree, TreeDelta, TreeReceipt, TreeSnapshot},
    state::Verifier,
};

/// Stable per-device ID for the one-time tree-mode event, so retries and
/// restarts deduplicate instead of publishing it repeatedly.
fn tree_mode_operation(device_id: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(format!("misty.sync.tree-mode.v1:{device_id}"));
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x80;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    uuid::Uuid::from_bytes(bytes).to_string()
}

async fn send_tree(socket: &mut SyncSocket, frame: Outgoing) -> Result<()> {
    match frame {
        Outgoing::Watch { tree_id, after } => socket.send(&ClientFrame::WatchTree { tree_id: &tree_id, after }).await,
        Outgoing::Unwatch { tree_id } => socket.send(&ClientFrame::UnwatchTree { tree_id: &tree_id }).await,
        Outgoing::Publish { request_id, op } => socket.send(&ClientFrame::PublishTree { request_id: &request_id, tree_op: &op }).await,
        Outgoing::Claim { request_id, claim } => socket.send(&ClientFrame::Claim { request_id: &request_id, claim: &claim }).await,
        Outgoing::SlotGet { request_id, tree_id, tab_node_id, slot } => {
            socket.send(&ClientFrame::SlotGet { request_id: &request_id, tree_id: &tree_id, tab_node_id: &tab_node_id, slot }).await
        }
    }
}

/// Free functions: holding `&Worker` (and its SQLite store) across an await
/// would make the worker future non-`Send`.
async fn send_all(socket: &mut SyncSocket, frames: Vec<Outgoing>) -> Result<()> {
    for frame in frames {
        send_tree(socket, frame).await?;
    }
    Ok(())
}


impl<F> Worker<F>
where
    F: FnMut(&[u8], &[u8], &EventContext) -> Result<Zeroizing<Vec<u8>>> + Send + 'static,
{
    pub(super) fn publish_tree_view(&self) -> Result<()> {
        let view = self.trees.view(&self.store)?;
        self.tree_view.send_if_modified(|current| {
            if *current == view {
                false
            } else {
                *current = view;
                true
            }
        });
        Ok(())
    }

    /// First contact on each connection: switch the credential log to tree
    /// mode (once, idempotently), seed this device's tree from the legacy
    /// shared workspace if it has none yet, then watch and resend.
    pub(super) async fn trees_connected(&mut self, socket: &mut SyncSocket) -> Result<()> {
        let document: crate::document::Document = serde_json::from_slice(&self.store.committed_snapshot(&self.root)?)?;
        if !document.tree_mode {
            let payload = serde_json::to_vec(&crate::document::Payload::TreeMode { version: 1 })?;
            let operation = tree_mode_operation(&self.store.grant().device_id);
            self.store.enqueue_identified(&self.root, &self.device, &operation, &payload)?;
            let view = document.workspace_view()?;
            let own_resume = document.resumes.get(&self.store.grant().device_id).map(|r| r.resume.clone());
            let records: Vec<_> = view.records;
            self.trees.seed_from_legacy(&mut self.store, &self.root, &records, own_resume)?;
        }
        let frames = self.trees.on_connect();
        send_all(socket, frames).await?;
        self.publish_tree_view()
    }

    /// Pending claims and slot reads cannot survive a lost connection.
    pub(super) fn trees_disconnected(&mut self) {
        self.tree_outbox.clear();
    }

    pub(super) async fn tree_roster(&mut self, socket: &mut SyncSocket, trees: Vec<Tree>) -> Result<()> {
        let frames = self.trees.on_roster(&mut self.store, trees)?;
        send_all(socket, frames).await?;
        self.publish_tree_view()
    }

    /// Unknown authors refresh the roster first: a newly enrolled device may
    /// have published before its grant reached us.
    async fn ensure_authors<'a>(&mut self, authors: impl Iterator<Item = &'a String>) -> Result<()> {
        let missing = authors.into_iter().any(|id| !self.roster.contains_key(id));
        if missing {
            self.update_roster(self.api.devices().await?)?;
        }
        Ok(())
    }

    pub(super) async fn tree_delta(&mut self, socket: &mut SyncSocket, delta: TreeDelta) -> Result<()> {
        let authors: Vec<String> = delta.changes.iter().map(|c| c.device_id.clone()).collect();
        self.ensure_authors(authors.iter()).await?;
        let verifier = Verifier { root: &self.root, scope: &self.scope, grants: &self.roster };
        let frames = self.trees.on_delta(&mut self.store, &verifier, delta)?;
        send_all(socket, frames).await?;
        self.publish_tree_view()
    }

    pub(super) fn tree_snapshot(&mut self, snapshot: TreeSnapshot) -> Result<()> {
        let verifier = Verifier { root: &self.root, scope: &self.scope, grants: &self.roster };
        self.trees.on_snapshot(&mut self.store, &verifier, snapshot)?;
        self.publish_tree_view()
    }

    pub(super) async fn tree_current(&mut self, socket: &mut SyncSocket, tree_id: &str, version: u64) -> Result<()> {
        let frames = self.trees.on_current(tree_id, version);
        send_all(socket, frames).await?;
        self.publish_tree_view()
    }

    pub(super) fn tree_ack(&mut self, request: Option<&str>, receipt: TreeReceipt) -> Result<()> {
        let verifier = Verifier { root: &self.root, scope: &self.scope, grants: &self.roster };
        self.trees.on_ack(&mut self.store, &verifier, request, receipt)?;
        self.publish_tree_view()
    }

    pub(super) fn tree_error(&mut self, request: Option<&str>, operation: Option<&str>, code: &str) -> Result<()> {
        self.trees.on_error(&mut self.store, request, operation, code)?;
        self.publish_tree_view()
    }

    /// Sends queued command frames, then at most one op per writable tree.
    /// Publishing waits for the roster so the driver seat is known.
    pub(super) async fn tree_tick(&mut self, socket: &mut SyncSocket) -> Result<()> {
        let queued = std::mem::take(&mut self.tree_outbox);
        send_all(socket, queued).await?;
        if self.roster.is_empty() || !self.devices.borrow().iter().any(|d| d.grant.device_id == self.store.grant().device_id && d.full_sync) {
            return Ok(());
        }
        let grant = self.store.grant().clone();
        let frames = self.trees.tick(&mut self.store, &self.root, &self.scope, &grant, &self.device)?;
        let published = !frames.is_empty();
        send_all(socket, frames).await?;
        if published {
            self.publish_tree_view()?;
        }
        Ok(())
    }
}
