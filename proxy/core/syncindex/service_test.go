package syncindex

import (
	"context"
	"database/sql"
	"testing"

	dbpkg "github.com/kannachi323/misty/proxy/db"
	_ "github.com/mattn/go-sqlite3"
)

func setupServiceTestDB(t *testing.T) *dbpkg.Database {
	t.Helper()
	conn, err := sql.Open("sqlite3", ":memory:?_foreign_keys=on")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	if _, err := conn.Exec(`
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
CREATE TABLE IF NOT EXISTS watched_dirs (
    remote_name TEXT NOT NULL,
    rel_path TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (remote_name, rel_path)
);
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
    remote_revision TEXT NOT NULL DEFAULT '',
    mime_type TEXT NOT NULL DEFAULT '',
    state_code TEXT NOT NULL DEFAULT '',
    last_seen_local_at TEXT,
    last_seen_remote_at TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);`); err != nil {
		t.Fatalf("create test schema: %v", err)
	}
	return &dbpkg.Database{Conn: conn}
}

func TestDeriveDirectoryItemStateRemoteOnly(t *testing.T) {
	row := dbpkg.FileMetadata{
		RemoteExists: true,
		RemoteSize:   sql.NullInt64{Int64: 42, Valid: true},
	}

	state, dirty, direction := deriveDirectoryItemState(row)
	if state != "REM" || dirty || direction != "none" {
		t.Fatalf("got (%q, %v, %q), want (%q, %v, %q)", state, dirty, direction, "REM", false, "none")
	}
}

func TestDeriveDirectoryItemStateDirtyPush(t *testing.T) {
	row := dbpkg.FileMetadata{
		LocalExists: true,
		LocalDirty:  true,
		LocalSize:   sql.NullInt64{Int64: 11, Valid: true},
	}

	state, dirty, direction := deriveDirectoryItemState(row)
	if state != "LOC" || !dirty || direction != "push" {
		t.Fatalf("got (%q, %v, %q), want (%q, %v, %q)", state, dirty, direction, "LOC", true, "push")
	}
}

func TestLocalObservationChanged(t *testing.T) {
	prev := dbpkg.FileMetadata{
		LocalExists: true,
		LocalMTime:  "2026-04-16T10:00:00Z",
		LocalSize:   sql.NullInt64{Int64: 128, Valid: true},
	}
	current := prev
	if localObservationChanged(prev, current) {
		t.Fatal("expected unchanged local observation")
	}

	current.LocalMTime = "2026-04-16T10:05:00Z"
	if !localObservationChanged(prev, current) {
		t.Fatal("expected changed local observation")
	}
}

func TestLocalObservationChangedEquivalentTimestampFormats(t *testing.T) {
	prev := dbpkg.FileMetadata{
		LocalExists: true,
		LocalMTime:  "2026-04-20T07:29:36.472Z",
		LocalSize:   sql.NullInt64{Int64: 128, Valid: true},
	}
	current := dbpkg.FileMetadata{
		LocalExists: true,
		LocalMTime:  "2026-04-20T07:29:36.472000000Z",
		LocalSize:   sql.NullInt64{Int64: 128, Valid: true},
	}
	if localObservationChanged(prev, current) {
		t.Fatal("equivalent timestamp formats should not count as a local change")
	}
}

func TestRemoteObservationChanged(t *testing.T) {
	prev := dbpkg.FileMetadata{
		RemoteExists: true,
		RemoteMTime:  "2026-04-16T10:00:00Z",
		RemoteSize:   sql.NullInt64{Int64: 128, Valid: true},
	}
	current := prev
	if remoteObservationChanged(prev, current) {
		t.Fatal("expected unchanged remote observation")
	}

	current.RemoteSize = sql.NullInt64{Int64: 256, Valid: true}
	if !remoteObservationChanged(prev, current) {
		t.Fatal("expected changed remote observation")
	}
}

func TestRemoteObservationChangedIgnoresUnknownSizeTransitions(t *testing.T) {
	prev := dbpkg.FileMetadata{
		RemoteExists: true,
		RemoteMTime:  "2026-04-20T07:29:36.472Z",
		RemoteSize:   sql.NullInt64{Int64: 1115783, Valid: true},
	}
	current := dbpkg.FileMetadata{
		RemoteExists: true,
		RemoteMTime:  "2026-04-20T07:29:36.472000000Z",
		RemoteSize:   sql.NullInt64{Int64: -1, Valid: true},
	}
	if remoteObservationChanged(prev, current) {
		t.Fatal("drive-native unknown size should not count as a remote content change by itself")
	}
}

