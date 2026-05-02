// access_tokens.go handles access token revocation and expiration for the proxy
//
// Matthew Chen (kannachi323)

package db

import (
	"log"
	"time"
)

func (db *Database) RevokeAccessToken(tokenID, userID string, expiresAt time.Time) error {
	_, err := db.Conn.Exec(`
		INSERT INTO revoked_access_tokens (token_id, user_id, expires_at, revoked_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(token_id) DO UPDATE SET
			user_id = excluded.user_id,
			expires_at = excluded.expires_at,
			revoked_at = excluded.revoked_at
	`, tokenID, userID, expiresAt, time.Now().UTC())
	if err != nil {
		log.Println("Failed to revoke access token:", err)
	}
	return err
}

func (db *Database) IsAccessTokenRevoked(tokenID string) (bool, error) {
	var exists int
	err := db.Conn.QueryRow(`
		SELECT EXISTS(
			SELECT 1
			FROM revoked_access_tokens
			WHERE token_id = ?
			LIMIT 1
		)
	`, tokenID).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists != 0, nil
}

func (db *Database) CleanupExpiredAccessTokenRevocations(now time.Time) error {
	if now.IsZero() {
		now = time.Now().UTC()
	}
	_, err := db.Conn.Exec(`
		DELETE FROM revoked_access_tokens
		WHERE expires_at < ?
	`, now)
	if err != nil {
		log.Println("Failed to cleanup expired access token revocations:", err)
	}
	return err
}
