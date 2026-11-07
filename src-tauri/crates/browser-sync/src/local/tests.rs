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
        kind: Kind::Bookmark,
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
    store.accepted(P, C, "a", store.clock, 1).unwrap();
    assert_eq!(
        store
            .write(P, C, vec![("a".into(), Some(record("a", "x")))])
            .unwrap(),
        0
    );
    assert_eq!(store.totals().unwrap().waiting, 0);
}

#[test]
fn deleting_what_the_server_never_had_sends_nothing() {
    let (_directory, mut store, _key) = store();
    store
        .write(P, C, vec![("a".into(), Some(record("a", "x")))])
        .unwrap();
    store.write(P, C, vec![("a".into(), None)]).unwrap();
    assert!(store.dirty(10).unwrap().is_empty());
}

#[test]
fn deleting_what_the_server_has_goes_out_as_a_deletion() {
    let (_directory, mut store, _key) = store();
    store
        .write(P, C, vec![("a".into(), Some(record("a", "x")))])
        .unwrap();
    let edit = store.dirty(1).unwrap()[0].edited_at;
    store.accepted(P, C, "a", edit, 3).unwrap();
    store.write(P, C, vec![("a".into(), None)]).unwrap();
    let dirty = store.dirty(1).unwrap();
    assert!(dirty[0].plaintext.is_none());
    assert_eq!(dirty[0].version, 3);
    assert!(store.list(P, C).unwrap().is_empty());
}

#[test]
fn an_edit_made_while_a_write_was_in_flight_stays_dirty() {
    let (_directory, mut store, _key) = store();
    store
        .write(P, C, vec![("a".into(), Some(record("a", "one")))])
        .unwrap();
    let sent = store.dirty(1).unwrap()[0].edited_at;
    store
        .write(P, C, vec![("a".into(), Some(record("a", "two")))])
        .unwrap();
    store.accepted(P, C, "a", sent, 1).unwrap();
    let dirty = store.dirty(1).unwrap();
    assert_eq!(dirty.len(), 1);
    assert_eq!(dirty[0].version, 1);
}

#[test]
fn the_newer_edit_wins_in_both_directions() {
    let (_directory, mut store, _key) = store();
    store
        .write(P, C, vec![("a".into(), Some(record("a", "mine")))])
        .unwrap();
    let mine = store.dirty(1).unwrap()[0].edited_at;
    let theirs = serde_json::to_vec(&record("a", "theirs")).unwrap();
    assert_eq!(
        store
            .apply_remote(P, C, "a", 2, mine - 1, Some(&theirs))
            .unwrap(),
        Applied::KeptLocal
    );
    assert_eq!(store.dirty(1).unwrap()[0].version, 2);
    assert_eq!(
        store
            .apply_remote(P, C, "a", 3, mine + 1, Some(&theirs))
            .unwrap(),
        Applied::Replaced
    );
    assert!(store.dirty(1).unwrap().is_empty());
    assert_eq!(
        store.get(P, C, "a").unwrap().unwrap().fields["title"],
        json!("theirs")
    );
}

#[test]
fn a_server_cannot_roll_a_record_back() {
    let (_directory, mut store, _key) = store();
    let new = serde_json::to_vec(&record("a", "new")).unwrap();
    let old = serde_json::to_vec(&record("a", "old")).unwrap();
    store
        .apply_remote(P, C, "a", 5, 100, Some(&new))
        .unwrap();
    assert_eq!(
        store.apply_remote(P, C, "a", 4, 999, Some(&old)).unwrap(),
        Applied::Ignored
    );
    assert_eq!(
        store.apply_remote(P, C, "a", 5, 999, Some(&old)).unwrap(),
        Applied::Ignored
    );
    assert_eq!(
        store.get(P, C, "a").unwrap().unwrap().fields["title"],
        json!("new")
    );
}

#[test]
fn a_new_edit_is_ordered_after_what_was_received_even_with_a_slow_clock() {
    let (_directory, mut store, _key) = store();
    let future = now_ms() + 86_400_000;
    let theirs = serde_json::to_vec(&record("a", "theirs")).unwrap();
    store
        .apply_remote(P, C, "a", 1, future, Some(&theirs))
        .unwrap();
    store
        .write(P, C, vec![("a".into(), Some(record("a", "mine")))])
        .unwrap();
    assert!(store.dirty(1).unwrap()[0].edited_at > future);
}

#[test]
fn a_remote_deletion_removes_the_record() {
    let (_directory, mut store, _key) = store();
    let theirs = serde_json::to_vec(&record("a", "x")).unwrap();
    store.apply_remote(P, C, "a", 1, 10, Some(&theirs)).unwrap();
    store.apply_remote(P, C, "a", 2, 20, None).unwrap();
    assert!(store.list(P, C).unwrap().is_empty());
    assert!(store.get(P, C, "a").unwrap().is_none());
}

