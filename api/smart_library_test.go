package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kannachi323/misty/server/db"
)

func TestSmartLibraryHandlersRequireAuthentication(t *testing.T) {
	service := NewSmartLibraryService(&db.Database{})
	tests := []struct {
		name, method, path string
		handler            http.HandlerFunc
	}{
		{"register", http.MethodPost, "/ai/smart-library/folders", service.RegisterFolder()},
		{"preflight", http.MethodPost, "/ai/smart-library/folders/f/preflight", service.Preflight()},
		{"sample", http.MethodPost, "/ai/smart-library/folders/f/sample", service.CreateSample()},
		{"approve", http.MethodPost, "/ai/smart-library/folders/f/approve", service.Approve("full")},
		{"progress", http.MethodGet, "/ai/smart-library/folders/f/progress", service.Progress()},
		{"results", http.MethodGet, "/ai/smart-library/folders/f/results", service.Results()},
		{"rescan", http.MethodPost, "/ai/smart-library/folders/f/rescan", service.Rescan()},
		{"search", http.MethodPost, "/ai/smart-library/folders/f/search", service.Search()},
		{"delete", http.MethodDelete, "/ai/smart-library/folders/f", service.Delete()},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			request := httptest.NewRequest(tt.method, tt.path, strings.NewReader("{}"))
			recorder := httptest.NewRecorder()
			tt.handler.ServeHTTP(recorder, request)
			if recorder.Code != http.StatusUnauthorized {
				t.Fatalf("status=%d", recorder.Code)
			}
		})
	}
}

func TestOpaqueSmartLibraryIDsRejectPaths(t *testing.T) {
	if !validOpaqueID("asset_123", "asset_") {
		t.Fatal("valid opaque ID rejected")
	}
	for _, value := range []string{"asset_/Users/photo.jpg", "asset_hello world", "other_123"} {
		if validOpaqueID(value, "asset_") {
			t.Fatalf("accepted %q", value)
		}
	}
}
