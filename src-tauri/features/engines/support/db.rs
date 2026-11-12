// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// src-tauri/src/db.rs. The engine layer's tables live in Misty's own database (misty.db) with a
// `cli_` prefix: the session index of each CLI's own files, the full-text search index, the
// model/effort/channel a session last ran, recorded internal frames, plan reviews and the engine
// settings. They belong to this device and are never synced; the CLIs' own files stay the
// source of truth.

use parking_lot::Mutex;
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicI64, Ordering};

static WRITE_STAMP: AtomicI64 = AtomicI64::new(0);

/// Monotonic write stamp sampled synchronously at the command entry point
/// before `spawn_blocking`. Even when two calls land in the same millisecond
/// or their blocking tasks acquire the writer mutex out of call order,
/// `next_write_stamp()` strictly increases with call order.
pub fn next_write_stamp() -> i64 {
    let wall = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
        .saturating_mul(1_000);
    let mut prev = WRITE_STAMP.load(Ordering::Relaxed);
    loop {
        let next = wall.max(prev + 1);
        match WRITE_STAMP.compare_exchange_weak(prev, next, Ordering::SeqCst, Ordering::Relaxed) {
            Ok(_) => return next,
            Err(actual) => prev = actual,
        }
    }
}

/// Raise the stamp counter past every stamp already on disk. The counter
/// restarts with the process, so a row stamped while the wall clock ran ahead
/// would otherwise make every later choice look stale (and be dropped by the
/// `updated_at` guard) until real time caught up.
fn seed_write_stamp(conn: &Connection) -> rusqlite::Result<()> {
    let stored: Option<i64> = conn.query_row(
        "SELECT MAX(updated_at) FROM (
             SELECT MAX(updated_at) AS updated_at FROM cli_session_models
             UNION ALL SELECT MAX(updated_at) FROM cli_session_efforts
             UNION ALL SELECT MAX(updated_at) FROM cli_session_providers
         )",
        [],
        |r| r.get(0),
    )?;
    if let Some(stored) = stored {
        WRITE_STAMP.fetch_max(stored, Ordering::SeqCst);
    }
    Ok(())
}

/// Folded into the scanner's stat signature so a schema/derivation change
/// still invalidates cached parse results. Version 3 also revalidates the
/// workspace attribution of unchanged Qoder transcripts.
pub const CACHE_VERSION: &str = "3";

static GLOBAL: std::sync::OnceLock<std::sync::Arc<Db>> = std::sync::OnceLock::new();

/// The store the app opened at startup, for the settings reads that have no handle.
pub fn global() -> Option<&'static std::sync::Arc<Db>> {
    GLOBAL.get()
}

/// Remembers the store the app opened, once.
pub fn set_global(db: std::sync::Arc<Db>) {
    let _ = GLOBAL.set(db);
}

/// Writer plus a dedicated read-only connection. WAL lets the reader run on
/// its own snapshot while the writer holds an index transaction; sharing one
/// connection made every `list_sessions`/`search` wait for a full FTS rebuild.
pub struct Db(pub Mutex<Connection>, Mutex<Connection>);

