//! The exchange against a small server written here, which holds records the way the real one
//! does and can misbehave on demand. Each `Session` stands for one signed-in install.
use super::*;
use crate::{crypto::VaultRoot, document::entities::Kind, document::ViewRecord, local::LocalKey};
use serde_json::json;
use std::collections::BTreeMap;

const VAULT: &str = "01951d32-40ac-7000-8000-000000000001";
const P: &str = "personal";
const C: &str = "bookmarks";

#[derive(Default)]
struct Server {
    records: BTreeMap<(String, String), (u64, Vec<u8>, u64, bool)>,
    head: u64,
    compacted: u64,
}

impl Server {
    fn answer(&mut self, frame: &ClientFrame) -> ServerFrame {
        match frame {
            ClientFrame::Pull { request_id, after } => self.pull(request_id, *after, 1000),
            ClientFrame::Push { request_id, writes } => self.push(request_id, writes),
        }
    }

    fn pull(&self, request_id: &str, after: u64, limit: usize) -> ServerFrame {
        let reset = after < self.compacted;
        let after = if reset { 0 } else { after };
        let mut rows: Vec<_> = self
            .records
            .iter()
            .filter(|(_, row)| row.2 > after)
            .collect();
        rows.sort_by_key(|(_, row)| row.2);
        let total = rows.len();
        let page: Vec<_> = rows.into_iter().take(limit).collect();
        let more = page.len() < total;
        let cursor = if more {
            page.last().map_or(after, |(_, row)| row.2)
        } else {
            self.head
        };
        ServerFrame::Records {
            request_id: request_id.into(),
            page: WirePage {
                records: page
                    .into_iter()
                    .map(|((scope, key), row)| WireRecord {
                        scope: scope.clone(),
                        key: key.clone(),
                        version: row.0,
                        sealed: row.1.clone(),
                    })
                    .collect(),
                cursor,
                head: self.head,
                more,
                reset,
            },
        }
    }

    fn push(&mut self, request_id: &str, writes: &[WireWrite]) -> ServerFrame {
        let mut results = Vec::new();
        for write in writes {
            let entry = (write.scope.clone(), write.key.clone());
            let current = self.records.get(&entry).map_or(0, |row| row.0);
            if current != write.base_version {
                let row = &self.records[&entry];
                results.push(WireResult {
                    scope: write.scope.clone(),
                    key: write.key.clone(),
                    applied: false,
                    version: current,
                    current: Some(WireRecord {
                        scope: write.scope.clone(),
                        key: write.key.clone(),
                        version: row.0,
                        sealed: row.1.clone(),
                    }),
                });
                continue;
            }
            self.head += 1;
            self.records.insert(
                entry,
                (
                    write.base_version + 1,
                    write.sealed.clone(),
                    self.head,
                    write.deleted,
                ),
            );
            results.push(WireResult {
                scope: write.scope.clone(),
                key: write.key.clone(),
                applied: true,
                version: write.base_version + 1,
                current: None,
            });
        }
        ServerFrame::Pushed {
            request_id: request_id.into(),
            results,
        }
    }
}

struct Session {
    _directory: tempfile::TempDir,
    store: LocalStore,
    exchange: Exchange,
    changed: Vec<(String, String)>,
    notices: Vec<Notice>,
}

impl Session {
    fn new(root: &VaultRoot) -> Self {
        let directory = tempfile::tempdir().unwrap();
        let store =
            LocalStore::open(&directory.path().join("r.sqlite"), &LocalKey::generate()).unwrap();
        let exchange = Exchange::new(RecordKeys::new(root, VAULT).unwrap(), &store).unwrap();
        Self {
            _directory: directory,
            store,
            exchange,
            changed: Vec::new(),
            notices: Vec::new(),
        }
    }

    fn edit(&mut self, id: &str, title: Option<&str>) {
        let record = title.map(|title| ViewRecord {
            kind: Kind::Bookmark,
            id: id.into(),
            fields: serde_json::from_value(json!({ "title": title })).unwrap(),
        });
        self.store
            .write(P, C, vec![(id.into(), record)])
            .unwrap();
        self.exchange.edited(Instant::now() - Duration::from_secs(120));
    }

