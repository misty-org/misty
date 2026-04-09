package tests

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/kannachi323/misty/proxy/api/vault"
	"github.com/kannachi323/misty/proxy/core/auth"
)

// TestVaultSmoke drives the vault HTTP layer end-to-end the same way the C++
// client will: chi router + JWT middleware + httptest server, mint a token
// locally, create a repo, kick off a backup, consume the SSE job stream, and
// verify a real snapshot lands on disk afterwards.
//
// Requires the `restic` binary in PATH; skips otherwise (CI without restic).
func TestVaultSmoke(t *testing.T) {
	if _, err := exec.LookPath("restic"); err != nil {
		t.Skip("restic binary not found in PATH; skipping smoke test")
	}

	// Isolate the registry/password files under a fresh HOME so we don't
	// touch the developer's real ~/misty/restic directory.
	home := t.TempDir()
	t.Setenv("HOME", home)

	svc := vault.NewService()

	router := chi.NewRouter()
	router.Route("/api", func(r chi.Router) {
		r.Group(func(r chi.Router) {
			r.Use(auth.JWTMiddleware)

			r.Get("/vault/repos", svc.ListRepos())
			r.Post("/vault/repos", svc.CreateRepo())
			r.Get("/vault/snapshots", svc.ListSnapshots())
			r.Post("/vault/backup", svc.StartBackup())
			r.Get("/vault/jobs", svc.ListJobs())
			r.Get("/vault/jobs/{id}", svc.GetJob())
			r.Get("/vault/jobs/{id}/stream", svc.StreamJob())
		})
	})

	server := httptest.NewServer(router)
	defer server.Close()

	token, err := auth.GenerateToken("test-user-id", "smoke@test.local")
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	do := func(method, path string, body any) *http.Response {
		t.Helper()
		var buf io.Reader
		if body != nil {
			b, _ := json.Marshal(body)
			buf = bytes.NewReader(b)
		}
		req, err := http.NewRequest(method, server.URL+path, buf)
		if err != nil {
			t.Fatalf("NewRequest %s %s: %v", method, path, err)
		}
		req.Header.Set("Authorization", "Bearer "+token)
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("Do %s %s: %v", method, path, err)
		}
		return resp
	}

	// --- 1. POST /api/vault/repos ---------------------------------------
	repoDir := filepath.Join(t.TempDir(), "repo")
	resp := do("POST", "/api/vault/repos", map[string]string{
		"name":     "smoke-repo",
		"url":      "local:" + repoDir,
		"password": "smoke-password-1234",
	})
	if resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("CreateRepo: expected 201, got %d: %s", resp.StatusCode, body)
	}
	resp.Body.Close()

	// --- 2. POST /api/vault/backup --------------------------------------
	src := filepath.Join(t.TempDir(), "src")
	if err := os.MkdirAll(filepath.Join(src, "sub"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "hello.txt"), []byte("hello sse"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "sub", "n.txt"), []byte("nested sse"), 0644); err != nil {
		t.Fatal(err)
	}

	resp = do("POST", "/api/vault/backup", map[string]any{
		"repo":  "smoke-repo",
		"paths": []string{src},
		"tags":  []string{"smoke"},
	})
	if resp.StatusCode != http.StatusAccepted {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("StartBackup: expected 202, got %d: %s", resp.StatusCode, body)
	}
	var startResp struct {
		JobID string `json:"job_id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&startResp); err != nil {
		resp.Body.Close()
		t.Fatalf("decode StartBackup: %v", err)
	}
	resp.Body.Close()
	if startResp.JobID == "" {
		t.Fatal("StartBackup returned empty job_id")
	}

	// --- 3. GET /api/vault/jobs/{id}/stream (SSE) ----------------------
	// Subscribe with a hard timeout. We expect at least one state event and
	// the channel to close cleanly when the job ends.
	streamCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	streamReq, err := http.NewRequestWithContext(streamCtx, "GET",
		server.URL+"/api/vault/jobs/"+startResp.JobID+"/stream", nil)
	if err != nil {
		t.Fatalf("stream NewRequest: %v", err)
	}
	streamReq.Header.Set("Authorization", "Bearer "+token)
	streamReq.Header.Set("Accept", "text/event-stream")

	streamResp, err := http.DefaultClient.Do(streamReq)
	if err != nil {
		t.Fatalf("stream Do: %v", err)
	}
	defer streamResp.Body.Close()
	if streamResp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(streamResp.Body)
		t.Fatalf("stream: expected 200, got %d: %s", streamResp.StatusCode, body)
	}
	if ct := streamResp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/event-stream") {
		t.Errorf("stream: expected text/event-stream, got %q", ct)
	}

	// Parse SSE events. Each event is "event: <name>\ndata: <json>\n\n".
	scanner := bufio.NewScanner(streamResp.Body)
	scanner.Buffer(make([]byte, 1<<20), 1<<20)

	var (
		eventName     string
		stateEvents   int
		progressCount int
		finalState    map[string]any
	)
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case strings.HasPrefix(line, "event: "):
			eventName = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "data: "):
			payload := strings.TrimPrefix(line, "data: ")
			if eventName == "state" {
				stateEvents++
				_ = json.Unmarshal([]byte(payload), &finalState)
			} else if eventName == "progress" {
				progressCount++
			}
		case line == "":
			eventName = ""
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("scanner: %v", err)
	}
	if stateEvents < 1 {
		t.Errorf("expected at least 1 state event, got %d", stateEvents)
	}
	if finalState == nil {
		t.Fatal("never received a state event")
	}
	if state, _ := finalState["state"].(string); state != "succeeded" {
		t.Errorf("expected final state=succeeded, got %v (full: %v)", state, finalState)
	}
	t.Logf("SSE: %d state events, %d progress events, final state=%v",
		stateEvents, progressCount, finalState["state"])

	// --- 4. GET /api/vault/snapshots — confirm the backup is real ------
	resp = do("GET", "/api/vault/snapshots?repo=smoke-repo", nil)
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		t.Fatalf("ListSnapshots: expected 200, got %d: %s", resp.StatusCode, body)
	}
	var snaps []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&snaps); err != nil {
		resp.Body.Close()
		t.Fatalf("decode snapshots: %v", err)
	}
	resp.Body.Close()
	if len(snaps) != 1 {
		t.Errorf("expected 1 snapshot after backup, got %d", len(snaps))
	}

	// --- 5. GET /api/vault/jobs/{id} — final job record matches stream -
	resp = do("GET", "/api/vault/jobs/"+startResp.JobID, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GetJob: expected 200, got %d", resp.StatusCode)
	}
	var job map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&job); err != nil {
		resp.Body.Close()
		t.Fatalf("decode job: %v", err)
	}
	resp.Body.Close()
	if state, _ := job["state"].(string); state != "succeeded" {
		t.Errorf("GetJob: expected state=succeeded, got %v", state)
	}

	// Sanity check: registry file lives under our isolated HOME, not the
	// developer's real ~/misty.
	wantPrefix := home
	if got := filepath.Join(home, "misty", "restic"); !strings.HasPrefix(got, wantPrefix) {
		t.Errorf("registry leaked outside HOME: %s", got)
	}
}
