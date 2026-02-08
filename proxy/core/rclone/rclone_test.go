package rclone

import (
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/rclone/rclone/fs/config"
	"github.com/rclone/rclone/fs/config/configfile"
)

// setupTest creates a temp rclone config, a temp data dir, and a "test-local"
// remote. It resets the package-level initOnce so Init() re-runs with
// the temp config. Returns the remote name, data root, and cleanup func.
func setupTest(t *testing.T) (remote string, root string, cleanup func()) {
	t.Helper()

	// Create temp config file
	tmpConf := filepath.Join(t.TempDir(), "rclone.conf")
	if err := os.WriteFile(tmpConf, []byte(""), 0600); err != nil {
		t.Fatal(err)
	}

	// Reset init so we can re-init with the temp config
	initOnce = sync.Once{}

	// Point rclone at our temp config
	if err := config.SetConfigPath(tmpConf); err != nil {
		t.Fatal(err)
	}
	configfile.Install()

	// Mark init as done so operations don't try to re-init with the real path
	initOnce.Do(func() {})

	// Create a temp data directory
	root = filepath.Join(t.TempDir(), "data")
	if err := os.MkdirAll(root, 0755); err != nil {
		t.Fatal(err)
	}

	// Create a local remote via rclone config
	remote = "test-local"
	ctx := context.Background()
	if err := CreateRemote(ctx, remote, "local", map[string]string{}); err != nil {
		t.Fatal("CreateRemote:", err)
	}

	cleanup = func() {
		DeleteRemote(remote)
	}
	return
}

// --- Remote CRUD tests ---

func TestListRemotes(t *testing.T) {
	remote, _, cleanup := setupTest(t)
	defer cleanup()

	remotes := ListRemotes()
	found := false
	for _, r := range remotes {
		if r.Name == remote && r.Type == "local" {
			found = true
		}
	}
	if !found {
		t.Errorf("ListRemotes: expected %q (type local), got %v", remote, remotes)
	}
}

func TestRemoteExists(t *testing.T) {
	remote, _, cleanup := setupTest(t)
	defer cleanup()

	if !RemoteExists(remote) {
		t.Error("RemoteExists: expected true for existing remote")
	}
	if RemoteExists("no-such-remote") {
		t.Error("RemoteExists: expected false for nonexistent remote")
	}
}

func TestCreateRemoteDuplicate(t *testing.T) {
	remote, _, cleanup := setupTest(t)
	defer cleanup()

	err := CreateRemote(context.Background(), remote, "local", nil)
	if err == nil {
		t.Error("CreateRemote: expected error for duplicate, got nil")
	}
}

func TestDeleteRemote(t *testing.T) {
	remote, _, cleanup := setupTest(t)
	_ = cleanup // we'll delete manually

	DeleteRemote(remote)
	if RemoteExists(remote) {
		t.Error("DeleteRemote: remote still exists after deletion")
	}
}

func TestGetRemoteType(t *testing.T) {
	remote, _, cleanup := setupTest(t)
	defer cleanup()

	if typ := GetRemoteType(remote); typ != "local" {
		t.Errorf("GetRemoteType: expected 'local', got %q", typ)
	}
	if typ := GetRemoteType("nonexistent"); typ != "" {
		t.Errorf("GetRemoteType: expected empty for nonexistent, got %q", typ)
	}
}

// --- File operation tests ---
// All operations use the local backend pointing at a temp directory.
// For the "local" remote type, the path IS the filesystem path.

func TestMkDir(t *testing.T) {
	remote, root, cleanup := setupTest(t)
	defer cleanup()

	ctx := context.Background()

	// For the local backend, MkDir creates a directory at remote:path.
	// We use the root as a base and create a subdir inside it.
	newDir := filepath.Join(root, "newdir")

	// Use UploadFile to verify the dir works (MkDir for local creates the path)
	if err := MkDir(ctx, remote, newDir); err != nil {
		t.Fatal("MkDir:", err)
	}

	// Verify by listing the parent — the new dir should appear
	items, err := ListDir(ctx, remote, root)
	if err != nil {
		t.Fatal("ListDir after MkDir:", err)
	}
	found := false
	for _, item := range items {
		if item.Name == "newdir" && item.IsDir {
			found = true
		}
	}
	if !found {
		t.Errorf("MkDir: directory 'newdir' not found in listing: %+v", items)
	}
}

