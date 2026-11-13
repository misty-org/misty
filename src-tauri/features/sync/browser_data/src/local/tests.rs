use super::*;
use crate::document::entities::Kind;
use serde_json::json;

const P: &str = "profile-a";
const C: &str = "bookmarks";

fn store() -> (tempfile::TempDir, LocalStore, LocalKey) {
    let directory = tempfile::tempdir().unwrap();
    let key = LocalKey::generate();
    let store = LocalStore::open(&directory.path().join("records.sqlite"), &key).unwrap();
    (directory, store, key)
}

fn record(id: &str, title: &str) -> ViewRecord {
    ViewRecord {
        kind: Kind::OpenTab,
        id: id.into(),
        fields: serde_json::from_value(json!({ "title": title })).unwrap(),
    }
}

#[test]
fn records_survive_a_reopen_and_are_sealed_on_disk() {
    let (directory, mut store, key) = store();
    store
        .write(P, C, vec![("a".into(), Some(record("a", "secret title")))])
        .unwrap();
    drop(store);
    let path = directory.path().join("records.sqlite");
    let raw = Connection::open(&path).unwrap();
    let sealed: Vec<u8> = raw
        .query_row("SELECT sealed FROM records", [], |r| r.get(0))
        .unwrap();
    assert!(!sealed.windows(6).any(|window| window == b"secret"));
    drop(raw);
    let reopened = LocalStore::open(&path, &key).unwrap();
    assert_eq!(reopened.list(P, C).unwrap().len(), 1);
    assert!(LocalStore::open(&path, &LocalKey::generate())
        .unwrap()
        .list(P, C)
        .unwrap()
        .is_empty());
}

#[test]
fn a_row_moved_to_another_id_or_profile_fails_to_open() {
    let (_directory, mut store, _key) = store();
    store
        .write(P, C, vec![("a".into(), Some(record("a", "x")))])
        .unwrap();
    store
        .connection
        .execute("UPDATE records SET profile = 'other'", [])
        .unwrap();
    assert!(store.list("other", C).unwrap().is_empty());
    assert!(store.get("other", C, "a").is_err());
}

#[test]
fn profiles_and_collections_are_separate() {
    let (_directory, mut store, _key) = store();
    store
        .write(P, C, vec![("a".into(), Some(record("a", "x")))])
        .unwrap();
    assert!(store.list("profile-b", C).unwrap().is_empty());
    assert!(store.list(P, "passwords").unwrap().is_empty());
}

#[test]
fn writing_the_same_record_changes_nothing() {
    let (_directory, mut store, _key) = store();
    assert_eq!(
        store
            .write(P, C, vec![("a".into(), Some(record("a", "x")))])
            .unwrap(),
        1
    );
    assert_eq!(
        store
            .write(P, C, vec![("a".into(), Some(record("a", "x")))])
            .unwrap(),
        0
    );
}

#[test]
fn a_deletion_removes_the_record() {
    let (_directory, mut store, _key) = store();
    store
        .write(P, C, vec![("a".into(), Some(record("a", "x")))])
        .unwrap();
    store.write(P, C, vec![("a".into(), None)]).unwrap();
    assert!(store.get(P, C, "a").unwrap().is_none());
    assert!(store.deleted_ids(P, C).unwrap().is_empty());
}

#[test]
fn a_row_this_version_cannot_read_is_kept_not_lost() {
    let (_directory, mut store, _key) = store();
    let future = br#"{"kind":"from_the_future","id":"z","fields":{}}"#;
    store.write_one(P, C, "z", Some(future)).unwrap();
    store
        .write(P, C, vec![("a".into(), Some(record("a", "x")))])
        .unwrap();
    assert_eq!(store.list(P, C).unwrap().len(), 1);
    assert!(store.get(P, C, "z").is_err());
}

#[test]
fn a_crash_halfway_through_a_page_leaves_everything_as_it_was() {
    let (_directory, mut store, _key) = store();
    let body = serde_json::to_vec(&record("a", "x")).unwrap();
    let result: Result<()> = store.atomic(|store| {
        store.write_one(P, C, "a", Some(&body))?;
        store.set_meta("cursor", "9")?;
        Err(Error::Invalid)
    });
    assert!(result.is_err());
    assert!(store.list(P, C).unwrap().is_empty());
    assert_eq!(store.meta("cursor").unwrap(), None);
}

#[test]
fn an_old_deletion_is_forgotten_once_settled() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("records.db");
    let key = LocalKey::generate();
    {
        let mut store = LocalStore::open(&path, &key).unwrap();
        for id in ["old", "unsent", "recent"] {
            store.write_one("p", "tabs", id, Some(b"tab")).unwrap();
            store
                .connection
                .execute("UPDATE records SET version = 1 WHERE id = ?1", [id])
                .unwrap();
            store.write_one("p", "tabs", id, None).unwrap();
        }
        store
            .connection
            .execute(
                "UPDATE records SET dirty = 0, edited_at = 1 WHERE id = 'old'",
                [],
            )
            .unwrap();
        store
            .connection
            .execute("UPDATE records SET edited_at = 1 WHERE id = 'unsent'", [])
            .unwrap();
        store
            .connection
            .execute("UPDATE records SET dirty = 0 WHERE id = 'recent'", [])
            .unwrap();
    }
    let store = LocalStore::open(&path, &key).unwrap();
    let mut left = store.deleted_ids("p", "tabs").unwrap();
    left.sort();
    assert_eq!(left, ["recent", "unsent"]);
}