#[test]
fn a_row_this_version_cannot_read_is_kept_not_lost() {
    let (_directory, mut store, _key) = store();
    let future = br#"{"kind":"from_the_future","id":"z","fields":{}}"#;
    store.apply_remote(P, C, "z", 1, 10, Some(future)).unwrap();
    store
        .write(P, C, vec![("a".into(), Some(record("a", "x")))])
        .unwrap();
    assert_eq!(store.list(P, C).unwrap().len(), 1);
    assert_eq!(store.totals().unwrap().records, 2);
}

#[test]
fn leaving_a_vault_keeps_live_records_for_the_next_one() {
    let (_directory, mut store, _key) = store();
    store
        .write(P, C, vec![("a".into(), Some(record("a", "x")))])
        .unwrap();
    let edit = store.dirty(1).unwrap()[0].edited_at;
    store.accepted(P, C, "a", edit, 9).unwrap();
    let gone = serde_json::to_vec(&record("b", "y")).unwrap();
    store.apply_remote(P, C, "b", 1, 1, Some(&gone)).unwrap();
    store.apply_remote(P, C, "b", 2, 2, None).unwrap();
    store.set_meta("vault.cursor", "77").unwrap();
    store.unlink().unwrap();
    let dirty = store.dirty(10).unwrap();
    assert_eq!(dirty.len(), 1);
    assert_eq!(dirty[0].id, "a");
    assert_eq!(dirty[0].version, 0);
    assert_eq!(store.meta("vault.cursor").unwrap(), None);
    assert_eq!(store.list(P, C).unwrap().len(), 1);
}

#[test]
fn removing_a_profile_leaves_the_others() {
    let (_directory, mut store, _key) = store();
    store
        .write(P, C, vec![("a".into(), Some(record("a", "x")))])
        .unwrap();
    store
        .write("profile-b", C, vec![("a".into(), Some(record("a", "y")))])
        .unwrap();
    store.remove_profile(P).unwrap();
    assert!(store.list(P, C).unwrap().is_empty());
    assert_eq!(store.list("profile-b", C).unwrap().len(), 1);
}

#[test]
fn a_crash_halfway_through_a_page_leaves_everything_as_it_was() {
    let (_directory, mut store, _key) = store();
    let body = serde_json::to_vec(&record("a", "x")).unwrap();
    let result: Result<()> = store.atomic(|store| {
        store.apply_remote(P, C, "a", 1, 10, Some(&body))?;
        store.set_meta("vault.cursor", "9")?;
        Err(Error::Invalid)
    });
    assert!(result.is_err());
    assert!(store.list(P, C).unwrap().is_empty());
    assert_eq!(store.meta("vault.cursor").unwrap(), None);
}

#[test]
fn traffic_adds_up_over_thirty_days_and_older_days_drop_off() {
    let (_directory, store, _key) = store();
    const DAY: u64 = 86_400_000;
    let today = 20_000 * DAY;
    store.add_traffic(today - 40 * DAY, 1_000, 1_000).unwrap();
    store.add_traffic(today - 29 * DAY, 10, 1).unwrap();
    store.add_traffic(today, 5, 2).unwrap();
    store.add_traffic(today, 5, 2).unwrap();
    assert_eq!(store.traffic(today).unwrap(), (20, 5));
    assert_eq!(store.meta(&format!("traffic.{}", 20_000 - 40)).unwrap(), None);
}

#[test]
fn a_secret_is_sealed_and_goes_when_the_vault_does() {
    let (_directory, mut store, _key) = store();
    store.set_secret("session-key", b"the key").unwrap();
    assert_eq!(
        store.secret("session-key").unwrap().unwrap().as_slice(),
        b"the key"
    );
    let raw = store.meta("secret.session-key").unwrap().unwrap();
    assert!(!raw.contains(&"the key".bytes().map(|b| format!("{b:02x}")).collect::<String>()));
    store.unlink().unwrap();
    assert!(store.secret("session-key").unwrap().is_none());
}

#[test]
fn erasing_a_profile_tells_the_server_about_what_it_has_seen() {
    let (_directory, mut store, _key) = store();
    store.write_one("gone", "tabs", "sent", Some(b"one")).unwrap();
    store.write_one("gone", "tabs", "unsent", Some(b"two")).unwrap();
    store.write_one("kept", "tabs", "other", Some(b"three")).unwrap();
    let pending = store.dirty(10).unwrap();
    let sent = pending.iter().find(|record| record.id == "sent").unwrap();
    store
        .accepted("gone", "tabs", "sent", sent.edited_at, 4)
        .unwrap();
    store.erase_profile("gone").unwrap();
    let left = store.dirty(10).unwrap();
    assert!(left.iter().any(|record| record.id == "sent" && record.plaintext.is_none()));
    assert!(!left.iter().any(|record| record.id == "unsent"));
    assert!(left.iter().any(|record| record.id == "other" && record.plaintext.is_some()));
    assert_eq!(store.deleted_ids("gone", "tabs").unwrap(), ["sent"]);
}

