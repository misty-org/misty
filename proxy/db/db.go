package db

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"

	_ "github.com/mattn/go-sqlite3"
)

type Database struct {
	Conn *sql.DB
}

func (db *Database) GetDSN() string {
	path := os.Getenv("DB_PATH")
	if path == "" {
		home, _ := os.UserHomeDir()
		path = filepath.Join(home, "misty", "db", "data.db")
	}
	return path
}

func (db *Database) StartDatabase() error {
	dsn := db.GetDSN()

	conn, err := sql.Open("sqlite3", dsn+"?_foreign_keys=on")
	if err != nil {
		log.Println("Failed to open database: ", err)
		return err
	}

	if err := conn.Ping(); err != nil {
		log.Println("Failed to connect to database: ", err)
		return err
	}

	db.Conn = conn

	if err := ensureSyncSchema(conn); err != nil {
		log.Println("Failed to ensure sync schema: ", err)
		_ = conn.Close()
		return err
	}

	return nil
}

func (db *Database) Stop() {
	if db.Conn != nil {
		db.Conn.Close()
	}
}

func ensureSyncSchema(conn *sql.DB) error {
	const schema = `
CREATE TABLE IF NOT EXISTS sync_roots (
    id TEXT PRIMARY KEY,
    remote_name TEXT NOT NULL UNIQUE,
    remote_type TEXT NOT NULL DEFAULT '',
    provider_folder TEXT NOT NULL DEFAULT '',
    folder_name TEXT NOT NULL DEFAULT '',
    mount_root TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    dirty_bit INTEGER NOT NULL DEFAULT 0,
    last_refetch_at TEXT,
    last_poll_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_entries (
    id TEXT PRIMARY KEY,
    root_id TEXT NOT NULL REFERENCES sync_roots(id) ON DELETE CASCADE,
    rel_path TEXT NOT NULL,
    parent_rel_path TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    is_dir INTEGER NOT NULL DEFAULT 0,
    local_exists INTEGER NOT NULL DEFAULT 0,
    remote_exists INTEGER NOT NULL DEFAULT 0,
    is_dirty INTEGER NOT NULL DEFAULT 0,
    sync_direction TEXT NOT NULL DEFAULT 'none',
    local_mtime TEXT,
    local_size INTEGER,
    remote_mtime TEXT,
    remote_size INTEGER,
    remote_revision TEXT,
    mime_type TEXT NOT NULL DEFAULT '',
    state_code TEXT NOT NULL DEFAULT 'REM',
    last_seen_local_at TEXT,
    last_seen_remote_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(root_id, rel_path)
);

CREATE INDEX IF NOT EXISTS idx_sync_entries_root_parent_name
    ON sync_entries(root_id, parent_rel_path, name);
CREATE INDEX IF NOT EXISTS idx_sync_entries_root_dirty
    ON sync_entries(root_id, is_dirty);
CREATE INDEX IF NOT EXISTS idx_sync_entries_root_updated
    ON sync_entries(root_id, updated_at);

CREATE TABLE IF NOT EXISTS file_metadata (
    remote_name TEXT NOT NULL,
    rel_path TEXT NOT NULL,
    parent_rel_path TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    is_dir INTEGER NOT NULL DEFAULT 0,
    local_exists INTEGER NOT NULL DEFAULT 0,
    local_mtime TEXT,
    local_size INTEGER,
    remote_exists INTEGER NOT NULL DEFAULT 0,
    remote_mtime TEXT,
    remote_size INTEGER,
    remote_revision TEXT NOT NULL DEFAULT '',
    mime_type TEXT NOT NULL DEFAULT '',
    local_dirty INTEGER NOT NULL DEFAULT 0,
    last_local_event_at TEXT,
    last_local_seen_at TEXT,
    last_remote_seen_at TEXT,
    last_compared_at TEXT,
    last_synced_at TEXT,
    last_error TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (remote_name, rel_path)
);

CREATE INDEX IF NOT EXISTS idx_file_metadata_remote_parent_name
    ON file_metadata(remote_name, parent_rel_path, name);
CREATE INDEX IF NOT EXISTS idx_file_metadata_remote_updated
    ON file_metadata(remote_name, updated_at);
CREATE INDEX IF NOT EXISTS idx_file_metadata_remote_dirty
    ON file_metadata(remote_name, local_dirty);

CREATE TABLE IF NOT EXISTS watched_dirs (
    remote_name TEXT NOT NULL,
    rel_path TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (remote_name, rel_path)
);

CREATE TABLE IF NOT EXISTS file_hash (
    remote_name TEXT NOT NULL,
    rel_path TEXT NOT NULL,
    side TEXT NOT NULL,
    algorithm TEXT NOT NULL,
    hash_value TEXT NOT NULL,
    observed_mtime TEXT,
    observed_size INTEGER,
    computed_at TEXT NOT NULL,
    PRIMARY KEY (remote_name, rel_path, side, algorithm)
);
`

	if _, err := conn.Exec(schema); err != nil {
		return err
	}

	// Additive migrations for columns added after the initial schema shipped.
	// SQLite doesn't support "ADD COLUMN IF NOT EXISTS", so probe table_info
	// before issuing the ALTER.
	if err := addColumnIfMissing(conn, "sync_entries", "retry_count", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := addColumnIfMissing(conn, "sync_entries", "last_error", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	return nil
}

func addColumnIfMissing(conn *sql.DB, table, column, columnDef string) error {
	rows, err := conn.Query(fmt.Sprintf("PRAGMA table_info(%s)", table))
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull, pk int
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return err
		}
		if name == column {
			return nil
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	_, err = conn.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", table, column, columnDef))
	return err
}
