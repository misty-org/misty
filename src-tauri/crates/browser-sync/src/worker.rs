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
mod commands;
#[cfg(test)]
mod control_tests;
mod handle;
mod workspaces;

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
    live: Arc<watch::Sender<bool>>,
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
    /// Whether this vault keeps its socket open (a window shows it). Without
    /// one it connects to pull and publish, then disconnects until the next pull.
    live: watch::Receiver<bool>,
    /// When the last pull finished while not live.
    pulled_at: Option<Instant>,
    /// The connected loop disconnected to go dormant, not to stop.
    dormant_exit: bool,
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
        let (live_tx, live) = watch::channel(true);
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
            live: Arc::new(live_tx),
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
                live,
                pulled_at: None,
                dormant_exit: false,
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
            if !self.dormant().await? {
                return Ok(());
            }
            self.roster.clear();
            self.presence.send_replace(Vec::new());
            // A dormant vault's routine pull keeps showing its last state.
            if *self.live.borrow() || self.pulled_at.is_none() {
                self.report(Phase::Connecting, None)?;
            }
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
                Ok(()) if std::mem::take(&mut self.dormant_exit) => {
                    self.presence.send_replace(Vec::new());
                    continue;
                }
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

    /// Waits while this vault is not live, has nothing to publish and pulled
    /// less than a pull interval ago. False when the worker stops meanwhile.
    async fn dormant(&mut self) -> Result<bool> {
        loop {
            if *self.live.borrow() || self.store.pending_count()? > 0 {
                return Ok(true);
            }
            let Some(due) = self.pulled_at.map(|at| at + crate::batch::pull_interval()) else {
                return Ok(true);
            };
            if Instant::now() >= due {
                return Ok(true);
            }
            let wait = tokio::time::sleep_until(due);
            tokio::pin!(wait);
            tokio::select! {
                biased;
                _ = self.stop.changed() => return Ok(false),
                result = self.live.changed() => if result.is_err() { return Ok(true); },
                command = self.commands.recv() => { if !self.command(command)? { return Ok(false); } },
                _ = &mut wait => return Ok(true),
            }
        }
    }

    /// Not live, caught up and nothing left to send: time to disconnect.
    fn settled_for_dormancy(&self, in_flight: bool) -> Result<bool> {
        Ok(!*self.live.borrow()
            && !in_flight
            && self.workspace_outbox.is_empty()
            && self.flushes.is_empty()
            && self.store.applied_sequence()? >= self.head
            && self.store.pending_count()? == 0)
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
}

mod connection;

#[cfg(test)]
mod extensions_tests;
