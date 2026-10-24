use super::*;

fn library() -> Connection {
    let connection = Connection::open_in_memory().unwrap();
    connection
            .execute_batch(
                "CREATE TABLE visits (id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id TEXT NOT NULL,
                   url TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', visited_at INTEGER NOT NULL,
                   typed INTEGER NOT NULL DEFAULT 0, origin TEXT NOT NULL DEFAULT '', changed INTEGER NOT NULL DEFAULT 1);
                 CREATE TABLE history_dirty (origin TEXT NOT NULL, hour INTEGER NOT NULL, PRIMARY KEY (origin, hour));",
            )
            .unwrap();
    connection
}

fn visit(connection: &Connection, url: &str, at: i64) {
    connection
        .execute(
            "INSERT INTO visits (profile_id, url, title, visited_at) VALUES ('p', ?1, 'T', ?2)",
            params![url, at],
        )
        .unwrap();
}

fn urls(connection: &Connection) -> Vec<(String, String)> {
    let mut s = connection
        .prepare("SELECT origin, url FROM visits ORDER BY origin, url")
        .unwrap();
    s.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

#[test]
fn visits_travel_as_hourly_batches_and_merge_on_other_devices() {
    let now = super::super::super::browser_library::now_ms();
    let a = library();
    visit(&a, "https://one.test/", now);
    visit(&a, "https://two.test/", now);
    let (writes, hours) = uploads(&a, "device-a", "p", &[]).unwrap();
    assert_eq!(writes.len(), 1);
    uploaded(&a, "p", &writes, &hours).unwrap();
    // Nothing left to send until something changes.
    assert!(uploads(&a, "device-a", "p", &[]).unwrap().0.is_empty());

    let batches: Vec<ViewRecord> = writes.into_iter().filter_map(|(_, r)| r).collect();
    let b = library();
    merge(&b, "device-b", "p", &batches).unwrap();
    assert_eq!(
        urls(&b),
        [
            ("device-a".to_string(), "https://one.test/".to_string()),
            ("device-a".to_string(), "https://two.test/".to_string()),
        ]
    );
    // Merging again changes nothing.
    merge(&b, "device-b", "p", &batches).unwrap();
    assert_eq!(urls(&b).len(), 2);
}

#[test]
fn a_visit_deleted_on_another_device_leaves_every_device() {
    let now = super::super::super::browser_library::now_ms();
    let a = library();
    visit(&a, "https://one.test/", now);
    visit(&a, "https://two.test/", now);
    let (writes, hours) = uploads(&a, "device-a", "p", &[]).unwrap();
    uploaded(&a, "p", &writes, &hours).unwrap();
    let batches: Vec<ViewRecord> = writes.into_iter().filter_map(|(_, r)| r).collect();

    // Device B deletes one of A's visits: it rewrites A's batch.
    let b = library();
    merge(&b, "device-b", "p", &batches).unwrap();
    b.execute(
            "INSERT INTO history_dirty SELECT origin, visited_at / 3600000 FROM visits WHERE url = 'https://one.test/'",
            [],
        )
        .unwrap();
    b.execute("DELETE FROM visits WHERE url = 'https://one.test/'", [])
        .unwrap();
    let (rewrite, _) = uploads(&b, "device-b", "p", &batches).unwrap();
    let rewritten: Vec<ViewRecord> = rewrite.into_iter().filter_map(|(_, r)| r).collect();
    assert_eq!(rewritten.len(), 1);
    assert_eq!(batch_of(&rewritten[0]).unwrap().0, "device-a");

    // A merges its own rewritten batch: the deleted visit goes there too.
    merge(&a, "device-a", "p", &rewritten).unwrap();
    assert_eq!(urls(&a), [(String::new(), "https://two.test/".to_string())]);
}

#[test]
fn an_unsynced_visit_survives_a_merge() {
    let now = super::super::super::browser_library::now_ms();
    let a = library();
    visit(&a, "https://new.test/", now);
    merge(&a, "device-a", "p", &[]).unwrap();
    assert_eq!(urls(&a).len(), 1);
}

#[test]
fn a_busy_hour_splits_into_parts() {
    let visits: Vec<Visit> = (0..3000)
        .map(|i| {
            (
                format!("https://site.test/{i}"),
                "Title".into(),
                7 * HOUR_MS + i,
                false,
            )
        })
        .collect();
    let written = parts("device-a", 7, &visits);
    assert!(written.len() > 1);
    let total: usize = written.iter().map(|r| visits_of(r).len()).sum();
    assert_eq!(total, 3000);
    for record in &written {
        misty_browser_sync::document::entities::validate(Kind::HistoryBatch, &record.fields)
            .unwrap();
    }
}