    fn title(&self, id: &str) -> Option<String> {
        self.store
            .get(P, C, id)
            .unwrap()
            .map(|record| record.fields["title"].as_str().unwrap().to_owned())
    }

    fn deliver(&mut self, frame: ServerFrame) -> Vec<ClientFrame> {
        let outcome = self.exchange.on_frame(&mut self.store, frame).unwrap();
        self.changed.extend(outcome.changed);
        self.notices.extend(outcome.notice);
        outcome.send
    }

    /// Runs this session against the server until nothing is left to say.
    fn sync(&mut self, server: &mut Server) {
        let mut queue = self.exchange.connected();
        loop {
            while let Some(frame) = queue.pop() {
                let answer = server.answer(&frame);
                queue.extend(self.deliver(answer));
            }
            match self
                .exchange
                .next_push(&mut self.store, Instant::now() + Duration::from_secs(120))
                .unwrap()
            {
                Some(frame) => queue.push(frame),
                None => break,
            }
        }
    }
}

fn pair() -> (Server, Session, Session) {
    let root = VaultRoot::generate();
    (Server::default(), Session::new(&root), Session::new(&root))
}

#[test]
fn a_change_on_one_session_reaches_the_other() {
    let (mut server, mut a, mut b) = pair();
    a.edit("x", Some("from a"));
    a.sync(&mut server);
    b.sync(&mut server);
    assert_eq!(b.title("x").as_deref(), Some("from a"));
    assert!(b.changed.contains(&(P.to_owned(), C.to_owned())));
    assert!(a.exchange.settled(&a.store).unwrap());
    assert!(b.exchange.settled(&b.store).unwrap());
}

#[test]
fn a_deletion_reaches_the_other_session_and_stays_deleted() {
    let (mut server, mut a, mut b) = pair();
    a.edit("x", Some("t"));
    a.sync(&mut server);
    b.sync(&mut server);
    b.edit("x", None);
    b.sync(&mut server);
    a.sync(&mut server);
    assert_eq!(a.title("x"), None);
    assert!(a.store.dirty(10).unwrap().is_empty());
}

#[test]
fn when_two_sessions_edit_offline_the_newer_edit_wins_on_both() {
    let (mut server, mut a, mut b) = pair();
    a.edit("x", Some("base"));
    a.sync(&mut server);
    b.sync(&mut server);
    a.edit("x", Some("older"));
    std::thread::sleep(Duration::from_millis(3));
    b.edit("x", Some("newer"));
    // The newer edit reaches the server second: it loses the swap, and still wins.
    a.sync(&mut server);
    b.sync(&mut server);
    a.sync(&mut server);
    assert_eq!(a.title("x").as_deref(), Some("newer"));
    assert_eq!(b.title("x").as_deref(), Some("newer"));
    // The newer edit reaches the server first: the older one gives way when it arrives.
    a.edit("y", Some("older"));
    std::thread::sleep(Duration::from_millis(3));
    b.edit("y", Some("newer"));
    b.sync(&mut server);
    a.sync(&mut server);
    b.sync(&mut server);
    assert_eq!(a.title("y").as_deref(), Some("newer"));
    assert_eq!(b.title("y").as_deref(), Some("newer"));
    assert!(a.exchange.settled(&a.store).unwrap());
    assert!(b.exchange.settled(&b.store).unwrap());
}

#[test]
fn a_laptop_returning_after_a_week_cannot_overwrite_newer_changes() {
    let (mut server, mut laptop, mut desktop) = pair();
    laptop.edit("x", Some("base"));
    laptop.sync(&mut server);
    desktop.sync(&mut server);
    // The laptop edits offline, then a much later edit lands from the desktop.
    laptop.edit("x", Some("a week old"));
    std::thread::sleep(Duration::from_millis(3));
    desktop.edit("x", Some("today"));
    desktop.sync(&mut server);
    laptop.sync(&mut server);
    assert_eq!(laptop.title("x").as_deref(), Some("today"));
}

