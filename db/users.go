package db

import (
	"database/sql"
	"errors"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

type User struct {
	ID                  string
	LicenseID           string
	Name                string
	Email               string
	EmailUpdatesEnabled bool
	CreatedAt           time.Time
}

type UserSettings struct {
	EmailUpdatesEnabled bool
}

func (db *Database) CreateUser(name, email, password string) (*User, error) {
	normalizedEmail := normalizeEmail(email)
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}

	id := uuid.New().String()
	now := time.Now()
	licenseID := uuid.New().String()
	tx, err := db.Conn.Begin()
	if err != nil {
		return nil, err
	}

	_, err = tx.Exec(
		`INSERT INTO users (id, license_id, name, email, password_hash) VALUES ($1, $2, $3, $4, $5)`,
		id, licenseID, name, normalizedEmail, hash,
	)
	if err != nil {
		_ = tx.Rollback()
		log.Println("Failed to create user:", err)
		return nil, err
	}

	license, err := createLicenseTx(tx, licenseID, id, TierBasic, LicenseStatusActive, nil)
	if err != nil {
		_ = tx.Rollback()
		log.Println("Failed to create license for user:", err)
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		log.Println("Failed to commit user creation:", err)
		return nil, err
	}

	return &User{ID: id, LicenseID: license.ID, Name: name, Email: normalizedEmail, CreatedAt: now}, nil
}

func (db *Database) GetUserByEmail(email string) (*User, string, error) {
	var u User
	var hash string
	normalizedEmail := normalizeEmail(email)

	err := db.Conn.QueryRow(
		`SELECT id, license_id, name, email, password_hash, created_at FROM users WHERE LOWER(email) = $1`,
		normalizedEmail,
	).Scan(&u.ID, &u.LicenseID, &u.Name, &u.Email, &hash, &u.CreatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, "", nil
		}
		log.Println("Failed to get user:", err)
		return nil, "", err
	}

	return &u, hash, nil
}

func (db *Database) UpdateUserName(id, name string) error {
	_, err := db.Conn.Exec(`UPDATE users SET name = $1 WHERE id = $2`, name, id)
	if err != nil {
		log.Println("Failed to update user name:", err)
	}
	return err
}

func (db *Database) GetUserByID(id string) (*User, error) {
	var u User
	err := db.Conn.QueryRow(
		`SELECT id, license_id, name, email, email_updates_enabled, created_at FROM users WHERE id = $1`,
		id,
	).Scan(&u.ID, &u.LicenseID, &u.Name, &u.Email, &u.EmailUpdatesEnabled, &u.CreatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		log.Println("Failed to get user by ID:", err)
		return nil, err
	}
	return &u, nil
}

func (db *Database) GetUserSettingsByID(id string) (*UserSettings, error) {
	var settings UserSettings
	err := db.Conn.QueryRow(
		`SELECT email_updates_enabled FROM users WHERE id = $1`,
		id,
	).Scan(&settings.EmailUpdatesEnabled)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		log.Println("Failed to get user settings:", err)
		return nil, err
	}
	return &settings, nil
}

func (db *Database) UpdateUserSettings(id string, settings UserSettings) error {
	_, err := db.Conn.Exec(
		`UPDATE users SET email_updates_enabled = $1 WHERE id = $2`,
		settings.EmailUpdatesEnabled,
		id,
	)
	if err != nil {
		log.Println("Failed to update user settings:", err)
	}
	return err
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}
