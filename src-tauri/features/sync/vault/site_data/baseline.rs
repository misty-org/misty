//! What this computer knows of one open profile's cookies, and how each thing that happens changes
//! it. Everything here is decisions, with no engine and no store, so all of it can be tested.
//!
//! The baseline is what the engine should hold. Comparing a read with it finds this computer's
//! changes; records from elsewhere merge into it, and what differs is written to the engine.
use super::cookie_records::{parse_records, site_writes};
use super::entries::*;
use crate::browser::site_data::website_data::coverage::SkipReason;
use browser_data::document::{credentials::Cookie, ViewRecord};
use std::collections::{BTreeMap, BTreeSet};

/// The moment a change is being judged at.
pub(super) struct Pass {
    pub now_ms: u64,
    pub idle: bool,
    pub conflates_none: bool,
}

/// One write to the engine.
pub(super) enum EngineOp {
    Set {
        site: String,
        key: String,
        cookie: Cookie,
    },
    Delete {
        site: String,
        key: String,
        cookie: Cookie,
    },
}

/// How an engine write went.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Applied {
    Stored,
    /// The engine can't hold this cookie: it is left out here and stays in the records.
    Refused,
    /// It didn't get there this time. The baseline stands and the next pass tries again.
    Later,
}

/// For each site, by cookie, the newest edit this store has been brought up to.
pub(super) type Seen = BTreeMap<String, BTreeMap<String, u64>>;

#[derive(Default)]
pub(super) struct Baseline {
    pub sites: BTreeMap<String, SiteCookies>,
    parts: BTreeMap<String, usize>,
    /// What this store has been brought up to, cookie by cookie. After a restart, an edit newer
    /// than this, or a cookie it doesn't list, is one the engine hasn't had yet, and an older one
    /// means the engine moved. Per site wouldn't do: a cookie arriving from elsewhere with an older
    /// edit than the site's newest here would read as deleted here, and sign out everywhere.
    pub seen: Seen,
    /// Keys the engine won't hold, with their sites. Never treated as deleted.
    pub refused: BTreeMap<String, String>,
    pub(super) retry: BTreeMap<String, String>,
    /// Keys just written. One missing from the next read was silently refused.
    pub(super) verify: BTreeSet<String>,
    /// Sites whose records need rewriting.
    pub unsaved: BTreeSet<String>,
    /// Sites whose `seen` needs moving.
    pub(super) touched: BTreeSet<String>,
    pub skipped: Vec<(String, SkipReason)>,
    pub(super) empty_reads: u8,
    /// A read has been compared since this baseline was loaded.
    pub observed: bool,
    /// The first read came back empty. WebKit reads that way until a store's file has loaded, so
    /// what the next read finds was here all along, not this computer's change.
    pub came_up_empty: bool,
}

pub(super) fn op_for(
    site: &str,
    key: &str,
    entry: &Entry,
    engine: Option<&Cookie>,
    now: u64,
) -> Option<EngineOp> {
    match (&entry.cookie, engine) {
        (Some(cookie), _) if !expired(cookie, now) => Some(EngineOp::Set {
            site: site.to_owned(),
            key: key.to_owned(),
            cookie: cookie.clone(),
        }),
        (_, Some(cookie)) => Some(EngineOp::Delete {
            site: site.to_owned(),
            key: key.to_owned(),
            cookie: cookie.clone(),
        }),
        _ => None,
    }
}

impl Baseline {
    /// A profile's baseline as its records have it, for a store that hasn't been read yet.
    pub fn load(records: &[ViewRecord], seen: Seen) -> Self {
        let mut baseline = Self {
            seen,
            ..Self::default()
        };
        for (name, (entries, parts)) in parse_records(records) {
            baseline.parts.insert(name.clone(), parts);
            baseline.sites.insert(name, entries);
        }
        baseline
    }

    /// A vault has opened on this store. What it already holds gives way to anything in the vault
    /// and adds what the vault lacks, so joining never clobbers what's there; a new vault's first
    /// computer simply uploads it all.
    pub fn rejoin(&mut self) {
        for (name, entries) in &mut self.sites {
            entries.retain(|_, entry| entry.cookie.is_some());
            for entry in entries.values_mut() {
                entry.edited_at = 0;
                entry.idle = true;
                entry.base = 0;
            }
            self.unsaved.insert(name.clone());
        }
        self.seen.clear();
        self.observed = false;
        self.came_up_empty = false;
    }

