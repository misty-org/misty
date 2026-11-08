//! Keeps one signed-in session connected to the vault, in the background. The connection comes
//! and goes on its own: being offline, a server restart or an expired ticket are never anyone's
//! problem, and only `Notice`s are ever worth saying out loud.
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use rand::Rng;
use serde::Serialize;
use tokio::{
    sync::{watch, Notify},
    time::{interval, sleep, Instant, MissedTickBehavior},
};

use super::{
    client::VaultSocket,
    exchange::{Exchange, Notice},
    keys::RecordKeys,
};
use crate::{
    crypto::{DeviceKey, VaultRoot},
    local::LocalStore,
    transport::SyncApi,
    Error, Result,
};

const TICK: Duration = Duration::from_millis(100);
const TRAFFIC_SAVE: Duration = Duration::from_secs(60);
const MAX_BACKOFF_MS: u64 = 30_000;
/// The login expired: refreshing failed, so wait longer before trying again.
const SIGNED_OUT_WAIT: Duration = Duration::from_secs(60);

/// Where sync stands, for Settings.
#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq)]
pub struct LinkStatus {
    pub connected: bool,
    /// Changes waiting to reach the server.
    pub sending: u64,
    /// Changes on the server this session hasn't read yet.
    pub receiving: u64,
    pub set_aside: u64,
    /// Milliseconds since the epoch this session was last fully caught up.
    pub synced_at: Option<u64>,
    pub notice: Option<Notice>,
    pub stopped: bool,
}

pub struct LinkConfig {
    pub api: SyncApi,
    pub store: Arc<Mutex<LocalStore>>,
    pub root: VaultRoot,
    pub vault_id: String,
    pub session_id: String,
    pub session_key: DeviceKey,
    /// Called with (profile, collection) when records change from elsewhere.
    pub on_change: Arc<dyn Fn(&str, &str) + Send + Sync>,
    /// Called when the list of signed-in sessions changes.
    pub on_sessions: Arc<dyn Fn() + Send + Sync>,
}

/// A running link. Dropping it stops it.
pub struct Link {
    pub status: watch::Receiver<LinkStatus>,
    wake: Arc<Notify>,
    stop: watch::Sender<bool>,
    task: Option<tokio::task::JoinHandle<()>>,
}

impl Link {
    pub fn start(config: LinkConfig) -> Result<Self> {
        let keys = RecordKeys::new(&config.root, &config.vault_id)?;
        let exchange = {
            let store = config.store.lock().map_err(|_| Error::Invalid)?;
            Exchange::new(keys, &store)?
        };
        let (status_tx, status) = watch::channel(LinkStatus::default());
        let (stop, stop_rx) = watch::channel(false);
        let wake = Arc::new(Notify::new());
        let task = tokio::spawn(
            Runner {
                config,
                exchange,
                status: status_tx,
                stop: stop_rx,
                wake: wake.clone(),
                synced_at: None,
                notice: None,
            }
            .run(),
        );
        Ok(Self {
            status,
            wake,
            stop,
            task: Some(task),
        })
    }

    /// A local change happened.
    pub fn edited(&self) {
        self.wake.notify_one();
    }

    /// Something that can tell the link about a local change without holding on to it.
    pub fn waker(&self) -> Arc<Notify> {
        self.wake.clone()
    }

    /// Stops and waits, so what's in flight has settled before anything else happens.
    pub async fn shutdown(mut self) {
        let _ = self.stop.send(true);
        if let Some(task) = self.task.take() {
            let _ = task.await;
        }
    }
}

impl Drop for Link {
    fn drop(&mut self) {
        let _ = self.stop.send(true);
    }
}

struct Runner {
    config: LinkConfig,
    exchange: Exchange,
    status: watch::Sender<LinkStatus>,
    stop: watch::Receiver<bool>,
    wake: Arc<Notify>,
    synced_at: Option<u64>,
    notice: Option<Notice>,
}

/// How a connection ended.
enum Ended {
    Stopped,
    Lost,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as u64)
}

impl Runner {
    async fn run(mut self) {
        let mut failures = 0u32;
        // A change from before this connection still has to go.
        self.exchange.edited(std::time::Instant::now());
        loop {
            if *self.stop.borrow() {
                break;
            }
            self.report(false);
            let started = Instant::now();
            let (api, vault_id, session_id, key) = (
                self.config.api.clone(),
                self.config.vault_id.clone(),
                self.config.session_id.clone(),
                self.config.session_key.clone(),
            );
            let attempt =
                async move { VaultSocket::connect(&api, &vault_id, &session_id, &key).await };
            let connected = tokio::select! {
                biased;
                _ = self.stop.changed() => break,
                result = attempt => result,
            };
            let delay = match connected {
                Ok(mut socket) => {
                    let ended = self.connected(&mut socket).await;
                    socket.close().await;
                    match ended {
                        Ok(Ended::Stopped) => break,
                        Ok(Ended::Lost) => {
                            if started.elapsed() >= Duration::from_secs(30) {
                                failures = 0;
                            }
                            None
                        }
                        // The local database failed. Nothing is lost; this retries.
                        Err(error) => {
                            eprintln!("vault sync: {error}");
                            None
                        }
                    }
                }
                Err(Error::DeviceForbidden) => {
                    // No ticket: this session was removed, or the vault is gone.
                    let gone = matches!(
                        self.config.api.server_vault().await,
                        Ok(vault) if vault.as_ref().is_none_or(|v| v.vault_id != self.config.vault_id)
                    );
                    self.notice = Some(if gone {
                        Notice::VaultGone
                    } else {
                        Notice::SessionRemoved
                    });
                    break;
                }
                Err(Error::Authentication) => Some(SIGNED_OUT_WAIT),
                Err(_) => None,
            };
            self.report(false);
            failures = (failures + 1).min(6);
            let max = (500u64 << failures).min(MAX_BACKOFF_MS);
            let delay = delay.unwrap_or_else(|| {
                Duration::from_millis(rand::thread_rng().gen_range(max / 2..=max))
            });
            tokio::select! {
                biased;
                _ = self.stop.changed() => break,
                _ = sleep(delay) => {}
            }
        }
        self.report_stopped();
    }

