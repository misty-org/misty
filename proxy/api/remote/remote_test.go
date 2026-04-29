package remote

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/kannachi323/misty/proxy/core/rclone"
)

const testRemote = "api-test-local"

// setupAPI creates a temp rclone config and a local remote for API handler testing.
func setupAPI(t *testing.T) (root string, cleanup func()) {
	t.Helper()

	tmpConf := filepath.Join(t.TempDir(), "rclone.conf")
	os.WriteFile(tmpConf, []byte(""), 0600)

	t.Setenv("MISTY_RCLONE_CONFIG", tmpConf)
	if err := rclone.Init(); err != nil {
		t.Skipf("rclone binary unavailable: %v", err)
	}

	root = filepath.Join(t.TempDir(), "data")
	os.MkdirAll(root, 0755)

	// Create a local remote for testing
	rclone.CreateRemote(context.Background(), testRemote, "local", map[string]string{})

	cleanup = func() {
		rclone.DeleteRemote(testRemote)
	}
	return
}

func doRequest(handler http.HandlerFunc, method, url string, body io.Reader) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, url, body)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	return rr
}

// --- Remote management handler tests ---

func TestListRemotesHandler(t *testing.T) {
	_, cleanup := setupAPI(t)
	defer cleanup()

	rr := doRequest(ListRemotes(), "GET", "/api/remotes", nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("ListRemotes: expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var remotes []rclone.RemoteInfo
	json.NewDecoder(rr.Body).Decode(&remotes)

	found := false
	for _, r := range remotes {
		if r.Name == testRemote {
			found = true
		}
	}
	if !found {
		t.Errorf("expected %q in remotes list", testRemote)
	}
}

func TestDeleteRemoteHandler(t *testing.T) {
	_, cleanup := setupAPI(t)
	_ = cleanup

	rr := doRequest(DeleteRemote(), "DELETE", "/api/remotes?name="+testRemote, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("DeleteRemote: expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	if rclone.RemoteExists(testRemote) {
		t.Error("remote still exists after delete handler")
	}
}

func TestDeleteRemoteNotFound(t *testing.T) {
	_, cleanup := setupAPI(t)
	defer cleanup()

	rr := doRequest(DeleteRemote(), "DELETE", "/api/remotes?name=nonexistent", nil)
	if rr.Code != http.StatusNotFound {
		t.Errorf("expected 404 for nonexistent remote, got %d", rr.Code)
	}
}

func TestDeleteRemoteMissingParam(t *testing.T) {
	_, cleanup := setupAPI(t)
	defer cleanup()

	rr := doRequest(DeleteRemote(), "DELETE", "/api/remotes", nil)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing name, got %d", rr.Code)
	}
}

func TestListTypesHandler(t *testing.T) {
	rr := doRequest(ListTypes(), "GET", "/api/remotes/types", nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("ListTypes: expected 200, got %d", rr.Code)
	}

	var types []map[string]string
	json.NewDecoder(rr.Body).Decode(&types)
	if len(types) == 0 {
		t.Error("ListTypes: expected non-empty list")
	}

	found := false
	for _, typ := range types {
		if typ["type"] == "local" {
			found = true
		}
	}
	if !found {
		t.Error("ListTypes: expected 'local' in types list")
	}
}

func TestHealthHandler(t *testing.T) {
	rr := doRequest(Health(), "GET", "/api/remotes/health", nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("Health: expected 200, got %d", rr.Code)
	}

	var body map[string]any
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Fatalf("Health: decode response: %v", err)
	}
	if _, ok := body["ready"]; !ok {
		t.Fatal("Health: missing ready")
	}
	if _, ok := body["config_path"]; !ok {
		t.Fatal("Health: missing config_path")
	}
	if _, ok := body["link_path"]; !ok {
		t.Fatal("Health: missing link_path")
	}
}

// --- File operation handler tests ---

func TestListFilesHandler(t *testing.T) {
	root, cleanup := setupAPI(t)
	defer cleanup()

	// Create test files
	os.WriteFile(filepath.Join(root, "hello.txt"), []byte("hi"), 0644)
	os.MkdirAll(filepath.Join(root, "subdir"), 0755)

	rr := doRequest(ListFiles(), "GET", "/api/files?remote="+testRemote+"&path="+root, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("ListFiles: expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp rclone.ListResponse
	json.NewDecoder(rr.Body).Decode(&resp)

	if len(resp.Items) != 2 {
		t.Fatalf("expected 2 items, got %d: %+v", len(resp.Items), resp.Items)
	}
	if resp.Remote != testRemote {
		t.Errorf("expected remote %q, got %q", testRemote, resp.Remote)
	}
}

func TestListFilesMissingRemote(t *testing.T) {
	_, cleanup := setupAPI(t)
	defer cleanup()

	rr := doRequest(ListFiles(), "GET", "/api/files?path=/tmp", nil)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing remote, got %d", rr.Code)
	}
}

func TestListFilesNotFoundRemote(t *testing.T) {
	_, cleanup := setupAPI(t)
	defer cleanup()

	rr := doRequest(ListFiles(), "GET", "/api/files?remote=nope&path=/tmp", nil)
	if rr.Code != http.StatusNotFound {
		t.Errorf("expected 404 for nonexistent remote, got %d", rr.Code)
	}
}

func TestDownloadFileHandler(t *testing.T) {
	root, cleanup := setupAPI(t)
	defer cleanup()

	content := "file content for download"
	os.WriteFile(filepath.Join(root, "doc.txt"), []byte(content), 0644)

	rr := doRequest(DownloadFile(), "GET",
		"/api/file/download?remote="+testRemote+"&path="+filepath.Join(root, "doc.txt"), nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("DownloadFile: expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	if rr.Body.String() != content {
		t.Errorf("expected body %q, got %q", content, rr.Body.String())
	}
	if ct := rr.Header().Get("Content-Type"); ct != "application/octet-stream" {
		t.Errorf("expected Content-Type application/octet-stream, got %q", ct)
	}
	if cd := rr.Header().Get("Content-Disposition"); !strings.Contains(cd, "doc.txt") {
		t.Errorf("expected Content-Disposition to contain filename, got %q", cd)
	}
}

func TestDownloadFileMissingParams(t *testing.T) {
	_, cleanup := setupAPI(t)
	defer cleanup()

	rr := doRequest(DownloadFile(), "GET", "/api/file/download?remote="+testRemote, nil)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing path, got %d", rr.Code)
	}
}

func TestUploadFileHandler(t *testing.T) {
	root, cleanup := setupAPI(t)
	defer cleanup()

	content := "uploaded via handler"
	req := httptest.NewRequest("POST",
		"/api/file/upload?remote="+testRemote+"&path="+root, strings.NewReader(content))
	req.Header.Set("X-File-Name", "uploaded.txt")
	req.Header.Set("Content-Length", "19")

	rr := httptest.NewRecorder()
	UploadFile().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("UploadFile: expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	// Verify file on disk
	data, err := os.ReadFile(filepath.Join(root, "uploaded.txt"))
	if err != nil {
		t.Fatal("uploaded file not found:", err)
	}
	if string(data) != content {
		t.Errorf("expected %q, got %q", content, string(data))
	}
}

func TestUploadFileMissingFileName(t *testing.T) {
	root, cleanup := setupAPI(t)
	defer cleanup()

	req := httptest.NewRequest("POST",
		"/api/file/upload?remote="+testRemote+"&path="+root, strings.NewReader("data"))
	// No X-File-Name header
	rr := httptest.NewRecorder()
	UploadFile().ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing X-File-Name, got %d", rr.Code)
	}
}

func TestMkDirHandler(t *testing.T) {
	root, cleanup := setupAPI(t)
	defer cleanup()

	body, _ := json.Marshal(map[string]string{
		"remote": testRemote,
		"path":   filepath.Join(root, "newdir"),
	})
	rr := doRequest(MkDir(), "POST", "/api/mkdir", bytes.NewReader(body))
	if rr.Code != http.StatusOK {
		t.Fatalf("MkDir: expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	info, err := os.Stat(filepath.Join(root, "newdir"))
	if err != nil {
		t.Fatal("directory not created:", err)
	}
	if !info.IsDir() {
		t.Error("expected directory")
	}
}

func TestMkDirMissingFields(t *testing.T) {
	_, cleanup := setupAPI(t)
	defer cleanup()

	body, _ := json.Marshal(map[string]string{"remote": testRemote})
	rr := doRequest(MkDir(), "POST", "/api/mkdir", bytes.NewReader(body))
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing path, got %d", rr.Code)
	}
}

func TestDeleteFileHandler(t *testing.T) {
	root, cleanup := setupAPI(t)
	defer cleanup()

	filePath := filepath.Join(root, "todelete.txt")
	os.WriteFile(filePath, []byte("bye"), 0644)

	rr := doRequest(DeleteFile(), "DELETE",
		"/api/file?remote="+testRemote+"&path="+filePath, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("DeleteFile: expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	if _, err := os.Stat(filePath); !os.IsNotExist(err) {
		t.Error("file still exists after delete")
	}
}

func TestSearchHandler(t *testing.T) {
	root, cleanup := setupAPI(t)
	defer cleanup()

	os.WriteFile(filepath.Join(root, "report.pdf"), []byte("pdf"), 0644)
	os.WriteFile(filepath.Join(root, "notes.txt"), []byte("txt"), 0644)

	rr := doRequest(Search(), "GET",
		"/api/search?remote="+testRemote+"&q=report&path="+root, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("Search: expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp rclone.ListResponse
	json.NewDecoder(rr.Body).Decode(&resp)

	if len(resp.Items) != 1 {
		t.Fatalf("expected 1 result, got %d", len(resp.Items))
	}
	if resp.Items[0].Name != "report.pdf" {
		t.Errorf("expected 'report.pdf', got %q", resp.Items[0].Name)
	}
}

func TestSearchMissingQuery(t *testing.T) {
	_, cleanup := setupAPI(t)
	defer cleanup()

	rr := doRequest(Search(), "GET", "/api/search?remote="+testRemote, nil)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing query, got %d", rr.Code)
	}
}

func TestAboutHandler(t *testing.T) {
	_, cleanup := setupAPI(t)
	defer cleanup()

	rr := doRequest(AboutRemote(), "GET", "/api/about?remote="+testRemote, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("About: expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var info rclone.AboutInfo
	json.NewDecoder(rr.Body).Decode(&info)
	if info.Remote != testRemote {
		t.Errorf("expected remote %q, got %q", testRemote, info.Remote)
	}
	if info.Total <= 0 {
		t.Error("expected positive total space")
	}
}

func TestAboutMissingRemote(t *testing.T) {
	_, cleanup := setupAPI(t)
	defer cleanup()

	rr := doRequest(AboutRemote(), "GET", "/api/about", nil)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing remote, got %d", rr.Code)
	}
}

func TestConfigCancelStopsInFlightFlow(t *testing.T) {
	const name = "cancel-test-remote"

	oauthMu.Lock()
	previousPending := oauthPending
	previousCancels := oauthCancels
	oauthPending = map[string]bool{}
	oauthCancels = map[string]context.CancelFunc{}
	oauthMu.Unlock()

	t.Cleanup(func() {
		oauthMu.Lock()
		oauthPending = previousPending
		oauthCancels = previousCancels
		oauthMu.Unlock()
	})

	cancelled := false
	if !beginOAuthFlow(name, func() { cancelled = true }) {
		t.Fatal("expected flow registration to succeed")
	}

	rr := doRequest(ConfigCancel(), "DELETE", "/api/remotes/config?name="+name, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("ConfigCancel: expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if !cancelled {
		t.Fatal("expected ConfigCancel to invoke the active cancel func")
	}

	oauthMu.Lock()
	defer oauthMu.Unlock()
	if oauthPending[name] {
		t.Fatal("expected pending flow entry to be cleared")
	}
	if _, ok := oauthCancels[name]; ok {
		t.Fatal("expected cancel func entry to be cleared")
	}
}

func TestBeginOAuthFlowAllowsOnlyOneActiveFlow(t *testing.T) {
	oauthMu.Lock()
	previousPending := oauthPending
	previousCancels := oauthCancels
	oauthPending = map[string]bool{}
	oauthCancels = map[string]context.CancelFunc{}
	oauthMu.Unlock()

	t.Cleanup(func() {
		oauthMu.Lock()
		oauthPending = previousPending
		oauthCancels = previousCancels
		oauthMu.Unlock()
	})

	if !beginOAuthFlow("remote-a", func() {}) {
		t.Fatal("expected first flow registration to succeed")
	}
	if beginOAuthFlow("remote-b", func() {}) {
		t.Fatal("expected second concurrent flow registration to be rejected")
	}
}

// Ensure unused import doesn't cause issues
var _ = sync.Once{}
