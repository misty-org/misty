//! What part of each website's data can sync. An item this device cannot store
//! exactly is skipped here, never deleted for other devices, and reported.
//! Reports carry only site hosts, counts and fixed reasons: never cookie names,
//! values, storage keys or database contents.
#![cfg_attr(not(any(target_os = "macos", windows)), allow(dead_code))]
use misty_browser_sync::document::credentials::{Area, Cookie, SameSite};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

const MAX_SITES: usize = 200;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum DataKind {
    Cookies,
    LocalStorage,
    SessionStorage,
    IndexedDb,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SkipReason {
    /// Partitioned (CHIPS) cookies have no portable partition key.
    Partitioned,
    /// Engine attributes (ports, unknown policies, expiry clamping) that would
    /// be lost or changed by copying.
    UnsupportedAttributes,
    /// Data another device synced that this device's browser cannot hold. It
    /// is kept for the other devices rather than deleted.
    NotSupportedHere,
    Malformed,
    Duplicate,
    /// Values without a portable encoding (class instances, cycles).
    UnsupportedValues,
    TooLarge,
    /// The account-wide sync event cannot hold more of this device's data.
    SyncLimit,
    /// The site could not be read this time. Its last synced copy is kept.
    Unreadable,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct Synced {
    pub kind: DataKind,
    pub count: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct Skipped {
    pub kind: DataKind,
    pub reason: SkipReason,
    pub count: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct SiteCoverage {
    pub site: String,
    pub synced: Vec<Synced>,
    pub skipped: Vec<Skipped>,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct Coverage {
    synced: BTreeMap<(String, DataKind), u32>,
    skipped: BTreeMap<(String, DataKind, SkipReason), u32>,
}

/// The site a cookie domain or an HTTP(S) origin belongs to.
pub(crate) fn site(domain_or_origin: &str) -> String {
    url::Url::parse(domain_or_origin)
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned))
        .unwrap_or_else(|| {
            domain_or_origin
                .trim_start_matches('.')
                .to_ascii_lowercase()
        })
}

pub(crate) fn area_site(area: &Area) -> Option<(String, DataKind)> {
    match area {
        Area::Cookies => None,
        Area::LocalStorage { origin } => Some((site(origin), DataKind::LocalStorage)),
        Area::SessionStorage { origin, .. } => Some((site(origin), DataKind::SessionStorage)),
        Area::IndexedDb { origin } => Some((site(origin), DataKind::IndexedDb)),
    }
}

impl Coverage {
    pub fn synced(&mut self, site: &str, kind: DataKind, count: u32) {
        *self.synced.entry((site.into(), kind)).or_default() += count;
    }
    pub fn skipped(&mut self, site: &str, kind: DataKind, reason: SkipReason, count: u32) {
        *self.skipped.entry((site.into(), kind, reason)).or_default() += count.max(1);
    }
    /// Moves items counted as synced to skipped, when a later stage (the
    /// device shard packer) could not keep them.
    pub fn unsync(&mut self, site: &str, kind: DataKind, reason: SkipReason, count: u32) {
        if let Some(synced) = self.synced.get_mut(&(site.to_owned(), kind)) {
            *synced = synced.saturating_sub(count);
            if *synced == 0 {
                self.synced.remove(&(site.to_owned(), kind));
            }
        }
        self.skipped(site, kind, reason, count);
    }

    pub fn has_skips(&self) -> bool {
        !self.skipped.is_empty()
    }
    /// Sites with something unsynced come first so the report leads with them.
    pub fn report(&self) -> Vec<SiteCoverage> {
        let mut sites: BTreeMap<&str, SiteCoverage> = BTreeMap::new();
        for ((site, kind), count) in &self.synced {
            sites
                .entry(site)
                .or_insert_with(|| empty(site))
                .synced
                .push(Synced {
                    kind: *kind,
                    count: *count,
                });
        }
        for ((site, kind, reason), count) in &self.skipped {
            sites
                .entry(site)
                .or_insert_with(|| empty(site))
                .skipped
                .push(Skipped {
                    kind: *kind,
                    reason: *reason,
                    count: *count,
                });
        }
        let mut report: Vec<_> = sites.into_values().collect();
        report.sort_by_key(|site| (site.skipped.is_empty(), site.site.clone()));
        report.truncate(MAX_SITES);
        report
    }
}

fn empty(site: &str) -> SiteCoverage {
    SiteCoverage {
        site: site.into(),
        synced: vec![],
        skipped: vec![],
    }
}

pub(crate) type CookieIdentity = (String, String, bool, String);
pub(crate) fn identity(cookie: &Cookie) -> CookieIdentity {
    (
        cookie.name.clone(),
        cookie.domain.trim_start_matches('.').to_ascii_lowercase(),
        cookie.host_only,
        cookie.path.clone(),
    )
}

/// Cookies read from an engine: the exactly representable ones, and the site
/// and reason of each one skipped.
#[derive(Default)]
pub(crate) struct CookieRead {
    pub cookies: Vec<Cookie>,
    pub skipped: Vec<(String, SkipReason)>,
}

impl CookieRead {
    /// Keep each valid cookie once, up to the shared model's limit. An engine
    /// alias of an identity already kept is skipped instead of failing the read.
    pub fn accept(
        items: impl IntoIterator<Item = Result<Cookie, (String, SkipReason)>>,
        limit: usize,
    ) -> Self {
        let mut read = Self::default();
        let mut seen = BTreeSet::new();
        for item in items {
            match item {
                Ok(cookie) if cookie.validate().is_err() => read
                    .skipped
                    .push((site(&cookie.domain), SkipReason::Malformed)),
                Ok(cookie) if !seen.insert(identity(&cookie)) => read
                    .skipped
                    .push((site(&cookie.domain), SkipReason::Duplicate)),
                Ok(cookie) if read.cookies.len() >= limit => read
                    .skipped
                    .push((site(&cookie.domain), SkipReason::TooLarge)),
                Ok(cookie) => read.cookies.push(cookie),
                Err(skip) => read.skipped.push(skip),
            }
        }
        read
    }

    /// Previously synced cookies this device cannot store stay in the
    /// observation, so capturing here never deletes them for other devices.
    pub fn carry(&mut self, baseline: &[Cookie], representable: impl Fn(&Cookie) -> bool) {
        let seen: BTreeSet<_> = self.cookies.iter().map(identity).collect();
        for cookie in baseline {
            if !representable(cookie)
                && !seen.contains(&identity(cookie))
                && cookie.validate().is_ok()
            {
                self.skipped
                    .push((site(&cookie.domain), SkipReason::NotSupportedHere));
                self.cookies.push(cookie.clone());
            }
        }
    }

    /// On an engine that reports SameSite=None as unspecified, keep the synced
    /// copy's explicit None so capturing never downgrades it for other devices.
    pub fn align_same_site(&mut self, reference: &[Cookie], engine_conflates_none: bool) {
        if engine_conflates_none {
            align_same_site(&mut self.cookies, reference);
        }
    }

    pub fn record(&self, coverage: &mut Coverage) {
        for (site, reason) in &self.skipped {
            coverage.skipped(site, DataKind::Cookies, *reason, 1);
        }
    }
}

pub(crate) fn align_same_site(cookies: &mut [Cookie], reference: &[Cookie]) {
    let explicit: BTreeSet<_> = reference
        .iter()
        .filter(|cookie| matches!(cookie.same_site, Some(SameSite::None)))
        .map(identity)
        .collect();
    for cookie in cookies.iter_mut() {
        if cookie.same_site.is_none() && cookie.secure && explicit.contains(&identity(cookie)) {
            cookie.same_site = Some(SameSite::None);
        }
    }
}

/// Split a restore target into cookies this engine can store and cookies it
/// must leave alone (they are reported back unchanged on readback).
pub(crate) fn partition_restorable(
    target: Vec<Cookie>,
    representable: impl Fn(&Cookie) -> bool,
) -> (Vec<Cookie>, Vec<Cookie>) {
    target.into_iter().partition(|cookie| representable(cookie))
}

#[cfg(test)]
#[path = "browser_data_coverage_tests.rs"]
mod tests;