func TestUploadAndListDir(t *testing.T) {
	remote, root, cleanup := setupTest(t)
	defer cleanup()

	ctx := context.Background()
	content := "hello rclone"

	// Upload a file
	err := UploadFile(ctx, remote, root, "test.txt", int64(len(content)), strings.NewReader(content))
	if err != nil {
		t.Fatal("UploadFile:", err)
	}

	// Verify file exists on disk
	data, err := os.ReadFile(filepath.Join(root, "test.txt"))
	if err != nil {
		t.Fatal("file not found on disk:", err)
	}
	if string(data) != content {
		t.Errorf("file content: expected %q, got %q", content, string(data))
	}

	// List directory
	items, err := ListDir(ctx, remote, root)
	if err != nil {
		t.Fatal("ListDir:", err)
	}
	if len(items) != 1 {
		t.Fatalf("ListDir: expected 1 item, got %d", len(items))
	}
	if items[0].Name != "test.txt" {
		t.Errorf("ListDir: expected name 'test.txt', got %q", items[0].Name)
	}
	if items[0].IsDir {
		t.Error("ListDir: expected file, got directory")
	}
	if items[0].Size != int64(len(content)) {
		t.Errorf("ListDir: expected size %d, got %d", len(content), items[0].Size)
	}
}

func TestUploadAndDownload(t *testing.T) {
	remote, root, cleanup := setupTest(t)
	defer cleanup()

	ctx := context.Background()
	content := "download me please"

	err := UploadFile(ctx, remote, root, "dl.txt", int64(len(content)), strings.NewReader(content))
	if err != nil {
		t.Fatal("UploadFile:", err)
	}

	var buf bytes.Buffer
	written, err := DownloadFile(ctx, remote, filepath.Join(root, "dl.txt"), &buf)
	if err != nil {
		t.Fatal("DownloadFile:", err)
	}
	if buf.String() != content {
		t.Errorf("DownloadFile: expected %q, got %q", content, buf.String())
	}
	if written != int64(len(content)) {
		t.Errorf("DownloadFile: expected %d bytes written, got %d", len(content), written)
	}
}

func TestDeleteFile(t *testing.T) {
	remote, root, cleanup := setupTest(t)
	defer cleanup()

	ctx := context.Background()

	// Create a file
	filePath := filepath.Join(root, "deleteme.txt")
	if err := os.WriteFile(filePath, []byte("bye"), 0644); err != nil {
		t.Fatal(err)
	}

	// Delete via rclone
	if err := DeletePath(ctx, remote, filePath); err != nil {
		t.Fatal("DeletePath (file):", err)
	}
	if _, err := os.Stat(filePath); !os.IsNotExist(err) {
		t.Error("file still exists after DeletePath")
	}
}

func TestDeleteDirectory(t *testing.T) {
	remote, root, cleanup := setupTest(t)
	defer cleanup()

	ctx := context.Background()

	// Create a directory with a file inside
	dirPath := filepath.Join(root, "rmdir")
	os.MkdirAll(dirPath, 0755)
	os.WriteFile(filepath.Join(dirPath, "inside.txt"), []byte("data"), 0644)

	if err := DeletePath(ctx, remote, dirPath); err != nil {
		t.Fatal("DeletePath (dir):", err)
	}
	if _, err := os.Stat(dirPath); !os.IsNotExist(err) {
		t.Error("directory still exists after DeletePath")
	}
}

func TestListDirWithMixedContent(t *testing.T) {
	remote, root, cleanup := setupTest(t)
	defer cleanup()

	ctx := context.Background()

	// Create files and subdirectories
	os.WriteFile(filepath.Join(root, "a.txt"), []byte("aaa"), 0644)
	os.WriteFile(filepath.Join(root, "b.txt"), []byte("bb"), 0644)
	os.MkdirAll(filepath.Join(root, "subdir"), 0755)

	items, err := ListDir(ctx, remote, root)
	if err != nil {
		t.Fatal("ListDir:", err)
	}
	if len(items) != 3 {
		t.Fatalf("expected 3 items, got %d: %+v", len(items), items)
	}

	dirs, files := 0, 0
	for _, item := range items {
		if item.IsDir {
			dirs++
		} else {
			files++
		}
	}
	if dirs != 1 || files != 2 {
		t.Errorf("expected 1 dir + 2 files, got %d dirs + %d files", dirs, files)
	}
}

func TestSearch(t *testing.T) {
	remote, root, cleanup := setupTest(t)
	defer cleanup()

	ctx := context.Background()

	// Create nested structure
	os.MkdirAll(filepath.Join(root, "docs"), 0755)
	os.WriteFile(filepath.Join(root, "docs", "report.pdf"), []byte("pdf"), 0644)
	os.WriteFile(filepath.Join(root, "docs", "notes.txt"), []byte("txt"), 0644)
	os.WriteFile(filepath.Join(root, "readme.md"), []byte("md"), 0644)

	// Search for "report"
	results, err := Search(ctx, remote, root, "report", 50)
	if err != nil {
		t.Fatal("Search:", err)
	}
	if len(results) != 1 {
		t.Fatalf("Search 'report': expected 1 result, got %d: %+v", len(results), results)
	}
	if results[0].Name != "report.pdf" {
		t.Errorf("Search: expected 'report.pdf', got %q", results[0].Name)
	}

	// Search for ".txt" — should not match (search is name-based, not extension-based by default)
	// but "notes.txt" contains ".txt" so it should match
	results, err = Search(ctx, remote, root, ".txt", 50)
	if err != nil {
		t.Fatal("Search:", err)
	}
	if len(results) != 1 {
		t.Fatalf("Search '.txt': expected 1 result, got %d", len(results))
	}

	// Search with max results cap
	results, err = Search(ctx, remote, root, "", 2) // empty query matches everything
	if err != nil {
		t.Fatal("Search:", err)
	}
	// Empty string matches all entries — should be capped at 2
	if len(results) > 2 {
		t.Errorf("Search cap: expected <= 2 results, got %d", len(results))
	}
}

