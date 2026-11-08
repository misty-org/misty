//! Keeps open profiles' cookie stores and their records in step. One task, so passes never overlap
//! and the baselines need no locks: a pass only ever waits on the engine with nothing held.
use super::baseline::{Baseline, Pass, Seen};
use super::cookie_records::COOKIES;
use super::engine::{self, Store, CONFLATES_NONE};
use super::scope::{Scope, Stored, Unavailable};
use super::{idle_now, now_ms, open_profiles, skips, Signal};
use crate::browser::profiles;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tokio::sync::{broadcast, mpsc, oneshot};

const WHILE_FOCUSED: Duration = Duration::from_secs(15);
const WHILE_UNFOCUSED: Duration = Duration::from_secs(60);
/// Pages set cookies as they finish; a burst of loads is one pass.
const AFTER_LOAD: Duration = Duration::from_secs(1);
const LOAD_GAP: Duration = Duration::from_secs(3);
const FLUSH_GAP: Duration = Duration::from_secs(2);

pub(super) fn ledger_name(profile: &str) -> String {
    format!("site_cookies.{profile}")
}

fn joined_key(profile: &str) -> String {
    format!("vault.site_cookies_joined.{profile}")
}

#[derive(Default, Serialize, Deserialize)]
pub(super) struct Ledger {
    pub(super) seen: Seen,
    #[serde(default)]
    pub(super) skips: Vec<skips::SiteSkip>,
}

pub(super) struct Profile {
    pub(super) store: Store,
    pub(super) baseline: Baseline,
    pub(super) skips: Vec<skips::SiteSkip>,
}

pub(super) struct CookieSync {
    pub(super) app: AppHandle,
    pub(super) scope: Scope,
    pub(super) profiles: BTreeMap<String, Profile>,
    pub(super) due: BTreeMap<String, Instant>,
    last_pass: BTreeMap<String, Instant>,
    remote: BTreeSet<String>,
    next_tick: Instant,
    acks: Vec<oneshot::Sender<()>>,
}

fn interval() -> Duration {
    if super::any_focused() {
        WHILE_FOCUSED
    } else {
        WHILE_UNFOCUSED
    }
}

fn pass_now() -> Pass {
    Pass {
        now_ms: now_ms(),
        idle: idle_now(),
        conflates_none: CONFLATES_NONE,
    }
}

pub(super) async fn run(app: AppHandle, mut signals: mpsc::UnboundedReceiver<Signal>) {
    let mut changes = profiles::subscribe();
    let mut sync = CookieSync {
        app,
        scope: Scope::current(),
        profiles: BTreeMap::new(),
        due: BTreeMap::new(),
        last_pass: BTreeMap::new(),
        remote: BTreeSet::new(),
        next_tick: Instant::now() + interval(),
        acks: Vec::new(),
    };
    loop {
        tokio::select! {
            signal = signals.recv() => match signal {
                Some(signal) => sync.signal(signal),
                None => break,
            },
            change = changes.recv() => match change {
                Ok(change) if change.remote && change.collection == COOKIES => {
                    sync.remote.insert(change.profile);
                }
                Ok(_) => {}
                // Some were missed, so anything open may be behind.
                Err(broadcast::error::RecvError::Lagged(_)) => {
                    sync.remote.extend(open_profiles(&sync.app));
                }
                Err(broadcast::error::RecvError::Closed) => break,
            },
            _ = tokio::time::sleep(sync.wait()) => {}
        }
        sync.work().await;
    }
}

impl CookieSync {
    fn wait(&self) -> Duration {
        let next = self
            .due
            .values()
            .copied()
            .fold(self.next_tick, Instant::min);
        next.saturating_duration_since(Instant::now())
    }