    /// Merges records from elsewhere. Returns what the engine has to change; the baseline already
    /// says so, so the next read doesn't send it back. Where this computer's copy won, the record
    /// is rewritten, which is how the other side learns.
    pub fn absorb(&mut self, records: &[ViewRecord], pass: &Pass) -> Vec<EngineOp> {
        let mut ops = Vec::new();
        let mut incoming = parse_records(records);
        for (name, (theirs, parts)) in &mut incoming {
            age_out(theirs, pass.now_ms);
            self.parts.insert(name.clone(), *parts);
            let ours = self.sites.entry(name.clone()).or_default();
            age_out(ours, pass.now_ms);
            let (refused, retry, verify) = (&mut self.refused, &mut self.retry, &mut self.verify);
            merge_into(ours, theirs, |key, old, new| {
                let old = old
                    .and_then(|entry| entry.cookie.as_ref())
                    .filter(|cookie| !expired(cookie, pass.now_ms));
                let unchanged = match (&new.cookie, old) {
                    (Some(new), Some(old)) => same_cookie(new, old, pass.conflates_none),
                    (None, None) => true,
                    _ => false,
                };
                // Something new about this cookie: whatever was true of the old copy isn't.
                refused.remove(key);
                retry.remove(key);
                verify.remove(key);
                if !unchanged {
                    ops.extend(op_for(name, key, new, old, pass.now_ms));
                }
            });
            if !same_entries(ours, theirs) {
                self.unsaved.insert(name.clone());
            }
            self.touched.insert(name.clone());
        }
        // A site the records no longer have, such as after the server dropped them, goes back.
        for (name, entries) in &self.sites {
            if !entries.is_empty() && !incoming.contains_key(name) {
                self.unsaved.insert(name.clone());
            }
        }
        ops
    }

    pub(super) fn store(
        &mut self,
        name: &str,
        key: &str,
        cookie: Option<Cookie>,
        edited_at: u64,
        idle: bool,
        base: u64,
    ) {
        self.sites.entry(name.to_owned()).or_default().insert(
            key.to_owned(),
            Entry {
                cookie,
                edited_at,
                idle,
                base,
            },
        );
        self.unsaved.insert(name.to_owned());
        self.touched.insert(name.to_owned());
    }

    pub fn applied(&mut self, op: &EngineOp, outcome: Applied) {
        let (name, key, is_set) = match op {
            EngineOp::Set { site, key, .. } => (site, key, true),
            EngineOp::Delete { site, key, .. } => (site, key, false),
        };
        match outcome {
            Applied::Stored => {
                self.retry.remove(key);
                if is_set {
                    self.verify.insert(key.clone());
                }
            }
            Applied::Refused => {
                self.retry.remove(key);
                self.refused.insert(key.clone(), name.clone());
            }
            Applied::Later => {
                self.retry.insert(key.clone(), name.clone());
            }
        }
    }

    /// Whether a read is due soon: writes went out that the next read should confirm.
    pub fn awaiting_read(&self) -> bool {
        !self.verify.is_empty() || !self.retry.is_empty()
    }

    /// The writes that bring a site's records up to date, dropping what has aged out.
    pub fn writes_for(&mut self, name: &str, now_ms: u64) -> Vec<(String, Option<ViewRecord>)> {
        let old_parts = self.parts.get(name).copied().unwrap_or(0);
        let Some(entries) = self.sites.get_mut(name) else {
            return Vec::new();
        };
        age_out(entries, now_ms);
        let writes = site_writes(name, entries, old_parts);
        let parts = writes.iter().filter(|(_, record)| record.is_some()).count();
        self.parts.insert(name.to_owned(), parts);
        writes
    }

    /// Whether this copy of a cookie is one this store hasn't been brought up to.
    pub(super) fn is_unseen(&self, name: &str, key: &str, entry: &Entry) -> bool {
        self.seen
            .get(name)
            .and_then(|cookies| cookies.get(key))
            .is_none_or(|seen| entry.edited_at > *seen)
    }

    /// Moves `seen` for the sites this store has caught up on. Returns whether it changed.
    pub fn settle(&mut self) -> bool {
        let mut changed = false;
        for name in std::mem::take(&mut self.touched) {
            if self.retry.values().any(|site| *site == name) {
                self.touched.insert(name);
                continue;
            }
            let edits: BTreeMap<String, u64> = self
                .sites
                .get(&name)
                .into_iter()
                .flatten()
                .map(|(key, entry)| (key.clone(), entry.edited_at))
                .collect();
            let before = if edits.is_empty() {
                self.seen.remove(&name)
            } else {
                self.seen.insert(name, edits.clone())
            };
            changed |= before.unwrap_or_default() != edits;
        }
        changed
    }

    #[cfg(test)]
    pub fn entry(&self, name: &str, key: &str) -> Option<&Entry> {
        self.sites.get(name)?.get(key)
    }
}
