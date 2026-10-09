//! Workspace-protocol glue for the worker's connected loop. `WorkspaceSync` holds the
//! logic; this file only moves frames between it, the socket and storage.
use super::*;
use crate::workspace::{
    protocol::{Workspace, WorkspaceDelta, WorkspaceReceipt, WorkspaceSnapshot},
    state::Verifier,
};

/// Stable per-device ID for the one-time workspace-mode event, so retries and
/// restarts deduplicate instead of publishing it repeatedly.
fn workspace_mode_operation(device_id: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(format!("misty.sync.tree-mode.v1:{device_id}"));
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x80;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    uuid::Uuid::from_bytes(bytes).to_string()
}

const WORKSPACE_REFETCH_LIMIT: u8 = 3;

async fn send_workspace(socket: &mut SyncSocket, frame: Outgoing) -> Result<()> {
    match frame {
        Outgoing::Watch {
            workspace_id,
            after,
        } => {
            socket
                .send(&ClientFrame::WatchWorkspace {
                    workspace_id: &workspace_id,
                    after,
                })
                .await
        }
        Outgoing::Unwatch { workspace_id } => {
            socket
                .send(&ClientFrame::UnwatchWorkspace {
                    workspace_id: &workspace_id,
                })
                .await
        }
        Outgoing::Publish { request_id, op } => {
            socket
                .send(&ClientFrame::PublishWorkspace {
                    request_id: &request_id,
                    workspace_op: &op,
                })
                .await
        }
        Outgoing::Claim { request_id, claim } => {
            socket
                .send(&ClientFrame::Claim {
                    request_id: &request_id,
                    claim: &claim,
                })
                .await
        }
        Outgoing::SlotGet {
            request_id,
            workspace_id,
            view_node_id,
            slot,
        } => {
            socket
                .send(&ClientFrame::SlotGet {
                    request_id: &request_id,
                    workspace_id: &workspace_id,
                    view_node_id: &view_node_id,
                    slot,
                })
                .await
        }
    }
}

/// Free functions: holding `&Worker` (and its SQLite store) across an await
/// would make the worker future non-`Send`.
async fn send_all(socket: &mut SyncSocket, frames: Vec<Outgoing>) -> Result<()> {
    for frame in frames {
        send_workspace(socket, frame).await?;
    }
    Ok(())
}

