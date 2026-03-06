package db

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
)

var (
	ErrTokenRevoked  = errors.New("refresh token has been revoked")
	ErrTokenExpired  = errors.New("refresh token has expired")
	ErrTokenNotFound = errors.New("refresh token not found")
)

func HashToken(raw string) string {
	h := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(h[:])
}

func (db *Database) tokenEncryptionKey() ([]byte, error) {
	if encoded := strings.TrimSpace(os.Getenv("MISTY_TOKEN_ENCRYPTION_KEY")); encoded != "" {
		key, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			return nil, fmt.Errorf("decode MISTY_TOKEN_ENCRYPTION_KEY: %w", err)
		}
		if len(key) != 32 {
			return nil, fmt.Errorf("MISTY_TOKEN_ENCRYPTION_KEY must decode to 32 bytes")
		}
		return key, nil
	}

	dsn := db.GetDSN()
	if dsn == "" || dsn == ":memory:" || strings.HasPrefix(dsn, "file:") {
		sum := sha256.Sum256([]byte("misty-dev-local-token-key"))
		return sum[:], nil
	}

	keyPath := filepath.Join(filepath.Dir(dsn), "token.key")
	if raw, err := os.ReadFile(keyPath); err == nil {
		key, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(raw)))
		if err != nil {
			return nil, fmt.Errorf("decode token key: %w", err)
		}
		if len(key) != 32 {
			return nil, fmt.Errorf("token key must decode to 32 bytes")
		}
		return key, nil
	}

	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(keyPath), 0700); err != nil {
		return nil, err
	}
	if err := os.WriteFile(keyPath, []byte(base64.StdEncoding.EncodeToString(key)), 0600); err != nil {
		return nil, err
	}
	return key, nil
}

func (db *Database) encryptRefreshToken(rawToken string) (string, error) {
	key, err := db.tokenEncryptionKey()
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nonce, nonce, []byte(rawToken), nil)
	return base64.StdEncoding.EncodeToString(sealed), nil
}

func (db *Database) decryptRefreshToken(encryptedToken string) (string, error) {
	key, err := db.tokenEncryptionKey()
	if err != nil {
		return "", err
	}
	payload, err := base64.StdEncoding.DecodeString(encryptedToken)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(payload) < gcm.NonceSize() {
		return "", fmt.Errorf("encrypted token payload is too short")
	}
	nonce := payload[:gcm.NonceSize()]
	ciphertext := payload[gcm.NonceSize():]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}

func parseStoredTime(raw any) (time.Time, error) {
	switch v := raw.(type) {
	case time.Time:
		return v, nil
	case string:
		return parseStoredTimeString(v)
	case []byte:
		return parseStoredTimeString(string(v))
	default:
		return time.Time{}, fmt.Errorf("unsupported time value type %T", raw)
	}
}

func parseStoredTimeString(value string) (time.Time, error) {
	layouts := []string{
		time.RFC3339Nano,
		"2006-01-02 15:04:05.999999999-07:00",
		"2006-01-02 15:04:05.999999999Z07:00",
		"2006-01-02 15:04:05-07:00",
		"2006-01-02 15:04:05Z07:00",
		"2006-01-02 15:04:05.999999999",
		"2006-01-02 15:04:05",
	}

	for _, layout := range layouts {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed, nil
		}
	}
	return time.Time{}, fmt.Errorf("unsupported time value %q", value)
}

func (db *Database) StoreRefreshToken(userID, rawToken string, expiresAt time.Time) error {
	id := uuid.New().String()
	tokenHash := HashToken(rawToken)
	encryptedToken, err := db.encryptRefreshToken(rawToken)
	if err != nil {
		log.Println("Failed to encrypt refresh token:", err)
		return err
	}

	_, err = db.Conn.Exec(`
		INSERT INTO refresh_tokens (id, user_id, token_hash, encrypted_token, expires_at)
		VALUES (?, ?, ?, ?, ?)`,
		id, userID, tokenHash, encryptedToken, expiresAt,
	)
	if err != nil {
		log.Println("Failed to store refresh token:", err)
	}
	return err
}

