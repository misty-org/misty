package license

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/kannachi323/misty/proxy/db"
)

const refreshThreshold = 24 * time.Hour // refresh if token expires within 1 day

type Claims struct {
	UserID string `json:"user_id"`
	Email  string `json:"email"`
	Tier   string `json:"tier"`
	jwt.RegisteredClaims
}

type Manager struct {
	database  *db.Database
	serverURL string
	secret    []byte
}

func NewManager(database *db.Database) *Manager {
	return &Manager{
		database:  database,
		serverURL: os.Getenv("MISTY_SERVER_URL"),
		secret:    []byte(os.Getenv("LICENSE_SECRET")),
	}
}

// GetTier returns the current subscription tier from the local cache.
// Returns "free" if no valid license is cached.
func (m *Manager) GetTier() string {
	cached, err := m.database.GetLicense()
	if err != nil || cached == nil {
		return "free"
	}
	if time.Now().After(cached.ExpiresAt) {
		return "free"
	}
	if _, err := m.validateToken(cached.Token); err != nil {
		return "free"
	}
	return cached.Tier
}

// RenewIfCached re-validates the cached license token if it's close to expiry.
// Safe to call without credentials — does nothing if cache is empty or still fresh.
func (m *Manager) RenewIfCached() {
	cached, err := m.database.GetLicense()
	if err != nil || cached == nil {
		return
	}
	if time.Until(cached.ExpiresAt) > refreshThreshold {
		return
	}
	// Re-validate the existing token — if the server still considers it valid,
	// parse claims and extend the local cache without needing credentials.
	claims, err := m.validateToken(cached.Token)
	if err != nil {
		return
	}
	// Token is structurally valid but close to expiry; keep it in cache
	// without extension (server-side expiry is authoritative).
	_ = m.database.StoreLicense(cached.Token, cached.Tier, claims.ExpiresAt.Time)
}

// RefreshIfNeeded fetches a fresh license token from the server if the
// cached one is missing, expired, or within refreshThreshold of expiry.
func (m *Manager) RefreshIfNeeded(email, password string) error {
	cached, err := m.database.GetLicense()
	if err != nil {
		return err
	}

	if cached != nil && time.Until(cached.ExpiresAt) > refreshThreshold {
		return nil // still fresh
	}

	return m.fetchAndStore(email, password)
}

func (m *Manager) fetchAndStore(email, password string) error {
	if m.serverURL == "" {
		return errors.New("MISTY_SERVER_URL not configured")
	}

	body, _ := json.Marshal(map[string]string{"email": email, "password": password})
	resp, err := http.Post(m.serverURL+"/license/validate", "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("license server unreachable: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusForbidden {
		return errors.New("subscription inactive")
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("license server returned %d", resp.StatusCode)
	}

	var result struct {
		LicenseToken string `json:"license_token"`
		Tier         string `json:"tier"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return err
	}

	claims, err := m.validateToken(result.LicenseToken)
	if err != nil {
		return fmt.Errorf("server returned invalid token: %w", err)
	}

	if err := m.database.StoreLicense(result.LicenseToken, result.Tier, claims.ExpiresAt.Time); err != nil {
		return err
	}

	log.Printf("License refreshed: tier=%s expires=%s", result.Tier, claims.ExpiresAt.Time.Format(time.RFC3339))
	return nil
}

func (m *Manager) validateToken(tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return m.secret, nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}