impl<F> Worker<F>
where
    F: FnMut(&[u8], &[u8], &EventContext) -> Result<Zeroizing<Vec<u8>>> + Send + 'static,
{
    pub(super) fn publish_sync_state(&self) -> Result<()> {
        let mut view = self.workspaces.optimistic_view(&self.store, &self.root)?;
        view.collections = self.collections_view()?;
        view.all_upgraded = self.all_upgraded();
        view.nested_bookmarks = self.nested_bookmarks();
        view.pinned_tabs = self.pinned_tabs();
        self.sync_state.send_if_modified(|current| {
            if *current == view {
                false
            } else {
                *current = view;
                true
            }
        });
        Ok(())
    }

    /// First contact on each connection: switch the credential log to workspace
    /// mode (once, idempotently), seed this device's workspace from the legacy
    /// shared workspace if it has none yet, then watch and resend.
    pub(super) async fn workspaces_connected(&mut self, socket: &mut SyncSocket) -> Result<()> {
        self.collections.connected();
        let document: crate::document::Document =
            serde_json::from_slice(&self.store.committed_snapshot(&self.root)?)?;
        if !document.workspace_mode {
            let payload =
                serde_json::to_vec(&crate::document::Payload::WorkspaceMode { version: 1 })?;
            let operation = workspace_mode_operation(&self.store.grant().device_id);
            self.store
                .enqueue_identified(&self.root, &self.device, &operation, &payload)?;
            let view = document.workspace_view()?;
            let records: Vec<_> = view.records;
            // Focus is local to each machine; the legacy focus record is not carried.
            self.workspaces
                .seed_from_legacy(&mut self.store, &self.root, &records, None)?;
        }
        let frames = self.workspaces.on_connect();
        send_all(socket, frames).await?;
        self.publish_sync_state()
    }

    /// Pending claims and slot reads cannot survive a lost connection.
    pub(super) fn workspaces_disconnected(&mut self) {
        self.workspace_outbox.clear();
        self.workspaces.on_disconnect();
        let _ = self.publish_sync_state();
    }

    pub(super) async fn workspace_roster(
        &mut self,
        socket: &mut SyncSocket,
        workspaces: Vec<Workspace>,
    ) -> Result<()> {
        let frames = self
            .workspaces
            .on_roster(&mut self.store, &self.root, workspaces)?;
        send_all(socket, frames).await?;
        self.publish_sync_state()
    }

    /// Unknown authors refresh the roster first: a newly enrolled device may
    /// have published before its grant reached us.
    async fn ensure_authors<'a>(
        &mut self,
        authors: impl Iterator<Item = &'a String>,
    ) -> Result<()> {
        let missing = authors.into_iter().any(|id| !self.roster.contains_key(id));
        if missing {
            self.update_roster(self.api.devices().await?)?;
        }
        Ok(())
    }

    pub(super) async fn workspace_delta(
        &mut self,
        socket: &mut SyncSocket,
        delta: WorkspaceDelta,
    ) -> Result<()> {
        let authors: Vec<String> = delta.changes.iter().map(|c| c.device_id.clone()).collect();
        self.ensure_authors(authors.iter()).await?;
        let verifier = Verifier {
            root: &self.root,
            scope: &self.scope,
            grants: &self.roster,
        };
        let frames = self
            .workspaces
            .on_delta(&mut self.store, &verifier, delta)?;
        send_all(socket, frames).await?;
        self.publish_sync_state()
    }

    pub(super) async fn workspace_snapshot(&mut self, snapshot: WorkspaceSnapshot) -> Result<()> {
        // A snapshot is verified against its last author's grant, like a delta.
        if let Some(change) = &snapshot.last_change {
            self.ensure_authors(std::iter::once(&change.device_id))
                .await?;
        }
        let verifier = Verifier {
            root: &self.root,
            scope: &self.scope,
            grants: &self.roster,
        };
        self.workspaces
            .on_snapshot(&mut self.store, &verifier, snapshot)?;
        self.publish_sync_state()
    }

    /// The server's copy of a workspace is authoritative and every copy is verified
    /// before use, so one that fails to verify is dropped and fetched again on a
    /// fresh connection instead of stopping sync. A failure that persists
    /// across refetches still stops it: that copy cannot be trusted.
    pub(super) fn workspace_verified(&mut self, workspace: &str, result: Result<()>) -> Result<()> {
        match result {
            Ok(()) => {
                self.workspace_refetches = 0;
                Ok(())
            }
            Err(error @ (Error::Identity | Error::Sequence | Error::Invalid)) => {
                if self.workspace_refetches >= WORKSPACE_REFETCH_LIMIT {
                    return Err(error);
                }
                self.workspace_refetches += 1;
                self.workspaces.forget(&mut self.store, workspace)?;
                let _ = self.publish_sync_state();
                Err(Error::Network)
            }
            Err(error) => Err(error),
        }
    }

    pub(super) async fn workspace_current(
        &mut self,
        socket: &mut SyncSocket,
        workspace_id: &str,
        version: u64,
    ) -> Result<()> {
        let frames = self
            .workspaces
            .on_current(&mut self.store, workspace_id, version)?;
        send_all(socket, frames).await?;
        self.publish_sync_state()
    }

    pub(super) fn workspace_ack(
        &mut self,
        request: Option<&str>,
        receipt: WorkspaceReceipt,
    ) -> Result<()> {
        let verifier = Verifier {
            root: &self.root,
            scope: &self.scope,
            grants: &self.roster,
        };
        self.workspaces
            .on_ack(&mut self.store, &verifier, request, receipt)?;
        self.publish_sync_state()
    }

    pub(super) fn workspace_error(
        &mut self,
        request: Option<&str>,
        operation: Option<&str>,
        code: &str,
    ) -> Result<()> {
        if self.records_failed(request) {
            return Ok(());
        }
        self.workspaces
            .on_error(&mut self.store, &self.root, request, operation, code)?;
        self.publish_sync_state()
    }

    /// Sends queued command frames, then at most one op per writable workspace.
    /// Publishing waits for the roster so the driver seat is known.
    pub(super) async fn workspace_tick(&mut self, socket: &mut SyncSocket) -> Result<()> {
        let queued = std::mem::take(&mut self.workspace_outbox);
        send_all(socket, queued).await?;
        if self.roster.is_empty()
            || !self
                .devices
                .borrow()
                .iter()
                .any(|d| d.grant.device_id == self.store.grant().device_id && d.full_sync)
        {
            return Ok(());
        }
        let grant = self.store.grant().clone();
        let frames = self.workspaces.tick(
            &mut self.store,
            &self.root,
            &self.scope,
            &grant,
            &self.device,
        )?;
        let published = !frames.is_empty();
        send_all(socket, frames).await?;
        if published {
            self.publish_sync_state()?;
        }
        Ok(())
    }
}
