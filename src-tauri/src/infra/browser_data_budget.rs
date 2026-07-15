//! Fit one device's website data into a single credential sync event. What
//! does not fit, or could not be read, is skipped and reported. An area that
//! synced before keeps its last synced copy: missing coverage would be read as
//! a deletion on every other device.
#![cfg_attr(not(any(target_os = "macos", windows)), allow(dead_code))]
use super::browser_data_coverage::{
    area_site, identity, site, CookieIdentity, Coverage, DataKind, SkipReason,
};
use misty_browser_sync::{
    document::credentials::{Area, Cookie},
    protocol::MAX_EVENT_BYTES,
    store::BrowserObservation,
};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

const MAX_AREAS: usize = 128;
// Room for the batch envelope, profile ID, base sequences and a published epoch.
const BUDGET: usize = MAX_EVENT_BYTES - (64 << 10);
const COOKIE_BUDGET: usize = BUDGET / 2;
const UPDATE_OVERHEAD: usize = 96;

pub(crate) struct Candidate {
    pub area: Area,
    /// This capture's value; `None` when it could not be read.
    pub fresh: Option<Value>,
    /// The last synced value, which stands in when the fresh one cannot sync.
    pub previous: Option<Value>,
}

/// Local data that could not sync and is represented by its last synced copy.
/// Restoring must leave it alone rather than roll it back to that copy.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct Held {
    pub areas: BTreeSet<String>,
    /// IndexedDB databases by origin, when only some of an origin's databases
    /// could not be exported.
    pub databases: BTreeMap<String, BTreeSet<String>>,
}

impl Held {
    pub fn key(area: &Area) -> String {
        serde_json::to_string(area).unwrap_or_default()
    }
    pub fn holds(&self, area: &Area) -> bool {
        self.areas.contains(&Self::key(area))
    }
}

fn size(value: &impl serde::Serialize) -> usize {
    serde_json::to_vec(value).map_or(usize::MAX / 4, |bytes| bytes.len())
}

fn items(area: &Area, payload: &Value) -> u32 {
    let count = match area {
        Area::IndexedDb { .. } => payload["databases"].as_array().map_or(0, Vec::len),
        _ => payload.as_object().map_or(0, serde_json::Map::len),
    };
    count.try_into().unwrap_or(u32::MAX)
}

/// Keep databases this device could not export at their last synced version.
/// Returns the names now held, so a restore does not overwrite local copies.
pub(crate) fn carry_databases(
    fresh: &mut Value,
    previous: Option<&Value>,
    skipped: &BTreeSet<String>,
) -> BTreeSet<String> {
    let mut held = BTreeSet::new();
    let (Some(databases), Some(previous)) = (fresh["databases"].as_array_mut(), previous) else {
        return held;
    };
    let present: BTreeSet<String> = databases
        .iter()
        .filter_map(|db| db["name"].as_str().map(str::to_owned))
        .collect();
    for db in previous["databases"].as_array().into_iter().flatten() {
        if let Some(name) = db["name"]
            .as_str()
            .filter(|name| skipped.contains(*name) && !present.contains(*name))
        {
            held.insert(name.to_owned());
            databases.push(db.clone());
        }
    }
    databases.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    held
}

pub(crate) struct Fitted {
    pub observations: Vec<BrowserObservation>,
    pub held: Held,
}

/// How much of a device's data one capture may publish.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Limit {
    /// Legacy workspaces: everything shares one credential sync event.
    SingleEvent,
    /// Device trees: sign-in shards enforce their own per-slot limits.
    Shards,
}

/// `carried` names cookies kept only for other devices; they are reported as
/// skipped here, not counted as this device's synced cookies.
pub(crate) fn fit(
    mut cookies: Vec<Cookie>,
    carried: &BTreeSet<CookieIdentity>,
    candidates: Vec<Candidate>,
    coverage: &mut Coverage,
    limit: Limit,
) -> Result<Fitted, String> {
    let bounded = limit == Limit::SingleEvent;
    let sizes: Vec<usize> = cookies.iter().map(|cookie| size(cookie) + 1).collect();
    let mut used = sizes.iter().sum::<usize>() + UPDATE_OVERHEAD;
    if bounded && used > COOKIE_BUDGET {
        // Drop the largest local cookies first; keep those held for others.
        let mut order: Vec<usize> = (0..cookies.len())
            .filter(|&i| !carried.contains(&identity(&cookies[i])))
            .collect();
        order.sort_by_key(|&i| std::cmp::Reverse(sizes[i]));
        let mut dropped = BTreeSet::new();
        for i in order {
            if used <= COOKIE_BUDGET {
                break;
            }
            used -= sizes[i];
            dropped.insert(i);
        }
        let mut index = 0;
        cookies.retain(|cookie| {
            let keep = !dropped.contains(&index);
            index += 1;
            if !keep {
                coverage.skipped(
                    &site(&cookie.domain),
                    DataKind::Cookies,
                    SkipReason::SyncLimit,
                    1,
                );
            }
            keep
        });
    }
    for cookie in cookies
        .iter()
        .filter(|cookie| !carried.contains(&identity(cookie)))
    {
        coverage.synced(&site(&cookie.domain), DataKind::Cookies, 1);
    }
    let mut observations = vec![BrowserObservation {
        area: Area::Cookies,
        payload: serde_json::to_value(&cookies).map_err(|_| "Could not encode native cookies")?,
    }];
    let mut held = Held::default();
    // Previously synced areas first: they must stay covered. New areas follow,
    // smallest first, so one oversized site cannot crowd out many small ones.
    let (kept, mut new): (Vec<_>, Vec<_>) = candidates
        .into_iter()
        .partition(|candidate| candidate.previous.is_some());
    new.sort_by_cached_key(|candidate| candidate.fresh.as_ref().map_or(0, size));
    for candidate in kept.into_iter().chain(new) {
        let Some((site, kind)) = area_site(&candidate.area) else {
            continue;
        };
        let cost = |payload: &Value| size(payload) + size(&candidate.area) + UPDATE_OVERHEAD;
        let fits = |payload: &Value| {
            !bounded || (used + cost(payload) <= BUDGET && observations.len() < MAX_AREAS)
        };
        let (payload, stale) = match candidate.fresh {
            Some(fresh) if fits(&fresh) => (fresh, false),
            fresh => {
                if fresh.is_some() {
                    coverage.skipped(&site, kind, SkipReason::SyncLimit, 1);
                }
                match candidate.previous {
                    Some(previous) => (previous, true),
                    None => continue,
                }
            }
        };
        if stale {
            held.areas.insert(Held::key(&candidate.area));
        } else {
            coverage.synced(&site, kind, items(&candidate.area, &payload));
        }
        used += cost(&payload);
        observations.push(BrowserObservation {
            area: candidate.area,
            payload,
        });
    }
    Ok(Fitted { observations, held })
}

#[cfg(test)]
#[path = "browser_data_budget_tests.rs"]
mod tests;
