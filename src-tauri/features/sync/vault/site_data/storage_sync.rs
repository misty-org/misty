//! Keeps open profiles' localStorage and their records in step, a whole origin at a time. One task,
//! like cookies. Reading runs in pages already open, or for a site with none, in an inert document
//! that never touches the network; writing happens only where no page of the site is open.
use super::engine::Store;
use super::parts::{Known, LOCAL_STORAGE};
use super::scope::{Scope, Stored, Unavailable};
use super::{backfill, open_profiles, skips, Signal};
use crate::browser::profiles;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Webview};
use tokio::sync::{broadcast, mpsc, oneshot};

/// Pages write what they want to keep as they finish loading.
const AFTER_LOAD: Duration = Duration::from_millis(1500);
/// Switching between windows reads every open site; once in this long is plenty.
const FLUSH_GAP: Duration = Duration::from_secs(10);
/// How often a site being held is checked for its tabs having closed.
const HELD_CHECK: Duration = Duration::from_secs(5);
/// Checks for a vault having opened, and for backfill to resume.
const TICK: Duration = Duration::from_secs(60);
/// Pages write as they're used, not only as they load, and someone may walk away with this window
/// still in front. An unchanged page only answers with its stamp, so reading is cheap.
const READ_OPEN_PAGES: Duration = Duration::from_secs(30);

/// Origins with newer data waiting on their tabs, per profile. Read on the main thread when a
/// page is about to load, so kept outside the task.
static HELD: Mutex<BTreeMap<String, BTreeSet<String>>> = Mutex::new(BTreeMap::new());

pub(super) fn is_held(profile: &str, origin: &str) -> bool {
    HELD.try_lock()
        .is_ok_and(|held| held.get(profile).is_some_and(|set| set.contains(origin)))
}

pub(super) fn set_held(profile: &str, origins: BTreeSet<String>) {
    if let Ok(mut held) = HELD.lock() {
        if origins.is_empty() {
            held.remove(profile);
        } else {
            held.insert(profile.to_owned(), origins);
        }
    }
}

fn ledger_name(profile: &str) -> String {
    format!("site_storage.{profile}")
}

#[derive(Default, Serialize, Deserialize)]
pub(super) struct Ledger {
    origins: BTreeMap<String, Known>,
}

pub(super) struct Profile {
    pub store: Store,
    pub known: BTreeMap<String, Known>,
    /// What to bring in next, oldest finding first.
    pub queue: VecDeque<String>,
    pub held: BTreeSet<String>,
    pub backfill: Option<VecDeque<String>>,
    pub dirty: bool,
    pub(super) scan_at: Option<Instant>,
    pub(super) failures: u32,
}

pub(super) struct StorageSync {
    pub app: AppHandle,
    pub scope: Scope,
    pub profiles: BTreeMap<String, Profile>,
    captures: BTreeMap<(String, String), Instant>,
    all_tabs: BTreeSet<String>,
    last_flush: Option<Instant>,
    next_tick: Instant,
    next_read: Instant,
    next_held_check: Instant,
    acks: Vec<oneshot::Sender<()>>,
}

pub(super) async fn run(app: AppHandle, mut signals: mpsc::UnboundedReceiver<Signal>) {
    let mut changes = profiles::subscribe();
    let now = Instant::now();
    let mut sync = StorageSync {
        app,
        scope: Scope::current(),
        profiles: BTreeMap::new(),
        captures: BTreeMap::new(),
        all_tabs: BTreeSet::new(),
        last_flush: None,
        next_tick: now + TICK,
        next_read: now + READ_OPEN_PAGES,
        next_held_check: now + HELD_CHECK,
        acks: Vec::new(),
    };
    loop {
        tokio::select! {
            signal = signals.recv() => match signal {
                Some(signal) => sync.signal(signal).await,
                None => break,
            },
            change = changes.recv() => match change {
                Ok(change) if change.remote && change.collection == LOCAL_STORAGE => {
                    sync.rescan(&change.profile);
                }
                Ok(_) => {}
                Err(broadcast::error::RecvError::Lagged(_)) => {
                    for profile in open_profiles(&sync.app) {
                        sync.rescan(&profile);
                    }
                }
                Err(broadcast::error::RecvError::Closed) => break,
            },
            _ = tokio::time::sleep(sync.wait()) => {}
        }
        sync.work().await;
    }
}

/// The origin a page is showing, if it's a website.
pub(super) fn page_origin(view: &Webview) -> Option<String> {
    let url = view.url().ok()?;
    matches!(url.scheme(), "http" | "https").then(|| url.origin().ascii_serialization())
}

impl StorageSync {
    fn wait(&self) -> Duration {
        let mut next = self.next_tick.min(self.next_read);
        for at in self.captures.values() {
            next = next.min(*at);
        }
        for profile in self.profiles.values() {
            if let Some(at) = profile.scan_at {
                next = next.min(at);
            }
            if !profile.queue.is_empty() {
                next = Instant::now();
            }
            if !profile.held.is_empty() {
                next = next.min(self.next_held_check);
            }
            if profile.backfill.is_some() {
                next = next.min(Instant::now() + backfill::GAP);
            }
        }
        if !self.all_tabs.is_empty() {
            next = Instant::now();
        }
        next.saturating_duration_since(Instant::now())
    }

