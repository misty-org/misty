//! What the cookie tests share.
use super::super::baseline::{Baseline, EngineOp, Pass};
use super::super::cookie_records::site_writes;
use super::super::entries::*;
use crate::infra::website_data::coverage::CookieRead;
use misty_browser_sync::document::credentials::Cookie;
use misty_browser_sync::document::ViewRecord;
use std::collections::BTreeMap;

pub(super) const NOW: u64 = 1_800_000_000_000;
pub(super) const DAY: u64 = 86_400_000;
pub(super) const HOUR: u64 = 3_600_000;
pub(super) const SITE: &str = "example.test";

pub(super) fn cookie(name: &str, value: &str) -> Cookie {
    Cookie {
        name: name.into(),
        value: value.into(),
        domain: SITE.into(),
        path: "/".into(),
        host_only: true,
        secure: true,
        http_only: false,
        same_site: None,
        expires_unix_seconds: None,
        partition_key: None,
    }
}

pub(super) fn lasting(name: &str, value: &str) -> Cookie {
    Cookie {
        expires_unix_seconds: Some((NOW / 1000) as i64 + 86_400),
        ..cookie(name, value)
    }
}

pub(super) fn entry(value: Option<&str>, edited_at: u64, idle: bool) -> Entry {
    Entry {
        cookie: value.map(|value| cookie("sid", value)),
        edited_at,
        idle,
        base: 0,
    }
}

pub(super) fn pass() -> Pass {
    Pass {
        now_ms: NOW,
        idle: false,
        conflates_none: true,
    }
}

pub(super) fn read(cookies: Vec<Cookie>) -> CookieRead {
    CookieRead {
        cookies,
        skipped: Vec::new(),
    }
}

pub(super) fn key(name: &str) -> String {
    cookie_key(&cookie(name, ""))
}

pub(super) fn value_of(baseline: &Baseline, name: &str) -> Option<String> {
    let entry = baseline.entry(SITE, &key(name))?;
    entry.cookie.as_ref().map(|cookie| cookie.value.clone())
}

/// A site's records holding these entries.
pub(super) fn records(entries: &[(&str, Entry)]) -> Vec<ViewRecord> {
    let map: SiteCookies = entries
        .iter()
        .map(|(name, entry)| (key(name), entry.clone()))
        .collect();
    site_writes(SITE, &map, 0)
        .into_iter()
        .filter_map(|(_, record)| record)
        .collect()
}

/// A baseline that has already read an engine holding these entries' cookies.
pub(super) fn settled(entries: &[(&str, Entry)]) -> Baseline {
    let mut baseline = Baseline::load(&records(entries), BTreeMap::new());
    let live = entries
        .iter()
        .filter_map(|(_, entry)| entry.cookie.clone())
        .collect();
    assert!(baseline.observe(read(live), &pass()).is_empty());
    baseline.came_up_empty = false;
    baseline.unsaved.clear();
    baseline.settle();
    baseline
}

pub(super) fn sets(ops: &[EngineOp]) -> Vec<(&str, &str)> {
    ops.iter()
        .filter_map(|op| match op {
            EngineOp::Set { cookie, .. } => Some((cookie.name.as_str(), cookie.value.as_str())),
            EngineOp::Delete { .. } => None,
        })
        .collect()
}

pub(super) fn deletes(ops: &[EngineOp]) -> Vec<&str> {
    ops.iter()
        .filter_map(|op| match op {
            EngineOp::Delete { cookie, .. } => Some(cookie.name.as_str()),
            EngineOp::Set { .. } => None,
        })
        .collect()
}
