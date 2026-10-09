//! The cloneable handle the host holds: every call is a command to the worker task.

use super::*;

/// A native import owns one reserved command slot until completion. Dropping
/// its future queues quarantine synchronously, before a subsequent restore can
/// read the journal. No async cleanup task can race that subsequent read.
pub(crate) struct BrowserImportAttempt {
    permit: Option<mpsc::OwnedPermit<Command>>,
    profile: String,
    revision: u64,
    id: String,
}
impl BrowserImportAttempt {
    pub(crate) fn complete(mut self) {
        self.permit.take();
    }
    fn dispatch(&mut self) -> oneshot::Receiver<Result<BrowserImportJournal>> {
        let (send, receive) = oneshot::channel();
        if let Some(permit) = self.permit.take() {
            permit.send(Command::QuarantineBrowserImport(
                self.profile.clone(),
                self.revision,
                self.id.clone(),
                send,
            ));
        }
        receive
    }
    pub(crate) async fn quarantine(mut self) -> Result<()> {
        self.dispatch().await.map_err(|_| Error::Network)??;
        Ok(())
    }
}
impl Drop for BrowserImportAttempt {
    fn drop(&mut self) {
        if self.permit.is_some() {
            self.dispatch();
        }
    }
}

impl WorkerHandle {
    pub async fn invalidate_browser_readiness(&self) -> Result<()> {
        let (send, receive) = oneshot::channel();
        self.commands
            .send(Command::BrowserUnverified(send))
            .await
            .map_err(|_| Error::Network)?;
        receive.await.map_err(|_| Error::Network)?
    }

    /// Native-only complete observations from the active physical store. This
    /// is not exposed over renderer IPC.
    pub async fn observe_browser_profile(
        &self,
        profile: String,
        generation: String,
        observed: Vec<BrowserObservation>,
    ) -> Result<BrowserCaptureState> {
        let _lease = self.acquire_browser_import_lease().await;
        let (send, receive) = oneshot::channel();
        self.commands
            .send(Command::ObserveBrowser(profile, generation, observed, send))
            .await
            .map_err(|_| Error::Network)?;
        receive.await.map_err(|_| Error::Network)?
    }

    pub(crate) async fn acquire_browser_import_lease(&self) -> tokio::sync::OwnedMutexGuard<()> {
        self.browser_imports.clone().lock_owned().await
    }

    pub(crate) async fn browser_import_attempt(
        &self,
        profile: String,
        revision: u64,
        id: String,
    ) -> Result<BrowserImportAttempt> {
        // The native account lease serializes restores. Only one command slot
        // is retained; normal readback/finish commands remain serviceable.
        let permit = self
            .commands
            .clone()
            .reserve_owned()
            .await
            .map_err(|_| Error::Network)?;
        Ok(BrowserImportAttempt {
            permit: Some(permit),
            profile,
            revision,
            id,
        })
    }

    /// Device-local native identities. Never forward these mappings to renderer IPC.
    pub async fn browser_profile_binding(&self, profile: String) -> Result<BrowserProfileBinding> {
        let (send, receive) = oneshot::channel();
        self.commands
            .send(Command::ReadBrowserProfile(profile, send))
            .await
            .map_err(|_| Error::Network)?;
        receive.await.map_err(|_| Error::Network)?
    }

    /// Serializes with native restore attempts. The host must additionally hold
    /// its account/browser lifecycle lease across allocation and engine use.
    pub async fn stage_browser_profile(
        &self,
        profile: String,
        revision: u64,
        id: String,
    ) -> Result<BrowserProfileBinding> {
        let _lease = self.acquire_browser_import_lease().await;
        let (send, receive) = oneshot::channel();
        self.commands
            .send(Command::StageBrowserProfile(profile, revision, id, send))
            .await
            .map_err(|_| Error::Network)?;
        receive.await.map_err(|_| Error::Network)?
    }

    pub async fn activate_browser_profile(
        &self,
        profile: String,
        revision: u64,
        id: String,
    ) -> Result<BrowserProfileBinding> {
        let _lease = self.acquire_browser_import_lease().await;
        let (send, receive) = oneshot::channel();
        self.commands
            .send(Command::ActivateBrowserProfile(profile, revision, id, send))
            .await
            .map_err(|_| Error::Network)?;
        receive.await.map_err(|_| Error::Network)?
    }

    /// Acknowledge only after all clients close and native deletion completes.
    pub async fn forget_retired_browser_profile(
        &self,
        profile: String,
        revision: u64,
        id: String,
    ) -> Result<BrowserProfileBinding> {
        let _lease = self.acquire_browser_import_lease().await;
        let (send, receive) = oneshot::channel();
        self.commands
            .send(Command::ForgetBrowserProfile(profile, revision, id, send))
            .await
            .map_err(|_| Error::Network)?;
        receive.await.map_err(|_| Error::Network)?
    }

