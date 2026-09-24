//! One owned worker per native account/device. The host registry, not a renderer
//! window, owns its handle. A locked vault has no worker or decrypted root.
use std::{collections::HashMap, sync::Arc, time::Duration};

use rand::Rng;
use serde::Serialize;
use tokio::{
    sync::{broadcast, mpsc, oneshot, watch},
    time::{interval, sleep, Instant, MissedTickBehavior},
};
use zeroize::Zeroizing;

use crate::{
    crypto::{DeviceKey, VaultRoot, VaultScope},
    document::CredentialRecord,
    protocol::*,
    store::{
        BrowserCaptureState, BrowserImportJournal, BrowserObservation, BrowserProfileBinding,
        PendingSnapshot, Store,
    },
    transport::{SyncApi, SyncSocket},
    Error, Result,
};

#[derive(Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Connecting,
    Offline,
    CatchingUp,
    Ready,
    Attention,
    Stopped,
}

#[derive(Clone, Serialize)]
pub struct Status {
    pub phase: Phase,
    pub applied_sequence: u64,
    pub head_sequence: u64,
    pub pending_changes: u64,
    pub issue: Option<&'static str>,
}

enum Command {
    BrowserUnverified(oneshot::Sender<Result<()>>),
    ObserveBrowser(
        String,
        String,
        Vec<BrowserObservation>,
        oneshot::Sender<Result<BrowserCaptureState>>,
    ),
    Enqueue(String, Zeroizing<Vec<u8>>, oneshot::Sender<Result<String>>),
    Snapshot(oneshot::Sender<Result<Zeroizing<Vec<u8>>>>),
    PendingSnapshot(oneshot::Sender<Result<PendingSnapshot>>),
    ImportsApplied(u64, oneshot::Sender<Result<()>>),
    ReadBrowserProfile(String, oneshot::Sender<Result<BrowserProfileBinding>>),
    StageBrowserProfile(
        String,
        u64,
        String,
        oneshot::Sender<Result<BrowserProfileBinding>>,
    ),
    ActivateBrowserProfile(
        String,
        u64,
        String,
        oneshot::Sender<Result<BrowserProfileBinding>>,
    ),
    ForgetBrowserProfile(
        String,
        u64,
        String,
        oneshot::Sender<Result<BrowserProfileBinding>>,
    ),
    ReadBrowserImport(String, oneshot::Sender<Result<BrowserImportJournal>>),
    BeginBrowserImport(
        String,
        u64,
        String,
        u64,
        oneshot::Sender<Result<BrowserImportJournal>>,
    ),
    FinishBrowserImport(
        String,
        u64,
        String,
        Vec<CredentialRecord>,
        oneshot::Sender<Result<BrowserImportJournal>>,
    ),
    QuarantineBrowserImport(
        String,
        u64,
        String,
        oneshot::Sender<Result<BrowserImportJournal>>,
    ),
}

#[derive(Clone)]
pub struct WorkerHandle {
    browser_imports: Arc<tokio::sync::Mutex<()>>,
    commands: mpsc::Sender<Command>,
    stop: watch::Sender<bool>,
    pub status: watch::Receiver<Status>,
    pub presence: watch::Receiver<Vec<Presence>>,
    events: broadcast::Sender<AccountEvent>,
}

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

    pub fn account_events(&self) -> broadcast::Receiver<AccountEvent> {
        self.events.subscribe()
    }

    /// The owner must await the worker task after stopping before considering the
    /// vault locked: that drops socket, decrypted root, and device key together.
    pub fn stop(&self) {
        let _ = self.stop.send(true);
    }
}

pub struct Worker<F> {
    api: SyncApi,
    scope: VaultScope,
    root: VaultRoot,
    device: DeviceKey,
    store: Store,
    reduce: F,
    commands: mpsc::Receiver<Command>,
    stop: watch::Receiver<bool>,
    status: watch::Sender<Status>,
    presence: watch::Sender<Vec<Presence>>,
    events: broadcast::Sender<AccountEvent>,
    imported_through: Option<u64>,
    roster: HashMap<String, DeviceGrant>,
    head: u64,
}

