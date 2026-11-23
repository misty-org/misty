// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

use super::types::UsageEvent;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashMap;
use std::path::Path;

const SCHEMA_VERSION: &str = "1";

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS files (
    path      TEXT PRIMARY KEY,
    engine    TEXT NOT NULL,
    size      INTEGER NOT NULL,
    mtime_ms  INTEGER NOT NULL,
    offset    INTEGER NOT NULL,
    head_len  INTEGER NOT NULL,
    head_hash TEXT NOT NULL,
    state     TEXT
);
CREATE TABLE IF NOT EXISTS events (
    key         TEXT PRIMARY KEY,
    ts_ms       INTEGER NOT NULL,
    engine      TEXT NOT NULL,
    model       TEXT NOT NULL,
    project     TEXT,
    session_id  TEXT,
    input       INTEGER NOT NULL,
    output      INTEGER NOT NULL,
    cache_read  INTEGER NOT NULL,
    cache_write INTEGER NOT NULL,
    reasoning   INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS events_ts ON events(ts_ms);
CREATE TABLE IF NOT EXISTS codex_lineage (
    session_id TEXT PRIMARY KEY,
    root_id    TEXT NOT NULL
);
";

const DROP_ALL: &str = "
DROP TABLE IF EXISTS meta;
DROP TABLE IF EXISTS files;
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS codex_lineage;
";

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Cursor {
    pub path: String,
    pub engine: String,
    pub size: i64,
    pub mtime_ms: i64,
    pub offset: i64,
    pub head_len: i64,
    pub head_hash: String,
    pub state: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct AggRow {
    pub bucket: String,
    pub engine: String,
    pub model: String,
    pub project: Option<String>,
    pub sessions: i64,
    pub requests: i64,
    pub input: i64,
    pub output: i64,
    pub cache_read: i64,
    pub cache_write: i64,
    pub reasoning: i64,
}

pub(crate) fn open(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        file_access::fs::create_dir_all(parent)
            .map_err(|e| format!("create {}: {e}", parent.display()))?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = file_access::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path);
        if let Err(e) =
            file_access::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        {
            eprintln!("[usage-stats] chmod 0600 {}: {e}", path.display());
        }
    }
    let conn =
        file_access::fs::open_sqlite(path).map_err(|e| format!("open usage-stats db: {e}"))?;
    configure(&conn).map_err(|e| format!("configure usage-stats db: {e}"))?;
    migrate(&conn).map_err(|e| format!("migrate usage-stats db: {e}"))?;
    Ok(conn)
}

fn configure(conn: &Connection) -> rusqlite::Result<()> {
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
}

fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let version: Option<String> = conn
        .query_row(
            "SELECT value FROM meta WHERE key = 'schema_version'",
            [],
            |r| r.get(0),
        )
        .optional()
        .unwrap_or(None);
    if version.as_deref() == Some(SCHEMA_VERSION) {
        return Ok(());
    }
    conn.execute_batch(DROP_ALL)?;
    conn.execute_batch(SCHEMA)?;
    set_meta(conn, "schema_version", SCHEMA_VERSION)
}

pub(crate) fn reset_cursors(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "DELETE FROM files; DELETE FROM codex_lineage;
         DELETE FROM meta WHERE key <> 'schema_version';",
    )
}

pub(crate) fn get_meta(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get(0))
        .optional()
}

pub(crate) fn set_meta(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO meta(key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map(|_| ())
}

pub(crate) fn get_meta_i64(conn: &Connection, key: &str) -> rusqlite::Result<Option<i64>> {
    Ok(get_meta(conn, key)?.and_then(|v| v.parse().ok()))
}

pub(crate) fn cursors_for(
    conn: &Connection,
    engine: &str,
) -> rusqlite::Result<HashMap<String, Cursor>> {
    let mut stmt = conn.prepare(
        "SELECT path, engine, size, mtime_ms, offset, head_len, head_hash, state
         FROM files WHERE engine = ?1",
    )?;
    let rows = stmt.query_map([engine], |r| {
        Ok(Cursor {
            path: r.get(0)?,
            engine: r.get(1)?,
            size: r.get(2)?,
            mtime_ms: r.get(3)?,
            offset: r.get(4)?,
            head_len: r.get(5)?,
            head_hash: r.get(6)?,
            state: r.get(7)?,
        })
    })?;
    rows.map(|row| row.map(|c| (c.path.clone(), c))).collect()
}

pub(crate) fn save_cursor(conn: &Connection, cursor: &Cursor) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO files(path, engine, size, mtime_ms, offset, head_len, head_hash, state)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(path) DO UPDATE SET engine = excluded.engine, size = excluded.size,
           mtime_ms = excluded.mtime_ms, offset = excluded.offset, head_len = excluded.head_len,
           head_hash = excluded.head_hash, state = excluded.state",
        params![
            cursor.path,
            cursor.engine,
            cursor.size,
            cursor.mtime_ms,
            cursor.offset,
            cursor.head_len,
            cursor.head_hash,
            cursor.state
        ],
    )
    .map(|_| ())
}

