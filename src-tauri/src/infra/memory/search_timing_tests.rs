//! Is ranking every vector fast enough at a realistic size? Run it with
//! `cargo test --lib infra::memory::search_timing -- --ignored --nocapture`.
use std::time::Instant;

use rusqlite::params;

use super::search::{self, vector_bytes, DIMENSIONS};
use super::tests::database;

const CHUNKS: i64 = 50_000;

/// A cheap pseudo-random unit vector, so the numbers aren't helped by a pattern.
fn vector(seed: u64) -> Vec<f32> {
    let mut state = seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1;
    let mut values: Vec<f32> = (0..DIMENSIONS)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            (state as f32 / u64::MAX as f32) - 0.5
        })
        .collect();
    let length = values.iter().map(|value| value * value).sum::<f32>().sqrt();
    values.iter_mut().for_each(|value| *value /= length);
    values
}

#[test]
#[ignore = "takes a while; run it to measure"]
fn searching_fifty_thousand_chunks() {
    let (_directory, mut connection) = database();
    let text = "A page's words. ".repeat(250);
    let started = Instant::now();
    let transaction = connection.transaction().unwrap();
    for id in 0..CHUNKS {
        transaction
            .execute(
                "INSERT INTO memory_chunks (id, account, space_id, branch, record_id, content_hash,
                     embedded, due_at, text)
                 VALUES (?1, 'me', '', 'moments', ?1, ?1, 1, 0, ?2)",
                params![id, text],
            )
            .unwrap();
        transaction
            .execute(
                "INSERT INTO memory_vectors (chunk_id, account, space_id, branch, model, embedding)
                 VALUES (?1, 'me', '', 'moments', 'model', ?2)",
                params![id, vector_bytes(&vector(id as u64))],
            )
            .unwrap();
    }
    transaction.commit().unwrap();
    println!("stored {CHUNKS} chunks in {:?}", started.elapsed());
    let mut times = Vec::new();
    for round in 0..10 {
        let query = vector(1_000_000 + round);
        let started = Instant::now();
        let hits = search::search(&connection, "me", "", &["moments"], &query, "model", 20).unwrap();
        times.push(started.elapsed());
        assert_eq!(hits.len(), 20);
        assert!(hits.windows(2).all(|pair| pair[0].distance <= pair[1].distance));
    }
    println!("first search {:?}", times[0]);
    times.sort();
    println!("fastest {:?}, median {:?}, slowest {:?}", times[0], times[5], times[9]);
}
