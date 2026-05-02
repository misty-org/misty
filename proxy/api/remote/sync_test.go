package remote

import (
	"bufio"
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kannachi323/misty/proxy/core/rclone"
	"github.com/kannachi323/misty/proxy/core/syncindex"
	dbpkg "github.com/kannachi323/misty/proxy/db"
)

func decodeSyncListStream(t *testing.T, body string) syncindex.DirectoryResponse {
	t.Helper()

	resp := syncindex.DirectoryResponse{Items: []syncindex.DirectoryItem{}}
	scanner := bufio.NewScanner(strings.NewReader(body))
	for scanner.Scan() {
		line := scanner.Text()
		if strings.TrimSpace(line) == "" {
			continue
		}

		var chunk syncindex.DirectoryStreamChunk
		if err := json.Unmarshal([]byte(line), &chunk); err != nil {
			t.Fatalf("decode stream chunk: %v", err)
		}

		switch chunk.Type {
		case "items":
			resp.Remote = chunk.Remote
			resp.Path = chunk.Path
			resp.Items = append(resp.Items, chunk.Items...)
		case "done":
			resp.Remote = chunk.Remote
			resp.Path = chunk.Path
			resp.DirtyBit = chunk.DirtyBit
			resp.Watched = chunk.Watched
		case "error":
			t.Fatalf("unexpected stream error chunk: %s", chunk.Error)
		default:
			t.Fatalf("unexpected stream chunk type: %q", chunk.Type)
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("scan stream: %v", err)
	}
	return resp
}

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
	row := dbpkg.FileMetadata{
		RemoteName:    "drive-alice",
		RelPath:       "docs/report.txt",
		ParentRelPath: "docs",
		Name:          "report.txt",
		LocalExists:   true,
		RemoteExists:  true,
		LocalDirty:    true,
		LocalMTime:    now,
		RemoteMTime:   now,
		LocalSize:     sql.NullInt64{Int64: 42, Valid: true},
		RemoteSize:    sql.NullInt64{Int64: 42, Valid: true},
		UpdatedAt:     now,
	}
	if err := dbpkg.UpsertFileMetadata(database.Conn, row); err != nil {
		t.Fatalf("UpsertFileMetadata: %v", err)
	}

	service := syncindex.NewService(database)
	rr := doRequest(SyncList(service), http.MethodGet, "/api/sync/list?remote=drive-alice&path=docs", nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("SyncList: expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	resp := decodeSyncListStream(t, rr.Body.String())

	if resp.Remote != "drive-alice" || resp.Path != "docs" {
		t.Fatalf("unexpected response metadata: remote=%q path=%q", resp.Remote, resp.Path)
	}
	if len(resp.Items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(resp.Items))
	}
	if resp.Items[0].State != "MOD" || !resp.Items[0].SyncDirty || resp.Items[0].SyncDirection != "push" {
		t.Fatalf("unexpected item state: %+v", resp.Items[0])
	}
	if resp.Items[0].DirtyReason == "" {
		t.Fatalf("expected dirty reason, got empty item: %+v", resp.Items[0])
	}
}

func TestSyncRefetchRejectsMissingRemote(t *testing.T) {
	rr := doRequest(SyncRefetch(nil), http.MethodPost, "/api/sync/refetch", nil)
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 for nil service, got %d", rr.Code)
	}

	manager := syncindex.NewManager(syncindex.NewService(&dbpkg.Database{}), 0)
	rr = doRequest(SyncRefetch(manager), http.MethodPost, "/api/sync/refetch", bytes.NewBufferString(`{"path":"docs"}`))
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing remote, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestSyncRefetchReturnsEmptyDirectoryWithoutLooping(t *testing.T) {
	database, cleanup := setupSyncTestDB(t)
	defer cleanup()

	tmpConf := filepath.Join(t.TempDir(), "rclone.conf")
	if err := os.WriteFile(tmpConf, []byte(""), 0o600); err != nil {
		t.Fatalf("WriteFile rclone.conf: %v", err)
	}
	t.Setenv("MISTY_RCLONE_CONFIG", tmpConf)
	if err := rclone.Init(); err != nil {
		t.Skipf("rclone binary unavailable: %v", err)
	}

	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	remoteName := "sync-refetch-empty"
	if err := rclone.CreateRemote(t.Context(), remoteName, "local", map[string]string{}); err != nil {
		t.Fatalf("CreateRemote: %v", err)
	}
	defer rclone.DeleteRemote(remoteName)

	remoteDir := filepath.Join(t.TempDir(), "remote-data")
	emptyDir := filepath.Join(remoteDir, "empty")
	if err := os.MkdirAll(emptyDir, 0o755); err != nil {
		t.Fatalf("MkdirAll empty dir: %v", err)
	}

	service := syncindex.NewService(database)
	manager := syncindex.NewManager(service, 0)
	body := bytes.NewBufferString(`{"remote":"` + remoteName + `","path":"` + filepath.ToSlash(emptyDir) + `"}`)
	rr := doRequest(SyncRefetch(manager), http.MethodPost, "/api/sync/refetch", body)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp syncindex.DirectoryResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Remote != remoteName || resp.Path != filepath.ToSlash(emptyDir) {
		t.Fatalf("unexpected response metadata: %+v", resp)
	}
	if len(resp.Items) != 0 {
		t.Fatalf("expected empty directory response, got %d items", len(resp.Items))
	}
}

func TestSyncMarkSyncedClearsDirtyAfterDownload(t *testing.T) {
	database, cleanup := setupSyncTestDB(t)
	defer cleanup()

	tempHome := t.TempDir()
	t.Setenv("HOME", tempHome)

	localPath := filepath.Join(tempHome, "misty", "mnt", "drive-alice", "docs", "report.txt")
	if err := os.MkdirAll(filepath.Dir(localPath), 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(localPath, []byte("hello world"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	now := dbpkg.NowRFC3339()
	row := dbpkg.FileMetadata{
		RemoteName:    "drive-alice",
		RelPath:       "docs/report.txt",
		ParentRelPath: "docs",
		Name:          "report.txt",
		LocalExists:   false,
		RemoteExists:  true,
		LocalDirty:    true,
		RemoteMTime:   now,
		RemoteSize:    sql.NullInt64{Int64: 11, Valid: true},
		UpdatedAt:     now,
	}
	if err := dbpkg.UpsertFileMetadata(database.Conn, row); err != nil {
		t.Fatalf("UpsertFileMetadata: %v", err)
	}

	service := syncindex.NewService(database)
	manager := syncindex.NewManager(service, 0)
	rr := doRequest(
		SyncMarkSynced(manager),
		http.MethodPost,
		"/api/sync/mark-synced",
		bytes.NewBufferString(`{"remote":"drive-alice","path":"docs/report.txt"}`),
	)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", rr.Code, rr.Body.String())
	}

	updated, err := dbpkg.GetFileMetadata(database.Conn, "drive-alice", "docs/report.txt")
	if err != nil {
		t.Fatalf("GetFileMetadata: %v", err)
	}
	if updated == nil {
		t.Fatal("expected updated row")
	}
	if updated.LocalDirty {
		t.Fatalf("expected LocalDirty=false, got true: %+v", *updated)
	}
	if !updated.LocalExists {
		t.Fatalf("expected LocalExists=true, got false: %+v", *updated)
	}
	if !updated.LocalSize.Valid || updated.LocalSize.Int64 != 11 {
		t.Fatalf("expected LocalSize=11, got %+v", updated.LocalSize)
	}
	if updated.LastSyncedAt == "" {
		t.Fatalf("expected LastSyncedAt to be set: %+v", *updated)
	}
}

func TestSyncListRejectsMissingRemoteQuery(t *testing.T) {
	rr := doRequest(SyncList(&syncindex.Service{}), http.MethodGet, "/api/sync/list", nil)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing remote query, got %d", rr.Code)
	}
}

func TestSyncListPrimesIndexOnFirstAccess(t *testing.T) {
	database, cleanup := setupSyncTestDB(t)
	defer cleanup()

	tmpConf := filepath.Join(t.TempDir(), "rclone.conf")
	if err := os.WriteFile(tmpConf, []byte(""), 0o600); err != nil {
		t.Fatalf("WriteFile rclone.conf: %v", err)
	}
	t.Setenv("MISTY_RCLONE_CONFIG", tmpConf)
	if err := rclone.Init(); err != nil {
		t.Skipf("rclone binary unavailable: %v", err)
	}

	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	remoteName := "sync-list-local"
	if err := rclone.CreateRemote(t.Context(), remoteName, "local", map[string]string{}); err != nil {
		t.Fatalf("CreateRemote: %v", err)
	}
	defer rclone.DeleteRemote(remoteName)

	remoteDir := filepath.Join(t.TempDir(), "remote-data")
	if err := os.MkdirAll(filepath.Join(remoteDir, "docs"), 0o755); err != nil {
		t.Fatalf("MkdirAll remote dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(remoteDir, "docs", "report.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatalf("WriteFile remote file: %v", err)
	}

	rr := doRequest(SyncList(syncindex.NewService(database)), http.MethodGet,
		"/api/sync/list?remote="+remoteName+"&path="+filepath.ToSlash(filepath.Join(remoteDir, "docs")), nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("SyncList first access: expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	resp := decodeSyncListStream(t, rr.Body.String())
	if len(resp.Items) != 1 {
		t.Fatalf("expected 1 item after initial prime, got %d", len(resp.Items))
	}
	if resp.Items[0].Name != "report.txt" {
		t.Fatalf("unexpected item after initial prime: %+v", resp.Items[0])
	}

	root, err := dbpkg.GetSyncRootByRemoteName(database.Conn, remoteName)
	if err != nil {
		t.Fatalf("GetSyncRootByRemoteName: %v", err)
	}
	if root == nil || root.LastRefetchAt == "" {
		t.Fatalf("expected last_refetch_at to be set after initial prime, got root=%+v", root)
	}
}

func TestSyncListRefetchesEmptyKnownDirectory(t *testing.T) {
	database, cleanup := setupSyncTestDB(t)
	defer cleanup()

	tmpConf := filepath.Join(t.TempDir(), "rclone.conf")
	if err := os.WriteFile(tmpConf, []byte(""), 0o600); err != nil {
		t.Fatalf("WriteFile rclone.conf: %v", err)
	}
	t.Setenv("MISTY_RCLONE_CONFIG", tmpConf)
	if err := rclone.Init(); err != nil {
		t.Skipf("rclone binary unavailable: %v", err)
	}

	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	remoteName := "sync-list-empty-known"
	if err := rclone.CreateRemote(t.Context(), remoteName, "local", map[string]string{}); err != nil {
		t.Fatalf("CreateRemote: %v", err)
	}
	defer rclone.DeleteRemote(remoteName)

	remoteDir := filepath.Join(t.TempDir(), "remote-data")
	targetDir := filepath.Join(remoteDir, "docs")
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		t.Fatalf("MkdirAll remote dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(targetDir, "report.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatalf("WriteFile remote file: %v", err)
	}

	now := dbpkg.NowRFC3339()
	root := dbpkg.SyncRoot{
		ID:            dbpkg.MakeSyncRootID(remoteName),
		RemoteName:    remoteName,
		MountRoot:     filepath.Join(tmpHome, "misty", "mnt", remoteName),
		Enabled:       true,
		LastRefetchAt: now,
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	if err := dbpkg.UpsertSyncRoot(database.Conn, root); err != nil {
		t.Fatalf("UpsertSyncRoot: %v", err)
	}

	rr := doRequest(SyncList(syncindex.NewService(database)), http.MethodGet,
		"/api/sync/list?remote="+remoteName+"&path="+filepath.ToSlash(targetDir), nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("SyncList empty known dir: expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	resp := decodeSyncListStream(t, rr.Body.String())
	if len(resp.Items) != 1 {
		t.Fatalf("expected 1 item after empty-dir refetch, got %d", len(resp.Items))
	}
	if resp.Items[0].Name != "report.txt" {
		t.Fatalf("unexpected item after empty-dir refetch: %+v", resp.Items[0])
	}
}
