//! What waits for a vector. Each record's text is kept beside its vector so the computer's own embedding
//! model can make one (`src/features/agents/deviceEmbeddings.ts`), and a failed try waits and comes back.
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::search::{unit_vector, vector_bytes};
use super::{MemoryError, Result, MOMENTS};

const MAX_TEXT_CHARS: usize = 16_000;
const LEASE_MS: i64 = 5 * 60_000;
/// How often a chunk is tried before it waits a day, so a broken record never spends without end.
const ATTEMPTS: i64 = 5;

fn content_hash(text: &str) -> String {
    hex::encode(Sha256::digest(text))[..32].to_owned()
}

/// Keeps one record's text in the index. Unchanged text keeps its vector, and text the same person
/// already has in that Space reuses its vector instead of paying for another. Empty text removes the
/// record. `backfill` is a copy from the vault: it never counts against the backlog cap.
#[allow(clippy::too_many_arguments)]
pub(super) fn put(
    connection: &Connection,
    account: &str,
    space: &str,
    branch: &str,
    record: &str,
    text: &str,
    due: i64,
    backfill: bool,
) -> rusqlite::Result<()> {
    let body: String = text.trim().chars().take(MAX_TEXT_CHARS).collect();
    if body.is_empty() {
        remove(connection, account, space, branch, record)?;
        return Ok(());
    }
    let hash = content_hash(&body);
    let same: Option<String> = connection
        .query_row(
            "SELECT content_hash FROM memory_chunks
             WHERE account = ?1 AND space_id = ?2 AND branch = ?3 AND record_id = ?4",
            params![account, space, branch, record],
            |row| row.get(0),
        )
        .optional()?;
    if same.as_deref() == Some(hash.as_str()) {
        return Ok(());
    }
    remove(connection, account, space, branch, record)?;
    let reuse: Option<(String, Vec<u8>)> = connection
        .query_row(
            "SELECT v.model, v.embedding FROM memory_chunks c JOIN memory_vectors v ON v.chunk_id = c.id
             WHERE c.account = ?1 AND c.space_id = ?2 AND c.content_hash = ?3 AND c.embedded = 1 LIMIT 1",
            params![account, space, hash],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    connection.execute(
        "INSERT INTO memory_chunks (account, space_id, branch, record_id, content_hash, embedded,
             due_at, backfill, text)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![account, space, branch, record, hash, reuse.is_some(), due, backfill, body],
    )?;
    if let Some((model, embedding)) = reuse {
        connection.execute(
            "INSERT INTO memory_vectors (chunk_id, account, space_id, branch, model, embedding)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![connection.last_insert_rowid(), account, space, branch, model, embedding],
        )?;
    }
    mark_moment_indexed(connection, account, branch, record)
}

pub(super) fn remove(
    connection: &Connection,
    account: &str,
    space: &str,
    branch: &str,
    record: &str,
) -> rusqlite::Result<()> {
    connection.execute(
        "DELETE FROM memory_chunks
         WHERE account = ?1 AND space_id = ?2 AND branch = ?3 AND record_id = ?4",
        params![account, space, branch, record],
    )?;
    Ok(())
}

/// Says whether a moment can be found yet, which the tree shows.
fn mark_moment_indexed(
    connection: &Connection,
    account: &str,
    branch: &str,
    record: &str,
) -> rusqlite::Result<()> {
    if branch == MOMENTS {
        connection.execute(
            "UPDATE memory_events SET indexed = EXISTS (SELECT 1 FROM memory_chunks c
                 WHERE c.account = ?1 AND c.branch = 'moments' AND c.record_id = ?2 AND c.embedded = 1)
             WHERE account = ?1 AND id = ?2",
            params![account, record],
        )?;
    }
    Ok(())
}