func TestSearchCaseInsensitive(t *testing.T) {
	remote, root, cleanup := setupTest(t)
	defer cleanup()

	ctx := context.Background()
	os.WriteFile(filepath.Join(root, "MyFile.TXT"), []byte("data"), 0644)

	results, err := Search(ctx, remote, root, "myfile", 50)
	if err != nil {
		t.Fatal("Search:", err)
	}
	if len(results) != 1 {
		t.Errorf("case-insensitive search: expected 1 result, got %d", len(results))
	}
}

func TestDownloadNonexistent(t *testing.T) {
	remote, root, cleanup := setupTest(t)
	defer cleanup()

	ctx := context.Background()
	var buf bytes.Buffer
	_, err := DownloadFile(ctx, remote, filepath.Join(root, "nope.txt"), &buf)
	if err == nil {
		t.Error("expected error downloading nonexistent file")
	}
}

func TestListDirEmpty(t *testing.T) {
	remote, root, cleanup := setupTest(t)
	defer cleanup()

	ctx := context.Background()
	items, err := ListDir(ctx, remote, root)
	if err != nil {
		t.Fatal("ListDir on empty dir:", err)
	}
	if len(items) != 0 {
		t.Errorf("expected 0 items in empty dir, got %d", len(items))
	}
}

func TestUploadLargeFile(t *testing.T) {
	remote, root, cleanup := setupTest(t)
	defer cleanup()

	ctx := context.Background()

	// 1MB file
	size := 1024 * 1024
	data := make([]byte, size)
	for i := range data {
		data[i] = byte(i % 256)
	}

	err := UploadFile(ctx, remote, root, "large.bin", int64(size), bytes.NewReader(data))
	if err != nil {
		t.Fatal("UploadFile (large):", err)
	}

	// Download and verify
	var buf bytes.Buffer
	_, err = DownloadFile(ctx, remote, filepath.Join(root, "large.bin"), &buf)
	if err != nil {
		t.Fatal("DownloadFile (large):", err)
	}
	if !bytes.Equal(buf.Bytes(), data) {
		t.Error("large file content mismatch")
	}
}

func TestUploadOverwrite(t *testing.T) {
	remote, root, cleanup := setupTest(t)
	defer cleanup()

	ctx := context.Background()

	// Upload v1
	v1 := "version 1"
	if err := UploadFile(ctx, remote, root, "file.txt", int64(len(v1)), strings.NewReader(v1)); err != nil {
		t.Fatal(err)
	}

	// Upload v2 (overwrite)
	v2 := "version 2 - updated"
	if err := UploadFile(ctx, remote, root, "file.txt", int64(len(v2)), strings.NewReader(v2)); err != nil {
		t.Fatal(err)
	}

	var buf bytes.Buffer
	if _, err := DownloadFile(ctx, remote, filepath.Join(root, "file.txt"), &buf); err != nil {
		t.Fatal(err)
	}
	if buf.String() != v2 {
		t.Errorf("expected %q after overwrite, got %q", v2, buf.String())
	}
}

func TestAboutLocal(t *testing.T) {
	remote, _, cleanup := setupTest(t)
	defer cleanup()

	ctx := context.Background()
	info, err := About(ctx, remote)

	// local backend may or may not support About depending on OS
	if err != nil {
		// On some systems About isn't supported for local — that's OK
		if strings.Contains(err.Error(), "does not support") {
			t.Skip("local backend doesn't support About on this OS")
		}
		t.Fatal("About:", err)
	}
	if info.Remote != remote {
		t.Errorf("About: expected remote %q, got %q", remote, info.Remote)
	}
	if info.Total <= 0 {
		t.Error("About: expected positive total space")
	}
}

// --- Edge case: operations on nonexistent remote ---

func TestOperationsOnBadRemote(t *testing.T) {
	setupTest(t) // just to init rclone config
	ctx := context.Background()

	_, err := ListDir(ctx, "no-such-remote", "/tmp")
	if err == nil {
		t.Error("ListDir on bad remote: expected error")
	}

	_, err = DownloadFile(ctx, "no-such-remote", "/tmp/x", io.Discard)
	if err == nil {
		t.Error("DownloadFile on bad remote: expected error")
	}

	err = UploadFile(ctx, "no-such-remote", "/tmp", "x", 0, strings.NewReader(""))
	if err == nil {
		t.Error("UploadFile on bad remote: expected error")
	}
}
