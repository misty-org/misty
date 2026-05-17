package search

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	coresearch "github.com/kannachi323/misty/proxy/core/search"
)

func intPtr(v int) *int { return &v }

func doRequest(handler http.HandlerFunc, method, url string, body []byte) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, url, bytes.NewReader(body))
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	return rr
}

func TestSearchHandlerReturnsScoredMatches(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "report.pdf"), []byte("pdf"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "notes.txt"), []byte("txt"), 0o644); err != nil {
		t.Fatal(err)
	}

	body, _ := json.Marshal(SearchQuery{
		Query:  "report",
		Path:   root,
		Source: SearchSourceLocal,
		Depth:  SearchScope{Scope: SearchDepthCWD, Depth: intPtr(0)},
	})
	rr := doRequest(Search(), http.MethodPost, "/api/search", body)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp coresearch.Response
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(resp.Items) != 1 {
		t.Fatalf("expected 1 result, got %d", len(resp.Items))
	}
	if resp.Items[0].Name != "report.pdf" {
		t.Fatalf("expected report.pdf, got %q", resp.Items[0].Name)
	}
	if resp.Items[0].Source != "LOCAL" {
		t.Fatalf("expected LOCAL source, got %q", resp.Items[0].Source)
	}
	if resp.Items[0].Score <= 0 {
		t.Fatalf("expected positive score, got %d", resp.Items[0].Score)
	}
}

func TestSearchHandlerHonorsDepth(t *testing.T) {
	root := t.TempDir()
	nested := filepath.Join(root, "docs", "deep")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "docs", "report.md"), []byte("md"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(nested, "report-deep.md"), []byte("md"), 0o644); err != nil {
		t.Fatal(err)
	}

	body, _ := json.Marshal(SearchQuery{
		Query:  "report",
		Path:   root,
		Source: SearchSourceLocal,
		Depth:  SearchScope{Scope: SearchDepthDepth, Depth: intPtr(1)},
	})
	rr := doRequest(Search(), http.MethodPost, "/api/search", body)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp coresearch.Response
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(resp.Items) != 1 {
		t.Fatalf("expected 1 result at depth 1, got %d", len(resp.Items))
	}
	if resp.Items[0].Name != "report.md" {
		t.Fatalf("expected shallow match, got %q", resp.Items[0].Name)
	}
}

func TestSearchHandlerRejectsUnsupportedSource(t *testing.T) {
	root := t.TempDir()
	body, _ := json.Marshal(SearchQuery{
		Query:  "report",
		Path:   root,
		Source: SearchSourceRemote,
		Depth:  SearchScope{Scope: SearchDepthCWD, Depth: intPtr(0)},
	})
	rr := doRequest(Search(), http.MethodPost, "/api/search", body)
	if rr.Code != http.StatusNotImplemented {
		t.Fatalf("expected 501, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestSearchLocalCoreCaseInsensitive(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "MyFile.TXT"), []byte("txt"), 0o644); err != nil {
		t.Fatal(err)
	}

	items, err := coresearch.SearchLocal(context.Background(), root, "myfile", 0, 100)
	if err != nil {
		t.Fatalf("SearchLocal: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(items))
	}
	if items[0].Name != "MyFile.TXT" {
		t.Fatalf("expected MyFile.TXT, got %q", items[0].Name)
	}
}