// ValidateRefreshToken checks if a refresh token is valid.
// For the desktop app we keep this tolerant: a revoked token is rejected, but
// we do not fan that out into revoking every token for the user.
func (db *Database) ValidateRefreshToken(rawToken string) (string, error) {
	tokenHash := HashToken(rawToken)

	var userID string
	var encryptedToken string
	var expiresAtRaw any
	var revoked bool

	err := db.Conn.QueryRow(`
		SELECT user_id, encrypted_token, expires_at, revoked FROM refresh_tokens
		WHERE token_hash = ?`,
		tokenHash,
	).Scan(&userID, &encryptedToken, &expiresAtRaw, &revoked)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", ErrTokenNotFound
		}
		log.Printf("Failed to scan refresh token for hash %s: %v", tokenHash, err)
		return "", err
	}

	expiresAt, err := parseStoredTime(expiresAtRaw)
	if err != nil {
		log.Printf("Failed to parse refresh token expiry for user %s: %v", userID, err)
		return "", err
	}

	if userID == "" {
		return "", ErrTokenNotFound
	}

	if revoked {
		log.Printf("Refresh token rejected because it was revoked for user %s", userID)
		return "", ErrTokenRevoked
	}

	if time.Now().After(expiresAt) {
		return "", ErrTokenExpired
	}

	decryptedToken, err := db.decryptRefreshToken(encryptedToken)
	if err != nil {
		log.Printf("Failed to decrypt refresh token for user %s: %v", userID, err)
		return "", err
	}
	if subtle.ConstantTimeCompare([]byte(decryptedToken), []byte(rawToken)) != 1 {
		return "", ErrTokenNotFound
	}

	return userID, nil
}

func (db *Database) CurrentSessionRefreshToken() (*UserInfo, string, error) {
	user, err := db.GetCurrentUser()
	if err != nil || user == nil {
		return nil, "", err
	}

	rows, err := db.Conn.Query(`
		SELECT encrypted_token, expires_at
		FROM refresh_tokens
		WHERE user_id = ? AND revoked = 0
		ORDER BY created_at DESC`,
		user.ID,
	)
	if err != nil {
		return nil, "", err
	}
	defer rows.Close()

	for rows.Next() {
		var encryptedToken string
		var expiresAtRaw any
		if err := rows.Scan(&encryptedToken, &expiresAtRaw); err != nil {
			return nil, "", err
		}
		expiresAt, err := parseStoredTime(expiresAtRaw)
		if err != nil || time.Now().After(expiresAt) {
			continue
		}
		rawToken, err := db.decryptRefreshToken(encryptedToken)
		if err != nil || rawToken == "" {
			continue
		}
		return user, rawToken, nil
	}
	if err := rows.Err(); err != nil {
		return nil, "", err
	}
	return user, "", ErrTokenNotFound
}

func (db *Database) RevokeRefreshToken(rawToken string) error {
	tokenHash := HashToken(rawToken)
	_, err := db.Conn.Exec(`
		UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?`,
		tokenHash,
	)
	if err != nil {
		log.Println("Failed to revoke refresh token:", err)
	}
	return err
}

func (db *Database) RevokeAllUserRefreshTokens(userID string) error {
	_, err := db.Conn.Exec(`
		UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ? AND revoked = 0`,
		userID,
	)
	if err != nil {
		log.Println("Failed to revoke all user refresh tokens:", err)
	}
	return err
}

func (db *Database) CleanupExpiredRefreshTokens() error {
	result, err := db.Conn.Exec(`
		DELETE FROM refresh_tokens WHERE expires_at < ? OR revoked = 1`,
		time.Now(),
	)
	if err != nil {
		log.Println("Failed to cleanup expired refresh tokens:", err)
		return err
	}
	rows, _ := result.RowsAffected()
	if rows > 0 {
		log.Printf("Cleaned up %d expired/revoked refresh tokens", rows)
	}
	return nil
}

func (db *Database) GetUserEmailByID(userID string) (string, error) {
	var email string
	err := db.Conn.QueryRow(`SELECT email FROM users WHERE id = ?`, userID).Scan(&email)
	if err != nil {
		log.Println("Failed to get user email by ID:", err)
	}
	return email, err
}