#[test]
fn a_repeated_or_reordered_answer_changes_nothing() {
    let (mut server, mut a, mut b) = pair();
    a.edit("x", Some("t"));
    a.sync(&mut server);
    let page = server.pull("pull-1", 0, 1000);
    let frames = b.exchange.connected();
    let ClientFrame::Pull { request_id, .. } = &frames[0] else {
        panic!()
    };
    let mut answer = page.clone();
    if let ServerFrame::Records { request_id: id, .. } = &mut answer {
        *id = request_id.clone();
    }
    b.deliver(answer.clone());
    assert_eq!(b.exchange.cursor(), 1);
    // The same answer again is no longer waited for.
    b.deliver(answer);
    assert_eq!(b.title("x").as_deref(), Some("t"));
    // An answer to a request nobody made is ignored.
    b.deliver(ServerFrame::Pushed {
        request_id: "push-99".into(),
        results: vec![],
    });
    b.deliver(ServerFrame::Records {
        request_id: "pull-99".into(),
        page: WirePage {
            cursor: 500,
            head: 500,
            ..Default::default()
        },
    });
    assert_eq!(b.exchange.cursor(), 1);
}

#[test]
fn a_lost_connection_resends_and_the_server_answers_with_what_it_has() {
    let (mut server, mut a, mut b) = pair();
    a.edit("x", Some("t"));
    let mut queue = a.exchange.connected();
    let pull = queue.pop().unwrap();
    let answer = server.answer(&pull);
    a.deliver(answer);
    let push = a
        .exchange
        .next_push(&mut a.store, Instant::now() + Duration::from_secs(120))
        .unwrap()
        .unwrap();
    // The server applied it, but the answer was lost with the connection.
    server.answer(&push);
    a.sync(&mut server);
    assert!(a.exchange.settled(&a.store).unwrap());
    b.sync(&mut server);
    assert_eq!(b.title("x").as_deref(), Some("t"));
}

#[test]
fn a_tampered_record_is_skipped_and_the_rest_still_arrive() {
    let (mut server, mut a, mut b) = pair();
    a.edit("bad", Some("bad"));
    a.edit("good", Some("good"));
    a.sync(&mut server);
    for row in server.records.values_mut() {
        if row.2 == 1 {
            *row.1.last_mut().unwrap() ^= 1;
        }
    }
    b.sync(&mut server);
    assert_eq!(
        b.title("bad").is_none() as u8 + b.title("good").is_none() as u8,
        1
    );
    assert_eq!(b.exchange.cursor(), server.head, "the cursor isn't stuck");
    assert!(b.exchange.settled(&b.store).unwrap());
}

#[test]
fn a_record_from_a_newer_version_is_kept_and_passed_along() {
    let (mut server, mut a, mut b) = pair();
    let future = br#"{"kind":"from_the_future","id":"z","fields":{}}"#;
    a.store.write_one(P, C, "z", Some(future)).unwrap();
    a.exchange.edited(Instant::now() - Duration::from_secs(120));
    a.sync(&mut server);
    b.sync(&mut server);
    assert_eq!(b.store.totals().unwrap().records, 1);
    assert!(b.store.list(P, C).unwrap().is_empty());
}

