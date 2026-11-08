//! Comparing a read of the engine with the baseline.
use super::baseline::{op_for, Baseline, EngineOp, Pass};
use super::entries::*;
use crate::browser::site_data::website_data::coverage::{site, CookieRead, SkipReason};
use browser_data::document::credentials::Cookie;
use std::collections::{BTreeMap, BTreeSet};

/// An engine that suddenly reads empty is believed on the second read, not the first: a store that
/// wasn't ready must never sign someone out of everything, everywhere.
const EMPTY_READS_TO_BELIEVE: u8 = 2;

impl Baseline {
    fn has_live(&self, now: u64) -> bool {
        self.sites
            .values()
            .flat_map(|entries| entries.iter())
            .any(|(key, entry)| {
                !self.refused.contains_key(key)
                    && entry
                        .cookie
                        .as_ref()
                        .is_some_and(|cookie| !expired(cookie, now))
            })
    }

    /// Compares a read of the engine with the baseline: what the engine has changed becomes
    /// records, and what it hasn't caught up with comes back as writes. The first read after
    /// loading is different, since the records may have moved on while nobody was looking.
    pub fn observe(&mut self, read: CookieRead, pass: &Pass) -> Vec<EngineOp> {
        let CookieRead { cookies, skipped } = read;
        let first = !self.observed;
        // Still coming up: nothing about an empty read can be believed yet.
        if cookies.is_empty() && self.came_up_empty {
            return Vec::new();
        }
        if cookies.is_empty() && !first && self.has_live(pass.now_ms) {
            self.empty_reads += 1;
            if self.empty_reads < EMPTY_READS_TO_BELIEVE {
                return Vec::new();
            }
        }
        self.empty_reads = 0;
        let store_was_empty = first && cookies.is_empty();
        let here_all_along = first || self.came_up_empty;
        self.came_up_empty = store_was_empty;
        self.observed = true;
        let mut engine: BTreeMap<String, BTreeMap<String, Cookie>> = BTreeMap::new();
        for cookie in cookies {
            engine
                .entry(site(&cookie.domain))
                .or_default()
                .insert(cookie_key(&cookie), cookie);
        }
        let mut ops = Vec::new();
        for (name, cookies) in &engine {
            for (key, cookie) in cookies {
                ops.extend(self.present(name, key, cookie, here_all_along, pass));
            }
        }
        // A cookie the read couldn't report isn't gone: its site's deletions wait.
        let read_all = !skipped
            .iter()
            .any(|(_, reason)| *reason == SkipReason::TooLarge);
        let unsure: BTreeSet<&str> = skipped
            .iter()
            .filter(|(_, reason)| {
                !matches!(reason, SkipReason::Partitioned | SkipReason::Duplicate)
            })
            .map(|(site, _)| site.as_str())
            .collect();
        let mut gone = Vec::new();
        for (name, entries) in &self.sites {
            let held = engine.get(name);
            for (key, entry) in entries {
                if !held.is_some_and(|cookies| cookies.contains_key(key)) {
                    gone.push((name.clone(), key.clone(), entry.clone()));
                }
            }
        }
        for (name, key, entry) in gone {
            let hold = !read_all || unsure.contains(name.as_str());
            ops.extend(self.absent(&name, &key, &entry, first, store_was_empty, hold, pass));
        }
        if first {
            self.touched.extend(self.sites.keys().cloned());
        }
        self.skipped = skipped;
        ops
    }

    /// A cookie the engine holds.
    fn present(
        &mut self,
        name: &str,
        key: &str,
        cookie: &Cookie,
        first: bool,
        pass: &Pass,
    ) -> Option<EngineOp> {
        let Some(entry) = self.sites.get(name).and_then(|entries| entries.get(key)) else {
            // New here. On a first read it was here all along: anything elsewhere wins over it.
            let (edited_at, idle) = if first {
                (0, true)
            } else {
                (pass.now_ms, pass.idle)
            };
            let cookie = aligned(cookie.clone(), pass.conflates_none);
            self.store(name, key, Some(cookie), edited_at, idle, 0);
            return None;
        };
        let same = entry
            .cookie
            .as_ref()
            .is_some_and(|stored| same_cookie(stored, cookie, pass.conflates_none));
        self.verify.remove(key);
        if same {
            self.retry.remove(key);
            self.refused.remove(key);
            return None;
        }
        // The common path stops above, without copying anything.
        let entry = entry.clone();
        if self.refused.contains_key(key) {
            return None;
        }
        let unseen = first && self.is_unseen(name, key, &entry);
        if self.retry.contains_key(key) || unseen {
            return op_for(name, key, &entry, Some(cookie), pass.now_ms);
        }
        let cookie = aligned(cookie.clone(), pass.conflates_none);
        let edited_at = pass.now_ms.max(entry.edited_at + 1);
        self.store(
            name,
            key,
            Some(cookie),
            edited_at,
            pass.idle,
            entry.edited_at,
        );
        None
    }

    /// A cookie the baseline has and the engine doesn't.
    #[allow(clippy::too_many_arguments)]
    fn absent(
        &mut self,
        name: &str,
        key: &str,
        entry: &Entry,
        first: bool,
        store_was_empty: bool,
        hold: bool,
        pass: &Pass,
    ) -> Option<EngineOp> {
        let verifying = self.verify.remove(key);
        let stored = entry.cookie.as_ref()?;
        if expired(stored, pass.now_ms) {
            self.retry.remove(key);
            return None;
        }
        if self.refused.contains_key(key) {
            return None;
        }
        // The engine said it stored this, and it isn't there.
        if verifying {
            self.refused.insert(key.to_owned(), name.to_owned());
            return None;
        }
        // On a first read a missing session cookie went with the last quit, a missing cookie newer
        // than what this store has seen hasn't reached it yet, and a store with nothing in it is
        // new. Otherwise, it was deleted just before Misty last stopped looking.
        let unseen = first
            && (store_was_empty
                || stored.expires_unix_seconds.is_none()
                || self.is_unseen(name, key, entry));
        if self.retry.contains_key(key) || unseen {
            return op_for(name, key, entry, None, pass.now_ms);
        }
        if !hold {
            let edited_at = pass.now_ms.max(entry.edited_at + 1);
            self.store(name, key, None, edited_at, pass.idle, entry.edited_at);
        }
        None
    }
}
