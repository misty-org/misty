package db

import (
	"database/sql"
	"errors"
	"log"
)

type UserInfo struct {
	ID    string
	Name  string
	Email string
}

// InsertOrIgnoreUser stores a user record locally (id + name + email, no password).
// Silently ignores conflicts — the server is the source of truth for credentials.
func (db *Database) InsertOrIgnoreUser(id, name, email string) error {
	_, err := db.Conn.Exec(`
		INSERT OR IGNORE INTO users (id, name, email)
		VALUES (?, ?, ?)`,
		id, name, email,
	)
	if err != nil {
		log.Println("Failed to insert user:", err)
	}
	return err
}

// GetUserByEmail returns the locally cached user record for the given email, or nil if not found.
func (db *Database) GetUserByEmail(email string) (*UserInfo, error) {
	var user UserInfo
	err := db.Conn.QueryRow(`
		SELECT id, name, email FROM users WHERE email = ?`,
		email,
	).Scan(&user.ID, &user.Name, &user.Email)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		log.Println("Failed to get user by email:", err)
		return nil, err
	}
	return &user, nil
}