    fn report(&self, connected: bool) {
        let (sending, set_aside) = self
            .config
            .store
            .lock()
            .ok()
            .and_then(|store| store.waiting().ok())
            .unwrap_or_default();
        let next = LinkStatus {
            connected,
            sending,
            receiving: self.exchange.behind(),
            set_aside,
            synced_at: self.synced_at,
            notice: self
                .notice
                .or(self.exchange.storage_full().then_some(Notice::StorageFull)),
            stopped: false,
        };
        self.status.send_if_modified(|current| {
            if *current == next {
                false
            } else {
                *current = next;
                true
            }
        });
    }

    fn report_stopped(&self) {
        let notice = self.notice;
        self.status.send_modify(|status| {
            status.connected = false;
            status.stopped = true;
            status.notice = notice;
        });
    }

    fn save_traffic(&self, reported: &mut (u64, u64)) {
        let current = self.config.api.traffic().snapshot();
        let (up, down) = (
            current.uploaded_bytes.saturating_sub(reported.0),
            current.downloaded_bytes.saturating_sub(reported.1),
        );
        if up == 0 && down == 0 {
            return;
        }
        if let Ok(store) = self.config.store.lock() {
            if store.add_traffic(now_ms(), up, down).is_ok() {
                *reported = (current.uploaded_bytes, current.downloaded_bytes);
            }
        }
    }

    fn with_store<T>(
        &mut self,
        work: impl FnOnce(&mut Exchange, &mut LocalStore) -> Result<T>,
    ) -> Result<T> {
        let store = self.config.store.clone();
        let exchange = &mut self.exchange;
        // SQLite is quick here, but a large page is real work; never stall other tasks with it.
        tokio::task::block_in_place(move || {
            let mut store = store.lock().map_err(|_| Error::Invalid)?;
            work(exchange, &mut store)
        })
    }

    async fn connected(&mut self, socket: &mut VaultSocket) -> Result<Ended> {
        for frame in self.exchange.connected() {
            if socket.send(&frame).await.is_err() {
                return Ok(Ended::Lost);
            }
        }
        let mut tick = interval(TICK);
        tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
        let mut traffic_timer = interval(TRAFFIC_SAVE);
        traffic_timer.set_missed_tick_behavior(MissedTickBehavior::Skip);
        let mut reported = {
            let current = self.config.api.traffic().snapshot();
            (current.uploaded_bytes, current.downloaded_bytes)
        };
        self.report(true);
        let result = loop {
            tokio::select! {
                biased;
                _ = self.stop.changed() => break Ok(Ended::Stopped),
                frame = socket.receive() => {
                    let Ok(frame) = frame else { break Ok(Ended::Lost) };
                    let outcome = match self.with_store(|exchange, store| {
                        store.atomic(|store| exchange.on_frame(store, frame))
                    }) {
                        Ok(outcome) => outcome,
                        Err(error) => break Err(error),
                    };
                    for (profile, collection) in &outcome.changed {
                        (self.config.on_change)(profile, collection);
                    }
                    if outcome.sessions_changed {
                        (self.config.on_sessions)();
                    }
                    if let Some(notice) = outcome.notice {
                        self.notice = Some(notice);
                    }
                    let mut lost = false;
                    for frame in &outcome.send {
                        if socket.send(frame).await.is_err() {
                            lost = true;
                            break;
                        }
                    }
                    if lost {
                        break Ok(Ended::Lost);
                    }
                    if outcome.stop {
                        break Ok(Ended::Stopped);
                    }
                    self.after_exchange();
                    self.report(true);
                },
                _ = self.wake.notified() => self.exchange.edited(std::time::Instant::now()),
                _ = tick.tick() => {
                    let now = std::time::Instant::now();
                    if self.exchange.push_timed_out(now) {
                        break Ok(Ended::Lost);
                    }
                    let push = match self.with_store(|exchange, store| exchange.next_push(store, now)) {
                        Ok(push) => push,
                        Err(error) => break Err(error),
                    };
                    if let Some(frame) = push {
                        if socket.send(&frame).await.is_err() {
                            break Ok(Ended::Lost);
                        }
                    }
                    self.report(true);
                },
                _ = traffic_timer.tick() => self.save_traffic(&mut reported),
            }
        };
        self.save_traffic(&mut reported);
        result
    }

    fn after_exchange(&mut self) {
        let settled = self
            .config
            .store
            .lock()
            .ok()
            .is_some_and(|store| self.exchange.settled(&store).unwrap_or(false));
        if settled {
            self.synced_at = Some(now_ms());
        }
    }
}