#[test]
fn a_deletion_is_forgotten_with_the_server_but_only_once_sent() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("records.db");
    let key = LocalKey::generate();
    {
        let mut store = LocalStore::open(&path, &key).unwrap();
        for id in ["old", "unsent", "recent"] {
            store.write_one("p", "tabs", id, Some(b"tab")).unwrap();
            store.connection.execute(
                "UPDATE records SET version = 1 WHERE id = ?1", [id],
            ).unwrap();
            store.write_one("p", "tabs", id, None).unwrap();
        }
        store.connection.execute(
            "UPDATE records SET dirty = 0, edited_at = 1 WHERE id = 'old'", [],
        ).unwrap();
        store.connection.execute(
            "UPDATE records SET edited_at = 1 WHERE id = 'unsent'", [],
        ).unwrap();
        store.connection.execute(
            "UPDATE records SET dirty = 0 WHERE id = 'recent'", [],
        ).unwrap();
    }
    let store = LocalStore::open(&path, &key).unwrap();
    let mut left = store.deleted_ids("p", "tabs").unwrap();
    left.sort();
    assert_eq!(left, ["recent", "unsent"]);
}

#[test]
fn the_inbox_lists_what_the_server_changed_until_it_is_taken() {
    use crate::collections::{BOOKMARKS, MEMORY};
    let directory = tempfile::tempdir().unwrap();
    let mut store = LocalStore::open(&directory.path().join("a.db"), &LocalKey::generate()).unwrap();
    store.apply_remote("", MEMORY, "one", 1, 10, Some(b"first")).unwrap();
    store.apply_remote("", MEMORY, "two", 2, 11, None).unwrap();
    store.apply_remote("", BOOKMARKS, "other", 3, 12, Some(b"{}")).unwrap();
    let mut listed = store.inbox("", MEMORY, 10).unwrap();
    listed.sort_by(|a, b| a.0.cmp(&b.0));
    assert_eq!(listed.len(), 2);
    assert_eq!(listed[0].0, "one");
    assert_eq!(listed[0].1.as_ref().unwrap().as_slice(), b"first");
    assert_eq!(listed[1].0, "two");
    assert!(listed[1].1.is_none());
    assert!(store.inbox("", BOOKMARKS, 10).unwrap().is_empty());
    store.inbox_done("", MEMORY, &["one".to_owned()]).unwrap();
    assert_eq!(store.inbox("", MEMORY, 10).unwrap().len(), 1);
    // A local edit isn't news, and a later change lists it again.
    store.write_one("", MEMORY, "mine", Some(b"here")).unwrap();
    assert_eq!(store.inbox("", MEMORY, 10).unwrap().len(), 1);
    store.apply_remote("", MEMORY, "one", 4, 20, Some(b"second")).unwrap();
    assert_eq!(store.inbox("", MEMORY, 10).unwrap().len(), 2);
}

#[test]
fn a_full_listing_that_drops_a_record_lists_it_as_deleted() {
    use crate::collections::MEMORY;
    let directory = tempfile::tempdir().unwrap();
    let mut store = LocalStore::open(&directory.path().join("a.db"), &LocalKey::generate()).unwrap();
    store.apply_remote("", MEMORY, "gone", 1, 10, Some(b"x")).unwrap();
    store.inbox_done("", MEMORY, &["gone".to_owned()]).unwrap();
    store.begin_full_listing().unwrap();
    store.finish_full_listing().unwrap();
    let listed = store.inbox("", MEMORY, 10).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].0, "gone");
    assert!(listed[0].1.is_none());
}

#[test]
fn memory_waits_with_history_for_the_slower_batch() {
    use crate::collections::{BOOKMARKS, HISTORY, MEMORY};
    let directory = tempfile::tempdir().unwrap();
    let mut store = LocalStore::open(&directory.path().join("a.db"), &LocalKey::generate()).unwrap();
    store.write_one("", MEMORY, "a", Some(b"x")).unwrap();
    store.write_one("", HISTORY, "b", Some(b"x")).unwrap();
    store.write_one("", BOOKMARKS, "c", Some(b"x")).unwrap();
    let now: Vec<String> = store.dirty_for_push(10, false).unwrap().into_iter().map(|row| row.collection).collect();
    assert_eq!(now, [BOOKMARKS]);
    let due = store.dirty_for_push(10, true).unwrap();
    assert_eq!(due[0].collection, BOOKMARKS);
    assert_eq!(due.len(), 3);
}
