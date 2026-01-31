package db

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
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
// If the token was revoked, it triggers theft detection and revokes ALL tokens for that user.
func (db *Database) ValidateRefreshToken(rawToken string) (string, error) {
	tokenHash := HashToken(rawToken)

	var userID string
	var expiresAt time.Time
	var revoked bool

	err := db.Conn.QueryRow(`
		SELECT user_id, expires_at, revoked FROM refresh_tokens
		WHERE token_hash = ?`,
		tokenHash,
	).Scan(&userID, &expiresAt, &revoked)
	if err != nil {
		return "", ErrTokenNotFound
	}

	// Theft detection: if a revoked token is presented, revoke ALL user tokens
	if revoked {
		log.Printf("SECURITY: Revoked refresh token reused for user %s — revoking all tokens", userID)
		_ = db.RevokeAllUserRefreshTokens(userID)
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
