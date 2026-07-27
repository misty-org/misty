package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestIsLocalhostHostname(t *testing.T) {
	tests := []struct {
		host string
		want bool
	}{
		{host: "localhost", want: true},
		{host: "127.0.0.1", want: true},
		{host: "::1", want: true},
		{host: " example.com ", want: false},
	}

	for _, tt := range tests {
		if got := isLocalhostHostname(tt.host); got != tt.want {
			t.Fatalf("isLocalhostHostname(%q) = %v, want %v", tt.host, got, tt.want)
		}
	}
}

func TestPasswordResetURLsFromEnv(t *testing.T) {
	t.Setenv("PASSWORD_RESET_URL", "https://app.example.com/reset")
	t.Setenv("PASSWORD_RESET_START_URL", "https://api.example.com/auth/reset/start")

	redirectURL, err := passwordResetRedirectURLFromEnv()
	if err != nil {
		t.Fatalf("passwordResetRedirectURLFromEnv() error = %v", err)
	}
	if redirectURL != "https://app.example.com/reset" {
		t.Fatalf("redirect URL = %q, want %q", redirectURL, "https://app.example.com/reset")
	}

	startURL, err := passwordResetStartURLFromEnv()
	if err != nil {
		t.Fatalf("passwordResetStartURLFromEnv() error = %v", err)
	}
	if startURL != "https://api.example.com/auth/reset/start" {
		t.Fatalf("start URL = %q, want %q", startURL, "https://api.example.com/auth/reset/start")
	}
}

func TestPasswordResetURLsRejectNonLocalhostHTTP(t *testing.T) {
	t.Setenv("PASSWORD_RESET_URL", "http://example.com/reset")
	if _, err := passwordResetRedirectURLFromEnv(); err == nil {
		t.Fatal("passwordResetRedirectURLFromEnv() succeeded for non-localhost http URL")
	}

	t.Setenv("PASSWORD_RESET_START_URL", "http://example.com/auth/reset/start")
	if _, err := passwordResetStartURLFromEnv(); err == nil {
		t.Fatal("passwordResetStartURLFromEnv() succeeded for non-localhost http URL")
	}
}

