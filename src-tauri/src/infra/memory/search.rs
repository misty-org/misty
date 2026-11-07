//! Search by meaning: every vector is kept as 768 little-endian float32s scaled to length 1, so cosine
//! distance is one minus their dot product, and a search reads that person's vectors in one Space and
//! keeps the nearest. No index and no new dependency; `search_timing_tests` measures it at 50,000.
use std::cmp::Ordering;
use std::collections::BinaryHeap;

use rusqlite::{params, Connection};
use serde::Serialize;

pub(crate) const DIMENSIONS: usize = 768;

/// One record found by meaning.
#[derive(Clone, Debug, Serialize)]
pub(crate) struct MemoryHit {
    pub branch: String,
    pub record_id: String,
    pub text: String,
    pub distance: f64,
}

/// A vector scaled to length 1, or nothing when it can't be: the wrong size, not finite, or all zeros.
pub(crate) fn unit_vector(values: &[f32]) -> Option<Vec<f32>> {
    if values.len() != DIMENSIONS || values.iter().any(|value| !value.is_finite()) {
        return None;
    }
    let length = values
        .iter()
        .map(|value| f64::from(*value) * f64::from(*value))
        .sum::<f64>()
        .sqrt();
    if length == 0.0 {
        return None;
    }
    Some(values.iter().map(|value| (f64::from(*value) / length) as f32).collect())
}

pub(crate) fn vector_bytes(unit: &[f32]) -> Vec<u8> {
    unit.iter().flat_map(|value| value.to_le_bytes()).collect()
}

fn dot(unit: &[f32], stored: &[u8]) -> Option<f32> {
    if stored.len() != DIMENSIONS * 4 {
        return None;
    }
    let mut sum = 0.0;
    for (value, bytes) in unit.iter().zip(stored.chunks_exact(4)) {
        sum += value * f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
    }
    Some(sum)
}

/// A candidate in the heap of the nearest so far: the worst is on top, to be pushed out.
struct Near {
    similarity: f32,
    chunk: i64,
}

impl PartialEq for Near {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}
impl Eq for Near {}
impl PartialOrd for Near {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Near {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .similarity
            .total_cmp(&self.similarity)
            .then_with(|| self.chunk.cmp(&other.chunk))
    }
}

/// The chunks nearest to `query`, nearest first. Only vectors from the same model are comparable.
pub(crate) fn nearest(
    connection: &Connection,
    account: &str,
    space: &str,
    branches: &[&str],
    query: &[f32],
    model: &str,
    limit: usize,
) -> rusqlite::Result<Vec<(i64, f32)>> {
    let Some(unit) = unit_vector(query) else {
        return Ok(Vec::new());
    };
    if model.is_empty() || branches.is_empty() {
        return Ok(Vec::new());
    }
    let wanted = serde_json::to_string(branches).unwrap_or_else(|_| "[]".to_owned());
    let mut statement = connection.prepare_cached(
        "SELECT chunk_id, embedding FROM memory_vectors
         WHERE account = ?1 AND space_id = ?2 AND model = ?3
           AND branch IN (SELECT value FROM json_each(?4))",
    )?;
    let mut rows = statement.query(params![account, space, model, wanted])?;
    let mut heap: BinaryHeap<Near> = BinaryHeap::with_capacity(limit + 1);
    while let Some(row) = rows.next()? {
        let chunk: i64 = row.get(0)?;
        let Some(similarity) = dot(&unit, row.get_ref(1)?.as_blob()?) else {
            continue;
        };
        heap.push(Near { similarity, chunk });
        if heap.len() > limit {
            heap.pop();
        }
    }
    Ok(heap
        .into_sorted_vec()
        .into_iter()
        .map(|near| (near.chunk, near.similarity))
        .collect())
}

/// One person's records in one Space, nearest in meaning first. There is no word search: without a
/// query vector there are no hits.
pub(crate) fn search(
    connection: &Connection,
    account: &str,
    space: &str,
    branches: &[&str],
    query: &[f32],
    model: &str,
    limit: i64,
) -> rusqlite::Result<Vec<MemoryHit>> {
    let limit = if (1..=50).contains(&limit) { limit as usize } else { 10 };
    let found = nearest(connection, account, space, branches, query, model, limit)?;
    let mut statement = connection
        .prepare_cached("SELECT branch, record_id, text FROM memory_chunks WHERE id = ?1")?;
    found
        .into_iter()
        .map(|(chunk, similarity)| {
            statement.query_row(params![chunk], |row| {
                Ok(MemoryHit {
                    branch: row.get(0)?,
                    record_id: row.get(1)?,
                    text: row.get(2)?,
                    distance: 1.0 - f64::from(similarity),
                })
            })
        })
        .collect()
}
