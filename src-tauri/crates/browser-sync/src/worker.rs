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

mod clipboard;
mod collections;
mod workspaces;
mod commands;
mod handle;
#[cfg(test)]
mod control_tests;

pub use clipboard::ClipboardRow;

use crate::{
    crypto::{DeviceKey, VaultRoot, VaultScope},
    document::CredentialRecord,
    protocol::*,
    store::{
        BrowserCaptureState, BrowserImportJournal, BrowserObservation, BrowserProfileBinding,
        PendingSnapshot, Store,
    },
    transport::{SyncApi, SyncSocket},
    workspace::sync::{Outgoing, SyncState, WorkspaceSync},
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

#[derive(Clone, Serialize, PartialEq, Eq)]
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
    WorkspaceChanges(Vec<crate::document::Change>, oneshot::Sender<Result<()>>),
    WorkspaceClaim(String, oneshot::Sender<Result<()>>),
    WorkspaceOpen(String, oneshot::Sender<Result<()>>),
    RecordsList(
        String,
        oneshot::Sender<Result<(u64, Vec<crate::document::ViewRecord>)>>,
    ),
    RecordsReady(String, oneshot::Sender<Result<bool>>),
    RecordsWrite(
        String,
        Vec<(String, Option<crate::document::ViewRecord>)>,
        oneshot::Sender<Result<()>>,
    ),
    WorkspaceSlotWrite(String, i16, Option<Vec<u8>>, oneshot::Sender<Result<()>>),
    WorkspaceSlotRead(
        String,
        String,
        i16,
        oneshot::Sender<Result<Option<Vec<u8>>>>,
    ),
    SigninStatus(
        String,
        oneshot::Sender<Result<crate::workspace::sync::SigninStatus>>,
    ),
    SigninWrite(
        String,
        Vec<(i16, Option<Vec<u8>>)>,
        std::collections::BTreeMap<i16, String>,
        oneshot::Sender<Result<()>>,
    ),
    SigninRead(String, i16, oneshot::Sender<Result<Option<Vec<u8>>>>),
    SigninBind(
        String,
        crate::store::DeviceSignin,
        oneshot::Sender<Result<()>>,
    ),
    Flush(oneshot::Sender<Result<()>>),
    ClipboardPublish(u8, Vec<u8>, oneshot::Sender<Result<()>>),
}

/// Longest a flush waits for the server before answering anyway; queued
/// edits stay stored and go out on the next connection.
const FLUSH_DEADLINE: Duration = Duration::from_secs(5);

