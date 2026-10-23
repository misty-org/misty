use super::*;

fn lane() -> ClipboardLane {
    ClipboardLane {
        keys: (0..CLIPBOARD_SLOTS)
            .map(|slot| format!("{slot:064x}"))
            .collect(),
        ..ClipboardLane::default()
    }
}

fn listing(records: Vec<wire::Record>, cursor: u64, more: bool) -> wire::Listing {
    wire::Listing {
        collection: CLIPBOARD.into(),
        records,
        cursor,
        more,
        reset: false,
    }
}

fn row(slot: u8, version: u64, ciphertext: Option<&[u8]>) -> wire::Record {
    wire::Record {
        key: format!("{slot:064x}"),
        version,
        ciphertext: ciphertext.map(<[u8]>::to_vec),
    }
}

#[test]
fn reads_the_ring_then_writes_with_the_stored_version() {
    let mut lane = lane();
    lane.connected();
    let Some(LaneFrame::Pull {
        request_id,
        after: 0,
    }) = lane.next()
    else {
        panic!("a new connection pulls first");
    };
    lane.publish(3, b"new".to_vec()).unwrap();
    assert_eq!(lane.next(), None, "one request at a time");
    lane.listing(
        Some(&request_id),
        &listing(
            vec![row(3, 4, Some(b"old")), row(7, 1, Some(b"x"))],
            9,
            false,
        ),
    )
    .unwrap();
    assert_eq!(lane.rows().len(), 2);
    let Some(LaneFrame::Push { request_id, write }) = lane.next() else {
        panic!("the queued clip goes out");
    };
    assert_eq!(
        (write.base_version, write.ciphertext.as_slice()),
        (4, &b"new"[..])
    );
    let answer = wire::Answer {
        key: write.key,
        applied: true,
        version: 5,
        current: None,
    };
    lane.ack(Some(&request_id), &[answer]).unwrap();
    assert!(lane.rows().contains(&ClipboardRow {
        slot: 3,
        ciphertext: b"new".to_vec()
    }));
    assert_eq!(lane.next(), None);
}

#[test]
fn a_lost_race_retries_on_the_servers_version() {
    let mut lane = lane();
    lane.publish(0, b"mine".to_vec()).unwrap();
    let Some(LaneFrame::Push { request_id, write }) = lane.next() else {
        panic!("push");
    };
    let answer = wire::Answer {
        key: write.key,
        applied: false,
        version: 8,
        current: Some(row(0, 8, Some(b"theirs"))),
    };
    lane.ack(Some(&request_id), &[answer]).unwrap();
    let Some(LaneFrame::Push { write, .. }) = lane.next() else {
        panic!("retry");
    };
    assert_eq!(
        (write.base_version, write.ciphertext.as_slice()),
        (8, &b"mine"[..])
    );
}

#[test]
fn tombstones_clear_slots_and_failures_retry() {
    let mut lane = lane();
    lane.connected();
    let Some(LaneFrame::Pull { request_id, .. }) = lane.next() else {
        panic!("pull");
    };
    assert!(lane.failed(Some(&request_id)));
    let Some(LaneFrame::Pull { request_id, .. }) = lane.next() else {
        panic!("pull again");
    };
    lane.listing(
        Some(&request_id),
        &listing(vec![row(1, 2, Some(b"a"))], 2, true),
    )
    .unwrap();
    let Some(LaneFrame::Pull {
        request_id,
        after: 2,
    }) = lane.next()
    else {
        panic!("the next page");
    };
    lane.listing(Some(&request_id), &listing(vec![row(1, 3, None)], 3, false))
        .unwrap();
    assert!(lane.rows().is_empty());
    assert!(!lane.failed(Some("someone else's")));
    assert!(lane
        .listing(Some("someone else's"), &listing(vec![], 0, false))
        .is_none());
    assert!(lane.publish(CLIPBOARD_SLOTS, b"x".to_vec()).is_err());
}