    /// All import methods are native-only. Receipts include credential material;
    /// neither these replies nor observed read-backs may be forwarded to JS.
    pub async fn browser_import_journal(&self, profile: String) -> Result<BrowserImportJournal> {
        let (send, receive) = oneshot::channel();
        self.commands
            .send(Command::ReadBrowserImport(profile, send))
            .await
            .map_err(|_| Error::Network)?;
        receive.await.map_err(|_| Error::Network)?
    }

    pub async fn begin_browser_import(
        &self,
        profile: String,
        revision: u64,
        id: String,
        snapshot_sequence: u64,
    ) -> Result<BrowserImportJournal> {
        let (send, receive) = oneshot::channel();
        self.commands
            .send(Command::BeginBrowserImport(
                profile,
                revision,
                id,
                snapshot_sequence,
                send,
            ))
            .await
            .map_err(|_| Error::Network)?;
        receive.await.map_err(|_| Error::Network)?
    }

    pub async fn finish_browser_import(
        &self,
        profile: String,
        revision: u64,
        id: String,
        observed: Vec<CredentialRecord>,
    ) -> Result<BrowserImportJournal> {
        if observed.len() > 16_384 {
            return Err(Error::TooLarge);
        }
        let (send, receive) = oneshot::channel();
        self.commands
            .send(Command::FinishBrowserImport(
                profile, revision, id, observed, send,
            ))
            .await
            .map_err(|_| Error::Network)?;
        receive.await.map_err(|_| Error::Network)?
    }

    pub async fn quarantine_browser_import(
        &self,
        profile: String,
        revision: u64,
        id: String,
    ) -> Result<BrowserImportJournal> {
        let (send, receive) = oneshot::channel();
        self.commands
            .send(Command::QuarantineBrowserImport(
                profile, revision, id, send,
            ))
            .await
            .map_err(|_| Error::Network)?;
        receive.await.map_err(|_| Error::Network)?
    }

    /// Returns only after the encrypted edit is committed locally. A disconnected
    /// network never delays durable acceptance behind a reconnection attempt.
    pub async fn enqueue(&self, payload: Zeroizing<Vec<u8>>) -> Result<String> {
        self.enqueue_identified(uuid::Uuid::new_v4().to_string(), payload)
            .await
    }

    pub async fn enqueue_identified(
        &self,
        operation_id: String,
        payload: Zeroizing<Vec<u8>>,
    ) -> Result<String> {
        if !valid_id(&operation_id) {
            return Err(Error::Invalid);
        }
        if payload.len() > MAX_EVENT_BYTES - 16 {
            return Err(Error::TooLarge);
        }
        let (send, receive) = oneshot::channel();
        self.commands
            .send(Command::Enqueue(operation_id, payload, send))
            .await
            .map_err(|_| Error::Network)?;
        receive.await.map_err(|_| Error::Network)?
    }

    /// Native-only snapshot. The host must project safe UI fields before IPC;
    /// decrypted cookie/storage payloads must not cross into the renderer.
    pub async fn snapshot(&self) -> Result<Zeroizing<Vec<u8>>> {
        let (send, receive) = oneshot::channel();
        self.commands
            .send(Command::Snapshot(send))
            .await
            .map_err(|_| Error::Network)?;
        receive.await.map_err(|_| Error::Network)?
    }

    /// Native-only optimistic state, including durable offline edits. Use the
    /// explicit committed_sequence for cursors; snapshot versions are tentative.
    pub async fn pending_snapshot(&self) -> Result<PendingSnapshot> {
        let (send, receive) = oneshot::channel();
        self.commands
            .send(Command::PendingSnapshot(send))
            .await
            .map_err(|_| Error::Network)?;
        receive.await.map_err(|_| Error::Network)?
    }

    pub async fn imports_applied(&self, sequence: u64) -> Result<()> {
        let (send, receive) = oneshot::channel();
        self.commands
            .send(Command::ImportsApplied(sequence, send))
            .await
            .map_err(|_| Error::Network)?;
        receive.await.map_err(|_| Error::Network)?
    }

    async fn call<T>(
        &self,
        command: impl FnOnce(oneshot::Sender<Result<T>>) -> Command,
    ) -> Result<T> {
        let (send, receive) = oneshot::channel();
        self.commands
            .send(command(send))
            .await
            .map_err(|_| Error::Network)?;
        receive.await.map_err(|_| Error::Network)?
    }

    /// Queues renderer edits durably. Folders and bookmarks go to the shared
    /// workspace; windows, tabs and views to the workspace this machine is on.
    pub async fn workspace_changes(&self, changes: Vec<crate::document::Change>) -> Result<()> {
        self.call(|reply| Command::WorkspaceChanges(changes, reply))
            .await
    }

