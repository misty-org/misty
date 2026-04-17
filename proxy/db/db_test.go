package db

import (
	"database/sql"
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
}
