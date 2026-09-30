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

// sessionStorage belongs to one tab and holds no lasting sign-in; not read.
const FIELDS: [(&str, &str); 2] = [("local", "local_storage"), ("indexed", "indexed_db")];

fn cache_key(origin: &str, field: &str) -> String {
    format!("{origin}\u{0}{field}")
}

/// The request for one page: which areas to read and the stamps already held.
fn read_request(cache: &ObservedCache, origin: &str, now: Instant) -> (Value, Value) {
    let read = json!({"local": true, "session": false, "indexed": true});
    let mut known = serde_json::Map::new();
    for (field, _) in FIELDS {
        if let Some(entry) = cache.areas.get(&cache_key(origin, field)) {
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
fn merge_observed(cache: &mut ObservedCache, value: &mut Value, origin: &str, now: Instant) {
    let unchanged: BTreeSet<String> =
        serde_json::from_value(value["unchanged"].clone()).unwrap_or_default();
    for (field, kind) in FIELDS {
        let key = cache_key(origin, field);
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

    /// One origin's report: its local storage and IndexedDB.
    fn absorb(&mut self, value: &Value, origin: &str, coverage: &mut Coverage) {
        let host = site(origin);
        let skips: Vec<PageSkip> =
            serde_json::from_value(value["skipped"].clone()).unwrap_or_default();
        for skip in skips {
            coverage.skipped(&host, skip.kind, skip.reason, skip.count);
        }
        let fields = [
            (Area::LocalStorage { origin: origin.into() }, "local"),
            (Area::IndexedDb { origin: origin.into() }, "indexed"),
        ];
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

fn unreadable(origin: &str, coverage: &mut Coverage) {
    let host = site(origin);
    coverage.skipped(&host, DataKind::LocalStorage, SkipReason::Unreadable, 1);
    coverage.skipped(&host, DataKind::IndexedDb, SkipReason::Unreadable, 1);
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
    for record in previous.iter().filter(|record| {
        !matches!(record.area, Area::Cookies | Area::SessionStorage { .. })
    }) {
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
    for (_, view) in super::browser::sync_storage_views(app, physical)? {
        let Ok(url) = view.url() else { continue };
        if !matches!(url.scheme(), "http" | "https") {
            continue;
        }
        let origin = url.origin().ascii_serialization();
        // Local storage and IndexedDB are per origin: read them from one tab.
        if !origins.insert(origin.clone()) {
            continue;
        }
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
            read_request(&cache, &origin, now)
        };
        for (field, _) in FIELDS {
            live_keys.insert(cache_key(&origin, field));
        }
        match evaluate_read(&view, physical, &origin, read, known).await {
            Ok(mut value) => {
                if let Ok(mut cache) = observed().lock() {
                    if cache.physical == physical {
                        merge_observed(&mut cache, &mut value, &origin, now);
                    }
                }
                slots.absorb(&value, &origin, coverage)
            }
            Err(error) if error == PROFILE_UNVERIFIED => return Err(error),
            // Navigation or a busy page: its last synced copy stays; retried next pass.
            Err(_) => unreadable(&origin, coverage),
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
                Ok(value) => slots.absorb(&value, &origin, coverage),
                Err(error) if error == PROFILE_UNVERIFIED => return Err(error),
                Err(_) => unreadable(&origin, coverage),
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
            "indexed": {"codec_version": 1, "databases": [{"name": "cache", "version": 1, "stores": []}]},
            "skipped": [{"kind": "indexed_db", "reason": "too_large", "count": 1}],
            "skipped_databases": ["huge"],
            "unchanged": [],
            "stamps": {"local": "l1", "indexed": "i1"}
        })
    }

    #[test]
    fn session_storage_is_never_read() {
        let (read, _) = read_request(&ObservedCache::default(), ORIGIN, Instant::now());
        assert_eq!(
            read,
            json!({"local": true, "session": false, "indexed": true})
        );
    }

    #[test]
    fn unchanged_storage_is_restored_from_the_last_export_instead_of_re_exported() {
        let mut cache = ObservedCache::default();
        let now = Instant::now();
        let mut first = exported();
        merge_observed(&mut cache, &mut first, ORIGIN, now);
        // The next pass offers the stamps it holds...
        let (_, known) = read_request(&cache, ORIGIN, now);
        assert_eq!(
            known,
            json!({"local": "l1", "indexed": "i1"})
        );
        // ...and a page that reports everything unchanged sends no data.
        let mut report = json!({
            "origin": ORIGIN, "local": null, "indexed": null,
            "skipped": [], "skipped_databases": [],
            "unchanged": ["local", "indexed"],
            "stamps": {"local": "l1", "indexed": "i1"}
        });
        merge_observed(&mut cache, &mut report, ORIGIN, now);
        for field in ["local", "indexed", "skipped", "skipped_databases"] {
            assert_eq!(report[field], exported()[field], "{field}");
        }
    }

    #[test]
    fn indexed_db_is_fully_exported_again_after_a_bounded_interval() {
        let mut cache = ObservedCache::default();
        let then = Instant::now();
        merge_observed(&mut cache, &mut exported(), ORIGIN, then);
        // Writes that change neither the database list nor the usage are
        // invisible to the stamp; a stale stamp is not offered, forcing export.
        let (_, known) = read_request(&cache, ORIGIN, then + INDEXED_REFRESH);
        assert_eq!(known, json!({"local": "l1"}));
        // A page without a usable stamp is never cached, so it always exports.
        let mut unstamped = exported();
        unstamped["stamps"]["indexed"] = Value::Null;
        merge_observed(&mut cache, &mut unstamped, ORIGIN, then);
        let (_, known) = read_request(&cache, ORIGIN, then);
        assert!(known.get("indexed").is_none());
    }
}
