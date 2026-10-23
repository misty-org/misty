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
    assert_eq!(known, json!({"local": "l1", "indexed": "i1"}));
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
