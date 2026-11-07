use super::events;
use super::index::{self, ChunkKey, EmbeddedChunk};
use super::search::{self, DIMENSIONS};
use super::tests::{axis, database, embed_all, keep, page, LATER, NOW};
use super::{MemoryError, BACKLOG_CAP};

const A: &str = "0000000000000000";

#[test]
fn search_ranks_by_meaning_in_one_space_and_model() {
    let (_directory, mut connection) = database();
    let near = keep(&mut connection, page("https://near.example/", ""));
    embed_all(&mut connection, "me", &axis(0));
    let mut far_page = page("https://far.example/", "");
    far_page.body = "Something else.".into();
    let far = keep(&mut connection, far_page);
    embed_all(&mut connection, "me", &axis(5));
    let mut other_space = page("https://other.example/", "");
    other_space.space_id = "work".into();
    other_space.body = "In another Space.".into();
    keep(&mut connection, other_space);
    embed_all(&mut connection, "me", &axis(0));
    let mut theirs = page("https://theirs.example/", "");
    theirs.body = "Someone else's.".into();
    events::record(&mut connection, "other", theirs, BACKLOG_CAP, NOW).unwrap();
    embed_all(&mut connection, "other", &axis(0));

    let hits = search::search(&connection, "me", "", &["moments"], &axis(0), "model", 10).unwrap();
    assert_eq!(hits.len(), 2);
    assert_eq!(hits[0].record_id, near.id);
    assert!(hits[0].distance.abs() < 1e-5);
    assert_eq!(hits[1].record_id, far.id);
    assert!(hits[1].distance > 0.5);
    assert!(hits[0].text.contains("What the page said."));
    let one = search::search(&connection, "me", "", &["moments"], &axis(5), "model", 1).unwrap();
    assert_eq!(one.len(), 1);
    assert_eq!(one[0].record_id, far.id);
    // Another model's vectors aren't comparable, and no vector means no hits.
    assert!(search::search(&connection, "me", "", &["moments"], &axis(0), "other", 10).unwrap().is_empty());
    assert!(search::search(&connection, "me", "", &["moments"], &[], "model", 10).unwrap().is_empty());
    assert!(search::search(&connection, "me", "", &["facts"], &axis(0), "model", 10).unwrap().is_empty());
}

#[test]
fn a_vector_is_stored_at_length_one_and_a_broken_one_is_refused() {
    let doubled: Vec<f32> = axis(0).iter().map(|value| value * 2.0).collect();
    let unit = search::unit_vector(&doubled).unwrap();
    let length: f32 = unit.iter().map(|value| value * value).sum();
    assert!((length - 1.0).abs() < 1e-5);
    assert!(search::unit_vector(&vec![0.0; DIMENSIONS]).is_none());
    assert!(search::unit_vector(&[1.0; 3]).is_none());
    let mut broken = axis(0);
    broken[0] = f32::NAN;
    assert!(search::unit_vector(&broken).is_none());
}

#[test]
fn the_same_text_reuses_its_vector_and_a_revisit_has_none() {
    let (_directory, mut connection) = database();
    keep(&mut connection, page("https://one.example/", ""));
    embed_all(&mut connection, "me", &axis(0));
    let same = keep(&mut connection, page("https://two.example/", ""));
    assert!(index::claim(&connection, "me", 10, LATER).unwrap().is_empty());
    let vectors: i64 = connection
        .query_row(
            "SELECT count(*) FROM memory_vectors v JOIN memory_chunks c ON c.id = v.chunk_id
             WHERE c.record_id = ?1",
            [&same.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(vectors, 1);
    let holder = keep(&mut connection, page("https://three.example/", A));
    embed_all(&mut connection, "me", &axis(0));
    let revisit = keep(&mut connection, page("https://three.example/", A));
    assert_eq!(revisit.same_as, holder.id);
    let chunks: i64 = connection
        .query_row("SELECT count(*) FROM memory_chunks WHERE record_id = ?1", [&revisit.id], |row| row.get(0))
        .unwrap();
    assert_eq!(chunks, 0);
}

#[test]
fn moments_wait_for_their_hour_and_failed_chunks_back_off() {
    let (_directory, mut connection) = database();
    keep(&mut connection, page("https://example.com/", ""));
    assert!(index::claim(&connection, "me", 10, NOW).unwrap().is_empty());
    let claimed = index::claim(&connection, "me", 10, LATER).unwrap();
    assert_eq!(claimed.len(), 1);
    // Leased, so nobody else takes it.
    assert!(index::claim(&connection, "me", 10, LATER).unwrap().is_empty());
    let key: ChunkKey = claimed[0].key.clone();
    index::retry(&connection, "me", std::slice::from_ref(&key), LATER).unwrap();
    assert!(index::claim(&connection, "me", 10, LATER).unwrap().is_empty());
    assert_eq!(index::claim(&connection, "me", 10, LATER + 60_000).unwrap().len(), 1);
    for attempt in 0..4 {
        index::retry(&connection, "me", std::slice::from_ref(&key), LATER).unwrap();
        let due = LATER + 60_000 * (attempt + 2);
        index::claim(&connection, "me", 10, due).unwrap();
    }
    index::retry(&connection, "me", std::slice::from_ref(&key), LATER).unwrap();
    assert!(index::claim(&connection, "me", 10, LATER + 60 * 60_000).unwrap().is_empty());
}

#[test]
fn a_vector_for_text_that_changed_is_dropped() {
    let (_directory, mut connection) = database();
    keep(&mut connection, page("https://example.com/", ""));
    let claimed = index::claim(&connection, "me", 10, LATER).unwrap();
    let mut key = claimed[0].key.clone();
    key.content_hash = "changed".into();
    index::complete(&mut connection, "me", "model", &[EmbeddedChunk { key, vector: axis(0) }]).unwrap();
    let vectors: i64 = connection
        .query_row("SELECT count(*) FROM memory_vectors", [], |row| row.get(0))
        .unwrap();
    assert_eq!(vectors, 0);
    let bad = EmbeddedChunk { key: claimed[0].key.clone(), vector: vec![1.0; 3] };
    assert_eq!(
        index::complete(&mut connection, "me", "model", &[bad]).unwrap_err(),
        MemoryError::Invalid("invalid_embedding")
    );
}

#[test]
fn past_the_backlog_cap_nothing_new_is_kept() {
    let (_directory, mut connection) = database();
    events::record(&mut connection, "me", page("https://one.example/", ""), 1, NOW).unwrap();
    assert_eq!(
        events::record(&mut connection, "me", page("https://two.example/", ""), 1, NOW).unwrap_err(),
        MemoryError::BacklogFull
    );
    assert_eq!(index::waiting(&connection, "me").unwrap(), 1);
    // A moment with no text waits for nothing, so it's still kept.
    let mut empty = page("https://three.example/", "");
    empty.title.clear();
    empty.body.clear();
    events::record(&mut connection, "me", empty, 1, NOW).unwrap();
}
