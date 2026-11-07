use rusqlite::Connection;

use super::events::{self, MemoryEvent, MemoryQuery};
use super::forget::{self, Forget};
use super::index::{self, EmbeddedChunk};
use super::prefs::{self, Remember};
use super::search::DIMENSIONS;
use super::{export, MemoryError, BACKLOG_CAP};
use crate::infra::store::Store;

pub(super) const NOW: i64 = 1_800_000_000_000;
pub(super) const LATER: i64 = NOW + 2 * super::HOUR_MS;

pub(super) fn database() -> (tempfile::TempDir, Connection) {
    let directory = tempfile::tempdir().unwrap();
    let connection = Store::at(directory.path().join("misty.db")).connect().unwrap();
    (directory, connection)
}

pub(super) fn page(url: &str, simhash: &str) -> MemoryEvent {
    MemoryEvent {
        kind: "page".into(),
        url: url.into(),
        title: "A page".into(),
        body: "What the page said.".into(),
        simhash: simhash.into(),
        occurred_at: super::rfc3339(NOW),
        ..MemoryEvent::default()
    }
}

pub(super) fn keep(connection: &mut Connection, event: MemoryEvent) -> MemoryEvent {
    events::record(connection, "me", event, BACKLOG_CAP, NOW).unwrap()
}

pub(super) fn all_in(connection: &Connection, account: &str, space: &str) -> Vec<MemoryEvent> {
    let query = MemoryQuery { space_id: space.into(), limit: 200, ..MemoryQuery::default() };
    events::list(connection, account, &query, LATER).unwrap()
}

/// A unit vector along one axis, with a little of the next so vectors aren't all orthogonal.
pub(super) fn axis(position: usize) -> Vec<f32> {
    let mut vector = vec![0.0; DIMENSIONS];
    vector[position] = 1.0;
    vector[position + 1] = 0.1;
    vector
}

pub(super) fn embed_all(connection: &mut Connection, account: &str, vector: &[f32]) {
    let claimed = index::claim(connection, account, 100, LATER).unwrap();
    let chunks: Vec<EmbeddedChunk> = claimed
        .into_iter()
        .map(|chunk| EmbeddedChunk { key: chunk.key, vector: vector.to_vec() })
        .collect();
    index::complete(connection, account, "model", &chunks).unwrap();
}

const A: &str = "0000000000000000";

#[test]
fn a_page_keeps_its_text_site_and_time() {
    let (_directory, mut connection) = database();
    let saved = keep(&mut connection, page("https://www.Example.com/a", A));
    assert_eq!(saved.site, "example.com");
    let listed = all_in(&connection, "me", "");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, saved.id);
    assert_eq!(listed[0].body, "What the page said.");
    assert_eq!(listed[0].occurred_at, super::rfc3339(NOW));
}

#[test]
fn what_cant_be_kept_is_refused() {
    let (_directory, mut connection) = database();
    let refused = |connection: &mut Connection, event: MemoryEvent| {
        events::record(connection, "me", event, BACKLOG_CAP, NOW).unwrap_err()
    };
    let invalid = MemoryError::Invalid("invalid_memory_event");
    assert_eq!(refused(&mut connection, page("ftp://example.com/", A)), invalid);
    assert_eq!(refused(&mut connection, page("https://example.com/", "xyz")), invalid);
    let mut long = page("https://example.com/", A);
    long.body = "x".repeat(20_001);
    assert_eq!(refused(&mut connection, long), invalid);
    let mut kind = page("https://example.com/", A);
    kind.kind = "dream".into();
    assert_eq!(refused(&mut connection, kind), invalid);
    let mut space = page("https://example.com/", A);
    space.space_id = "../other".into();
    assert_eq!(
        refused(&mut connection, space),
        MemoryError::Invalid("memory_space_not_found")
    );
}

#[test]
fn a_time_in_the_future_becomes_now() {
    let (_directory, mut connection) = database();
    let mut event = page("https://example.com/", A);
    event.occurred_at = super::rfc3339(NOW + 10 * 60_000);
    assert_eq!(keep(&mut connection, event).occurred_at, super::rfc3339(NOW));
}

#[test]
fn a_revisit_within_six_bits_points_at_the_visit_holding_the_text() {
    let (_directory, mut connection) = database();
    let first = keep(&mut connection, page("https://example.com/", A));
    let six_bits = "000000000000003f";
    let second = keep(&mut connection, page("https://example.com/", six_bits));
    assert_eq!(second.same_as, first.id);
    assert_eq!(second.body, "");
    let listed = all_in(&connection, "me", "");
    assert!(listed.iter().all(|event| event.body == "What the page said."));
    let seven_bits = "000000000000007f";
    let third = keep(&mut connection, page("https://example.com/", seven_bits));
    assert_eq!(third.same_as, "");
    assert_eq!(third.body, "What the page said.");
    // Another page, or the same page in another Space, is never the same visit.
    let other = keep(&mut connection, page("https://example.com/other", A));
    assert_eq!(other.same_as, "");
    let mut elsewhere = page("https://example.com/", A);
    elsewhere.space_id = "work".into();
    assert_eq!(keep(&mut connection, elsewhere).same_as, "");
}