/// How many of this computer's own moments wait for a vector.
pub(crate) fn waiting(connection: &Connection, account: &str) -> rusqlite::Result<i64> {
    connection.query_row(
        "SELECT count(*) FROM memory_chunks
         WHERE account = ?1 AND branch = 'moments' AND embedded = 0 AND backfill = 0",
        params![account],
        |row| row.get(0),
    )
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct ChunkKey {
    pub space_id: String,
    pub branch: String,
    pub record_id: String,
    pub content_hash: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct ClaimedChunk {
    #[serde(flatten)]
    pub key: ChunkKey,
    pub text: String,
}

/// Leases chunks that are due, so an interrupted batch is simply tried again later.
pub(crate) fn claim(
    connection: &Connection,
    account: &str,
    limit: i64,
    now: i64,
) -> rusqlite::Result<Vec<ClaimedChunk>> {
    let limit = if (1..=100).contains(&limit) { limit } else { 32 };
    let mut statement = connection.prepare_cached(
        "UPDATE memory_chunks SET lease_until = ?4, attempts = attempts + 1
         WHERE id IN (SELECT id FROM memory_chunks
             WHERE account = ?1 AND embedded = 0 AND due_at <= ?2
               AND (lease_until IS NULL OR lease_until <= ?2)
             ORDER BY due_at LIMIT ?3)
         RETURNING space_id, branch, record_id, content_hash, text",
    )?;
    let rows = statement
        .query_map(params![account, now, limit, now + LEASE_MS], |row| {
            Ok(ClaimedChunk {
                key: ChunkKey {
                    space_id: row.get(0)?,
                    branch: row.get(1)?,
                    record_id: row.get(2)?,
                    content_hash: row.get(3)?,
                },
                text: row.get(4)?,
            })
        })?
        .collect();
    rows
}

#[derive(Debug, Deserialize)]
pub(crate) struct EmbeddedChunk {
    #[serde(flatten)]
    pub key: ChunkKey,
    pub vector: Vec<f32>,
}

/// Stores a chunk's vector unless its text changed meanwhile.
pub(crate) fn complete(
    connection: &mut Connection,
    account: &str,
    model: &str,
    chunks: &[EmbeddedChunk],
) -> Result<()> {
    if chunks.is_empty() {
        return Ok(());
    }
    if model.trim().is_empty() || model.len() > 200 {
        return Err(MemoryError::Invalid("invalid_embedding"));
    }
    let transaction = connection.transaction()?;
    for chunk in chunks {
        let unit = unit_vector(&chunk.vector).ok_or(MemoryError::Invalid("invalid_embedding"))?;
        let key = &chunk.key;
        let id: Option<i64> = transaction
            .query_row(
                "UPDATE memory_chunks SET embedded = 1, lease_until = NULL
                 WHERE account = ?1 AND space_id = ?2 AND branch = ?3 AND record_id = ?4
                   AND content_hash = ?5 AND embedded = 0
                 RETURNING id",
                params![account, key.space_id, key.branch, key.record_id, key.content_hash],
                |row| row.get(0),
            )
            .optional()?;
        let Some(id) = id else { continue };
        transaction.execute(
            "INSERT INTO memory_vectors (chunk_id, account, space_id, branch, model, embedding)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, account, key.space_id, key.branch, model, vector_bytes(&unit)],
        )?;
        mark_moment_indexed(&transaction, account, &key.branch, &key.record_id)?;
    }
    transaction.commit()?;
    Ok(())
}

/// Backs a failed chunk off: a minute at first, a day after repeated failures.
pub(crate) fn retry(
    connection: &Connection,
    account: &str,
    chunks: &[ChunkKey],
    now: i64,
) -> rusqlite::Result<()> {
    let mut statement = connection.prepare_cached(
        "UPDATE memory_chunks SET lease_until = NULL,
             due_at = ?1 + CASE WHEN attempts >= ?2 THEN 86400000 ELSE 60000 END
         WHERE account = ?3 AND space_id = ?4 AND branch = ?5 AND record_id = ?6 AND embedded = 0",
    )?;
    for key in chunks {
        statement.execute(params![now, ATTEMPTS, account, key.space_id, key.branch, key.record_id])?;
    }
    Ok(())
}
