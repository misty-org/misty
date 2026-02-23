package db

import (
	"database/sql"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
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

	_, err := db.Conn.Exec(`
		INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
		VALUES (?, ?, ?, ?)`,
		id, userID, tokenHash, expiresAt,
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
	var expiresAtRaw any
	var revoked bool

	err := db.Conn.QueryRow(`
		SELECT user_id, expires_at, revoked FROM refresh_tokens
		WHERE token_hash = ?`,
		tokenHash,
	).Scan(&userID, &expiresAtRaw, &revoked)
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

	return userID, nil
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
