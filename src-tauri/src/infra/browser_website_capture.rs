//! Reads every open (and previously synced) origin's website storage. A site
//! that cannot be read, or an area that cannot be stored, is skipped and
//! reported; the rest of the profile still syncs.
use super::browser_data_budget::{carry_databases, Candidate, Held};
use super::browser_data_coverage::{area_site, site, Coverage, DataKind, SkipReason};
use super::browser_website_storage::{evaluate, evaluate_read, WebsiteStorage, PROFILE_UNVERIFIED};
use misty_browser_sync::document::{credentials::Area, CredentialRecord};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::Webview;

/// Writes that change neither an origin's database list nor its storage usage
/// are invisible to the IndexedDB stamp; a full export still runs this often.
const INDEXED_REFRESH: Duration = Duration::from_secs(20);

/// One area as last exported by a page: its stamp and what it reported.
#[derive(Clone)]
struct Observed {
    stamp: String,
    payload: Value,
    skipped: Vec<Value>,
    skipped_databases: Value,
    at: Instant,
}

/// Last export per origin area, for one browser profile. Lets periodic
/// capture skip re-exporting and re-parsing storage that has not changed.
#[derive(Default)]
struct ObservedCache {
    physical: String,
    areas: HashMap<String, Observed>,
}

fn observed() -> &'static Mutex<ObservedCache> {
    static CACHE: OnceLock<Mutex<ObservedCache>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

const FIELDS: [(&str, &str); 3] = [
    ("local", "local_storage"),
    ("session", "session_storage"),
    ("indexed", "indexed_db"),
];

fn cache_key(origin: &str, field: &str, tab_id: Option<&str>) -> String {
    match (field, tab_id) {
        ("session", Some(tab)) => format!("{origin}\u{0}session\u{0}{tab}"),
        _ => format!("{origin}\u{0}{field}"),
    }
}

/// The request for one page: which areas to read and the stamps already held.
fn read_request(
    cache: &ObservedCache,
    origin: &str,
    tab_id: Option<&str>,
    first: bool,
    now: Instant,
) -> (Value, Value) {
    let read = json!({"local": first, "session": tab_id.is_some(), "indexed": first});
    let mut known = serde_json::Map::new();
    for (field, _) in FIELDS {
        if let Some(entry) = cache.areas.get(&cache_key(origin, field, tab_id)) {
            if field == "indexed" && now.duration_since(entry.at) >= INDEXED_REFRESH {
                continue;
            }
            known.insert(field.into(), Value::String(entry.stamp.clone()));
        }
    }
    (read, Value::Object(known))
}

