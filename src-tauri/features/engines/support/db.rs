// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// src-tauri/src/db.rs. The engine layer's tables live in Misty's own database (misty.db) with a
// `cli_` prefix: the session index of each CLI's own files, the full-text search index, plan
// reviews and the engine settings. They belong to this device and are never synced; the CLIs' own files stay the
// source of truth.

use parking_lot::Mutex;
use rusqlite::Connection;

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
        retire_unused(&conn)?;
        // A separate connection takes its own WAL snapshot. `query_only` turns an accidental
        // write here into an immediate SQLITE_READONLY instead of a second writer racing the
        // indexer.
        let reader = store.connect()?;
        reader.pragma_update(None, "query_only", true)?;
        Ok(Self(Mutex::new(conn), Mutex::new(reader)))
    }

    /// A standalone database file, for tests.
    #[cfg(test)]
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
}

fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS cli_settings(
            id INTEGER PRIMARY KEY CHECK (id = 1),
            document TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS cli_signed_in_here(
            engine TEXT PRIMARY KEY
        );
        CREATE TABLE IF NOT EXISTS cli_workspaces(
            id TEXT PRIMARY KEY,
            path TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            last_opened_at INTEGER
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
            PRIMARY KEY(engine, session_id)
        );
        CREATE INDEX IF NOT EXISTS idx_cli_sessions_workspace ON cli_sessions(workspace_path);
        CREATE TABLE IF NOT EXISTS cli_meta(
            key TEXT PRIMARY KEY,
            value TEXT
        );
        CREATE TABLE IF NOT EXISTS cli_granted_roots(
            path TEXT PRIMARY KEY,
            granted_at INTEGER NOT NULL
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

/// The tables and columns earlier builds kept and nothing reads or writes any more: per-session
/// model, effort and channel memory, archive markers, recorded internal frames, and the
/// workspace grouping, ordering and remote metadata. Dropped on every open; once they are gone
/// this does nothing. Never edit a statement here, only add.
const RETIRED_TABLES: &[&str] = &[
    "cli_session_models",
    "cli_session_efforts",
    "cli_session_providers",
    "cli_session_archives",
    "cli_accepted_internal_frames",
];
const RETIRED_COLUMNS: &[(&str, &str)] = &[
    ("cli_workspaces", "sort_order"),
    ("cli_workspaces", "pinned"),
    ("cli_workspaces", "group_id"),
    ("cli_workspaces", "meta"),
    ("cli_workspaces", "kind"),
    ("cli_workspaces", "parent_id"),
    ("cli_sessions", "accepted_frames_signature"),
];

fn retire_unused(conn: &Connection) -> rusqlite::Result<()> {
    for table in RETIRED_TABLES {
        // Its indexes go with it.
        conn.execute_batch(&format!("DROP TABLE IF EXISTS {table};"))?;
    }
    for (table, column) in RETIRED_COLUMNS {
        let present: i64 = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name = ?2",
            rusqlite::params![table, column],
            |row| row.get(0),
        )?;
        if present > 0 {
            conn.execute_batch(&format!("ALTER TABLE {table} DROP COLUMN {column};"))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_older_database_loses_the_retired_tables_and_columns() {
        let dir = std::env::temp_dir().join(format!("misty-engine-db-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("misty.db");
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE cli_workspaces(id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL,
                    name TEXT NOT NULL, last_opened_at INTEGER, sort_order INTEGER,
                    pinned INTEGER NOT NULL DEFAULT 0, group_id TEXT, meta TEXT, kind TEXT,
                    parent_id TEXT);
                 INSERT INTO cli_workspaces(id, path, name, meta) VALUES('w', '/ws', 'ws', '{}');
                 CREATE TABLE cli_session_archives(engine TEXT, session_id TEXT,
                    workspace_path TEXT);
                 CREATE INDEX idx_cli_session_archives_workspace
                    ON cli_session_archives(workspace_path);
                 CREATE TABLE cli_accepted_internal_frames(engine TEXT, session_id TEXT,
                    frame_hash TEXT);",
            )
            .unwrap();
        }
        let db = Db::open_at(&path).unwrap();
        let conn = db.0.lock();
        let count = |sql: &str| -> i64 { conn.query_row(sql, [], |row| row.get(0)).unwrap() };
        for table in RETIRED_TABLES {
            assert_eq!(
                count(&format!(
                    "SELECT COUNT(*) FROM sqlite_master WHERE name = '{table}'"
                )),
                0,
                "{table}"
            );
        }
        for (table, column) in RETIRED_COLUMNS {
            assert_eq!(
                count(&format!(
                    "SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = '{column}'"
                )),
                0,
                "{table}.{column}"
            );
        }
        assert_eq!(db.workspace_paths().unwrap(), ["/ws"]);
        drop(conn);
        drop(db);
        // Opening again finds nothing left to retire.
        Db::open_at(&path).unwrap();
        std::fs::remove_dir_all(&dir).ok();
    }
}
