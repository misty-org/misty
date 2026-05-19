package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

func TestDownloadTokenRoundTrip(t *testing.T) {
	t.Setenv("DOWNLOAD_SIGNING_SECRET", "test-download-secret")

	expiresAt := time.Now().Add(time.Minute)
	token, err := issueDownloadToken("macos", expiresAt)
	if err != nil {
		t.Fatalf("issueDownloadToken() error = %v", err)
	}

	claims, err := validateDownloadToken(token)
	if err != nil {
		t.Fatalf("validateDownloadToken() error = %v", err)
	}

	if claims.Platform != "macos" {
		t.Fatalf("claims.Platform = %q, want %q", claims.Platform, "macos")
	}
}

func TestDownloadTokenRejectsWrongSecret(t *testing.T) {
	t.Setenv("DOWNLOAD_SIGNING_SECRET", "secret-a")

	token, err := issueDownloadToken("linux", time.Now().Add(time.Minute))
	if err != nil {
		t.Fatalf("issueDownloadToken() error = %v", err)
	}

	t.Setenv("DOWNLOAD_SIGNING_SECRET", "secret-b")
	if _, err := validateDownloadToken(token); err == nil {
		t.Fatal("validateDownloadToken() succeeded with wrong secret, want error")
	}
}

func TestDownloadRedirectRejectsPlatformMismatch(t *testing.T) {
	t.Setenv("DOWNLOAD_SIGNING_SECRET", "test-download-secret")
	t.Setenv("MISTY_DOWNLOAD_MACOS_URL", "https://downloads.example.com/misty.dmg")

	token, err := issueDownloadToken("linux", time.Now().Add(time.Minute))
	if err != nil {
		t.Fatalf("issueDownloadToken() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/download/macos?token="+token, nil)
	rec := httptest.NewRecorder()
	router := chi.NewRouter()
	router.Get("/download/{platform}", DownloadRedirect())

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
	}
}

func TestDownloadRedirectSendsSignedURLToAsset(t *testing.T) {
	t.Setenv("DOWNLOAD_SIGNING_SECRET", "test-download-secret")
	t.Setenv("MISTY_DOWNLOAD_MACOS_URL", "https://downloads.example.com/misty.dmg")

	token, err := issueDownloadToken("macos", time.Now().Add(time.Minute))
	if err != nil {
		t.Fatalf("issueDownloadToken() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/download/macos?token="+token, nil)
	rec := httptest.NewRecorder()
	router := chi.NewRouter()
	router.Get("/download/{platform}", DownloadRedirect())

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusFound {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusFound)
	}
	if location := rec.Header().Get("Location"); location != "https://downloads.example.com/misty.dmg" {
		t.Fatalf("Location = %q, want %q", location, "https://downloads.example.com/misty.dmg")
	}
}
