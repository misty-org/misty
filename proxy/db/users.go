package db

import (
	"database/sql"
	"errors"
	"log"
	"time"
)

type UserInfo struct {
	ID              string
	Name            string
	Email           string
	TokenValidAfter sql.NullString
}

func (db *Database) GetCurrentUser() (*UserInfo, error) {
	var user UserInfo
	err := db.Conn.QueryRow(`
		SELECT id, name, email, token_valid_after
		FROM users
		ORDER BY rowid ASC
		LIMIT 1`,
	).Scan(&user.ID, &user.Name, &user.Email, &user.TokenValidAfter)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		log.Println("Failed to get user by email:", err)
		return nil, err
	}
	return &user, nil
}

func (db *Database) GetCurrentUserID() (string, error) {
	user, err := db.GetCurrentUser()
	if err != nil || user == nil {
		return "", err
	}
	return user.ID, nil
}

// SetCurrentUser enforces the local single-user policy.
// It clears prior session state, replaces the stored local user, and keeps
// exactly one row in users.
func (db *Database) SetCurrentUser(id, name, email string) error {
	tx, err := db.Conn.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM refresh_tokens`); err != nil {
		log.Println("Failed to clear refresh tokens for user switch:", err)
		return err
	}
	if _, err := tx.Exec(`DELETE FROM revoked_access_tokens`); err != nil {
		log.Println("Failed to clear revoked access tokens for user switch:", err)
		return err
	}
	if _, err := tx.Exec(`DELETE FROM users`); err != nil {
		log.Println("Failed to clear users for user switch:", err)
		return err
	}
	if _, err := tx.Exec(`
		INSERT INTO users (id, name, email, token_valid_after)
		VALUES (?, ?, ?, NULL)
	`, id, name, email); err != nil {
		log.Println("Failed to insert current user:", err)
		return err
	}

	return tx.Commit()
}

func (db *Database) GetCurrentUserEmail() (string, error) {
	var email string
	err := db.Conn.QueryRow(`
		SELECT email
		FROM users
		ORDER BY rowid ASC
		LIMIT 1
	`).Scan(&email)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", nil
		}
		log.Println("Failed to get current user email:", err)
		return "", err
	}
	return email, nil
}

func (db *Database) GetUserTokenValidAfter(userID string) (*time.Time, error) {
	var raw sql.NullString
	err := db.Conn.QueryRow(`
		SELECT token_valid_after FROM users WHERE id = ?
	`, userID).Scan(&raw)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		log.Println("Failed to get user token_valid_after:", err)
		return nil, err
	}
	if !raw.Valid || raw.String == "" {
		return nil, nil
	}
	parsed, err := time.Parse(time.RFC3339Nano, raw.String)
	if err != nil {
		log.Println("Failed to parse user token_valid_after:", err)
		return nil, err
	}
	return &parsed, nil
}

func (db *Database) SetUserTokenValidAfter(userID string, when time.Time) error {
	if when.IsZero() {
		when = time.Now().UTC()
	}
	_, err := db.Conn.Exec(`
		UPDATE users
		SET token_valid_after = ?
		WHERE id = ?
	`, when.UTC().Format(time.RFC3339Nano), userID)
	if err != nil {
		log.Println("Failed to set user token_valid_after:", err)
	}
	return err
}
