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
mod command;
mod commands;
#[cfg(test)]
mod control_tests;
mod handle;
mod run_loop;
mod status;
mod workspaces;

pub use clipboard::ClipboardRow;
use command::Command;

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
    /// A local vault: it never connects, and only applies edits to its own database
    /// (`run_local`). For a device browsing without an account.
    local: bool,
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
                local: false,
            },
            handle,
        ))
    }

    /// Makes this worker a local vault's: it never connects to a server.
    pub fn local(mut self) -> Self {
        self.local = true;
        self
    }
}

mod connection;

#[cfg(test)]
mod extensions_tests;
#[cfg(test)]
mod local_tests;
