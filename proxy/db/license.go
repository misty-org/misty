package db

import (
	"database/sql"
	"errors"
	"time"
)

type LicenseCache struct {
	Token     string
	Tier      string
	ExpiresAt time.Time
}

func (db *Database) StoreLicense(token, tier string, expiresAt time.Time) error {
	_, err := db.Conn.Exec(`
		INSERT INTO license_cache (id, token, tier, expires_at)
		VALUES (1, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			token = EXCLUDED.token,
			tier = EXCLUDED.tier,
			expires_at = EXCLUDED.expires_at
	`, token, tier, expiresAt)
	return err
}

func (db *Database) GetLicense() (*LicenseCache, error) {
	var l LicenseCache
	err := db.Conn.QueryRow(
		`SELECT token, tier, expires_at FROM license_cache WHERE id = 1`,
	).Scan(&l.Token, &l.Tier, &l.ExpiresAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &l, nil
}