    pub(super) fn rescan(&mut self, profile: &str) {
        if let Some(known) = self.profiles.get_mut(profile) {
            known.scan_at = Some(Instant::now());
        }
    }

    async fn signal(&mut self, signal: Signal) {
        match signal {
            // Nothing to do for a closed profile, until it opens.
            Signal::Opened(profile) => {
                let _ = self.load(&profile).await;
                self.rescan(&profile);
            }
            Signal::Loaded { profile, origin } => {
                if let Some(origin) = origin {
                    self.captures
                        .entry((profile, origin))
                        .or_insert(Instant::now() + AFTER_LOAD);
                }
            }
            Signal::Flush { profile, done } => {
                let now = Instant::now();
                match profile {
                    Some(profile) => {
                        self.all_tabs.insert(profile);
                    }
                    None if done.is_some()
                        || self.last_flush.is_none_or(|last| now - last >= FLUSH_GAP) =>
                    {
                        self.last_flush = Some(now);
                        self.all_tabs.extend(open_profiles(&self.app));
                    }
                    None => {}
                }
                self.acks.extend(done);
            }
            Signal::AboutToLoad {
                profile,
                origin,
                loading,
                done,
            } => {
                let _ = self
                    .about_to_load(&profile, &origin, loading.as_deref())
                    .await;
                if let Some(done) = done {
                    let _ = done.send(());
                }
            }
        }
    }

    async fn work(&mut self) {
        if !self.scope.is_current() {
            self.reset();
        }
        let now = Instant::now();
        let open = open_profiles(&self.app);
        if now >= self.next_tick {
            self.next_tick = now + TICK;
            for profile in &open {
                let _ = self.load(profile).await;
                let _ = backfill::begin_if_due(self, profile).await;
            }
        }
        if now >= self.next_read {
            self.next_read = now + READ_OPEN_PAGES;
            self.all_tabs.extend(open.iter().cloned());
        }
        let captures: Vec<_> = self
            .captures
            .iter()
            .filter(|(_, at)| **at <= now)
            .map(|(key, _)| key.clone())
            .collect();
        for key in captures {
            self.captures.remove(&key);
            let _ = self.capture_tabs(&key.0, Some(&key.1)).await;
        }
        for profile in std::mem::take(&mut self.all_tabs) {
            let _ = self.capture_tabs(&profile, None).await;
        }
        for ack in self.acks.drain(..) {
            let _ = ack.send(());
        }
        let names: Vec<String> = self.profiles.keys().cloned().collect();
        for name in &names {
            let _ = self.restore_due(name, now).await;
            let _ = backfill::step(self, name).await;
            let _ = self.save_ledger(name).await;
        }
        if now >= self.next_held_check {
            self.next_held_check = now + HELD_CHECK;
        }
        // A closed profile is read afresh when it opens.
        let closed: Vec<String> = names
            .into_iter()
            .filter(|name| !open.contains(name))
            .collect();
        for name in closed {
            self.profiles.remove(&name);
            set_held(&name, BTreeSet::new());
        }
    }

    fn reset(&mut self) {
        self.scope = Scope::current();
        for name in self.profiles.keys() {
            set_held(name, BTreeSet::new());
        }
        self.profiles.clear();
        self.captures.clear();
        self.all_tabs.clear();
    }

    pub(super) async fn load(&mut self, name: &str) -> Stored<()> {
        if self.profiles.contains_key(name) {
            return Ok(());
        }
        let store = Store::for_profile(name).ok_or(Unavailable)?;
        let ledger: Ledger = self.scope.sealed(&ledger_name(name)).await?;
        skips::set_storage(
            name,
            skips::storage_skips(
                ledger
                    .origins
                    .iter()
                    .filter(|(_, k)| k.over)
                    .map(|(o, _)| o),
            ),
        );
        self.profiles.insert(
            name.to_owned(),
            Profile {
                store,
                known: ledger.origins,
                queue: VecDeque::new(),
                held: BTreeSet::new(),
                backfill: None,
                dirty: false,
                scan_at: Some(Instant::now()),
                failures: 0,
            },
        );
        Ok(())
    }

    async fn save_ledger(&mut self, name: &str) -> Stored<()> {
        let Some(profile) = self.profiles.get_mut(name).filter(|profile| profile.dirty) else {
            return Ok(());
        };
        profile.dirty = false;
        skips::set_storage(
            name,
            skips::storage_skips(profile.known.iter().filter(|(_, k)| k.over).map(|(o, _)| o)),
        );
        let ledger = Ledger {
            origins: profile.known.clone(),
        };
        self.scope.seal(&ledger_name(name), &ledger).await
    }
}
