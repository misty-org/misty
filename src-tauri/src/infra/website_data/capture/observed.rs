//! The last export of each origin's storage areas, so unchanged areas are not exported again.
use super::*;

/// Writes that change neither an origin's database list nor its storage usage
/// are invisible to the IndexedDB stamp; a full export still runs this often.
pub(super) const INDEXED_REFRESH: Duration = Duration::from_secs(20);

/// One area as last exported by a page: its stamp and what it reported.
#[derive(Clone)]
pub(super) struct Observed {
    pub(super) stamp: String,
    pub(super) payload: Value,
    pub(super) skipped: Vec<Value>,
    pub(super) skipped_databases: Value,
    pub(super) at: Instant,
}

/// Last export per origin area, for one browser profile. Lets periodic
/// capture skip re-exporting and re-parsing storage that has not changed.
#[derive(Default)]
pub(super) struct ObservedCache {
    pub(super) physical: String,
    pub(super) areas: HashMap<String, Observed>,
}

pub(super) fn observed() -> &'static Mutex<ObservedCache> {
    static CACHE: OnceLock<Mutex<ObservedCache>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

// sessionStorage belongs to one tab and holds no lasting sign-in; not read.
pub(super) const FIELDS: [(&str, &str); 2] = [("local", "local_storage"), ("indexed", "indexed_db")];

pub(super) fn cache_key(origin: &str, field: &str) -> String {
    format!("{origin}\u{0}{field}")
}

/// The request for one page: which areas to read and the stamps already held.
pub(super) fn read_request(cache: &ObservedCache, origin: &str, now: Instant) -> (Value, Value) {
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
pub(super) fn merge_observed(cache: &mut ObservedCache, value: &mut Value, origin: &str, now: Instant) {
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
