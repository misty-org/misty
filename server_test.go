package main

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
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

	server, err := CreateServer()
	if err != nil {
		t.Fatalf("CreateServer() error = %v", err)
	}
	if server.Library == nil || server.LibraryStore == nil {
		t.Fatal("CreateServer() did not configure the Space Library")
	}
}

func testAgentAttachmentPrivateKey(t *testing.T) string {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	pemBytes := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: mustMarshalPKCS8(t, key)})
	return base64.StdEncoding.EncodeToString(pemBytes)
}

func mustMarshalPKCS8(t *testing.T, key *rsa.PrivateKey) []byte {
	t.Helper()
	encoded, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

func configureTestR2(t *testing.T) {
	t.Helper()
	t.Setenv("R2_ENDPOINT", "https://account-id.r2.cloudflarestorage.com")
	t.Setenv("R2_BUCKET", "misty-server")
	t.Setenv("R2_ACCESS_KEY", "test-access")
	t.Setenv("R2_SECRET_KEY", "test-secret")
}

func TestCreateServerRejectsMissingAgentAttachmentSigningKey(t *testing.T) {
	t.Setenv("PASSWORD_RESET_URL", "http://localhost:5173/reset")
	t.Setenv("PASSWORD_RESET_START_URL", "http://localhost:8080/auth/reset/start")
	t.Setenv("MISTY_ENVIRONMENT", "production")
	t.Setenv("MISTY_AGENT_DOCUMENTS_ENABLED", "true")
	configureTestR2(t)
	t.Setenv("DOCUMENT_SIGNING_KEY", "")

	if _, err := CreateServer(); err == nil || !strings.Contains(err.Error(), "signing-key") {
		t.Fatalf("CreateServer() error = %v, want missing signing-key rejection", err)
	}
}

func TestCreateServerConfiguresCloudflareR2AgentAttachmentStore(t *testing.T) {
	t.Setenv("PASSWORD_RESET_URL", "http://localhost:5173/reset")
	t.Setenv("PASSWORD_RESET_START_URL", "http://localhost:8080/auth/reset/start")
	t.Setenv("MAILJET_API_KEY", "")
	t.Setenv("MAILJET_SECRET_KEY", "")
	t.Setenv("MAILJET_FROM_EMAIL", "")
	t.Setenv("MISTY_ENVIRONMENT", "production")
	t.Setenv("MISTY_AGENT_DOCUMENTS_ENABLED", "true")
	configureTestR2(t)
	t.Setenv("DOCUMENT_SIGNING_KEY", strings.Repeat("k", 32))
	t.Setenv("DOCUMENT_KEY_ID", "test-current")
	t.Setenv("DOCUMENT_PRIVATE_KEY_B64", testAgentAttachmentPrivateKey(t))

	server, err := CreateServer()
	if err != nil {
		t.Fatalf("CreateServer() error = %v", err)
	}
	if server.AgentAttachmentStore == nil {
		t.Fatal("CreateServer() did not configure R2 attachment store")
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

func TestCORSAllowsTauriOrigin(t *testing.T) {
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

	req := httptest.NewRequest(http.MethodOptions, "/api/login", nil)
	req.Header.Set("Origin", "tauri://localhost")
	req.Header.Set("Access-Control-Request-Method", "POST")
	req.Header.Set("Access-Control-Request-Headers", "content-type")
	rec := httptest.NewRecorder()
	server.Router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("OPTIONS /api/login status = %d, want %d", rec.Code, http.StatusOK)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "tauri://localhost" {
		t.Fatalf("Access-Control-Allow-Origin = %q, want tauri://localhost", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Fatalf("Access-Control-Allow-Credentials = %q, want true", got)
	}
}
