//! Handlers for workspace frames the server sends to the connected loop.
use super::*;
use crate::workspace::{
    protocol::{Workspace, WorkspaceDelta, WorkspaceReceipt, WorkspaceSnapshot},
    state::Verifier,
};

impl<F> Worker<F>
where
    F: FnMut(&[u8], &[u8], &EventContext) -> Result<Zeroizing<Vec<u8>>> + Send + 'static,
{
    pub(in crate::worker) async fn workspace_roster(
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

    pub(in crate::worker) async fn workspace_delta(
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

    pub(in crate::worker) async fn workspace_snapshot(
        &mut self,
        snapshot: WorkspaceSnapshot,
    ) -> Result<()> {
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
    pub(in crate::worker) fn workspace_verified(
        &mut self,
        workspace: &str,
        result: Result<()>,
    ) -> Result<()> {
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

    pub(in crate::worker) async fn workspace_current(
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

    pub(in crate::worker) fn workspace_ack(
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

    pub(in crate::worker) fn workspace_error(
        &mut self,
        request: Option<&str>,
        operation: Option<&str>,
        code: &str,
        retry_after: Option<Duration>,
    ) -> Result<()> {
        if self.records_failed(request, code, retry_after) || self.clipboard.failed(request) {
            return Ok(());
        }
        self.workspaces.on_error(
            &mut self.store,
            &self.root,
            request,
            operation,
            code,
            retry_after,
        )?;
        self.publish_sync_state()
    }
}