pub(crate) fn prune_cursors(
    conn: &Connection,
    engine: &str,
    keep: &[String],
) -> rusqlite::Result<usize> {
    let existing = cursors_for(conn, engine)?;
    let keep: std::collections::HashSet<&str> = keep.iter().map(String::as_str).collect();
    let mut removed = 0;
    for path in existing.keys().filter(|p| !keep.contains(p.as_str())) {
        removed += conn.execute("DELETE FROM files WHERE path = ?1", [path])?;
    }
    Ok(removed)
}

pub(crate) fn upsert_event(conn: &Connection, event: &UsageEvent) -> rusqlite::Result<bool> {
    let mut stmt = conn.prepare_cached(
        "INSERT INTO events(key, ts_ms, engine, model, project, session_id,
                            input, output, cache_read, cache_write, reasoning)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(key) DO UPDATE SET
           ts_ms = MIN(events.ts_ms, excluded.ts_ms),
           model = excluded.model,
           project = COALESCE(events.project, excluded.project),
           session_id = COALESCE(events.session_id, excluded.session_id),
           input = excluded.input, output = excluded.output,
           cache_read = excluded.cache_read, cache_write = excluded.cache_write,
           reasoning = excluded.reasoning
         WHERE excluded.ts_ms < events.ts_ms
            OR events.model IS NOT excluded.model
            OR (events.project IS NULL AND excluded.project IS NOT NULL)
            OR (events.session_id IS NULL AND excluded.session_id IS NOT NULL)
            OR events.input <> excluded.input OR events.output <> excluded.output
            OR events.cache_read <> excluded.cache_read
            OR events.cache_write <> excluded.cache_write
            OR events.reasoning <> excluded.reasoning",
    )?;
    let t = &event.tokens;
    let changed = stmt.execute(params![
        event.key,
        event.ts_ms,
        event.engine,
        event.model,
        event.project,
        event.session_id,
        t.input,
        t.output,
        t.cache_read,
        t.cache_write,
        t.reasoning
    ])?;
    Ok(changed > 0)
}

pub(crate) fn load_lineage(conn: &Connection) -> rusqlite::Result<HashMap<String, String>> {
    let mut stmt = conn.prepare("SELECT session_id, root_id FROM codex_lineage")?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    rows.collect()
}

pub(crate) fn save_lineage(conn: &Connection, pairs: &[(String, String)]) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare_cached(
        "INSERT INTO codex_lineage(session_id, root_id) VALUES (?1, ?2)
         ON CONFLICT(session_id) DO UPDATE SET root_id = excluded.root_id",
    )?;
    for (session, root) in pairs {
        stmt.execute(params![session, root])?;
    }
    Ok(())
}

pub(crate) fn aggregate(
    conn: &Connection,
    from_ms: i64,
    to_ms: i64,
    hourly: bool,
    tz_offset_minutes: i32,
) -> rusqlite::Result<Vec<AggRow>> {
    let format = if hourly { "%Y-%m-%dT%H" } else { "%Y-%m-%d" };
    let offset_ms = i64::from(tz_offset_minutes) * 60_000;
    let mut stmt = conn.prepare(
        "SELECT strftime(?1, (ts_ms + ?2) / 1000, 'unixepoch') AS bucket,
                engine, model, project,
                COUNT(DISTINCT session_id), COUNT(*),
                SUM(input), SUM(output), SUM(cache_read), SUM(cache_write), SUM(reasoning)
         FROM events
         WHERE ts_ms >= ?3 AND ts_ms < ?4
         GROUP BY bucket, engine, model, project
         ORDER BY bucket, engine, model, project",
    )?;
    let rows = stmt.query_map(params![format, offset_ms, from_ms, to_ms], |r| {
        Ok(AggRow {
            bucket: r.get(0)?,
            engine: r.get(1)?,
            model: r.get(2)?,
            project: r.get(3)?,
            sessions: r.get(4)?,
            requests: r.get(5)?,
            input: r.get(6)?,
            output: r.get(7)?,
            cache_read: r.get(8)?,
            cache_write: r.get(9)?,
            reasoning: r.get(10)?,
        })
    })?;
    rows.collect()
}

pub(crate) fn first_event_ms(conn: &Connection) -> rusqlite::Result<Option<i64>> {
    conn.query_row("SELECT MIN(ts_ms) FROM events", [], |r| r.get(0))
}

#[cfg(test)]
pub(crate) fn event_count(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM events", [], |r| r.get(0))
        .unwrap_or(-1)
}
