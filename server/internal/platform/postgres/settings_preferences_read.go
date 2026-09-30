package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
)

// AccountPreferences reads the account settings record without writing. A
// refresh is a read; it must not take a row lock or open a write transaction
// just to learn that nothing changed.
func (db *Database) AccountPreferences(ctx context.Context, userID string) (SettingsProfile, error) {
	var p SettingsProfile
	var raw []byte
	err := db.Conn.QueryRowContext(ctx, `SELECT id,name,schema_version,revision,values_json FROM settings_profiles WHERE id=$1 AND user_id=$2 AND NOT deleted`, AccountPreferencesID(userID), userID).Scan(&p.ID, &p.Name, &p.SchemaVersion, &p.Revision, &raw)
	if errors.Is(err, sql.ErrNoRows) {
		return p, ErrSettingsProfileNotFound
	}
	if err != nil {
		return p, err
	}
	return p, json.Unmarshal(raw, &p.Values)
}
