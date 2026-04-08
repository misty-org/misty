package tests

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/kannachi323/misty/proxy/core/auth"
	licensepkg "github.com/kannachi323/misty/proxy/core/license"
	proxydb "github.com/kannachi323/misty/proxy/db"
)

func newTestProxyDB(t *testing.T) *proxydb.Database {
	t.Helper()

	conn, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("sql.Open() error = %v", err)
	}

	t.Cleanup(func() {
		_ = conn.Close()
	})

	if _, err := conn.Exec(`
		CREATE TABLE license_cache (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			token TEXT NOT NULL,
			tier TEXT NOT NULL,
			expires_at DATETIME NOT NULL
		)
	`); err != nil {
		t.Fatalf("create license_cache table error = %v", err)
	}

	return &proxydb.Database{Conn: conn}
}

func newLicenseToken(t *testing.T, secret, userID, email, tier string) string {
	t.Helper()

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, &licensepkg.Claims{
		UserID: userID,
		Email:  email,
		Tier:   tier,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	})

	signed, err := token.SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("SignedString() error = %v", err)
	}
	return signed
}

func requestWithIdentity(userID, email string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, "/api/files", nil)
	ctx := context.WithValue(req.Context(), auth.ContextUserID, userID)
	ctx = context.WithValue(ctx, auth.ContextEmail, email)
	return req.WithContext(ctx)
}

func TestRequireProAllowsMaxHeaderToken(t *testing.T) {
	t.Setenv("LICENSE_SECRET", "proxy-test-secret")

	database := newTestProxyDB(t)
	manager := licensepkg.NewManager(database)
	token := newLicenseToken(t, "proxy-test-secret", "user_1", "max@example.com", "max")

	called := false
	handler := manager.RequirePro(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	}))

	req := requestWithIdentity("user_1", "max@example.com")
	req.Header.Set("X-License-Token", token)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNoContent)
	}
	if !called {
		t.Fatal("next handler was not called")
	}
}

func TestRequireProRejectsMismatchedIdentity(t *testing.T) {
	t.Setenv("LICENSE_SECRET", "proxy-test-secret")

	database := newTestProxyDB(t)
	manager := licensepkg.NewManager(database)
	token := newLicenseToken(t, "proxy-test-secret", "user_1", "max@example.com", "pro")

	handler := manager.RequirePro(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	req := requestWithIdentity("user_2", "other@example.com")
	req.Header.Set("X-License-Token", token)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusPaymentRequired {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusPaymentRequired)
	}
}

func TestRequireProUsesCachedPaidTier(t *testing.T) {
	t.Setenv("LICENSE_SECRET", "proxy-test-secret")

	database := newTestProxyDB(t)
	manager := licensepkg.NewManager(database)
	token := newLicenseToken(t, "proxy-test-secret", "user_3", "pro@example.com", "pro")

	if err := database.StoreLicense(token, "pro", time.Now().Add(time.Hour)); err != nil {
		t.Fatalf("StoreLicense() error = %v", err)
	}

	called := false
	handler := manager.RequirePro(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	}))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, requestWithIdentity("user_3", "pro@example.com"))

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNoContent)
	}
	if !called {
		t.Fatal("next handler was not called")
	}
}

func TestRequireRemoteQuotaAllowsFreeWithinLimit(t *testing.T) {
	t.Setenv("LICENSE_SECRET", "proxy-test-secret")

	database := newTestProxyDB(t)
	manager := licensepkg.NewManager(database)
	token := newLicenseToken(t, "proxy-test-secret", "user_4", "free@example.com", "free")

	if err := database.StoreLicense(token, "free", time.Now().Add(time.Hour)); err != nil {
		t.Fatalf("StoreLicense() error = %v", err)
	}

	called := false
	handler := manager.RequireRemoteQuota(3, func() int { return 2 })(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	}))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, requestWithIdentity("user_4", "free@example.com"))

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNoContent)
	}
	if !called {
		t.Fatal("next handler was not called")
	}
}

func TestRequireRemoteQuotaRejectsFreeAtLimit(t *testing.T) {
	t.Setenv("LICENSE_SECRET", "proxy-test-secret")

	database := newTestProxyDB(t)
	manager := licensepkg.NewManager(database)
	token := newLicenseToken(t, "proxy-test-secret", "user_5", "free@example.com", "free")

	if err := database.StoreLicense(token, "free", time.Now().Add(time.Hour)); err != nil {
		t.Fatalf("StoreLicense() error = %v", err)
	}

	handler := manager.RequireRemoteQuota(3, func() int { return 3 })(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, requestWithIdentity("user_5", "free@example.com"))

	if rec.Code != http.StatusPaymentRequired {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusPaymentRequired)
	}
}

func TestRequireRemoteQuotaAllowsPaidAboveLimit(t *testing.T) {
	t.Setenv("LICENSE_SECRET", "proxy-test-secret")

	database := newTestProxyDB(t)
	manager := licensepkg.NewManager(database)
	token := newLicenseToken(t, "proxy-test-secret", "user_6", "pro@example.com", "pro")

	called := false
	handler := manager.RequireRemoteQuota(3, func() int { return 99 })(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	}))

	req := requestWithIdentity("user_6", "pro@example.com")
	req.Header.Set("X-License-Token", token)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNoContent)
	}
	if !called {
		t.Fatal("next handler was not called")
	}
}
