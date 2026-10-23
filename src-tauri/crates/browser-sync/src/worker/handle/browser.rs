//! Browser profile, capture and import commands, and the reserved import slot.
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
}