#[derive(Clone)]
pub struct WorkerHandle {
    browser_imports: Arc<tokio::sync::Mutex<()>>,
    commands: mpsc::Sender<Command>,
    stop: watch::Sender<bool>,
    pub status: watch::Receiver<Status>,
    pub presence: watch::Receiver<Vec<Presence>>,
    pub devices: watch::Receiver<Vec<Device>>,
    /// Workspaces: roster, the driven workspace and the shared workspace.
    pub workspaces: watch::Receiver<SyncState>,
    pub traffic: Arc<crate::transport::TrafficCounters>,
    events: broadcast::Sender<AccountEvent>,
    /// The shared clipboard's sealed clips, as last read from the server.
    pub clipboard_rows: watch::Receiver<Vec<ClipboardRow>>,
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
    devices: watch::Sender<Vec<Device>>,
    events: broadcast::Sender<AccountEvent>,
    imported_through: Option<u64>,
    roster: HashMap<String, DeviceGrant>,
    head: u64,
    workspaces: WorkspaceSync,
    sync_state: watch::Sender<SyncState>,
    /// Frames produced by commands, sent by the connected loop.
    workspace_outbox: Vec<Outgoing>,
    connected_now: bool,
    claimed_requests: std::collections::HashSet<String>,
    /// Consecutive workspaces dropped and refetched after failing to verify.
    workspace_refetches: u8,
    collections: collections::CollectionSync,
    clipboard: clipboard::ClipboardLane,
    clipboard_rows: watch::Sender<Vec<ClipboardRow>>,
    /// Flushes awaiting the server, with their deadlines.
    flushes: Vec<(Instant, oneshot::Sender<Result<()>>)>,
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
        let (devices, devices_rx) = watch::channel(Vec::new());
        let (events, _) = broadcast::channel(32);
        let mut workspaces = WorkspaceSync::new(&scope, store.grant());
        workspaces.load(
            &store,
            &crate::workspace::state::Verifier {
                root: &root,
                scope: &scope,
                grants: &HashMap::new(),
            },
        )?;
        let (sync_state, workspaces_rx) =
            watch::channel(workspaces.optimistic_view(&store, &root)?);
        let clipboard = clipboard::ClipboardLane::new(&root, &scope)?;
        let (clipboard_rows, clipboard_rows_rx) = watch::channel(Vec::new());
        let handle = WorkerHandle {
            browser_imports: Arc::new(tokio::sync::Mutex::new(())),
            commands: commands_tx,
            stop: stop_tx,
            status: status_rx,
            presence: presence_rx,
            devices: devices_rx,
            workspaces: workspaces_rx,
            traffic: api.traffic(),
            events: events.clone(),
            clipboard_rows: clipboard_rows_rx,
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
                devices,
                events,
                imported_through: None,
                roster: HashMap::new(),
                head,
                workspaces,
                sync_state,
                workspace_outbox: Vec::new(),
                connected_now: false,
                claimed_requests: std::collections::HashSet::new(),
                workspace_refetches: 0,
                collections: collections::CollectionSync::default(),
                clipboard,
                clipboard_rows,
                flushes: Vec::new(),
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
            // The status only carries a code; keep the cause for diagnosis.
            // SQLite errors name the failing constraint or table, never values.
            let line = match error {
                Error::Storage(cause) => format!("browser sync stopped: {error}: {cause}"),
                _ => format!("browser sync stopped: {error}"),
            };
            eprintln!("{line}");
            let issue = match error {
                Error::Authentication => "sign_in_required",
                Error::DeviceForbidden => "sync_device_forbidden",
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
                    if socket.vault.head_sequence < self.head {
                        return Err(Error::Recovery);
                    }
                    self.store.confirm_enrollment(&socket.vault)?;
                    self.store.observe_head(socket.vault.head_sequence)?;
                    self.head = self.head.max(socket.vault.head_sequence);
                    self.connected_now = true;
                    let result = self.connected(&mut socket).await;
                    self.connected_now = false;
                    self.workspaces_disconnected();
                    result
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

    fn refresh_status(&self) -> Result<()> {
        let current = self.status.borrow().clone();
        self.report(current.phase, current.issue)
    }

    fn report(&self, mut phase: Phase, issue: Option<&'static str>) -> Result<()> {
        let cursor = self.store.applied_sequence()?;
        let pending = self.store.pending_count()?;
        if matches!(phase, Phase::CatchingUp | Phase::Ready) {
            // Workspace-wide sign-in imports only exist before workspaces.
            // In workspace mode each device's sign-in data has its own state
            // (reported per device), and nothing advances the legacy import
            // bookkeeping, so waiting on it would never finish.
            let imports_settled = self.workspaces.workspace_mode()
                || (self
                    .imported_through
                    .is_some_and(|sequence| sequence >= cursor)
                    && !self.store.browser_imports_pending(&self.root)?
                    && !self.store.browser_profiles_staged(&self.root)?);
            phase = if imports_settled
                && !self.roster.is_empty()
                && cursor >= self.head
                && pending == 0
            {
                Phase::Ready
            } else {
                Phase::CatchingUp
            };
        }
        let next = Status {
            phase,
            applied_sequence: cursor,
            head_sequence: self.head,
            pending_changes: pending,
            issue,
        };
        // A failed command is not a state change. Notifying on every rejection
        // feeds the renderer's retry back into this same command indefinitely.
        self.status.send_if_modified(|current| {
            if *current == next {
                false
            } else {
                *current = next;
                true
            }
        });
        Ok(())
    }

    fn update_roster(&mut self, devices: Vec<Device>) -> Result<()> {
        if devices.len() > 1024 {
            return Err(Error::TooLarge);
        }
        let enrolled = devices.clone();
        let mut roster = HashMap::new();
        let mut own = false;
        for device in devices {
            self.root.verify_grant(&self.scope, &device.grant)?;
            if device.last_counter > MAX_COUNTER {
                return Err(Error::Invalid);
            }
            if device.grant.device_id == self.store.grant().device_id {
                if device.revoked_at.is_some() {
                    return Err(Error::DeviceForbidden);
                }
                if device.grant.public_key != self.device.public_key()
                    || device.grant.key_epoch != self.store.grant().key_epoch
                {
                    return Err(Error::Identity);
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
            return Err(Error::DeviceForbidden);
        }
        self.roster = roster;
        // A request is delivered through the existing authenticated roster.
        // The target signs its own takeover. The request ID makes replay and
        // reconnect idempotent; a stale request never wakes a returning device.
        if let Some(own) = enrolled
            .iter()
            .find(|d| d.grant.device_id == self.store.grant().device_id)
        {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;
            if self.workspaces.idle() {
                self.store
                    .resync_workspace_counter(own.workspace_last_counter)?;
            } else {
                self.store
                    .observe_workspace_counter(own.workspace_last_counter)?;
            }
            // Workspace protocol: the target signs a claim reusing the request ID,
            // which the server checks against the request's workspace and expiry.
            if own.full_sync && own.activation_expires_at > now {
                if let Some(request) = own.activation_request.as_deref().filter(|id| valid_id(id)) {
                    if self.claimed_requests.insert(request.to_owned()) {
                        let workspace = own
                            .activation_workspace_id
                            .clone()
                            .filter(|id| valid_id(id))
                            .unwrap_or_else(|| own.grant.device_id.clone());
                        let grant = self.store.grant().clone();
                        let frame = self.workspaces.claim(
                            &mut self.store,
                            &self.scope,
                            &grant,
                            &self.device,
                            &workspace,
                            Some(request.to_owned()),
                            None,
                        )?;
                        self.workspace_outbox.push(frame);
                    }
                }
            }
        }
        self.devices.send_replace(enrolled);
        self.refresh_shared_retirement()
    }

    async fn connected(&mut self, socket: &mut SyncSocket) -> Result<()> {
        self.report(Phase::CatchingUp, None)?;
        self.workspaces_connected(socket).await?;
        let mut tick = interval(Duration::from_millis(250));
        tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
        let mut heartbeat = interval(Duration::from_secs(15));
        heartbeat.set_missed_tick_behavior(MissedTickBehavior::Skip);
        let mut in_flight: Option<(String, Instant)> = None;
        let mut gap_retries = 0u8;
        // Liveness is the transport: the server pings and this socket answers.
        // A heartbeat frame only reports a changed cursor, readiness or active
        // epoch, so an idle, caught-up device sends nothing.
        let mut reported: Option<(u64, bool, Option<String>)> = None;
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
                        ServerFrame::AccountEvent { event } => {
                            if event.topic == "browser-records" {
                                match event.id.as_deref() {
                                    Some(crate::collections::CLIPBOARD) => self.clipboard.hinted(),
                                    Some(collection) => self.collections.hinted(collection),
                                    None => {}
                                }
                            } else if event.topic == "reset" {
                                self.collections.reset();
                                self.clipboard.hinted();
                            }
                            let _ = self.events.send(event);
                        },
                        ServerFrame::Workspaces { workspaces } => self.workspace_roster(socket, workspaces).await?,
                        ServerFrame::WorkspaceDelta { delta } => {
                            let workspace = delta.workspace_id.clone();
                            let result = self.workspace_delta(socket, delta).await;
                            self.workspace_verified(&workspace, result)?
                        },
                        ServerFrame::WorkspaceSnapshot { snapshot } => {
                            let workspace = snapshot.workspace_id.clone();
                            let result = self.workspace_snapshot(snapshot).await;
                            self.workspace_verified(&workspace, result)?
                        },
                        ServerFrame::WorkspaceCurrent { workspace_id, version } => self.workspace_current(socket, &workspace_id, version).await?,
                        ServerFrame::WorkspaceAck { request_id, receipt } => self.workspace_ack(request_id.as_deref(), receipt)?,
                        ServerFrame::WorkspaceError { code, request_id, operation_id, retry_after_ms, .. } => self.workspace_error(request_id.as_deref(), operation_id.as_deref(), &code, retry_after_ms.map(Duration::from_millis))?,
                        ServerFrame::BatchPolicy { policy } => self.batch_policy(&policy),
                        ServerFrame::Slot { request_id, slot } => self.workspaces.on_slot(&self.root, &self.scope, request_id.as_deref(), slot),
                        ServerFrame::Blobs { .. } | ServerFrame::BlobAck { .. } => {},
                        ServerFrame::Records { request_id, listing } => {
                            if self.clipboard.listing(request_id.as_deref(), &listing).is_some() {
                                self.publish_clipboard_rows();
                            } else {
                                self.records_listing(request_id.as_deref(), listing)?
                            }
                        },
                        ServerFrame::RecordsAck { request_id, results, .. } => {
                            if self.clipboard.ack(request_id.as_deref(), &results).is_some() {
                                self.publish_clipboard_rows();
                            } else {
                                self.records_ack(request_id.as_deref(), results)?
                            }
                        },
                        ServerFrame::CheckpointRequired { .. } => return Err(Error::Recovery),
                        ServerFrame::Error { code, .. } if code == "sync_unavailable" => return Err(Error::Network),
                        ServerFrame::Error { code, .. } if code == "sync_device_forbidden" => return Err(Error::DeviceForbidden),
                        ServerFrame::Error { .. } => return Err(Error::Recovery),
                        _ => return Err(Error::Invalid),
                    }
                    self.report(Phase::CatchingUp, None)?;
                },
                _ = heartbeat.tick() => {
                    let status = self.status.borrow().clone();
                    let document = serde_json::from_slice::<crate::document::Document>(&self.store.committed_snapshot(&self.root)?).ok();
                    let active_epoch = document.as_ref().filter(|v| !v.workspace_mode && v.is_active(&self.store.grant().device_id))
                        .and_then(|v| v.active_device.as_ref()).map(|v| v.epoch.clone());
                    let current = (status.applied_sequence, status.phase == Phase::Ready, active_epoch);
                    if reported.as_ref() != Some(&current) {
                        socket.send(&ClientFrame::Heartbeat { applied_sequence: current.0, ready: current.1, active_epoch: current.2.as_deref(), activation: None }).await?;
                        reported = Some(current);
                    }
                },
                _ = tick.tick() => {
                    if socket.stale() || in_flight.as_ref().is_some_and(|(_, sent)| sent.elapsed() >= Duration::from_secs(20)) { return Err(Error::Network); }
                    self.workspace_tick(socket).await?;
                    self.records_tick(socket).await?;
                    self.clipboard_tick(socket).await?;
                    self.settle_flushes()?;
                    // Catch up before publishing offline credentials; the reducer
                    // will enforce their base-version preconditions atomically.
                    if in_flight.is_none() && self.devices.borrow().iter().any(|d| d.grant.device_id == self.store.grant().device_id && d.full_sync) && !self.roster.is_empty() && self.store.applied_sequence()? >= self.head {
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

#[cfg(test)]
mod extensions_tests;