func TestCreateServerAndMountHandlers(t *testing.T) {
	t.Setenv("PASSWORD_RESET_URL", "http://localhost:5173/reset")
	t.Setenv("PASSWORD_RESET_START_URL", "http://localhost:8080/auth/reset/start")
	t.Setenv("MAILJET_API_KEY", "")
	t.Setenv("MAILJET_SECRET_KEY", "")
	t.Setenv("MAILJET_FROM_EMAIL", "")

	server, err := CreateServer()
	if err != nil {
		t.Fatalf("CreateServer() error = %v", err)
	}
	if server.Router == nil || server.Database == nil || server.EmailSender == nil {
		t.Fatalf("server not fully initialized: %#v", server)
	}

	if err := server.MountHandlers(); err != nil {
		t.Fatalf("MountHandlers() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/login", nil)
	rec := httptest.NewRecorder()
	server.Router.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("POST /api/login status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestCreateServerRequiresProductionR2Configuration(t *testing.T) {
	t.Setenv("PASSWORD_RESET_URL", "http://localhost:5173/reset")
	t.Setenv("PASSWORD_RESET_START_URL", "http://localhost:8080/auth/reset/start")
	t.Setenv("MISTY_ENVIRONMENT", "production")
	t.Setenv("R2_ENDPOINT", "")
	t.Setenv("R2_BUCKET", "")
	t.Setenv("R2_ACCESS_KEY", "")
	t.Setenv("R2_SECRET_KEY", "")

	if _, err := CreateServer(); err == nil || !strings.Contains(err.Error(), "R2_ENDPOINT") {
		t.Fatalf("CreateServer() error = %v, want missing production R2 rejection", err)
	}
}

func TestCreateServerConfiguresIndependentDevelopmentLibrary(t *testing.T) {
	t.Setenv("PASSWORD_RESET_URL", "http://localhost:5173/reset")
	t.Setenv("PASSWORD_RESET_START_URL", "http://localhost:8080/auth/reset/start")
	t.Setenv("MAILJET_API_KEY", "")
	t.Setenv("MAILJET_SECRET_KEY", "")
	t.Setenv("MAILJET_FROM_EMAIL", "")
	t.Setenv("R2_ENDPOINT", "")
	t.Setenv("R2_BUCKET", "")
	t.Setenv("R2_ACCESS_KEY", "")
	t.Setenv("R2_SECRET_KEY", "")
	// The memory-backed Library fallback this test exercises is gated on a
	// non-production environment; without this the test's outcome silently
	// depends on whatever MISTY_ENVIRONMENT happens to be set to in the
	// process running the suite (e.g. a local .env that mimics production).
	t.Setenv("MISTY_ENVIRONMENT", "")

	server, err := CreateServer()
	if err != nil {
		t.Fatalf("CreateServer() error = %v", err)
	}
	if server.Library == nil || server.LibraryStore == nil {
		t.Fatal("CreateServer() did not configure the Space Library")
	}
}

func TestDemoLibraryStoreRequiresDedicatedBackingStorage(t *testing.T) {
	for _, key := range []string{"MISTY_LIBRARY_LOCAL_DIR", "R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY", "R2_SECRET_KEY"} {
		t.Setenv(key, "")
	}
	t.Setenv("MISTY_ENVIRONMENT", "development")
	t.Setenv("MISTY_DEMO_MODE", "local")
	if _, err := libraryStoreFromEnv(); err == nil || !strings.Contains(err.Error(), "MISTY_LIBRARY_LOCAL_DIR") {
		t.Fatalf("libraryStoreFromEnv(local demo) error = %v; want persistent local store requirement", err)
	}
	t.Setenv("MISTY_DEMO_MODE", "staging")
	if _, err := libraryStoreFromEnv(); err == nil || !strings.Contains(err.Error(), "dedicated R2") {
		t.Fatalf("libraryStoreFromEnv(staging demo) error = %v; want dedicated R2 requirement", err)
	}
}

func TestAllowedCORSOriginsRejectsWildcards(t *testing.T) {
	t.Setenv("MISTY_ALLOWED_ORIGINS", "https://app.misty.example, https://*, http://evil.example/*")
	origins := allowedCORSOrigins()
	joined := strings.Join(origins, ",")
	if !strings.Contains(joined, "https://app.misty.example") {
		t.Fatalf("configured exact origin missing: %v", origins)
	}
	if strings.Contains(joined, "*") {
		t.Fatalf("wildcard origin was accepted: %v", origins)
	}
}

func TestAllowedCORSOriginAcceptsViteLoopbackPorts(t *testing.T) {
	for _, origin := range []string{"http://localhost:5174", "http://127.0.0.1:5199", "http://[::1]:5175"} {
		if !isAllowedCORSOrigin(origin) {
			t.Fatalf("isAllowedCORSOrigin(%q) = false, want true", origin)
		}
	}
	for _, origin := range []string{"http://127.0.0.1:5200", "https://127.0.0.1:5174", "http://example.com:5174", "http://127.0.0.1:5174?spoofed=true"} {
		if isAllowedCORSOrigin(origin) {
			t.Fatalf("isAllowedCORSOrigin(%q) = true, want false", origin)
		}
	}
}

func TestCORSAllowsAppOrigins(t *testing.T) {
	t.Setenv("PASSWORD_RESET_URL", "http://localhost:5173/reset")
	t.Setenv("PASSWORD_RESET_START_URL", "http://localhost:8080/auth/reset/start")
	t.Setenv("MAILJET_API_KEY", "")
	t.Setenv("MAILJET_SECRET_KEY", "")
	t.Setenv("MAILJET_FROM_EMAIL", "")

	server, err := CreateServer()
	if err != nil {
		t.Fatalf("CreateServer() error = %v", err)
	}
	if err := server.MountHandlers(); err != nil {
		t.Fatalf("MountHandlers() error = %v", err)
	}

	for _, origin := range []string{"tauri://localhost", "http://127.0.0.1:5174"} {
		req := httptest.NewRequest(http.MethodOptions, "/api/login", nil)
		req.Header.Set("Origin", origin)
		req.Header.Set("Access-Control-Request-Method", "POST")
		req.Header.Set("Access-Control-Request-Headers", "content-type")
		rec := httptest.NewRecorder()
		server.Router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("OPTIONS /api/login from %s status = %d, want %d", origin, rec.Code, http.StatusOK)
		}
		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != origin {
			t.Fatalf("Access-Control-Allow-Origin = %q, want %s", got, origin)
		}
		if got := rec.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
			t.Fatalf("Access-Control-Allow-Credentials = %q, want true", got)
		}
	}

	req := httptest.NewRequest(http.MethodOptions, "/api/spaces", nil)
	req.Header.Set("Origin", "http://127.0.0.1:5173")
	req.Header.Set("Access-Control-Request-Method", "POST")
	req.Header.Set("Access-Control-Request-Headers", "authorization,content-type,idempotency-key")
	rec := httptest.NewRecorder()
	server.Router.ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://127.0.0.1:5173" {
		t.Fatalf("Space creation Access-Control-Allow-Origin = %q, want loopback origin", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Headers"); !strings.Contains(strings.ToLower(got), "idempotency-key") {
		t.Fatalf("Space creation Access-Control-Allow-Headers = %q, want Idempotency-Key", got)
	}
}
