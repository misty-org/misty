package db

import (
	"database/sql"
	"strings"
	"testing"
)

func TestEnsureSyncSchemaCreatesTablesAndIndexes(t *testing.T) {
	conn, err := sql.Open("sqlite3", ":memory:?_foreign_keys=on")
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()

	if err := ensureSyncSchema(conn); err != nil {
		t.Fatalf("ensureSyncSchema: %v", err)
	}

	expectedTables := []string{"sync_roots", "sync_entries"}
	for _, name := range expectedTables {
		var got string
		err := conn.QueryRow(`
			SELECT name
			FROM sqlite_master
			WHERE type = 'table' AND name = ?
		`, name).Scan(&got)
		if err != nil {
			t.Fatalf("missing table %q: %v", name, err)
		}
		if got != name {
			t.Fatalf("got table %q, want %q", got, name)
		}
	}

	expectedIndexes := []string{
		"idx_sync_entries_root_parent_name",
		"idx_sync_entries_root_dirty",
		"idx_sync_entries_root_updated",
	}
	for _, name := range expectedIndexes {
		var got string
		err := conn.QueryRow(`
			SELECT name
			FROM sqlite_master
			WHERE type = 'index' AND name = ?
		`, name).Scan(&got)
		if err != nil {
			t.Fatalf("missing index %q: %v", name, err)
		}
		if got != name {
			t.Fatalf("got index %q, want %q", got, name)
		}
	}

	expectedColumns := []string{"retry_count", "last_error"}
	for _, name := range expectedColumns {
		var got string
		err := conn.QueryRow(`
			SELECT name FROM pragma_table_info('sync_entries') WHERE name = ?
		`, name).Scan(&got)
		if err != nil {
			t.Fatalf("missing column sync_entries.%s: %v", name, err)
		}
	}
}

func TestAddColumnIfMissingIdempotent(t *testing.T) {
	conn, err := sql.Open("sqlite3", ":memory:?_foreign_keys=on")
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()

	if err := ensureSyncSchema(conn); err != nil {
		t.Fatalf("ensureSyncSchema: %v", err)
	}
	// Second call must be a no-op when columns already exist — simulates
	// a proxy restart against a previously-migrated DB.
	if err := ensureSyncSchema(conn); err != nil {
		t.Fatalf("ensureSyncSchema second call: %v", err)
	}
}

func setupSyncEntriesTestDB(t *testing.T) *sql.DB {
	t.Helper()
	conn, err := sql.Open("sqlite3", ":memory:?_foreign_keys=on")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	if err := ensureSyncSchema(conn); err != nil {
		t.Fatalf("ensureSyncSchema: %v", err)
	}
	root := SyncRoot{
		ID: "remote-1", RemoteName: "remote-1", MountRoot: "/tmp",
		Enabled: true, CreatedAt: "now", UpdatedAt: "now",
	}
	if err := UpsertSyncRoot(conn, root); err != nil {
		t.Fatalf("UpsertSyncRoot: %v", err)
	}
	return conn
}