#[test]
fn unknown_frames_and_fields_from_a_newer_server_are_ignored() {
    let frame: ServerFrame = serde_json::from_str(r#"{"type":"something_new","x":1}"#).unwrap();
    assert_eq!(frame, ServerFrame::Unknown);
    let (_, mut a, _) = pair();
    assert!(a.deliver(frame).is_empty());
    let page: ServerFrame = serde_json::from_str(
        r#"{"type":"records","request_id":"r","extra":true,"page":{"cursor":0,"head":0,"new_field":1}}"#,
    )
    .unwrap();
    assert!(matches!(page, ServerFrame::Records { .. }));
}

#[test]
fn a_record_too_big_to_send_is_set_aside_and_the_rest_go() {
    let (mut server, mut a, mut b) = pair();
    use rand::RngCore;
    let mut random = vec![0u8; 500_000];
    rand::rngs::OsRng.fill_bytes(&mut random);
    let noise = STANDARD.encode(random);
    a.edit("huge", Some(&noise));
    a.edit("small", Some("fine"));
    a.sync(&mut server);
    b.sync(&mut server);
    assert_eq!(b.title("small").as_deref(), Some("fine"));
    assert_eq!(b.title("huge"), None);
    assert_eq!(a.title("huge").as_deref(), Some(noise.as_str()), "still here");
    assert_eq!(a.store.set_aside_counts().unwrap(), vec![(C.to_owned(), 1)]);
    assert!(a.exchange.settled(&a.store).unwrap());
    // Its next edit tries again.
    a.edit("huge", Some("small now"));
    a.sync(&mut server);
    b.sync(&mut server);
    assert_eq!(b.title("huge").as_deref(), Some("small now"));
}

#[test]
fn a_record_just_under_the_limit_still_goes() {
    let (mut server, mut a, mut b) = pair();
    use rand::RngCore;
    let mut random = vec![0u8; 130_000];
    rand::rngs::OsRng.fill_bytes(&mut random);
    let large = STANDARD.encode(random);
    a.edit("large", Some(&large));
    a.sync(&mut server);
    b.sync(&mut server);
    assert_eq!(b.title("large").as_deref(), Some(large.as_str()));
    assert!(a.store.set_aside_counts().unwrap().is_empty());
}

#[test]
fn a_frame_the_server_refuses_finds_the_one_bad_record() {
    let (mut server, mut a, mut b) = pair();
    a.edit("one", Some("1"));
    a.edit("two", Some("2"));
    a.edit("three", Some("3"));
    let target = a.exchange.keys.key(P, C, "two").unwrap();
    let mut rounds = 0;
    let mut queue = a.exchange.connected();
    loop {
        rounds += 1;
        assert!(rounds < 40, "this has to finish");
        while let Some(frame) = queue.pop() {
            let refuse = matches!(&frame, ClientFrame::Push { writes, .. }
                if writes.iter().any(|write| write.key == target));
            let answer = if refuse {
                let ClientFrame::Push { request_id, .. } = &frame else {
                    unreachable!()
                };
                ServerFrame::Error {
                    request_id: request_id.clone(),
                    code: "invalid_sync_request".into(),
                    retry_after_ms: None,
                }
            } else {
                server.answer(&frame)
            };
            queue.extend(a.deliver(answer));
        }
        match a
            .exchange
            .next_push(&mut a.store, Instant::now() + Duration::from_secs(120))
            .unwrap()
        {
            Some(frame) => queue.push(frame),
            None => break,
        }
    }
    b.sync(&mut server);
    assert_eq!(b.title("one").as_deref(), Some("1"));
    assert_eq!(b.title("three").as_deref(), Some("3"));
    assert_eq!(b.title("two"), None);
    assert_eq!(a.store.set_aside_counts().unwrap(), vec![(C.to_owned(), 1)]);
    assert_eq!(a.exchange.set_aside, 1);
}

#[test]
fn storage_full_holds_uploads_keeps_reading_and_says_so_once_it_clears() {
    let (mut server, mut a, mut b) = pair();
    a.edit("x", Some("waits"));
    let now = Instant::now() + Duration::from_secs(120);
    a.exchange.connected();
    let push = a.exchange.next_push(&mut a.store, now).unwrap().unwrap();
    let ClientFrame::Push { request_id, .. } = &push else {
        panic!()
    };
    a.deliver(ServerFrame::Error {
        request_id: request_id.clone(),
        code: "storage_limit_reached".into(),
        retry_after_ms: None,
    });
    assert_eq!(a.notices, vec![Notice::StorageFull]);
    assert!(a.exchange.storage_full());
    assert!(a.exchange.next_push(&mut a.store, now).unwrap().is_none());
    // Downloads carry on while uploads wait.
    b.edit("y", Some("arrives"));
    b.sync(&mut server);
    let pull = a.exchange.pull_frame();
    let answer = server.answer(&pull);
    a.deliver(answer);
    assert_eq!(a.title("y").as_deref(), Some("arrives"));
    // After the wait, the held edit goes out and the notice clears.
    let later = Instant::now() + STORAGE_FULL_WAIT + Duration::from_secs(1);
    let push = a.exchange.next_push(&mut a.store, later).unwrap().unwrap();
    let answer = server.answer(&push);
    a.deliver(answer);
    assert!(!a.exchange.storage_full());
    assert_eq!(a.store.totals().unwrap().waiting, 0);
}

#[test]
fn being_rate_limited_waits_then_retries() {
    let (_server, mut a, _) = pair();
    a.edit("x", Some("t"));
    let now = Instant::now() + Duration::from_secs(120);
    a.exchange.connected();
    let push = a.exchange.next_push(&mut a.store, now).unwrap().unwrap();
    let ClientFrame::Push { request_id, .. } = &push else {
        panic!()
    };
    a.deliver(ServerFrame::Error {
        request_id: request_id.clone(),
        code: "sync_rate_limited".into(),
        retry_after_ms: Some(5_000),
    });
    assert!(a.notices.is_empty(), "this is not something to tell anyone");
    assert!(a
        .exchange
        .next_push(&mut a.store, Instant::now())
        .unwrap()
        .is_none());
    let later = Instant::now() + Duration::from_secs(300);
    assert!(a.exchange.next_push(&mut a.store, later).unwrap().is_some());
}

#[test]
fn a_removed_session_and_a_destroyed_vault_stop_and_say_why() {
    let (_server, mut a, mut b) = pair();
    let outcome = a
        .exchange
        .on_frame(
            &mut a.store,
            ServerFrame::Error {
                request_id: String::new(),
                code: "sync_session_forbidden".into(),
                retry_after_ms: None,
            },
        )
        .unwrap();
    assert!(outcome.stop);
    assert_eq!(outcome.notice, Some(Notice::SessionRemoved));
    let outcome = b
        .exchange
        .on_frame(&mut b.store, ServerFrame::VaultGone)
        .unwrap();
    assert!(outcome.stop);
    assert_eq!(outcome.notice, Some(Notice::VaultGone));
}

#[test]
fn any_other_error_passes_quietly() {
    let (_server, mut a, _) = pair();
    let outcome = a
        .exchange
        .on_frame(
            &mut a.store,
            ServerFrame::Error {
                request_id: String::new(),
                code: "sync_unavailable".into(),
                retry_after_ms: None,
            },
        )
        .unwrap();
    assert!(!outcome.stop);
    assert_eq!(outcome.notice, None);
}

#[test]
fn a_session_away_past_what_the_server_keeps_gets_a_full_listing() {
    let (mut server, mut a, mut b) = pair();
    a.edit("stays", Some("s"));
    a.edit("goes", Some("g"));
    a.sync(&mut server);
    b.sync(&mut server);
    // While b is away, "goes" is deleted and its tombstone compacted away.
    let goes = a.exchange.keys.key(P, C, "goes").unwrap();
    server.records.retain(|(_, key), _| *key != goes);
    server.head += 1;
    server.compacted = server.head;
    // b has its own unsent edit too: that must survive whatever the listing says.
    b.edit("mine", Some("offline"));
    b.sync(&mut server);
    assert_eq!(b.title("stays").as_deref(), Some("s"));
    assert_eq!(b.title("goes"), None, "gone from the listing means gone");
    a.sync(&mut server);
    assert_eq!(a.title("mine").as_deref(), Some("offline"));
}

#[test]
fn a_big_first_sync_pages_through_everything() {
    let (mut server, mut a, mut b) = pair();
    for index in 0..450 {
        a.edit(&format!("k{index}"), Some("t"));
    }
    a.sync(&mut server);
    assert_eq!(server.records.len(), 450);
    // Small pages, as if a real page's byte limit cut them short.
    let mut frames = b.exchange.connected();
    let mut pages = 0;
    while let Some(frame) = frames.pop() {
        let ClientFrame::Pull { request_id, after } = &frame else {
            panic!()
        };
        let answer = server.pull(request_id, *after, 50);
        frames.extend(b.deliver(answer));
        pages += 1;
    }
    assert_eq!(pages, 9);
    assert_eq!(b.store.list(P, C).unwrap().len(), 450);
    assert_eq!(b.exchange.behind(), 0);
}

#[test]
fn a_change_hint_during_a_pull_pulls_once_more() {
    let (mut server, mut a, mut b) = pair();
    a.edit("one", Some("1"));
    a.sync(&mut server);
    let mut frames = b.exchange.connected();
    let pull = frames.pop().unwrap();
    assert!(b.deliver(ServerFrame::Changed).is_empty(), "one at a time");
    a.edit("two", Some("2"));
    a.sync(&mut server);
    let answer = server.answer(&pull);
    let again = b.deliver(answer);
    assert_eq!(again.len(), 1);
    let answer = server.answer(&again[0]);
    b.deliver(answer);
    assert_eq!(b.title("two").as_deref(), Some("2"));
}

#[test]
fn a_burst_of_edits_waits_for_its_batch() {
    let (_server, mut a, _) = pair();
    let start = Instant::now();
    a.exchange.connected();
    a.store
        .write_one(P, C, "x", Some(br#"{"kind":"website","id":"x","fields":{}}"#))
        .unwrap();
    a.exchange.edited(start);
    assert!(
        a.exchange
            .next_push(&mut a.store, start + Duration::from_millis(100))
            .unwrap()
            .is_none(),
        "still typing"
    );
    assert!(a
        .exchange
        .next_push(&mut a.store, start + Duration::from_millis(600))
        .unwrap()
        .is_some());
}

#[test]
fn history_waits_for_its_slower_batch_while_everything_else_goes() {
    let (_server, mut a, _) = pair();
    let start = Instant::now();
    a.exchange.connected();
    a.store
        .write_one(P, "history", "h", Some(br#"{"kind":"history_batch","id":"h","fields":{}}"#))
        .unwrap();
    a.store
        .write_one(P, C, "b", Some(br#"{"kind":"website","id":"b","fields":{}}"#))
        .unwrap();
    a.exchange.edited(start);
    let soon = a
        .exchange
        .next_push(&mut a.store, start + Duration::from_secs(1))
        .unwrap()
        .unwrap();
    let ClientFrame::Push { writes, .. } = soon else {
        panic!()
    };
    assert_eq!(writes.len(), 1);
    assert_eq!(writes[0].key, a.exchange.keys.key(P, C, "b").unwrap());
}

#[test]
fn what_people_notice_goes_first() {
    let (_server, mut a, _) = pair();
    let body = br#"{"kind":"website","id":"x","fields":{}}"#;
    for collection in ["history", "extensions", "cookies", "bookmarks", "tabs", "profiles"] {
        a.store.write_one(P, collection, "x", Some(body)).unwrap();
    }
    let order: Vec<_> = a
        .store
        .dirty_for_push(10, true)
        .unwrap()
        .into_iter()
        .map(|row| row.collection)
        .collect();
    assert_eq!(
        order,
        ["profiles", "tabs", "bookmarks", "cookies", "extensions", "history"]
    );
}

#[test]
fn a_late_policy_from_the_server_applies() {
    let (_server, mut a, _) = pair();
    let frame: ServerFrame = serde_json::from_str(
        r#"{"type":"batch_policy","policy":{"revision":2,"lanes":{"records":{"quiet_ms":5000,"max_wait_ms":9000,"max_edits":5}}}}"#,
    )
    .unwrap();
    a.deliver(frame);
    let start = Instant::now();
    a.store
        .write_one(P, C, "x", Some(br#"{"kind":"website","id":"x","fields":{}}"#))
        .unwrap();
    a.exchange.edited(start);
    assert!(a
        .exchange
        .next_push(&mut a.store, start + Duration::from_secs(2))
        .unwrap()
        .is_none());
}

#[test]
#[ignore = "a measurement, not a check: cargo test --release -- --ignored --nocapture measure"]
fn measure_a_large_sync() {
    let (mut server, mut a, mut b) = pair();
    let start = Instant::now();
    a.store
        .atomic(|store| {
            for index in 0..2_000 {
                let record = ViewRecord {
                    kind: Kind::Bookmark,
                    id: format!("k{index}"),
                    fields: serde_json::from_value(json!({ "title": "a bookmark", "url": "https://example.com/a/page" })).unwrap(),
                };
                store.write(P, C, vec![(record.id.clone(), Some(record))])?;
            }
            Ok(())
        })
        .unwrap();
    println!("write 2000 locally: {:?}", start.elapsed());
    a.exchange.edited(Instant::now() - Duration::from_secs(120));
    let start = Instant::now();
    a.sync(&mut server);
    println!("seal and answer 2000: {:?}", start.elapsed());
    let start = Instant::now();
    b.sync(&mut server);
    println!("open and apply 2000, per record in one transaction each page: {:?}", start.elapsed());
    assert_eq!(b.store.list(P, C).unwrap().len(), 2_000);
}
