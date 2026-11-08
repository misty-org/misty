//! A site's cookies as records: one per site, `<site>` and then `<site>#<n>` when they don't fit.
use super::entries::{cookie_key, SiteCookies};
use crate::browser::site_data::website_data::coverage::site;
use browser_data::document::{entities::Kind, ViewRecord};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;

pub(super) const COOKIES: &str = "cookies";
/// Sealed records must stay under 256 KiB. Compression can't grow text by much, and padding adds
/// at most 16 KiB.
pub(super) const RECORD_BYTES: usize = 192 << 10;

fn record_id(site: &str, part: usize) -> String {
    match part {
        0 => site.to_owned(),
        part => format!("{site}#{part}"),
    }
}

/// The site a record id belongs to, and which part it is.
fn parse_id(id: &str) -> (&str, usize) {
    match id.rsplit_once('#').map(|(site, n)| (site, n.parse())) {
        Some((site, Ok(part))) => (site, part),
        _ => (id, 0),
    }
}

/// Every site's cookies in a list of records, with how many records each has. An entry that can't
/// be read, or a cookie that doesn't belong under its key and site, is left out by itself.
pub(super) fn parse_records(records: &[ViewRecord]) -> BTreeMap<String, (SiteCookies, usize)> {
    let mut sites: BTreeMap<String, (SiteCookies, usize)> = BTreeMap::new();
    for record in records.iter().filter(|r| r.kind == Kind::SiteCookies) {
        let (name, part) = parse_id(&record.id);
        let (entries, parts) = sites.entry(name.to_owned()).or_default();
        *parts = (*parts).max(part + 1);
        let Some(cookies) = record.fields.get(COOKIES).and_then(Value::as_object) else {
            continue;
        };
        for (key, value) in cookies {
            let Ok(entry) = serde_json::from_value::<super::entries::Entry>(value.clone()) else {
                continue;
            };
            let valid = entry.cookie.as_ref().is_none_or(|cookie| {
                cookie.validate().is_ok()
                    && cookie_key(cookie) == *key
                    && site(&cookie.domain) == name
            });
            if valid {
                entries.insert(key.clone(), entry);
            }
        }
    }
    sites
}

/// The writes that make a site's records say `entries`, removing parts it no longer needs.
pub(super) fn site_writes(
    name: &str,
    entries: &SiteCookies,
    old_parts: usize,
) -> Vec<(String, Option<ViewRecord>)> {
    let mut parts: Vec<Map<String, Value>> = Vec::new();
    let mut current = Map::new();
    let mut size = 0;
    for (key, entry) in entries {
        let Ok(value) = serde_json::to_value(entry) else {
            continue;
        };
        let length = key.len() + value.to_string().len() + 8;
        if size + length > RECORD_BYTES && !current.is_empty() {
            parts.push(std::mem::take(&mut current));
            size = 0;
        }
        size += length;
        current.insert(key.clone(), value);
    }
    if !current.is_empty() {
        parts.push(current);
    }
    let mut writes = Vec::new();
    for (part, cookies) in parts.iter().enumerate() {
        let id = record_id(name, part);
        writes.push((
            id.clone(),
            Some(ViewRecord {
                kind: Kind::SiteCookies,
                id,
                fields: BTreeMap::from([(COOKIES.to_owned(), json!(cookies))]),
            }),
        ));
    }
    for part in parts.len()..old_parts {
        writes.push((record_id(name, part), None));
    }
    writes
}