func TestMarkLocalDirtyIgnoresDuplicateWatcherEcho(t *testing.T) {
	database := setupServiceTestDB(t)
	service := NewService(database)
	row := dbpkg.FileMetadata{
		RemoteName:     "drive-test",
		RelPath:        "docs/report.txt",
		ParentRelPath:  "docs",
		Name:           "report.txt",
		LocalExists:    true,
		LocalMTime:     "2026-04-19T20:00:00Z",
		LocalSize:      sql.NullInt64{Int64: 128, Valid: true},
		RemoteExists:   true,
		RemoteMTime:    "2026-04-19T20:00:00Z",
		RemoteSize:     sql.NullInt64{Int64: 128, Valid: true},
		LocalDirty:     false,
		LastSyncedAt:   "2026-04-19T20:00:00Z",
		UpdatedAt:      "2026-04-19T20:00:00Z",
		LastComparedAt: "2026-04-19T20:00:00Z",
	}
	if err := dbpkg.UpsertFileMetadata(database.Conn, row); err != nil {
		t.Fatalf("seed metadata: %v", err)
	}

	if err := service.MarkLocalDirty(context.Background(), "drive-test", "docs/report.txt", true, false,
		"2026-04-19T20:00:00Z", 128); err != nil {
		t.Fatalf("MarkLocalDirty: %v", err)
	}

	got, err := dbpkg.GetFileMetadata(database.Conn, "drive-test", "docs/report.txt")
	if err != nil || got == nil {
		t.Fatalf("GetFileMetadata: %v (row=%v)", err, got)
	}
	if got.LocalDirty {
		t.Fatal("duplicate watcher echo should not re-dirty a synced row")
	}
}

func TestMarkLocalDirtyMarksRealLocalChange(t *testing.T) {
	database := setupServiceTestDB(t)
	service := NewService(database)
	row := dbpkg.FileMetadata{
		RemoteName:     "drive-test",
		RelPath:        "docs/report.txt",
		ParentRelPath:  "docs",
		Name:           "report.txt",
		LocalExists:    true,
		LocalMTime:     "2026-04-19T20:00:00Z",
		LocalSize:      sql.NullInt64{Int64: 128, Valid: true},
		RemoteExists:   true,
		RemoteMTime:    "2026-04-19T20:00:00Z",
		RemoteSize:     sql.NullInt64{Int64: 128, Valid: true},
		LocalDirty:     false,
		LastSyncedAt:   "2026-04-19T20:00:00Z",
		UpdatedAt:      "2026-04-19T20:00:00Z",
		LastComparedAt: "2026-04-19T20:00:00Z",
	}
	if err := dbpkg.UpsertFileMetadata(database.Conn, row); err != nil {
		t.Fatalf("seed metadata: %v", err)
	}

	if err := service.MarkLocalDirty(context.Background(), "drive-test", "docs/report.txt", true, false,
		"2026-04-19T20:05:00Z", 256); err != nil {
		t.Fatalf("MarkLocalDirty: %v", err)
	}

	got, err := dbpkg.GetFileMetadata(database.Conn, "drive-test", "docs/report.txt")
	if err != nil || got == nil {
		t.Fatalf("GetFileMetadata: %v (row=%v)", err, got)
	}
	if !got.LocalDirty {
		t.Fatal("real local change should mark row dirty")
	}
}

func TestMarkLocalDirtyCreatesSyncQueueEntry(t *testing.T) {
	database := setupServiceTestDB(t)
	service := NewService(database)

	if err := service.MarkLocalDirty(context.Background(), "drive-test", "docs/report.txt", true, false,
		"2026-04-19T20:05:00Z", 256); err != nil {
		t.Fatalf("MarkLocalDirty: %v", err)
	}

	root, err := dbpkg.GetSyncRootByRemoteName(database.Conn, "drive-test")
	if err != nil || root == nil {
		t.Fatalf("GetSyncRootByRemoteName: %v (root=%v)", err, root)
	}

	entries, err := dbpkg.ListSyncEntriesByParent(database.Conn, root.ID, "docs")
	if err != nil {
		t.Fatalf("ListSyncEntriesByParent: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected 1 sync entry, got %d", len(entries))
	}
	if !entries[0].IsDirty || entries[0].SyncDirection != "push" {
		t.Fatalf("unexpected sync entry: %+v", entries[0])
	}
}