    fn signal(&mut self, signal: Signal) {
        let now = Instant::now();
        match signal {
            Signal::Opened(profile) => {
                self.due.insert(profile, now);
            }
            Signal::Loaded { profile, .. } => {
                let gap = self
                    .last_pass
                    .get(&profile)
                    .map_or(now, |last| *last + LOAD_GAP);
                let at = gap.max(now + AFTER_LOAD);
                self.due.entry(profile).or_insert(at);
            }
            Signal::Flush { profile, done } => {
                self.next_tick = now + interval();
                let profiles = match profile {
                    Some(profile) => BTreeSet::from([profile]),
                    None => open_profiles(&self.app),
                };
                for profile in profiles {
                    let recent = self
                        .last_pass
                        .get(&profile)
                        .is_some_and(|last| now.duration_since(*last) < FLUSH_GAP);
                    if !recent || done.is_some() {
                        self.due.insert(profile, now);
                    }
                }
                self.acks.extend(done);
            }
            // Cookies have no such thing as a held site. Only the first read has to come first.
            Signal::AboutToLoad { profile, done, .. } => {
                if !self
                    .profiles
                    .get(&profile)
                    .is_some_and(|known| known.baseline.observed)
                {
                    self.due.insert(profile, now);
                }
                self.acks.extend(done);
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
            for profile in &open {
                self.due.insert(profile.clone(), now);
            }
            self.next_tick = now + interval();
        }
        // A closed profile's records are stored and wait for it to open.
        for profile in std::mem::take(&mut self.remote) {
            if open.contains(&profile) && self.remote_change(&profile).await.is_err() {
                // The store is unreachable: the next tick catches up.
                self.due.insert(profile, now);
            }
        }
        let ready: Vec<String> = self
            .due
            .iter()
            .filter(|(_, at)| **at <= now)
            .map(|(profile, _)| profile.clone())
            .collect();
        for profile in ready {
            self.due.remove(&profile);
            self.last_pass.insert(profile.clone(), Instant::now());
            if self.pass(&profile).await.is_err() && cfg!(debug_assertions) {
                eprintln!("[site-data] cookie pass stopped early");
            }
        }
        for ack in self.acks.drain(..) {
            let _ = ack.send(());
        }
        // A profile that has closed is read afresh when it opens: its records may move meanwhile.
        let before = self.profiles.len();
        let due = &self.due;
        self.profiles
            .retain(|profile, _| open.contains(profile) || due.contains_key(profile));
        self.last_pass.retain(|profile, _| open.contains(profile));
        if self.profiles.len() != before {
            engine::release_helpers();
        }
    }

    /// The account changed: nothing from the old one stays, including helper pages.
    fn reset(&mut self) {
        self.scope = Scope::current();
        self.profiles.clear();
        self.due.clear();
        self.last_pass.clear();
        self.remote.clear();
        engine::release_helpers();
        skips::forget_all();
    }

    /// Gets a profile's state, loading it from its records the first time.
    async fn load(&mut self, name: &str) -> Stored<()> {
        if self.profiles.contains_key(name) {
            return Ok(());
        }
        let store = Store::for_profile(name).ok_or(Unavailable)?;
        let records = self.scope.list(name, COOKIES).await?;
        let ledger: Ledger = self.scope.sealed(&ledger_name(name)).await?;
        let baseline = Baseline::load(&records, ledger.seen);
        self.profiles.insert(
            name.to_owned(),
            Profile {
                store,
                baseline,
                skips: ledger.skips,
            },
        );
        Ok(())
    }

    /// When a vault has opened on this store, what it holds gives way to what's in the vault.
    async fn join_if_needed(&mut self, name: &str) -> Stored<()> {
        let Some(vault) = self.scope.meta(crate::sync::vault::META_VAULT).await? else {
            return Ok(());
        };
        let key = joined_key(name);
        if self.scope.meta(&key).await?.as_deref() == Some(vault.as_str()) {
            return Ok(());
        }
        let records = self.scope.list(name, COOKIES).await?;
        let pass = pass_now();
        if let Some(profile) = self.profiles.get_mut(name) {
            profile.baseline.rejoin();
            profile.baseline.absorb(&records, &pass);
        }
        self.scope.set_meta(&key, &vault).await
    }

    /// One comparison of the engine with the baseline.
    async fn pass(&mut self, name: &str) -> Stored<()> {
        let started = Instant::now();
        skips::check_began(name, now_ms());
        self.load(name).await?;
        self.join_if_needed(name).await?;
        let (scope, app) = (self.scope, self.app.clone());
        let store = self.profiles.get(name).ok_or(Unavailable)?.store.clone();
        let read = match engine::read(&app, &store).await {
            Ok(read) => read,
            Err(error) => {
                if cfg!(debug_assertions) {
                    eprintln!("[site-data] cookie read failed: {error:?}");
                }
                // Said in Settings, so a store that can't be read is never mistaken for one with
                // nothing to sync. The kind only: no cookie, site or sign-in detail.
                skips::set_cookies(
                    name,
                    vec![skips::SiteSkip {
                        site: "All sites".to_owned(),
                        kind: skips::SkipKind::Cookies,
                        reason: format!("This computer's cookies couldn't be read ({error:?})"),
                    }],
                );
                return Err(Unavailable);
            }
        };
        let count = read.cookies.len();
        // A big store takes long enough to compare that it gets a thread of its own.
        let mut baseline =
            std::mem::take(&mut self.profiles.get_mut(name).ok_or(Unavailable)?.baseline);
        let pass = pass_now();
        let compared = tokio::task::spawn_blocking(move || {
            let ops = baseline.observe(read, &pass);
            (baseline, ops)
        })
        .await;
        let Ok((baseline, ops)) = compared else {
            // The baseline went with it, so this profile starts again from its records.
            self.profiles.remove(name);
            return Err(Unavailable);
        };
        let profile = self.profiles.get_mut(name).ok_or(Unavailable)?;
        profile.baseline = baseline;
        skips::check_read(name, now_ms(), count, profile.baseline.sites.len());
        let changed = profile.baseline.unsaved.len();
        let writes = ops.len();
        self.finish(name, scope, ops).await?;
        if cfg!(debug_assertions) {
            eprintln!(
                "[site-data] cookie pass: {count} cookies, {changed} sites changed, {writes} writes, {}ms",
                started.elapsed().as_millis()
            );
        }
        Ok(())
    }

    /// Records from elsewhere arrived for an open profile.
    async fn remote_change(&mut self, name: &str) -> Stored<()> {
        self.load(name).await?;
        // Nothing has compared this store with its records yet: the first pass does it all.
        if !self
            .profiles
            .get(name)
            .is_some_and(|known| known.baseline.observed)
        {
            self.due.insert(name.to_owned(), Instant::now());
            return Ok(());
        }
        let scope = self.scope;
        let records = scope.list(name, COOKIES).await?;
        let pass = pass_now();
        let profile = self.profiles.get_mut(name).ok_or(Unavailable)?;
        let ops = profile.baseline.absorb(&records, &pass);
        self.finish(name, scope, ops).await
    }
}