impl Db {
    /// Reader for hot query paths. Never use it for INSERT/UPDATE/DELETE:
    /// the connection runs with `query_only`, which rejects writes.
    pub fn read(&self) -> parking_lot::MutexGuard<'_, Connection> {
        self.1.lock()
    }

    /// Non-blocking passive WAL checkpoint so long-lived reader/writer
    /// connections do not let `app.db-wal` grow without bound after background
    /// index passes settle.
    pub fn wal_checkpoint_passive(&self) -> Result<(i64, i64), String> {
        let conn = self.0.lock();
        conn.query_row("PRAGMA wal_checkpoint(PASSIVE)", [], |r| {
            Ok((r.get(1)?, r.get(2)?))
        })
        .map_err(|e| e.to_string())
    }

    /// Opens the engine tables in Misty's database, through the same connection setup and
    /// migrations as every other store.
    pub fn open_store(store: &database::store::Store) -> rusqlite::Result<Self> {
        let conn = store.connect()?;
        migrate(&conn)?;
        seed_write_stamp(&conn)?;
        // A separate connection takes its own WAL snapshot. `query_only` turns an accidental
        // write here into an immediate SQLITE_READONLY instead of a second writer racing the
        // indexer.
        let reader = store.connect()?;
        reader.pragma_update(None, "query_only", true)?;
        Ok(Self(Mutex::new(conn), Mutex::new(reader)))
    }

    /// A standalone database file, for tests.
    pub fn open_at(path: &std::path::Path) -> rusqlite::Result<Self> {
        Self::open_store(&database::store::Store::at(path))
    }

    /// All registered workspace roots (session attribution + path confinement).
    pub fn workspace_paths(&self) -> Result<Vec<String>, String> {
        let conn = self.read();
        let mut stmt = conn
            .prepare("SELECT path FROM cli_workspaces")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            match row {
                Ok(path) => out.push(path),
                Err(e) => eprintln!("[db] skipping undecodable workspace row: {e}"),
            }
        }
        Ok(out)
    }

    /// Directories the user explicitly granted file access to on top of the
    /// registered workspaces (the on-demand grant flow, files::grant_root).
    pub fn granted_roots(&self) -> Result<Vec<String>, String> {
        let conn = self.read();
        let mut stmt = conn
            .prepare("SELECT path FROM cli_granted_roots ORDER BY granted_at")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            match row {
                Ok(path) => out.push(path),
                Err(e) => eprintln!("[db] skipping undecodable cli_granted_roots row: {e}"),
            }
        }
        Ok(out)
    }

    pub fn add_granted_root(&self, path: &str) -> Result<(), String> {
        let conn = self.0.lock();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        conn.execute(
            "INSERT OR IGNORE INTO cli_granted_roots(path, granted_at) VALUES(?1, ?2)",
            rusqlite::params![path, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn remove_granted_root(&self, path: &str) -> Result<(), String> {
        let conn = self.0.lock();
        conn.execute("DELETE FROM cli_granted_roots WHERE path=?1", [path])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    /// Per-plugin KV value (plugins::plugin_storage_get). Stored as JSON text;
    /// a corrupt row surfaces as an error instead of a silent `None` so the
    /// plugin host notices instead of losing state quietly.
    /// Devices that have reached the LAN bridge, newest first. `approved_at`
    /// being set is what lets a device through: the user approves each new
    /// device in the app before it can see or drive anything.
    /// every other client and for the next app start.
    pub fn remember_session_model(
        &self,
        engine: &str,
        session_id: &str,
        model: &str,
        now: i64,
    ) -> Result<(), String> {
        let conn = self.0.lock();
        conn.execute(
            "INSERT INTO cli_session_models(engine, session_id, model, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(engine, session_id) DO UPDATE
                SET model=excluded.model, updated_at=excluded.updated_at
              WHERE excluded.updated_at >= cli_session_models.updated_at",
            rusqlite::params![engine, session_id, model, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Remember the reasoning effort a session ran, beside its model. The
    /// picker follows the session, so a session reopened after a restart — or
    /// on the phone — keeps running the level it used instead of the engine
    /// default.
    pub fn remember_session_effort(
        &self,
        engine: &str,
        session_id: &str,
        effort: &str,
        now: i64,
    ) -> Result<(), String> {
        let conn = self.0.lock();
        conn.execute(
            "INSERT INTO cli_session_efforts(engine, session_id, effort, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(engine, session_id) DO UPDATE
                SET effort=excluded.effort, updated_at=excluded.updated_at
              WHERE excluded.updated_at >= cli_session_efforts.updated_at",
            rusqlite::params![engine, session_id, effort, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Remember the in-app channel a session ran. Spawn injects that channel's
    /// env onto the child and never rewrites the CLI's own files, so this row
    /// is what keeps two concurrent sessions of the same engine on different
    /// channels across restarts and other clients.
    pub fn remember_session_provider(
        &self,
        engine: &str,
        session_id: &str,
        provider_id: &str,
        now: i64,
    ) -> Result<(), String> {
        let conn = self.0.lock();
        conn.execute(
            "INSERT INTO cli_session_providers(engine, session_id, provider_id, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(engine, session_id) DO UPDATE
                SET provider_id=excluded.provider_id, updated_at=excluded.updated_at
              WHERE excluded.updated_at >= cli_session_providers.updated_at",
            rusqlite::params![engine, session_id, provider_id, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Approve (or re-approve) a device. Unknown ids are ignored: the row is
    /// created by the device's own request, never by the UI.

    pub fn record_accepted_internal_frame_hash(
        &self,
        engine: &str,
        session_id: &str,
        frame_hash: &str,
        workspace_path: &str,
    ) -> Result<bool, String> {
        let conn = self.0.lock();
        let changed = conn
            .execute(
                "INSERT OR IGNORE INTO cli_accepted_internal_frames(engine, session_id, frame_hash, workspace_path)
                 VALUES(?1, ?2, ?3, ?4)",
                rusqlite::params![engine, session_id, frame_hash, workspace_path],
            )
            .map_err(|error| error.to_string())?;
        if changed == 0 {
            return Ok(false);
        }
        // The FTS stamp only tracks file stat + INDEX_VERSION, so a frame the
        // engine already wrote (and the indexer may already have ingested)
        // would stay searchable forever. Drop the stamp under the same lock:
        // PENDING_FROM treats a missing row as pending and the next pass
        // re-indexes with this identity hidden. Stale session_messages rows
        // are replaced by that re-index.
        conn.execute(
            "DELETE FROM cli_fts_state WHERE engine=?1 AND session_id=?2",
            rusqlite::params![engine, session_id],
        )
        .map_err(|error| error.to_string())?;
        Ok(true)
    }

    pub fn accepted_internal_frames(
        &self,
        engine: &str,
        session_id: &str,
    ) -> Result<(HashSet<String>, String), String> {
        let conn = self.read();
        accepted_internal_frames_from(&conn, engine, session_id)
    }

    /// Every recorded identity, grouped `engine -> session -> set`, plus a
    /// signature over the whole table. The scanner folds the table signature
    /// into its global stat signature so newly recorded identities re-open a
    /// scan that no file change would otherwise justify, and compares each
    /// row's stored per-session signature to decide which files to re-derive.
    pub fn accepted_internal_frame_index(&self) -> Result<(AcceptedFrameIndex, String), String> {
        let conn = self.read();
        let mut stmt = conn
            .prepare(
                "SELECT engine, session_id, frame_hash FROM cli_accepted_internal_frames
                 ORDER BY engine, session_id, frame_hash",
            )
            .map_err(|error| error.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|error| error.to_string())?;
        let mut index: HashMap<String, HashMap<String, HashSet<String>>> = HashMap::new();
        let mut hasher = Sha256::new();
        let mut any = false;
        for row in rows {
            let (engine, session_id, frame_hash) = row.map_err(|error| error.to_string())?;
            hasher.update(engine.as_bytes());
            hasher.update(b"/");
            hasher.update(session_id.as_bytes());
            hasher.update(b"/");
            hasher.update(frame_hash.as_bytes());
            any = true;
            index
                .entry(engine)
                .or_default()
                .entry(session_id)
                .or_default()
                .insert(frame_hash);
        }
        // Per-session signatures are derived once here: the scanner asks for
        // them per candidate file, and re-hashing a set per candidate would
        // make a cold scan quadratic in recorded frames.
        let index = index
            .into_iter()
            .map(|(engine, sessions)| {
                let sessions = sessions
                    .into_iter()
                    .map(|(session_id, hashes)| {
                        let signature = accepted_frame_set_signature(&hashes);
                        (session_id, AcceptedFrameSet { hashes, signature })
                    })
                    .collect();
                (engine, sessions)
            })
            .collect();
        let signature = if any {
            format!("{:x}", hasher.finalize())
        } else {
            String::new()
        };
        Ok((index, signature))
    }
}

/// One session's recorded frame identities plus the signature that identifies
/// the set. An empty set signs as `""`, matching the stored column default so
/// sessions that never carried an internal frame are never re-derived.
#[derive(Debug, Default)]
pub struct AcceptedFrameSet {
    pub hashes: HashSet<String>,
    pub signature: String,
}

/// Recorded frame identities grouped by engine, then native session id.
pub type AcceptedFrameIndex = HashMap<String, HashMap<String, AcceptedFrameSet>>;

/// Identity set plus its signature, readable through a caller-owned connection.
/// The indexer re-checks the signature under its write lock (same connection),
/// so a frame recorded while a file was being parsed cannot be published.
pub(crate) fn accepted_internal_frames_from(
    conn: &rusqlite::Connection,
    engine: &str,
    session_id: &str,
) -> Result<(HashSet<String>, String), String> {
    let mut stmt = conn
        .prepare(
            "SELECT frame_hash FROM cli_accepted_internal_frames WHERE engine=?1 AND session_id=?2 ORDER BY frame_hash",
        )
        .map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![engine, session_id], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|error| error.to_string())?;
    let mut hashes = HashSet::new();
    for row in rows {
        hashes.insert(row.map_err(|error| error.to_string())?);
    }
    let signature = accepted_frame_set_signature(&hashes);
    Ok((hashes, signature))
}

/// Identity of one session's accepted-frame set: two sets with the same
/// members produce the same signature regardless of insertion order.
pub fn accepted_frame_set_signature(hashes: &HashSet<String>) -> String {
    if hashes.is_empty() {
        return String::new();
    }
    let mut ordered: Vec<&str> = hashes.iter().map(String::as_str).collect();
    ordered.sort_unstable();
    let mut hasher = Sha256::new();
    for hash in ordered {
        hasher.update(hash.as_bytes());
    }
    format!("{:x}", hasher.finalize())
}

fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS cli_settings(
            id INTEGER PRIMARY KEY CHECK (id = 1),
            document TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS cli_workspaces(
            id TEXT PRIMARY KEY,
            path TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            last_opened_at INTEGER,
            sort_order INTEGER,
            pinned INTEGER NOT NULL DEFAULT 0,
            group_id TEXT,
            meta TEXT,
            kind TEXT,
            parent_id TEXT
        );
        CREATE TABLE IF NOT EXISTS cli_sessions(
            engine TEXT NOT NULL,
            session_id TEXT NOT NULL,
            workspace_path TEXT NOT NULL,
            file_path TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            file_mtime_ms INTEGER NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            preview TEXT NOT NULL DEFAULT '',
            created_at INTEGER,
            updated_at INTEGER,
            message_count INTEGER NOT NULL DEFAULT 0,
            pinned INTEGER NOT NULL DEFAULT 0,
            custom_title TEXT,
            accepted_frames_signature TEXT NOT NULL DEFAULT '',
            PRIMARY KEY(engine, session_id)
        );
        CREATE INDEX IF NOT EXISTS idx_cli_sessions_workspace ON cli_sessions(workspace_path);
        -- App-owned archive markers. CLI transcripts remain untouched; the
        -- independent marker survives scanner upserts and workspace re-adds.
        -- The snapshot also covers plugin-fed remote sessions, which have no
        -- local row in `sessions`.
        CREATE TABLE IF NOT EXISTS cli_session_archives(
            engine TEXT NOT NULL,
            session_id TEXT NOT NULL,
            workspace_path TEXT NOT NULL,
            snapshot_json TEXT NOT NULL,
            archived_at INTEGER NOT NULL,
            PRIMARY KEY(engine, session_id)
        );
        CREATE INDEX IF NOT EXISTS idx_cli_session_archives_workspace
            ON cli_session_archives(workspace_path);
        CREATE TABLE IF NOT EXISTS cli_meta(
            key TEXT PRIMARY KEY,
            value TEXT
        );
        CREATE TABLE IF NOT EXISTS cli_granted_roots(
            path TEXT PRIMARY KEY,
            granted_at INTEGER NOT NULL
        );
        -- `workspace_path` is the workspace the frame was accepted in. A
        -- remote session has no `sessions` row, so a purge that joins through
        -- it can never reach these identities; the column is what lets
        -- removing a workspace reclaim them.
        CREATE TABLE IF NOT EXISTS cli_accepted_internal_frames(
            engine TEXT NOT NULL,
            session_id TEXT NOT NULL,
            frame_hash TEXT NOT NULL,
            workspace_path TEXT NOT NULL DEFAULT '',
            PRIMARY KEY(engine, session_id, frame_hash)
        );
        CREATE TABLE IF NOT EXISTS cli_session_models(
            engine TEXT NOT NULL,
            session_id TEXT NOT NULL,
            model TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY(engine, session_id)
        );
        -- Reasoning effort the session last ran, same shape and same reason as
        -- the model row above: the transcript is not a reliable carrier, and a
        -- session reopened here must keep running the level it used.
        CREATE TABLE IF NOT EXISTS cli_session_efforts(
            engine TEXT NOT NULL,
            session_id TEXT NOT NULL,
            effort TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY(engine, session_id)
        );
        -- Channel the session last ran. Spawn injects env from this id; the
        -- CLI's own files stay official so concurrent sessions can differ.
        CREATE TABLE IF NOT EXISTS cli_session_providers(
            engine TEXT NOT NULL,
            session_id TEXT NOT NULL,
            provider_id TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY(engine, session_id)
        );
        -- Message bodies for full-text search. The transcript files stay
        -- the source of truth; this table is a derived index rebuilt by
        -- history::search::index_pending whenever a file's stat moves.
        CREATE TABLE IF NOT EXISTS cli_session_messages(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            engine TEXT NOT NULL,
            session_id TEXT NOT NULL,
            seq INTEGER NOT NULL,
            role TEXT NOT NULL,
            text TEXT NOT NULL,
            ts_ms INTEGER,
            UNIQUE(engine, session_id, seq),
            FOREIGN KEY(engine, session_id)
                REFERENCES cli_sessions(engine, session_id) ON DELETE CASCADE
        );
        -- External-content FTS5: text lives once in cli_session_messages, the
        -- FTS table is index-only and the triggers sync both in the same
        -- transaction. trigram because unicode61 (agentsview's choice) has
        -- no CJK substring capability: a run of Chinese is one token there,
        -- while trigram gives substring match for Chinese and English alike.
        CREATE VIRTUAL TABLE IF NOT EXISTS cli_messages_fts USING fts5(
            text,
            content='cli_session_messages',
            content_rowid='id',
            tokenize='trigram'
        );
        CREATE TRIGGER IF NOT EXISTS cli_session_messages_ai AFTER INSERT ON cli_session_messages BEGIN
            INSERT INTO cli_messages_fts(rowid, text) VALUES(new.id, new.text);
        END;
        CREATE TRIGGER IF NOT EXISTS cli_session_messages_ad AFTER DELETE ON cli_session_messages BEGIN
            INSERT INTO cli_messages_fts(cli_messages_fts, rowid, text) VALUES('delete', old.id, old.text);
        END;
        CREATE TRIGGER IF NOT EXISTS cli_session_messages_au AFTER UPDATE ON cli_session_messages BEGIN
            INSERT INTO cli_messages_fts(cli_messages_fts, rowid, text) VALUES('delete', old.id, old.text);
            INSERT INTO cli_messages_fts(rowid, text) VALUES(new.id, new.text);
        END;
        -- Per-session index stamp: a session re-parses only when its file
        -- stat or the index derivation version moved. Cascade-kept with the
        -- sessions row like cli_session_messages.
        CREATE TABLE IF NOT EXISTS cli_fts_state(
            engine TEXT NOT NULL,
            session_id TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            file_mtime_ms INTEGER NOT NULL,
            version TEXT NOT NULL,
            indexed_at INTEGER NOT NULL,
            PRIMARY KEY(engine, session_id),
            FOREIGN KEY(engine, session_id)
                REFERENCES cli_sessions(engine, session_id) ON DELETE CASCADE
        );
        -- The source of truth for plan reviews (engine/plan_review.rs). No foreign key: a
        -- sessions row is built by the scanner from the transcript and can arrive after the
        -- plan record; the session cleanup paths cascade to it explicitly.
        CREATE TABLE IF NOT EXISTS cli_plan_reviews(
            plan_id TEXT NOT NULL,
            engine TEXT NOT NULL,
            session_id TEXT NOT NULL,
            workspace_path TEXT NOT NULL,
            run_id TEXT,
            revision INTEGER NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            complete INTEGER NOT NULL DEFAULT 0,
            review_kind TEXT NOT NULL,
            native_plan_id TEXT,
            exec_permission TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL,
            execution TEXT NOT NULL DEFAULT 'not_started',
            decision TEXT,
            decision_intent_at INTEGER,
            applied_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            superseded_by INTEGER,
            PRIMARY KEY(plan_id, revision)
        );
        CREATE INDEX IF NOT EXISTS idx_cli_plan_reviews_session
            ON cli_plan_reviews(engine, session_id);
        ",
    )
}
