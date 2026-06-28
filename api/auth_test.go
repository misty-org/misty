package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSessionCookieSameSiteUsesNoneForSecureAppOrigin(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/login", nil)
	req.Header.Set("Origin", "tauri://localhost")

	if got := sessionCookieSameSite(req, true); got != http.SameSiteNoneMode {
		t.Fatalf("sessionCookieSameSite() = %v, want %v", got, http.SameSiteNoneMode)
	}
}

func TestSessionCookieSameSiteKeepsLaxForInsecureRequest(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/login", nil)
	req.Header.Set("Origin", "http://localhost:5173")

	if got := sessionCookieSameSite(req, false); got != http.SameSiteLaxMode {
		t.Fatalf("sessionCookieSameSite() = %v, want %v", got, http.SameSiteLaxMode)
	}
}

func TestBearerTokenFromRequest(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	req.Header.Set("Authorization", "Bearer session-token")

	token, ok := bearerTokenFromRequest(req)
	if !ok || token != "session-token" {
		t.Fatalf("bearerTokenFromRequest() = %q, %v; want session-token, true", token, ok)
	}
}

func TestBearerTokenFromRequestRejectsEmptyToken(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	req.Header.Set("Authorization", "Bearer   ")

	if token, ok := bearerTokenFromRequest(req); ok || token != "" {
		t.Fatalf("bearerTokenFromRequest() = %q, %v; want empty, false", token, ok)
	}
}
