package db

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"errors"
	"time"
)

// Existing session deletion paths (account deletion, enrollment changes) also
// revoke refresh sessions. Access JWTs expire independently within five minutes.
func (db *Database) CreateRefreshSession(ctx context.Context, sessionHash, refreshHash, userID string, expires time.Time) error {
	return db.TestingWithRLSContext(ctx, sessionCreateRLSSettings(sessionHash, userID), func(tx *sql.Tx) error {
		result, err := tx.ExecContext(ctx, `INSERT INTO sessions(token_hash, refresh_hash, user_id, expires_at)
   SELECT $1,$2,id,$4 FROM users WHERE id=$3 AND lifecycle_state='active'`, sessionHash, refreshHash, userID, expires)
		if err != nil {
			return err
		}
		count, err := result.RowsAffected()
		if err == nil && count != 1 {
			return errors.New("account is not active")
		}
		return err
	})
}

// Rotation is serialized across all instances. A replay revokes the complete
// session family, including the refresh token issued by an earlier winner.
func (db *Database) RotateRefreshSession(ctx context.Context, sessionHash, oldHash, newHash, userID string) (bool, error) {
	valid := false
	err := db.TestingWithRLSContext(ctx, TestingServiceRLSSettings(), func(tx *sql.Tx) error {
		var current, owner string
		var expires time.Time
		err := tx.QueryRowContext(ctx, `SELECT refresh_hash,user_id,expires_at FROM sessions
   WHERE token_hash=$1 AND refresh_hash IS NOT NULL FOR UPDATE`, sessionHash).Scan(&current, &owner, &expires)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		var active bool
		if err := tx.QueryRowContext(ctx, `SELECT lifecycle_state='active' FROM users WHERE id=$1`, owner).Scan(&active); err != nil {
			return err
		}
		if owner != userID || !active || !expires.After(time.Now()) || subtle.ConstantTimeCompare([]byte(current), []byte(oldHash)) != 1 {
			_, err = tx.ExecContext(ctx, `DELETE FROM sessions WHERE token_hash=$1`, sessionHash)
			return err // Commit revocation even though the credential is invalid.
		}
		_, err = tx.ExecContext(ctx, `UPDATE sessions SET refresh_hash=$2 WHERE token_hash=$1`, sessionHash, newHash)
		valid = err == nil
		return err
	})
	return valid, err
}