func TestListDirtySyncEntriesOrdersByRetryThenUpdated(t *testing.T) {
	conn := setupSyncEntriesTestDB(t)

	entries := []SyncEntry{
		{ID: "remote-1:a.txt", RootID: "remote-1", RelPath: "a.txt", Name: "a.txt", IsDirty: true,
			RetryCount: 3, UpdatedAt: "2026-04-15T10:00:00Z", CreatedAt: "now"},
		{ID: "remote-1:b.txt", RootID: "remote-1", RelPath: "b.txt", Name: "b.txt", IsDirty: true,
			RetryCount: 0, UpdatedAt: "2026-04-17T10:00:00Z", CreatedAt: "now"},
		{ID: "remote-1:c.txt", RootID: "remote-1", RelPath: "c.txt", Name: "c.txt", IsDirty: true,
			RetryCount: 0, UpdatedAt: "2026-04-16T10:00:00Z", CreatedAt: "now"},
		{ID: "remote-1:clean.txt", RootID: "remote-1", RelPath: "clean.txt", Name: "clean.txt", IsDirty: false,
			RetryCount: 0, UpdatedAt: "2026-04-14T10:00:00Z", CreatedAt: "now"},
	}
	for _, entry := range entries {
		if err := UpsertSyncEntry(conn, entry); err != nil {
			t.Fatalf("UpsertSyncEntry: %v", err)
		}
	}

	got, err := ListDirtySyncEntries(conn, "remote-1", 10)
	if err != nil {
		t.Fatalf("ListDirtySyncEntries: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("got %d dirty entries, want 3", len(got))
	}
	wantOrder := []string{"c.txt", "b.txt", "a.txt"}
	for i, want := range wantOrder {
		if got[i].RelPath != want {
			t.Fatalf("entry %d: got %q, want %q", i, got[i].RelPath, want)
		}
	}
}

func TestClearSyncEntryDirtyResetsRetryAndError(t *testing.T) {
	conn := setupSyncEntriesTestDB(t)

	entry := SyncEntry{
		ID: "remote-1:x.txt", RootID: "remote-1", RelPath: "x.txt", Name: "x.txt",
		IsDirty: true, SyncDirection: "push", RetryCount: 2, LastError: "boom",
		CreatedAt: "now", UpdatedAt: "now",
	}
	if err := UpsertSyncEntry(conn, entry); err != nil {
		t.Fatalf("UpsertSyncEntry: %v", err)
	}
	// Simulate a prior failure being recorded directly — UpsertSyncEntry
	// doesn't update retry/last_error on conflict, so write them raw.
	if _, err := conn.Exec(`UPDATE sync_entries SET retry_count = 2, last_error = 'boom' WHERE id = ?`, entry.ID); err != nil {
		t.Fatalf("seed retry state: %v", err)
	}

	if err := ClearSyncEntryDirty(conn, entry.ID, "cleared-at"); err != nil {
		t.Fatalf("ClearSyncEntryDirty: %v", err)
	}
	got, err := GetSyncEntry(conn, entry.ID)
	if err != nil || got == nil {
		t.Fatalf("GetSyncEntry: %v (entry=%v)", err, got)
	}
	if got.IsDirty || got.RetryCount != 0 || got.LastError != "" || got.SyncDirection != "none" {
		t.Fatalf("after clear: dirty=%v retry=%d err=%q dir=%q", got.IsDirty, got.RetryCount, got.LastError, got.SyncDirection)
	}
	if got.UpdatedAt != "cleared-at" {
		t.Fatalf("updated_at not stamped: got %q", got.UpdatedAt)
	}
}

func TestIncrementSyncEntryRetryTruncatesAndBumps(t *testing.T) {
	conn := setupSyncEntriesTestDB(t)

	entry := SyncEntry{
		ID: "remote-1:y.txt", RootID: "remote-1", RelPath: "y.txt", Name: "y.txt",
		IsDirty: true, SyncDirection: "pull", CreatedAt: "now", UpdatedAt: "now",
	}
	if err := UpsertSyncEntry(conn, entry); err != nil {
		t.Fatalf("UpsertSyncEntry: %v", err)
	}

	longErr := strings.Repeat("e", 1000)
	if err := IncrementSyncEntryRetry(conn, entry.ID, longErr, "bumped"); err != nil {
		t.Fatalf("IncrementSyncEntryRetry: %v", err)
	}
	if err := IncrementSyncEntryRetry(conn, entry.ID, "second", "bumped-2"); err != nil {
		t.Fatalf("IncrementSyncEntryRetry second: %v", err)
	}

	got, err := GetSyncEntry(conn, entry.ID)
	if err != nil || got == nil {
		t.Fatalf("GetSyncEntry: %v (entry=%v)", err, got)
	}
	if got.RetryCount != 2 {
		t.Fatalf("retry_count = %d, want 2", got.RetryCount)
	}
	if got.LastError != "second" {
		t.Fatalf("last_error = %q, want 'second'", got.LastError)
	}
	if !got.IsDirty {
		t.Fatalf("entry should stay dirty after failure")
	}
}

func TestUpsertSyncEntryPreservesRetryOnConflict(t *testing.T) {
	conn := setupSyncEntriesTestDB(t)

	entry := SyncEntry{
		ID: "remote-1:z.txt", RootID: "remote-1", RelPath: "z.txt", Name: "z.txt",
		IsDirty: true, SyncDirection: "push", CreatedAt: "now", UpdatedAt: "now",
	}
	if err := UpsertSyncEntry(conn, entry); err != nil {
		t.Fatalf("UpsertSyncEntry: %v", err)
	}
	if err := IncrementSyncEntryRetry(conn, entry.ID, "fail-1", "t1"); err != nil {
		t.Fatalf("IncrementSyncEntryRetry: %v", err)
	}

	// Second upsert (e.g. from a later RefetchDirectory) must not reset the
	// retry bookkeeping — that's how the reconciler's throttling state
	// survives across ticks.
	entry.UpdatedAt = "now2"
	entry.SyncDirection = "pull"
	if err := UpsertSyncEntry(conn, entry); err != nil {
		t.Fatalf("UpsertSyncEntry second: %v", err)
	}
	got, err := GetSyncEntry(conn, entry.ID)
	if err != nil || got == nil {
		t.Fatalf("GetSyncEntry: %v", err)
	}
	if got.RetryCount != 1 || got.LastError != "fail-1" {
		t.Fatalf("retry state clobbered: retry=%d err=%q", got.RetryCount, got.LastError)
	}
	if got.SyncDirection != "pull" {
		t.Fatalf("sync_direction not updated: %q", got.SyncDirection)
	}
}
