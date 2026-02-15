package remote

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/kannachi323/misty/proxy/core/syncindex"
	dbpkg "github.com/kannachi323/misty/proxy/db"
)

func setupSyncTestDB(t *testing.T) (*dbpkg.Database, func()) {
	t.Helper()

	tempDir := t.TempDir()
	t.Setenv("DB_PATH", filepath.Join(tempDir, "sync-test.db"))

	database := &dbpkg.Database{}
	if err := database.StartDatabase(); err != nil {
		t.Fatalf("StartDatabase: %v", err)
	}

	cleanup := func() {
		database.Stop()
		_ = os.RemoveAll(tempDir)
	}
	return database, cleanup
}

func TestSyncListReturnsSeededDirectoryRows(t *testing.T) {
	database, cleanup := setupSyncTestDB(t)
	defer cleanup()

	now := dbpkg.NowRFC3339()
	root := dbpkg.SyncRoot{
		ID:             "drive-alice",
		RemoteName:     "drive-alice",
		RemoteType:     "drive",
		ProviderFolder: "Google Drive",
		FolderName:     "alice",
		MountRoot:      "/tmp/misty/mnt",
		Enabled:        true,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if err := dbpkg.UpsertSyncRoot(database.Conn, root); err != nil {
		t.Fatalf("UpsertSyncRoot: %v", err)
	}

	entry := dbpkg.SyncEntry{
		ID:            dbpkg.MakeSyncEntryID(root.ID, "docs/report.txt"),
		RootID:        root.ID,
		RelPath:       "docs/report.txt",
		ParentRelPath: "docs",
		Name:          "report.txt",
		LocalExists:   true,
		RemoteExists:  true,
		IsDirty:       true,
		SyncDirection: "push",
		LocalMTime:    now,
		RemoteMTime:   now,
		LocalSize:     sql.NullInt64{Int64: 42, Valid: true},
		RemoteSize:    sql.NullInt64{Int64: 42, Valid: true},
		StateCode:     "MOD",
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	if err := dbpkg.UpsertSyncEntry(database.Conn, entry); err != nil {
		t.Fatalf("UpsertSyncEntry: %v", err)
	}

	service := syncindex.NewService(database)
	rr := doRequest(SyncList(service), http.MethodGet, "/api/sync/list?remote=drive-alice&path=docs", nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("SyncList: expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp syncindex.DirectoryResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if resp.Remote != "drive-alice" || resp.Path != "docs" {
		t.Fatalf("unexpected response metadata: remote=%q path=%q", resp.Remote, resp.Path)
	}
	if len(resp.Items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(resp.Items))
	}
	if resp.Items[0].State != "MOD" || !resp.Items[0].SyncDirty || resp.Items[0].SyncDirection != "push" {
		t.Fatalf("unexpected item state: %+v", resp.Items[0])
	}
}

func TestSyncRefetchRejectsMissingRemote(t *testing.T) {
	rr := doRequest(SyncRefetch(nil), http.MethodPost, "/api/sync/refetch", nil)
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 for nil service, got %d", rr.Code)
	}

	rr = doRequest(SyncRefetch(&syncindex.Service{}), http.MethodPost, "/api/sync/refetch", bytes.NewBufferString(`{"path":"docs"}`))
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing remote, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestSyncListRejectsMissingRemoteQuery(t *testing.T) {
	rr := doRequest(SyncList(&syncindex.Service{}), http.MethodGet, "/api/sync/list", nil)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing remote query, got %d", rr.Code)
	}
}
