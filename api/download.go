package api

import (
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
	"github.com/kannachi323/misty/server/db"
)

const defaultDownloadURLTTL = 5 * time.Minute

type downloadClaims struct {
	Platform string `json:"platform"`
	jwt.RegisteredClaims
}

type downloadAsset struct {
	Platform string
	URL      string
}

func DownloadURL(database *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, err := sessionUserID(r, database)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if userID == "" {
			http.Error(w, "not authenticated", http.StatusUnauthorized)
			return
		}

		sub, err := database.GetSubscription(userID)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if sub.Status != "active" {
			http.Error(w, "license inactive", http.StatusForbidden)
			return
		}

		platform := normalizeDownloadPlatform(r.URL.Query().Get("platform"))
		if platform == "" {
			http.Error(w, "unsupported platform", http.StatusBadRequest)
			return
		}

		if _, ok := downloadAssetForPlatform(platform); !ok {
			http.Error(w, "download unavailable", http.StatusNotFound)
			return
		}

		ttl := downloadURLTTL()
		expiresAt := time.Now().Add(ttl)
		token, err := issueDownloadToken(platform, expiresAt)
		if err != nil {
			http.Error(w, "failed to sign download url", http.StatusInternalServerError)
			return
		}

		downloadURL := requestBaseURL(r)
		basePath := ""
		if strings.HasPrefix(r.URL.Path, "/api/") {
			basePath = "/api"
		}
		downloadURL.Path = joinURLPath(basePath, "download", platform)
		query := downloadURL.Query()
		query.Set("token", token)
		downloadURL.RawQuery = query.Encode()

		writeJSON(w, http.StatusOK, map[string]any{
			"url":        downloadURL.String(),
			"expires_at": expiresAt.UTC().Format(time.RFC3339),
		})
	}
}

func DownloadRedirect() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		platform := normalizeDownloadPlatform(chi.URLParam(r, "platform"))
		if platform == "" {
			http.Error(w, "unsupported platform", http.StatusBadRequest)
			return
		}

		claims, err := validateDownloadToken(r.URL.Query().Get("token"))
		if err != nil {
			http.Error(w, "invalid or expired download url", http.StatusUnauthorized)
			return
		}
		if claims.Platform != platform {
			http.Error(w, "download url platform mismatch", http.StatusForbidden)
			return
		}

		asset, ok := downloadAssetForPlatform(platform)
		if !ok {
			http.Error(w, "download unavailable", http.StatusNotFound)
			return
		}

		http.Redirect(w, r, asset.URL, http.StatusFound)
	}
}

func issueDownloadToken(platform string, expiresAt time.Time) (string, error) {
	now := time.Now()
	claims := downloadClaims{
		Platform: platform,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			Subject:   "download",
		},
	}

	secret, err := downloadSigningSecret()
	if err != nil {
		return "", err
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(secret)
}

func validateDownloadToken(tokenStr string) (*downloadClaims, error) {
	if strings.TrimSpace(tokenStr) == "" {
		return nil, fmt.Errorf("missing token")
	}

	token, err := jwt.ParseWithClaims(tokenStr, &downloadClaims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return downloadSigningSecret()
	})
	if err != nil {
		return nil, err
	}

	claims, ok := token.Claims.(*downloadClaims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}

	return claims, nil
}

func downloadSigningSecret() ([]byte, error) {
	secret := strings.TrimSpace(os.Getenv("DOWNLOAD_SIGNING_SECRET"))
	if secret == "" {
		secret = strings.TrimSpace(os.Getenv("LICENSE_SECRET"))
	}
	if secret == "" {
		return nil, fmt.Errorf("DOWNLOAD_SIGNING_SECRET or LICENSE_SECRET is required")
	}
	return []byte(secret), nil
}

func downloadURLTTL() time.Duration {
	raw := strings.TrimSpace(os.Getenv("DOWNLOAD_URL_TTL_SECONDS"))
	if raw == "" {
		return defaultDownloadURLTTL
	}
	seconds, err := strconv.Atoi(raw)
	if err != nil || seconds <= 0 {
		return defaultDownloadURLTTL
	}
	return time.Duration(seconds) * time.Second
}

func downloadAssetForPlatform(platform string) (downloadAsset, bool) {
	defaults := map[string]string{
		"windows": "https://github.com/kannachi323/misty/releases/tag/v0.1.0",
		"macos":   "https://github.com/kannachi323/misty/releases/download/v0.1.0/Misty-1.0-arm64.dmg",
		"linux":   "https://github.com/kannachi323/misty/releases/tag/v0.1.0",
	}

	envKey := "MISTY_DOWNLOAD_" + strings.ToUpper(platform) + "_URL"
	rawURL := strings.TrimSpace(os.Getenv(envKey))
	if rawURL == "" {
		rawURL = defaults[platform]
	}
	if rawURL == "" {
		return downloadAsset{}, false
	}

	parsedURL, err := url.Parse(rawURL)
	if err != nil || parsedURL.Scheme == "" || parsedURL.Host == "" {
		return downloadAsset{}, false
	}

	return downloadAsset{Platform: platform, URL: parsedURL.String()}, true
}

func normalizeDownloadPlatform(platform string) string {
	switch strings.ToLower(strings.TrimSpace(platform)) {
	case "windows", "win":
		return "windows"
	case "macos", "mac", "darwin":
		return "macos"
	case "linux":
		return "linux"
	default:
		return ""
	}
}

func requestBaseURL(r *http.Request) url.URL {
	scheme := r.Header.Get("X-Forwarded-Proto")
	if scheme == "" {
		if r.TLS != nil {
			scheme = "https"
		} else {
			scheme = "http"
		}
	}

	host := r.Header.Get("X-Forwarded-Host")
	if host == "" {
		host = r.Host
	}

	return url.URL{
		Scheme: scheme,
		Host:   host,
	}
}

func joinURLPath(parts ...string) string {
	trimmed := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.Trim(part, "/")
		if part != "" {
			trimmed = append(trimmed, part)
		}
	}
	return "/" + strings.Join(trimmed, "/")
}
