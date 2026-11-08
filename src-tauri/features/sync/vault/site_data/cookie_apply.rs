//! The end of every cookie pass: records saved, then the engine brought into line.
use super::baseline::{Applied, EngineOp};
use super::cookie_records::COOKIES;
use super::cookie_sync::{ledger_name, CookieSync, Ledger};
use super::engine;
use super::scope::{Scope, Stored, Unavailable};
use super::{now_ms, skips};
use std::time::{Duration, Instant};

/// Confirms what was just written reached the engine.
const AFTER_WRITES: Duration = Duration::from_secs(1);
const WRITE_BATCH: usize = 100;
const OPS_BEFORE_REST: usize = 64;

impl CookieSync {
    /// Saves what the baseline changed, then brings the engine up to date with it. The baseline
    /// was updated first, so nothing written here comes back as this computer's own change.
    pub(super) async fn finish(
        &mut self,
        name: &str,
        scope: Scope,
        ops: Vec<EngineOp>,
    ) -> Stored<()> {
        self.save_records(name, scope).await?;
        self.apply(name, scope, &ops).await?;
        let ledger = {
            let profile = self.profiles.get_mut(name).ok_or(Unavailable)?;
            let settled = profile.baseline.settle();
            let found =
                skips::cookie_skips(&profile.baseline.skipped, profile.baseline.refused.values());
            let skips_changed = found != profile.skips;
            if skips_changed {
                profile.skips = found;
            }
            skips::set_cookies(name, profile.skips.clone());
            (settled || skips_changed).then(|| Ledger {
                seen: profile.baseline.seen.clone(),
                skips: profile.skips.clone(),
            })
        };
        if let Some(ledger) = ledger {
            scope.seal(&ledger_name(name), &ledger).await?;
        }
        if self
            .profiles
            .get(name)
            .is_some_and(|known| known.baseline.awaiting_read())
        {
            self.due
                .entry(name.to_owned())
                .or_insert(Instant::now() + AFTER_WRITES);
        }
        Ok(())
    }

    async fn save_records(&mut self, name: &str, scope: Scope) -> Stored<()> {
        let profile = self.profiles.get_mut(name).ok_or(Unavailable)?;
        let sites = std::mem::take(&mut profile.baseline.unsaved);
        if sites.is_empty() {
            return Ok(());
        }
        let now = now_ms();
        let mut writes = Vec::new();
        for site in &sites {
            writes.extend(profile.baseline.writes_for(site, now));
        }
        for batch in writes.chunks(WRITE_BATCH) {
            if let Err(error) = scope.write(name, COOKIES, batch.to_vec()).await {
                // Still different from the records, whichever part got there: the next pass tries.
                if let Some(profile) = self.profiles.get_mut(name) {
                    profile.baseline.unsaved.extend(sites);
                }
                return Err(error);
            }
        }
        Ok(())
    }

    /// Writes one cookie at a time, without closing or reloading anything.
    async fn apply(&mut self, name: &str, scope: Scope, ops: &[EngineOp]) -> Stored<()> {
        let store = self.profiles.get(name).ok_or(Unavailable)?.store.clone();
        for (index, op) in ops.iter().enumerate() {
            let lease = scope.lease().await?;
            let (cookie, delete) = match op {
                EngineOp::Set { cookie, .. } => (cookie.clone(), false),
                EngineOp::Delete { cookie, .. } => (cookie.clone(), true),
            };
            let outcome = match engine::write(&self.app, &store, cookie, delete).await {
                Ok(()) => Applied::Stored,
                Err(error) if engine::is_refusal(error) => Applied::Refused,
                Err(_) => Applied::Later,
            };
            drop(lease);
            let profile = self.profiles.get_mut(name).ok_or(Unavailable)?;
            profile.baseline.applied(op, outcome);
            // A big join shouldn't starve the main thread, which runs each write.
            if index % OPS_BEFORE_REST == OPS_BEFORE_REST - 1 {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }
        Ok(())
    }
}