#[test]
fn each_account_and_space_sees_only_its_own() {
    let (_directory, mut connection) = database();
    keep(&mut connection, page("https://personal.example/", A));
    let mut work = page("https://work.example/", A);
    work.space_id = "work".into();
    let work = keep(&mut connection, work);
    events::record(&mut connection, "other", page("https://theirs.example/", A), BACKLOG_CAP, NOW).unwrap();
    assert_eq!(all_in(&connection, "me", "").len(), 1);
    let in_work = all_in(&connection, "me", "work");
    assert_eq!(in_work.len(), 1);
    assert_eq!(in_work[0].id, work.id);
    assert_eq!(all_in(&connection, "other", "work").len(), 0);
    assert_eq!(all_in(&connection, "other", "").len(), 1);
    // Forgetting everything in one Space leaves the others.
    let everything = Forget { all: true, ..Forget::default() };
    assert_eq!(forget::moments(&connection, "me", &everything, NOW, false).unwrap(), 1);
    assert_eq!(all_in(&connection, "me", "work").len(), 1);
    assert_eq!(all_in(&connection, "other", "").len(), 1);
}

fn at(connection: &mut Connection, url: &str, time: i64) {
    let mut event = page(url, "");
    event.occurred_at = super::rfc3339(time);
    keep(connection, event);
}

#[test]
fn forgetting_the_last_hour_today_everything_and_a_site() {
    let (_directory, mut connection) = database();
    let hour = super::HOUR_MS;
    at(&mut connection, "https://old.example/", NOW - 30 * hour);
    at(&mut connection, "https://today.example/", NOW - 5 * hour);
    at(&mut connection, "https://recent.example/", NOW - hour / 2);
    at(&mut connection, "https://sub.site.example/", NOW - 40 * hour);
    at(&mut connection, "https://site.example/", NOW - 40 * hour);
    at(&mut connection, "https://notsite.example/", NOW - 40 * hour);
    let last_hour = Forget { from: Some(NOW - hour), to: Some(NOW), ..Forget::default() };
    assert_eq!(forget::count_moments(&connection, "me", &last_hour).unwrap(), 1);
    assert_eq!(all_in(&connection, "me", "").len(), 6);
    assert_eq!(forget::moments(&connection, "me", &last_hour, NOW, false).unwrap(), 1);
    let today = Forget { from: Some(NOW - 24 * hour), to: Some(NOW), ..Forget::default() };
    assert_eq!(forget::moments(&connection, "me", &today, NOW, false).unwrap(), 1);
    let site = Forget { site: "site.example".into(), ..Forget::default() };
    assert_eq!(forget::moments(&connection, "me", &site, NOW, false).unwrap(), 2);
    let left: Vec<String> = all_in(&connection, "me", "").into_iter().map(|e| e.site).collect();
    assert_eq!(left.len(), 2);
    assert!(left.contains(&"notsite.example".to_owned()));
    let everything = Forget { all: true, ..Forget::default() };
    assert_eq!(forget::moments(&connection, "me", &everything, NOW, false).unwrap(), 2);
    let chunks: i64 = connection
        .query_row("SELECT count(*) FROM memory_chunks", [], |row| row.get(0))
        .unwrap();
    assert_eq!(chunks, 0);
}

#[test]
fn forgetting_needs_something_to_forget() {
    let (_directory, connection) = database();
    let invalid = MemoryError::Invalid("invalid_forget");
    let nothing = Forget::default();
    assert_eq!(forget::moments(&connection, "me", &nothing, NOW, false).unwrap_err(), invalid);
    let backwards = Forget { from: Some(NOW), to: Some(NOW - 1), ..Forget::default() };
    assert_eq!(forget::moments(&connection, "me", &backwards, NOW, false).unwrap_err(), invalid);
    let half = Forget { from: Some(NOW), ..Forget::default() };
    assert_eq!(forget::moments(&connection, "me", &half, NOW, false).unwrap_err(), invalid);
}

#[test]
fn forgetting_a_visit_gives_its_text_to_a_later_revisit() {
    let (_directory, mut connection) = database();
    let holder = keep(&mut connection, page("https://example.com/", A));
    let revisit = keep(&mut connection, page("https://example.com/", A));
    let only_holder = Forget { ids: vec![holder.id.clone()], ..Forget::default() };
    forget::moments(&connection, "me", &only_holder, NOW, false).unwrap();
    let left = all_in(&connection, "me", "");
    assert_eq!(left.len(), 1);
    assert_eq!(left[0].id, revisit.id);
    assert_eq!(left[0].same_as, "");
    assert_eq!(left[0].body, "What the page said.");
    // It holds the text now, so search needs it.
    let chunks: i64 = connection
        .query_row(
            "SELECT count(*) FROM memory_chunks WHERE record_id = ?1",
            [&revisit.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(chunks, 1);
}

#[test]
fn the_export_holds_every_space_and_a_page_per_day() {
    let (_directory, mut connection) = database();
    keep(&mut connection, page("https://example.com/", A));
    let mut work = page("https://work.example/", A);
    work.space_id = "work".into();
    keep(&mut connection, work);
    let fact = Remember {
        kind: "fact".into(),
        content: "Tea, no sugar".into(),
        ..Remember::default()
    };
    prefs::remember(&mut connection, "me", fact, NOW).unwrap();
    let bytes = export::zip_all(&connection, "me").unwrap();
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    let mut read = |name: &str| {
        let mut file = archive.by_name(name).unwrap();
        let mut text = String::new();
        std::io::Read::read_to_string(&mut file, &mut text).unwrap();
        text
    };
    let lines = read("memory.jsonl");
    assert_eq!(lines.lines().count(), 2);
    assert!(lines.contains("work.example"));
    assert!(read("facts.jsonl").contains("Tea, no sugar"));
    let day = chrono::DateTime::from_timestamp_millis(NOW).unwrap().format("%Y-%m-%d");
    assert!(read(&format!("days/{day}.md")).contains("A page — https://example.com/"));
}