    /// Moves this device's sign-in lease to `workspace_id` (the machine most
    /// recently active on a device publishes its sign-ins). Requires a connection.
    pub async fn claim_workspace(&self, workspace_id: String) -> Result<()> {
        // Sign-in writes queued under the current lease go before it moves.
        let _ = self.flush().await;
        self.call(|reply| Command::WorkspaceClaim(workspace_id, reply))
            .await
    }

    /// Shows and edits `workspace_id` on this machine. Works offline; any number
    /// of machines may be on one workspace at once. Edits still batched for
    /// the workspace being left are sent first, since it stops being watched.
    pub async fn open_workspace(&self, workspace_id: String) -> Result<()> {
        let _ = self.flush().await;
        self.call(|reply| Command::WorkspaceOpen(workspace_id, reply))
            .await
    }

    /// Sends every batched change now instead of when its batch is due, and
    /// answers once the server has them or after a few seconds. Offline it
    /// answers `Network` at once; the changes stay stored either way.
    pub async fn flush(&self) -> Result<()> {
        self.call(Command::Flush).await
    }

    /// Native-only: a pulled collection as shown here (pending writes on
    /// top), with the server cursor it was read through.
    pub async fn records_list(
        &self,
        collection: String,
    ) -> Result<(u64, Vec<crate::document::ViewRecord>)> {
        self.call(|reply| Command::RecordsList(collection, reply))
            .await
    }

    /// Whether this native collection has completed its initial pull.
    pub async fn records_ready(&self, collection: String) -> Result<bool> {
        self.call(|reply| Command::RecordsReady(collection, reply)).await
    }

    /// Native-only: replaces whole records (`None` deletes); queued durably
    /// and pushed when connected.
    pub async fn records_write(
        &self,
        collection: String,
        writes: Vec<(String, Option<crate::document::ViewRecord>)>,
    ) -> Result<()> {
        self.call(|reply| Command::RecordsWrite(collection, writes, reply))
            .await
    }

    /// Native-only: slot plaintext (page state, history) may hold form data.
    pub async fn write_page_slot(
        &self,
        tab_record: String,
        slot: i16,
        plaintext: Option<Vec<u8>>,
    ) -> Result<()> {
        self.call(|reply| Command::WorkspaceSlotWrite(tab_record, slot, plaintext, reply))
            .await
    }

    pub async fn read_page_slot(
        &self,
        workspace_id: String,
        tab_record: String,
        slot: i16,
    ) -> Result<Option<Vec<u8>>> {
        self.call(|reply| Command::WorkspaceSlotRead(workspace_id, tab_record, slot, reply))
            .await
    }

    /// Native-only: whether this session holds a device's lock, the device's
    /// verified sign-in slots, and this machine's store binding for it.
    pub async fn signin_status(
        &self,
        workspace_id: String,
    ) -> Result<crate::workspace::sync::SigninStatus> {
        self.call(|reply| Command::SigninStatus(workspace_id, reply))
            .await
    }

    /// Native-only: queues sign-in shard plaintext for the locked device and
    /// records the digests of all its current shards.
    pub async fn write_signin(
        &self,
        workspace_id: String,
        writes: Vec<(i16, Option<Vec<u8>>)>,
        written: std::collections::BTreeMap<i16, String>,
    ) -> Result<()> {
        self.call(|reply| Command::SigninWrite(workspace_id, writes, written, reply))
            .await
    }

    /// Native-only: one verified sign-in shard's plaintext.
    pub async fn read_signin(&self, workspace_id: String, slot: i16) -> Result<Option<Vec<u8>>> {
        self.call(|reply| Command::SigninRead(workspace_id, slot, reply))
            .await
    }

    /// Native-only: records which local store holds a device's sign-in data.
    pub async fn bind_signin(
        &self,
        workspace_id: String,
        binding: crate::store::DeviceSignin,
    ) -> Result<()> {
        self.call(|reply| Command::SigninBind(workspace_id, binding, reply))
            .await
    }

    /// Puts a sealed clip in `slot` of the shared clipboard ring.
    pub async fn clipboard_publish(&self, slot: u8, ciphertext: Vec<u8>) -> Result<()> {
        let (send, receive) = oneshot::channel();
        self.commands
            .send(Command::ClipboardPublish(slot, ciphertext, send))
            .await
            .map_err(|_| Error::Network)?;
        receive.await.map_err(|_| Error::Network)?
    }

    pub fn account_events(&self) -> broadcast::Receiver<AccountEvent> {
        self.events.subscribe()
    }

    /// The owner must await the worker task after stopping before considering the
    /// vault locked: that drops socket, decrypted root, and device key together.
    pub fn stop(&self) {
        let _ = self.stop.send(true);
    }

    /// Keeps this vault's socket open while true (a window shows the vault).
    /// While false it pulls every `batch::pull_interval`, and connects at once
    /// to publish anything queued. New workers start live.
    pub fn set_live(&self, live: bool) {
        self.live.send_if_modified(|current| {
            let changed = *current != live;
            *current = live;
            changed
        });
    }
}
