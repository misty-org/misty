use browser_data::{
    collections::MEMORY,
    local::{LocalKey, LocalStore},
    vault::exchange::MAX_SEALED,
};
use rusqlite::Connection;

use super::forget::{self, Forget};
use super::index;
use super::prefs::{self, Remember};
use super::sync::{self, SyncBody, SYNC_PAGE_TEXT_BYTES};
use super::tests::{all_in, axis, database, embed_all, keep, page, LATER, NOW};
use super::{summaries, sync_apply};

struct Computer {
    _directory: tempfile::TempDir,
    connection: Connection,
    records: LocalStore,
}

fn computer() -> Computer {
    let (directory, connection) = database();
    let records =
        LocalStore::open(&directory.path().join("records.db"), &LocalKey::generate()).unwrap();
    Computer {
        _directory: directory,
        connection,
        records,
    }
}

/// One link pass here: rows into the record store, and what the server sends back taken in.
fn send(from: &mut Computer) {
    loop {
        let rows = sync::outgoing(&from.connection, "me", 50).unwrap();
        if rows.is_empty() {
            return;
        }
        for row in &rows {
            from.records
                .write_one("", MEMORY, &row.id, row.body.as_deref())
                .unwrap();
        }
        sync::sent(&mut from.connection, "me", &rows).unwrap();
    }
}

fn take_in(to: &mut Computer) {
    let incoming: Vec<(String, Option<Vec<u8>>)> = to
        .records
        .inbox("", MEMORY, 500)
        .unwrap()
        .into_iter()
        .map(|(id, body)| (id, body.map(|body| body.to_vec())))
        .collect();
    sync_apply::apply(&mut to.connection, "me", &incoming).unwrap();
    let ids: Vec<String> = incoming.into_iter().map(|(id, _)| id).collect();
    to.records.inbox_done("", MEMORY, &ids).unwrap();
}

/// The server, for two computers: what `from` waits to send arrives at `to`, sealed and all.
fn travel(from: &mut Computer, to: &mut Computer, version: &mut u64) {
    send(from);
    for row in from.records.dirty(1000).unwrap() {
        *version += 1;
        to.records
            .apply_remote(
                &row.profile,
                &row.collection,
                &row.id,
                *version,
                row.edited_at,
                row.plaintext.as_ref().map(|plain| plain.as_slice()),
            )
            .unwrap();
        from.records
            .accepted(
                &row.profile,
                &row.collection,
                &row.id,
                row.edited_at,
                *version,
            )
            .unwrap();
    }
    take_in(to);
}

fn remember(computer: &mut Computer, space: &str, content: &str) -> prefs::MemoryFact {
    let input = Remember {
        space_id: space.into(),
        kind: "fact".into(),
        content: content.into(),
        ..Remember::default()
    };
    prefs::remember(&mut computer.connection, "me", input, NOW).unwrap()
}

#[test]
fn moments_facts_and_summaries_travel_with_their_spaces() {
    let (mut a, mut b, mut version) = (computer(), computer(), 0);
    let personal = keep(&mut a.connection, page("https://personal.example/", ""));
    let mut work = page("https://work.example/", "");
    work.space_id = "work".into();
    let work = keep(&mut a.connection, work);
    let fact = remember(&mut a, "work", "Tea, no sugar");
    summaries::add_manual(&mut a.connection, "me", "", "My week", "It went well.", NOW).unwrap();
    travel(&mut a, &mut b, &mut version);

    let here = all_in(&b.connection, "me", "");
    assert_eq!(here.len(), 1);
    assert_eq!(here[0], personal);
    assert_eq!(all_in(&b.connection, "me", "work")[0], work);
    let facts = prefs::list(&b.connection, "me", "work", "", 0).unwrap();
    assert_eq!(facts[0].id, fact.id);
    assert_eq!(facts[0].content, "Tea, no sugar");
    assert!(prefs::list(&b.connection, "me", "", "", 0)
        .unwrap()
        .is_empty());
    let text: String = b
        .connection
        .query_row(
            "SELECT text FROM memory_summaries WHERE space_id = ''",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(text, "It went well.");
    // What came from the vault doesn't go back.
    assert!(sync::outgoing(&b.connection, "me", 50).unwrap().is_empty());
}

#[test]
fn a_record_opens_to_the_same_body_and_vectors_stay_home() {
    let mut a = computer();
    let event = keep(&mut a.connection, page("https://example.com/", ""));
    embed_all(&mut a.connection, "me", &axis(0));
    let rows = sync::outgoing(&a.connection, "me", 50).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id, format!("moment:{}", event.id));
    let body = rows[0].body.as_ref().unwrap();
    let read: SyncBody = serde_json::from_slice(body).unwrap();
    assert_eq!(
        read,
        SyncBody::Moment {
            event: event.clone()
        }
    );
    let text = String::from_utf8_lossy(body);
    assert!(!text.contains("embedding"), "{text}");
    assert!(body.len() < 1000, "a vector would be 3 KB");
}