impl<F> Worker<F>
where
    F: FnMut(&[u8], &[u8], &EventContext) -> Result<Zeroizing<Vec<u8>>> + Send + 'static,
{
    pub fn new(
        api: SyncApi,
        scope: VaultScope,
        root: VaultRoot,
        device: DeviceKey,
        mut store: Store,
        reduce: F,
    ) -> Result<(Self, WorkerHandle)> {
        root.verify_grant(&scope, store.grant())?;
        if device.public_key() != store.grant().public_key
            || scope.deployment != api.deployment()
            || !store.matches_scope(&scope)?
        {
            return Err(Error::Identity);
        }
        store.resume_browser_captures(&root, &device)?;
        let cursor = store.applied_sequence()?;
        let head = store.observed_head()?;
        let (commands_tx, commands) = mpsc::channel(16);
        let (stop_tx, stop) = watch::channel(false);
        let (status, status_rx) = watch::channel(Status {
            phase: Phase::Offline,
            applied_sequence: cursor,
            head_sequence: head,
            pending_changes: store.pending_count()?,
            issue: None,
        });
        let (presence, presence_rx) = watch::channel(Vec::new());
        let (events, _) = broadcast::channel(32);
        let handle = WorkerHandle {
            browser_imports: Arc::new(tokio::sync::Mutex::new(())),
            commands: commands_tx,
            stop: stop_tx,
            status: status_rx,
            presence: presence_rx,
            events: events.clone(),
        };
        Ok((
            Self {
                api,
                scope,
                root,
                device,
                store,
                reduce,
                commands,
                stop,
                status,
                presence,
                events,
                imported_through: None,
                roster: HashMap::new(),
                head,
            },
            handle,
        ))
    }

    pub async fn run(mut self) -> Result<()> {
        // This outer cancellation also covers an in-progress roster fetch or
        // socket write inside a frame handler. Lock must not wait for network I/O.
        let mut stop = self.stop.clone();
        let result = tokio::select! {
            biased;
            _ = stop.changed() => Ok(()),
            result = self.run_inner() => result,
        };
        if let Err(error) = &result {
            let issue = match error {
                Error::Authentication => "sign_in_required",
                Error::Identity | Error::Unlock => "vault_identity_failed",
                Error::Sequence => "replay_conflict",
                Error::Recovery => "checkpoint_or_key_recovery_required",
                Error::Storage(_) => "local_storage_unavailable",
                _ => "sync_protocol_failed",
            };
            let _ = self.report(Phase::Attention, Some(issue));
        } else {
            let _ = self.report(Phase::Stopped, None);
        }
        self.presence.send_replace(Vec::new());
        result
    }

    async fn run_inner(&mut self) -> Result<()> {
        let mut failures = 0u32;
        loop {
            if *self.stop.borrow() {
                return Ok(());
            }
            self.roster.clear();
            self.presence.send_replace(Vec::new());
            self.report(Phase::Connecting, None)?;
            // The attempt owns copies of only its signing identity. Local edits
            // can continue using the database while DNS/HTTP/socket setup waits.
            let api = self.api.clone();
            let scope = self.scope.clone();
            let grant = self.store.grant().clone();
            let device = self.device.clone();
            let public = self.root.public_key()?;
            let cursor = self.store.applied_sequence()?;
            let cached_vault = self.store.cached_vault()?;
            let attempt = async move {
                if let Some(cached) = cached_vault {
                    cached.ensure_enrolled(&api, &grant).await?;
                }
                SyncSocket::connect(&api, &scope, &grant, &device, &public, cursor).await
            };
            tokio::pin!(attempt);
            let connected = loop {
                tokio::select! {
                    biased;
                    _ = self.stop.changed() => return Ok(()),
                    command = self.commands.recv() => {
                        if !self.command(command)? { return Ok(()); }
                    },
                    result = &mut attempt => break result,
                }
            };
            let started = Instant::now();
            let result = match connected {
                Ok(mut socket) => {
                    if socket.workspace.head_sequence < self.head {
                        return Err(Error::Recovery);
                    }
                    self.store.confirm_enrollment(&socket.workspace)?;
                    self.store.observe_head(socket.workspace.head_sequence)?;
                    self.head = self.head.max(socket.workspace.head_sequence);
                    self.connected(&mut socket).await
                }
                Err(error) => Err(error),
            };
            match result {
                Ok(()) => return Ok(()),
                Err(Error::Network) => {}
                Err(error) => return Err(error),
            }
            self.presence.send_replace(Vec::new());
            self.report(Phase::Offline, None)?;
            if started.elapsed() >= Duration::from_secs(30) {
                failures = 0;
            }
            failures = (failures + 1).min(5);
            let max_ms = (500u64 << failures).min(30_000);
            let delay = Duration::from_millis(rand::thread_rng().gen_range(max_ms / 2..=max_ms));
            let backoff = sleep(delay);
            tokio::pin!(backoff);
            loop {
                tokio::select! {
                    biased;
                    _ = self.stop.changed() => return Ok(()),
                    command = self.commands.recv() => {
                        if !self.command(command)? { return Ok(()); }
                    },
                    _ = &mut backoff => break,
                }
            }
        }
    }

    fn command(&mut self, command: Option<Command>) -> Result<bool> {
        let Some(command) = command else {
            return Ok(false);
        };
        match command {
            Command::BrowserUnverified(reply) => {
                self.imported_through = None;
                let result = self.refresh_status();
                let _ = reply.send(result);
            }
            Command::ObserveBrowser(profile, generation, observed, reply) => {
                let result = self.store.observe_browser_profile(
                    &self.root,
                    &self.device,
                    &profile,
                    &generation,
                    observed,
                );
                if !matches!(result, Ok(BrowserCaptureState::Clean)) {
                    self.imported_through = None;
                }
                let _ = reply.send(result);
                self.refresh_status()?;
            }
            Command::ReadBrowserProfile(profile, reply) => {
                let _ = reply.send(self.store.browser_profile_binding(&self.root, &profile));
            }
            Command::StageBrowserProfile(profile, revision, id, reply) => {
                let result = self
                    .store
                    .stage_browser_profile(&self.root, &profile, revision, &id);
                if result.is_ok() {
                    self.imported_through = None;
                }
                let _ = reply.send(result);
                self.refresh_status()?;
            }
            Command::ActivateBrowserProfile(profile, revision, id, reply) => {
                let result = self
                    .store
                    .activate_browser_profile(&self.root, &profile, revision, &id);
                let _ = reply.send(result);
                self.refresh_status()?;
            }
            Command::ForgetBrowserProfile(profile, revision, id, reply) => {
                let _ = reply.send(
                    self.store
                        .forget_retired_browser_profile(&self.root, &profile, revision, &id),
                );
            }
            Command::ReadBrowserImport(profile, reply) => {
                let _ = reply.send(self.store.browser_import_journal(&self.root, &profile));
            }
            Command::BeginBrowserImport(profile, revision, id, sequence, reply) => {
                let result = self
                    .store
                    .begin_browser_import(&self.root, &profile, revision, &id, sequence);
                if result.is_ok() {
                    self.imported_through = None;
                }
                let _ = reply.send(result);
                self.refresh_status()?;
            }
            Command::FinishBrowserImport(profile, revision, id, observed, reply) => {
                let result = self
                    .store
                    .finish_browser_import(&self.root, &profile, revision, &id, &observed);
                let _ = reply.send(result);
                self.refresh_status()?;
            }
            Command::QuarantineBrowserImport(profile, revision, id, reply) => {
                let result = self
                    .store
                    .quarantine_browser_import(&self.root, &profile, revision, &id);
                let _ = reply.send(result);
                self.refresh_status()?;
            }
            Command::Enqueue(operation_id, payload, reply) => {
                // Reject invalid edits before they acquire an irreversible device
                // counter and poison every other device's ordered replay.
                let result = (|| {
                    if self
                        .store
                        .received_intent(&self.root, &operation_id, &payload)?
                    {
                        return Ok(operation_id.clone());
                    }
                    // Imported engine changes must not become fresh local
                    // credential events, including after a crash/timeout. The
                    // durable receipt, not a renderer's in-memory flag, gates
                    // capture for this profile. Workspace edits remain allowed.
                    let decoded = serde_json::from_slice::<crate::document::Payload>(&payload).ok();
                    if let Some(decoded) = &decoded {
                        let document: crate::document::Document =
                            serde_json::from_slice(&self.store.committed_snapshot(&self.root)?)?;
                        if !document.can_publish(&self.store.grant().device_id, decoded) {
                            return Err(Error::InactiveDevice);
                        }
                    }
                    if let Some(crate::document::Payload::Credentials { batch, .. }) =
                        decoded.as_ref().map(|v| v.data())
                    {
                        if self
                            .store
                            .browser_import_journal(&self.root, &batch.profile_id)?
                            .pending
                            .is_some()
                            || self
                                .store
                                .browser_profile_binding(&self.root, &batch.profile_id)?
                                .staged
                                .is_some()
                        {
                            return Err(Error::Recovery);
                        }
                    }
                    let pending = self.store.pending_snapshot(&self.root, &mut self.reduce)?;
                    let sequence =
                        pending.committed_sequence + pending.operation_ids.len() as u64 + 1;
                    if sequence > MAX_COUNTER {
                        return Err(Error::TooLarge);
                    }
                    (self.reduce)(
                        &pending.snapshot,
                        &payload,
                        &EventContext {
                            sequence,
                            operation_id: operation_id.clone(),
                            device_id: self.store.grant().device_id.clone(),
                        },
                    )?;
                    self.store
                        .enqueue_identified(&self.root, &self.device, &operation_id, &payload)
                        .map(|_| operation_id)
                })();
                let update = self.refresh_status();
                let _ = reply.send(result);
                update?;
            }
            Command::Snapshot(reply) => {
                let _ = reply.send(self.store.committed_snapshot(&self.root));
            }
            Command::PendingSnapshot(reply) => {
                let _ = reply.send(self.store.pending_snapshot(&self.root, &mut self.reduce));
            }
            Command::ImportsApplied(sequence, reply) => {
                let result = if self.store.browser_profiles_staged(&self.root)?
                    || !self.store.browser_imports_verified(&self.root)?
                {
                    Err(Error::Recovery)
                } else if sequence <= self.store.applied_sequence()? {
                    self.imported_through = Some(self.imported_through.unwrap_or(0).max(sequence));
                    Ok(())
                } else {
                    Err(Error::Sequence)
                };
                let update = self.refresh_status();
                let _ = reply.send(result);
                update?;
            }
        }
        Ok(true)
    }

    fn refresh_status(&self) -> Result<()> {
        let current = self.status.borrow().clone();
        self.report(current.phase, current.issue)
    }

    fn report(&self, mut phase: Phase, issue: Option<&'static str>) -> Result<()> {
        let cursor = self.store.applied_sequence()?;
        let pending = self.store.pending_count()?;
        if matches!(phase, Phase::CatchingUp | Phase::Ready) {
            phase = if self
                .imported_through
                .is_some_and(|sequence| sequence >= cursor)
                && !self.roster.is_empty()
                && cursor >= self.head
                && pending == 0
                && !self.store.browser_imports_pending(&self.root)?
                && !self.store.browser_profiles_staged(&self.root)?
            {
                Phase::Ready
            } else {
                Phase::CatchingUp
            };
        }
        self.status.send_replace(Status {
            phase,
            applied_sequence: cursor,
            head_sequence: self.head,
            pending_changes: pending,
            issue,
        });
        Ok(())
    }

    fn update_roster(&mut self, devices: Vec<Device>) -> Result<()> {
        if devices.len() > 1024 {
            return Err(Error::TooLarge);
        }
        let mut roster = HashMap::new();
        let mut own = false;
        for device in devices {
            self.root.verify_grant(&self.scope, &device.grant)?;
            if device.last_counter > MAX_COUNTER {
                return Err(Error::Invalid);
            }
            if device.grant.device_id == self.store.grant().device_id {
                if device.revoked_at.is_some()
                    || device.grant.public_key != self.device.public_key()
                    || device.grant.key_epoch != self.store.grant().key_epoch
                {
                    return Err(Error::Authentication);
                }
                if device.last_counter > self.store.allocated_counter()? {
                    return Err(Error::Recovery);
                }
                own = true;
            }
            if roster
                .insert(device.grant.device_id.clone(), device.grant)
                .is_some()
            {
                return Err(Error::Identity);
            }
        }
        if !own {
            return Err(Error::Authentication);
        }
        self.roster = roster;
        Ok(())
    }

    async fn connected(&mut self, socket: &mut SyncSocket) -> Result<()> {
        self.report(Phase::CatchingUp, None)?;
        let mut tick = interval(Duration::from_millis(250));
        tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
        let mut heartbeat = interval(Duration::from_secs(15));
        heartbeat.set_missed_tick_behavior(MissedTickBehavior::Skip);
        let mut in_flight: Option<(String, Instant)> = None;
        let mut gap_retries = 0u8;
        loop {
            tokio::select! {
                biased;
                _ = self.stop.changed() => return Ok(()),
                command = self.commands.recv() => { if !self.command(command)? { return Ok(()); } },
                frame = socket.receive() => {
                    match frame? {
                        ServerFrame::Devices { devices } => self.update_roster(devices)?,
                        ServerFrame::Presence { devices } => {
                            if devices.len() > 1024 || devices.iter().any(|d| !valid_id(&d.device_id) || d.applied_sequence > MAX_COUNTER) { return Err(Error::Invalid); }
                            self.presence.send_replace(devices);
                        },
                        ServerFrame::Ack { receipt } => {
                            self.store.acknowledge(&receipt)?;
                            self.head = self.head.max(receipt.sequence);
                            if in_flight.as_ref().is_some_and(|(id, _)| *id == receipt.operation_id) { in_flight = None; }
                        },
                        ServerFrame::Events { replay } => {
                            if replay.checkpoint_required { return Err(Error::Recovery); }
                            if replay.head_sequence > MAX_COUNTER || replay.events.is_empty() || replay.events.len() > 200
                                || replay.events.iter().any(|e| e.sequence > replay.head_sequence) { return Err(Error::Invalid); }
                            self.store.observe_head(replay.head_sequence)?;
                            self.head = self.head.max(replay.head_sequence);
                            let before = self.store.applied_sequence()?;
                            let mut expected = before + 1;
                            let mut gap = false;
                            for event in &replay.events {
                                if event.sequence > expected { gap = true; break; }
                                if event.sequence == expected { expected += 1; }
                            }
                            if gap {
                                gap_retries += 1;
                                if gap_retries > 3 { return Err(Error::Sequence); }
                                socket.send(&ClientFrame::Resume { after: before }).await?;
                                self.report(Phase::CatchingUp, None)?;
                                continue;
                            }
                            if replay.events.iter().any(|e| !self.roster.contains_key(&e.mutation.device_id)) {
                                self.update_roster(self.api.devices().await?)?;
                            }
                            let page = replay.events.into_iter().map(|event| {
                                let grant = self.roster.get(&event.mutation.device_id).ok_or(Error::Identity)?.clone();
                                Ok((event, grant))
                            }).collect::<Result<Vec<_>>>()?;
                            let applied = self.store.apply_events(&self.root, &page, &mut self.reduce)?;
                            self.store.resume_browser_captures(&self.root, &self.device)?;
                            if applied > before { gap_retries = 0; }
                            self.head = self.head.max(replay.head_sequence);
                            if in_flight.as_ref().is_some_and(|(id, _)| page.iter().any(|(e, _)| e.mutation.operation_id == *id)) { in_flight = None; }
                        },
                        ServerFrame::AccountEvent { event } => { let _ = self.events.send(event); },
                        ServerFrame::CheckpointRequired { .. } => return Err(Error::Recovery),
                        ServerFrame::Error { code, .. } if code == "sync_unavailable" => return Err(Error::Network),
                        ServerFrame::Error { code, .. } if code == "sync_device_forbidden" => return Err(Error::Authentication),
                        ServerFrame::Error { .. } => return Err(Error::Recovery),
                        _ => return Err(Error::Invalid),
                    }
                    self.report(Phase::CatchingUp, None)?;
                },
                _ = heartbeat.tick() => {
                    let status = self.status.borrow().clone();
                    let document = serde_json::from_slice::<crate::document::Document>(&self.store.committed_snapshot(&self.root)?).ok();
                    let active_epoch = document.as_ref().filter(|v| v.is_active(&self.store.grant().device_id))
                        .and_then(|v| v.active_device.as_ref()).map(|v| v.epoch.as_str());
                    socket.send(&ClientFrame::Heartbeat { applied_sequence: status.applied_sequence, ready: status.phase == Phase::Ready, active_epoch, activation: None }).await?;
                },
                _ = tick.tick() => {
                    if socket.stale() || in_flight.as_ref().is_some_and(|(_, sent)| sent.elapsed() >= Duration::from_secs(20)) { return Err(Error::Network); }
                    // Catch up before publishing offline credentials; the reducer
                    // will enforce their base-version preconditions atomically.
                    if in_flight.is_none() && !self.roster.is_empty() && self.store.applied_sequence()? >= self.head {
                        if let Some(mutation) = self.store.pending(true, 1)?.into_iter().next() {
                            let bytes = self.root.open_mutation(&self.scope, self.store.grant(), &mutation)?;
                            let payload = serde_json::from_slice::<crate::document::Payload>(&bytes).ok();
                            let status = self.status.borrow().clone();
                            socket.send(&publication_frame(&mutation, payload.as_ref(), &status)).await?;
                            in_flight = Some((mutation.operation_id, Instant::now()));
                        }
                    }
                },
            }
        }
    }
}

fn publication_frame<'a>(
    mutation: &'a Mutation,
    payload: Option<&'a crate::document::Payload>,
    status: &Status,
) -> ClientFrame<'a> {
    use crate::document::Payload;
    match payload {
        Some(Payload::ActiveDevice { active: true, .. }) => ClientFrame::Heartbeat {
            applied_sequence: status.applied_sequence,
            ready: status.phase == Phase::Ready,
            active_epoch: None,
            activation: Some(mutation),
        },
        Some(Payload::Published { active_epoch, .. }) => ClientFrame::Publish {
            mutation,
            active_epoch: Some(active_epoch),
        },
        _ => ClientFrame::Publish {
            mutation,
            active_epoch: None,
        },
    }
}