/// Restores unchanged areas from the cache and records freshly exported ones,
/// so the page report looks exactly like a full export.
fn merge_observed(
    cache: &mut ObservedCache,
    value: &mut Value,
    origin: &str,
    tab_id: Option<&str>,
    now: Instant,
) {
    let unchanged: BTreeSet<String> =
        serde_json::from_value(value["unchanged"].clone()).unwrap_or_default();
    for (field, kind) in FIELDS {
        let key = cache_key(origin, field, tab_id);
        if unchanged.contains(field) {
            let Some(entry) = cache.areas.get(&key) else {
                continue;
            };
            value[field] = entry.payload.clone();
            if let Some(skipped) = value["skipped"].as_array_mut() {
                skipped.extend(entry.skipped.iter().cloned());
            }
            if field == "indexed" {
                value["skipped_databases"] = entry.skipped_databases.clone();
            }
            continue;
        }
        let Some(stamp) = value["stamps"][field].as_str() else {
            cache.areas.remove(&key);
            continue;
        };
        let skipped = value["skipped"]
            .as_array()
            .map(|all| {
                all.iter()
                    .filter(|skip| skip["kind"] == kind)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();
        cache.areas.insert(
            key,
            Observed {
                stamp: stamp.to_owned(),
                payload: value[field].clone(),
                skipped,
                skipped_databases: if field == "indexed" {
                    value["skipped_databases"].clone()
                } else {
                    Value::Array(Vec::new())
                },
                at: now,
            },
        );
    }
}

pub(super) struct Captured {
    pub candidates: Vec<Candidate>,
    /// IndexedDB databases per origin that could not be exported locally.
    pub held_databases: BTreeMap<String, BTreeSet<String>>,
}

#[derive(Deserialize)]
struct PageSkip {
    kind: DataKind,
    reason: SkipReason,
    count: u32,
}

#[derive(Default)]
struct Slots {
    candidates: BTreeMap<String, Candidate>,
    held_databases: BTreeMap<String, BTreeSet<String>>,
}

impl Slots {
    fn previous(&self, area: &Area) -> Option<Value> {
        self.candidates
            .get(&Held::key(area))
            .and_then(|candidate| candidate.previous.clone())
    }
    fn set(&mut self, area: Area, fresh: Option<Value>) {
        let previous = self.previous(&area);
        self.candidates.insert(
            Held::key(&area),
            Candidate {
                area,
                fresh,
                previous,
            },
        );
    }

    /// One page's report: session storage for its tab, plus local storage and
    /// IndexedDB the first time its origin is seen in this capture.
    fn absorb(
        &mut self,
        value: &Value,
        origin: &str,
        tab_id: Option<String>,
        first: bool,
        coverage: &mut Coverage,
    ) {
        let host = site(origin);
        let skips: Vec<PageSkip> =
            serde_json::from_value(value["skipped"].clone()).unwrap_or_default();
        for skip in skips
            .into_iter()
            .filter(|skip| first || skip.kind == DataKind::SessionStorage)
        {
            coverage.skipped(&host, skip.kind, skip.reason, skip.count);
        }
        let mut fields = vec![];
        if let Some(tab_id) = tab_id {
            fields.push((
                Area::SessionStorage {
                    origin: origin.into(),
                    tab_id,
                },
                "session",
            ));
        }
        if first {
            fields.push((
                Area::LocalStorage {
                    origin: origin.into(),
                },
                "local",
            ));
            fields.push((
                Area::IndexedDb {
                    origin: origin.into(),
                },
                "indexed",
            ));
        }
        for (area, field) in fields {
            let mut payload = value[field].clone();
            // Skipped by the page and reported above: its synced copy stands in.
            if payload.is_null() {
                self.set(area, None);
                continue;
            }
            if field == "indexed" {
                let skipped =
                    serde_json::from_value(value["skipped_databases"].clone()).unwrap_or_default();
                let held = carry_databases(&mut payload, self.previous(&area).as_ref(), &skipped);
                if !held.is_empty() {
                    self.held_databases.insert(origin.into(), held);
                }
            }
            // A fixed valid profile is sufficient to canonicalize this area key.
            if area.key(&"a".repeat(64)).is_err() || area.validate_payload(&payload).is_err() {
                if let Some((host, kind)) = area_site(&area) {
                    coverage.skipped(&host, kind, SkipReason::Malformed, 1);
                }
                self.set(area, None);
                continue;
            }
            self.set(area, Some(payload));
        }
    }
}

fn unreadable(origin: &str, first: bool, coverage: &mut Coverage) {
    let host = site(origin);
    coverage.skipped(&host, DataKind::SessionStorage, SkipReason::Unreadable, 1);
    if first {
        coverage.skipped(&host, DataKind::LocalStorage, SkipReason::Unreadable, 1);
        coverage.skipped(&host, DataKind::IndexedDb, SkipReason::Unreadable, 1);
    }
}

pub(super) async fn capture(
    app: &tauri::AppHandle,
    physical: &str,
    previous: &[CredentialRecord],
    extra: Option<(Webview, Vec<String>)>,
    coverage: &mut Coverage,
) -> Result<Captured, String> {
    // Keep already captured, closed origins in the complete observation. They
    // cannot be mistaken for deletions merely because their tab isn't mounted.
    let mut slots = Slots::default();
    for record in previous
        .iter()
        .filter(|record| !matches!(record.area, Area::Cookies))
    {
        slots.candidates.insert(
            Held::key(&record.area),
            Candidate {
                area: record.area.clone(),
                fresh: Some(record.payload.clone()),
                previous: Some(record.payload.clone()),
            },
        );
    }
    let mut origins = BTreeSet::new();
    let mut live_keys = BTreeSet::new();
    for (tab_id, view) in super::browser::sync_storage_views(app, physical)? {
        let Ok(url) = view.url() else { continue };
        if !matches!(url.scheme(), "http" | "https") {
            continue;
        }
        let origin = url.origin().ascii_serialization();
        // Local storage and IndexedDB are per origin: read them from one tab.
        let first = origins.insert(origin.clone());
        let now = Instant::now();
        let (read, known) = {
            let mut cache = observed()
                .lock()
                .map_err(|_| "Website storage cache is unavailable")?;
            if cache.physical != physical {
                *cache = ObservedCache {
                    physical: physical.into(),
                    ..Default::default()
                };
            }
            read_request(&cache, &origin, Some(&tab_id), first, now)
        };
        for (field, _) in FIELDS {
            if field == "session" || first {
                live_keys.insert(cache_key(&origin, field, Some(&tab_id)));
            }
        }
        match evaluate_read(&view, physical, &origin, read, known).await {
            Ok(mut value) => {
                if let Ok(mut cache) = observed().lock() {
                    if cache.physical == physical {
                        merge_observed(&mut cache, &mut value, &origin, Some(&tab_id), now);
                    }
                }
                slots.absorb(&value, &origin, Some(tab_id), first, coverage)
            }
            Err(error) if error == PROFILE_UNVERIFIED => return Err(error),
            // Navigation or a busy page: its last synced copy stays; retried next pass.
            Err(_) => unreadable(&origin, first, coverage),
        }
    }
    // Forget pages that closed, so the cache stays bounded by what is open.
    if let Ok(mut cache) = observed().lock() {
        if cache.physical == physical {
            cache.areas.retain(|key, _| live_keys.contains(key));
        }
    }
    if let Some((owner, extra)) = extra {
        let mut storage = WebsiteStorage::new(owner, physical.into());
        for origin in extra {
            if !origins.insert(origin.clone()) {
                continue;
            }
            let value = match storage.origin_view(&origin).await {
                Ok(view) => evaluate(view, physical, &origin, None).await,
                Err(error) => Err(error),
            };
            match value {
                Ok(value) => slots.absorb(&value, &origin, None, true, coverage),
                Err(error) if error == PROFILE_UNVERIFIED => return Err(error),
                Err(_) => unreadable(&origin, true, coverage),
            }
        }
    }
    Ok(Captured {
        candidates: slots.candidates.into_values().collect(),
        held_databases: slots.held_databases,
    })
}

#[cfg(test)]
mod observed_tests {
    use super::*;

    const ORIGIN: &str = "https://mail.example.test";

    fn exported() -> Value {
        json!({
            "origin": ORIGIN,
            "local": {"theme": "dark"},
            "session": {"draft": "1"},
            "indexed": {"codec_version": 1, "databases": [{"name": "cache", "version": 1, "stores": []}]},
            "skipped": [{"kind": "indexed_db", "reason": "too_large", "count": 1}],
            "skipped_databases": ["huge"],
            "unchanged": [],
            "stamps": {"local": "l1", "session": "s1", "indexed": "i1"}
        })
    }

    #[test]
    fn a_second_tab_of_an_origin_reads_only_its_own_session_storage() {
        let cache = ObservedCache::default();
        let now = Instant::now();
        let (read, _) = read_request(&cache, ORIGIN, Some("tab-1"), true, now);
        assert_eq!(
            read,
            json!({"local": true, "session": true, "indexed": true})
        );
        let (read, _) = read_request(&cache, ORIGIN, Some("tab-2"), false, now);
        assert_eq!(
            read,
            json!({"local": false, "session": true, "indexed": false})
        );
    }

    #[test]
    fn unchanged_storage_is_restored_from_the_last_export_instead_of_re_exported() {
        let mut cache = ObservedCache::default();
        let now = Instant::now();
        let mut first = exported();
        merge_observed(&mut cache, &mut first, ORIGIN, Some("tab-1"), now);
        // The next pass offers the stamps it holds...
        let (_, known) = read_request(&cache, ORIGIN, Some("tab-1"), true, now);
        assert_eq!(
            known,
            json!({"local": "l1", "session": "s1", "indexed": "i1"})
        );
        // ...and a page that reports everything unchanged sends no data.
        let mut report = json!({
            "origin": ORIGIN, "local": null, "session": null, "indexed": null,
            "skipped": [], "skipped_databases": [],
            "unchanged": ["local", "session", "indexed"],
            "stamps": {"local": "l1", "session": "s1", "indexed": "i1"}
        });
        merge_observed(&mut cache, &mut report, ORIGIN, Some("tab-1"), now);
        for field in [
            "local",
            "session",
            "indexed",
            "skipped",
            "skipped_databases",
        ] {
            assert_eq!(report[field], exported()[field], "{field}");
        }
    }

    #[test]
    fn indexed_db_is_fully_exported_again_after_a_bounded_interval() {
        let mut cache = ObservedCache::default();
        let then = Instant::now();
        merge_observed(&mut cache, &mut exported(), ORIGIN, Some("tab-1"), then);
        // Writes that change neither the database list nor the usage are
        // invisible to the stamp; a stale stamp is not offered, forcing export.
        let (_, known) = read_request(&cache, ORIGIN, Some("tab-1"), true, then + INDEXED_REFRESH);
        assert_eq!(known, json!({"local": "l1", "session": "s1"}));
        // A page without a usable stamp is never cached, so it always exports.
        let mut unstamped = exported();
        unstamped["stamps"]["indexed"] = Value::Null;
        merge_observed(&mut cache, &mut unstamped, ORIGIN, Some("tab-1"), then);
        let (_, known) = read_request(&cache, ORIGIN, Some("tab-1"), true, then);
        assert!(known.get("indexed").is_none());
    }
}
