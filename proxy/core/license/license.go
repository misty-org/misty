package license

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/kannachi323/misty/proxy/db"
)

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

func (m *Manager) cachedClaims() (*Claims, error) {
	cached, err := m.database.GetLicense()
	if err != nil || cached == nil {
		return nil, err
	}
	if !cached.ExpiresAt.IsZero() && time.Now().After(cached.ExpiresAt) {
		return nil, errors.New("cached entitlement expired")
	}
	return m.validateToken(cached.Token)
}

func identityMatches(claims *Claims, userID, email string) bool {
	if claims == nil {
		return false
	}
	if userID != "" && claims.UserID == userID {
		return true
	}
	if email != "" && strings.EqualFold(claims.Email, email) {
		return true
	}
	return false
}

// GetTierForIdentity returns the local cached entitlement tier for the
// authenticated user. Returns "free" if no matching entitlement is cached.
func (m *Manager) GetTierForIdentity(userID, email string) string {
	claims, err := m.cachedClaims()
	if err != nil || !identityMatches(claims, userID, email) {
		return "free"
	}
	return claims.Tier
}

// RenewIfCached is intentionally a no-op for perpetual entitlements.
func (m *Manager) RenewIfCached() {}

// RefreshIfNeeded returns a previously verified local entitlement for this
// user if one exists; otherwise it performs the one-time server verification.
func (m *Manager) RefreshIfNeeded(email, password string) (string, error) {
	claims, err := m.cachedClaims()
	if err == nil && identityMatches(claims, "", email) {
		return m.GetCachedTokenForIdentity(claims.UserID, email), nil
	}

	return m.fetchAndStore(email, password)
}

// GetCachedTokenForIdentity returns the cached entitlement token for the
// authenticated user, or empty string if none matches.
func (m *Manager) GetCachedTokenForIdentity(userID, email string) string {
	cached, err := m.database.GetLicense()
	if err != nil || cached == nil {
		return ""
	}
	if !cached.ExpiresAt.IsZero() && time.Now().After(cached.ExpiresAt) {
		return ""
	}
	claims, err := m.validateToken(cached.Token)
	if err != nil || !identityMatches(claims, userID, email) {
		return ""
	}
	return cached.Token
}

func (m *Manager) fetchAndStore(email, password string) (string, error) {
	if m.serverURL == "" {
		return "", errors.New("MISTY_SERVER_URL not configured")
	}

	body, _ := json.Marshal(map[string]string{"email": email, "password": password})
	resp, err := http.Post(m.serverURL+"/license/validate", "application/json", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("license server unreachable: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusForbidden {
		return "", errors.New("subscription inactive")
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("license server returned %d", resp.StatusCode)
	}

	var result struct {
		LicenseToken string `json:"license_token"`
		Tier         string `json:"tier"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}

	claims, err := m.validateToken(result.LicenseToken)
	if err != nil {
		return "", fmt.Errorf("server returned invalid token: %w", err)
	}
	if !identityMatches(claims, "", email) {
		return "", errors.New("server returned entitlement for a different user")
	}

	expiresAt := time.Time{}
	if claims.ExpiresAt != nil {
		expiresAt = claims.ExpiresAt.Time
	}

	if err := m.database.StoreLicense(result.LicenseToken, result.Tier, expiresAt); err != nil {
		return "", err
	}

	expiry := "never"
	if !expiresAt.IsZero() {
		expiry = expiresAt.Format(time.RFC3339)
	}
	log.Printf("Entitlement cached: tier=%s expires=%s", result.Tier, expiry)
	return result.LicenseToken, nil
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
