//! Which sites couldn't sync, for Settings. Hosts and plain reasons only: never a cookie's name,
//! a storage key, or anything about a sign-in.
use crate::infra::website_data::coverage::SkipReason;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::Mutex;

const MAX_SITES: usize = 500;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SkipKind {
    Cookies,
    LocalStorage,
}

/// One site's data that couldn't sync, and why.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct SiteSkip {
    pub site: String,
    pub kind: SkipKind,
    pub reason: String,
}

pub(super) const OVER_CAP: &str = "Its saved data is over the 8 MB limit";

fn cookie_reason(reason: SkipReason) -> Option<&'static str> {
    Some(match reason {
        SkipReason::Partitioned => "It uses partitioned cookies, which can't sync yet",
        SkipReason::UnsupportedAttributes => "It has cookies that can't be copied exactly",
        SkipReason::NotSupportedHere => "It has cookies this computer's browser can't store",
        SkipReason::Malformed => "It has cookies that couldn't be read",
        SkipReason::TooLarge => "This profile has more cookies than can sync",
        // An engine's alias of a cookie that did sync. Nothing is missing.
        SkipReason::Duplicate => return None,
    })
}

/// One line per site, with the first reason found for it.
pub(super) fn cookie_skips<'a>(
    read: impl IntoIterator<Item = &'a (String, SkipReason)>,
    refused: impl IntoIterator<Item = &'a String>,
) -> Vec<SiteSkip> {
    let mut sites: BTreeMap<&str, &'static str> = BTreeMap::new();
    for site in refused {
        sites.insert(
            site,
            cookie_reason(SkipReason::NotSupportedHere).unwrap_or_default(),
        );
    }
    for (site, reason) in read {
        if let Some(reason) = cookie_reason(*reason) {
            sites.entry(site).or_insert(reason);
        }
    }
    sites
        .into_iter()
        .take(MAX_SITES)
        .map(|(site, reason)| SiteSkip {
            site: site.to_owned(),
            kind: SkipKind::Cookies,
            reason: reason.to_owned(),
        })
        .collect()
}

/// The sites whose localStorage is over the cap.
pub(super) fn storage_skips<'a>(over: impl IntoIterator<Item = &'a String>) -> Vec<SiteSkip> {
    let mut sites: Vec<_> = over
        .into_iter()
        .map(|origin| crate::infra::website_data::coverage::site(origin))
        .collect();
    sites.sort();
    sites.dedup();
    sites.truncate(MAX_SITES);
    sites
        .into_iter()
        .map(|site| SiteSkip {
            site,
            kind: SkipKind::LocalStorage,
            reason: OVER_CAP.to_owned(),
        })
        .collect()
}

/// How far a profile's cookie checks have got, as counts and times only. A check that began and
/// never got through its read stopped somewhere silent, which this is here to show.
#[derive(Clone, Copy, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CookieCheck {
    pub began_at: u64,
    pub read_at: u64,
    pub cookies: usize,
    pub sites: usize,
}

static CHECKS: Mutex<BTreeMap<String, CookieCheck>> = Mutex::new(BTreeMap::new());

pub(super) fn check_began(profile: &str, now_ms: u64) {
    if let Ok(mut all) = CHECKS.lock() {
        all.entry(profile.to_owned()).or_default().began_at = now_ms;
    }
}

pub(super) fn check_read(profile: &str, now_ms: u64, cookies: usize, sites: usize) {
    if let Ok(mut all) = CHECKS.lock() {
        let check = all.entry(profile.to_owned()).or_default();
        check.read_at = now_ms;
        check.cookies = cookies;
        check.sites = sites;
    }
}

/// `None` until a profile's first check begins.
pub(crate) fn cookie_check(profile: &str) -> Option<CookieCheck> {
    CHECKS.lock().ok()?.get(profile).copied()
}

#[derive(Clone, Default)]
struct ProfileSkips {
    cookies: Vec<SiteSkip>,
    storage: Vec<SiteSkip>,
}

/// The latest answer per profile: read by Settings from any thread, so it's never behind a pass.
static SKIPS: Mutex<BTreeMap<String, ProfileSkips>> = Mutex::new(BTreeMap::new());

pub(super) fn set_cookies(profile: &str, skips: Vec<SiteSkip>) {
    if let Ok(mut all) = SKIPS.lock() {
        all.entry(profile.to_owned()).or_default().cookies = skips;
    }
}

pub(super) fn set_storage(profile: &str, skips: Vec<SiteSkip>) {
    if let Ok(mut all) = SKIPS.lock() {
        all.entry(profile.to_owned()).or_default().storage = skips;
    }
}

pub(super) fn forget_all() {
    if let Ok(mut all) = SKIPS.lock() {
        all.clear();
    }
    if let Ok(mut all) = CHECKS.lock() {
        all.clear();
    }
}

pub(super) fn known(profile: &str) -> Option<Vec<SiteSkip>> {
    let all = SKIPS.lock().ok()?;
    let skips = all.get(profile)?;
    Some(
        skips
            .cookies
            .iter()
            .chain(&skips.storage)
            .cloned()
            .collect(),
    )
}

/// What Settings shows for a profile: the latest pass, or for one that hasn't opened this launch,
/// what it said last time.
pub(super) fn coverage(profile: &str) -> Vec<SiteSkip> {
    if let Some(known) = known(profile) {
        return known;
    }
    #[derive(Default, Deserialize)]
    struct SavedCookies {
        #[serde(default)]
        skips: Vec<SiteSkip>,
    }
    #[derive(Default, Deserialize)]
    struct SavedStorage {
        #[serde(default)]
        origins: BTreeMap<String, super::parts::Known>,
    }
    // Never reopens a store an account change is in the middle of closing.
    let Ok(_lease) = crate::infra::profile_data::browser_lifecycle().try_read() else {
        return Vec::new();
    };
    let Ok(store) = crate::infra::profile_data::local_store() else {
        return Vec::new();
    };
    let Ok(store) = store.lock() else {
        return Vec::new();
    };
    let read = |name: String| store.secret(&name).ok().flatten();
    let mut out = read(format!("site_cookies.{profile}"))
        .and_then(|bytes| serde_json::from_slice::<SavedCookies>(&bytes).ok())
        .unwrap_or_default()
        .skips;
    if let Some(saved) = read(format!("site_storage.{profile}"))
        .and_then(|bytes| serde_json::from_slice::<SavedStorage>(&bytes).ok())
    {
        let over = saved.origins.iter().filter(|(_, known)| known.over);
        out.extend(storage_skips(over.map(|(origin, _)| origin)));
    }
    out
}