#[test]
fn another_computer_makes_its_own_vector_and_owes_no_backlog() {
    let (mut a, mut b, mut version) = (computer(), computer(), 0);
    let event = keep(&mut a.connection, page("https://example.com/", ""));
    embed_all(&mut a.connection, "me", &axis(0));
    travel(&mut a, &mut b, &mut version);
    assert_eq!(index::waiting(&b.connection, "me").unwrap(), 0);
    let claimed = index::claim(&b.connection, "me", 10, LATER).unwrap();
    assert_eq!(claimed.len(), 1);
    assert_eq!(claimed[0].key.record_id, event.id);
    assert!(claimed[0].text.contains("What the page said."));
}

#[test]
fn a_revisit_travels_as_a_pointer_and_keeps_its_text_when_its_visit_goes() {
    let (mut a, mut b, mut version) = (computer(), computer(), 0);
    let holder = keep(
        &mut a.connection,
        page("https://example.com/", "0000000000000000"),
    );
    let revisit = keep(
        &mut a.connection,
        page("https://example.com/", "0000000000000001"),
    );
    assert_eq!(revisit.same_as, holder.id);
    travel(&mut a, &mut b, &mut version);
    let rows: Vec<_> = all_in(&b.connection, "me", "");
    assert_eq!(rows.len(), 2);
    assert!(rows.iter().all(|event| event.body == "What the page said."));
    let stored: String = b
        .connection
        .query_row(
            "SELECT body FROM memory_events WHERE id = ?1",
            [&revisit.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(stored, "");
    let only_holder = Forget {
        ids: vec![holder.id.clone()],
        ..Forget::default()
    };
    forget::moments(&a.connection, "me", &only_holder, NOW + 1, false).unwrap();
    travel(&mut a, &mut b, &mut version);
    let left = all_in(&b.connection, "me", "");
    assert_eq!(left.len(), 1);
    assert_eq!(left[0].id, revisit.id);
    assert_eq!(left[0].body, "What the page said.");
    assert_eq!(left[0].same_as, "");
}

#[test]
fn forgetting_goes_everywhere_and_a_never_sent_row_owes_no_deletion() {
    let (mut a, mut b, mut version) = (computer(), computer(), 0);
    let event = keep(&mut a.connection, page("https://example.com/", ""));
    let fact = remember(&mut a, "", "Tea, no sugar");
    let surface = summaries::add_manual(&mut a.connection, "me", "", "", "Week", NOW).unwrap();
    travel(&mut a, &mut b, &mut version);
    embed_all(&mut b.connection, "me", &axis(0));
    let site = Forget {
        site: "example.com".into(),
        ..Forget::default()
    };
    forget::moments(&a.connection, "me", &site, NOW, false).unwrap();
    prefs::forget(&mut a.connection, "me", "", Some(""), &fact.id, NOW).unwrap();
    forget::node(
        &mut a.connection,
        "me",
        "",
        &surface,
        None,
        None,
        false,
        NOW,
    )
    .unwrap();
    travel(&mut a, &mut b, &mut version);
    assert!(all_in(&b.connection, "me", "").is_empty());
    assert!(prefs::list(&b.connection, "me", "", "", 0)
        .unwrap()
        .is_empty());
    for table in [
        "memory_summaries",
        "memory_chunks",
        "memory_vectors",
        "memory_deleted",
    ] {
        let count: i64 = b
            .connection
            .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 0, "{table}");
    }
    let _ = event;
    // A row the vault never had has nobody to tell.
    let unsent = keep(&mut a.connection, page("https://unsent.example/", ""));
    let only = Forget {
        ids: vec![unsent.id],
        ..Forget::default()
    };
    forget::moments(&a.connection, "me", &only, NOW, false).unwrap();
    assert!(sync::outgoing(&a.connection, "me", 50).unwrap().is_empty());
}

#[test]
fn a_change_here_that_hasnt_gone_out_stays() {
    let (mut a, mut b, mut version) = (computer(), computer(), 0);
    let fact = remember(&mut a, "", "Tea");
    travel(&mut a, &mut b, &mut version);
    prefs::update(&mut b.connection, "me", "", "", &fact.id, "Coffee", NOW + 5).unwrap();
    prefs::update(&mut a.connection, "me", "", "", &fact.id, "Water", NOW + 6).unwrap();
    travel(&mut a, &mut b, &mut version);
    assert_eq!(
        prefs::list(&b.connection, "me", "", "", 0).unwrap()[0].content,
        "Coffee"
    );
    // A deletion here also beats a copy that arrives before it has gone out.
    prefs::forget(&mut b.connection, "me", "", Some(""), &fact.id, NOW + 7).unwrap();
    prefs::update(&mut a.connection, "me", "", "", &fact.id, "Juice", NOW + 8).unwrap();
    travel(&mut a, &mut b, &mut version);
    assert!(prefs::list(&b.connection, "me", "", "", 0)
        .unwrap()
        .is_empty());
}

#[test]
fn the_same_words_on_two_computers_end_as_one_memory() {
    let (mut a, mut b, mut version) = (computer(), computer(), 0);
    let on_a = remember(&mut a, "", "Tea, no sugar");
    let on_b = remember(&mut b, "", "Tea, no sugar");
    assert_ne!(on_a.id, on_b.id);
    travel(&mut a, &mut b, &mut version);
    travel(&mut b, &mut a, &mut version);
    travel(&mut a, &mut b, &mut version);
    let (left, right) = (
        prefs::list(&a.connection, "me", "", "", 0).unwrap(),
        prefs::list(&b.connection, "me", "", "", 0).unwrap(),
    );
    assert_eq!(left.len(), 1);
    assert_eq!(right.len(), 1);
    assert_eq!(left[0].id, right[0].id);
    assert_eq!(left[0].id, on_a.id.clone().min(on_b.id));
}

#[test]
fn text_past_the_limit_is_cut_at_a_character_and_a_record_always_fits() {
    assert_eq!(sync::synced_text("héllo", 2), "h");
    assert_eq!(sync::synced_text("héllo", 3), "hé");
    assert_eq!(sync::synced_text("short", 100), "short");
    // Control characters are the worst case: each escapes to six bytes.
    let mut a = computer();
    let mut event = page("https://example.com/", "");
    event.body = "\u{1}".repeat(SYNC_PAGE_TEXT_BYTES);
    event.title = "\u{1}".repeat(300);
    event.url = format!("https://example.com/{}", "x".repeat(2000));
    keep(&mut a.connection, event);
    let rows = sync::outgoing(&a.connection, "me", 1).unwrap();
    let body = rows[0].body.as_ref().unwrap();
    assert!(body.len() < MAX_SEALED, "{} bytes", body.len());
}

#[test]
fn a_new_vault_gets_everything_and_never_what_was_forgotten() {
    let mut a = computer();
    keep(&mut a.connection, page("https://example.com/", ""));
    let gone = remember(&mut a, "", "Tea");
    remember(&mut a, "", "Coffee");
    send(&mut a);
    // Sync stopped: the record store keeps its copies, ready for whatever vault comes next.
    a.records.unlink().unwrap();
    prefs::forget(&mut a.connection, "me", "", Some(""), &gone.id, NOW).unwrap();
    sync::start_over(&a.connection, "me").unwrap();
    assert_eq!(sync::outgoing(&a.connection, "me", 50).unwrap().len(), 3);
    send(&mut a);
    let going = a.records.dirty(50).unwrap();
    assert_eq!(going.len(), 2);
    assert!(going.iter().all(|row| row.plaintext.is_some()));
    assert!(going
        .iter()
        .all(|row| row.id != format!("fact:{}", gone.id)));
}

#[test]
fn a_record_from_a_newer_version_is_left_alone() {
    let mut a = computer();
    let records = vec![
        (
            "moment:x".to_owned(),
            Some(br#"{"record":"hologram"}"#.to_vec()),
        ),
        ("moment:y".to_owned(), Some(b"not json".to_vec())),
    ];
    sync_apply::apply(&mut a.connection, "me", &records).unwrap();
    assert!(all_in(&a.connection, "me", "").is_empty());
}
