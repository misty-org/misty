package db

import (
	"fmt"
)

type DBXUserRecord struct {
	UserID       string `json:"user_id"`
	DbxUserID    string `json:"dbx_user_id"`
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	DisplayName  string `json:"display_name"`
	Email        string `json:"email"`
}

// StoreDBXUser upserts a user by (user_id, dbx_user_id).
func (db *Database) StoreDBXUser(userID, dbxUserID, accessToken, refreshToken, displayName, email string) error {
	if dbxUserID == "" {
		return fmt.Errorf("dbx_user_id is required")
	}
	query := `INSERT INTO dbx_users (user_id, dbx_user_id, access_token, refresh_token, display_name, email)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (user_id, dbx_user_id) DO UPDATE SET
			access_token = EXCLUDED.access_token,
			refresh_token = EXCLUDED.refresh_token,
			display_name = EXCLUDED.display_name,
			email = EXCLUDED.email`
	_, err := db.Conn.Exec(query, userID, dbxUserID, accessToken, refreshToken, displayName, email)
	if err != nil {
		return fmt.Errorf("failed to store DBX user: %w", err)
	}
	return nil
}

// GetDBXUsers returns all user records for a specific user_id
func (db *Database) GetDBXUsers(userID string) ([]DBXUserRecord, error) {
	query := `SELECT user_id, dbx_user_id, access_token, refresh_token, COALESCE(display_name, ''), COALESCE(email, '') FROM dbx_users WHERE user_id = $1`
	rows, err := db.Conn.Query(query, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get DBX users: %w", err)
	}
	defer rows.Close()

	users := make([]DBXUserRecord, 0)
	for rows.Next() {
		var t DBXUserRecord
		if err := rows.Scan(&t.UserID, &t.DbxUserID, &t.AccessToken, &t.RefreshToken, &t.DisplayName, &t.Email); err != nil {
			return users, fmt.Errorf("failed to scan DBX user: %w", err)
		}
		users = append(users, t)
	}
	if err = rows.Err(); err != nil {
		return users, fmt.Errorf("error iterating users: %w", err)
	}
	return users, nil
}

// DeleteDBXUser deletes the user record for (user_id, dbx_user_id).
func (db *Database) DeleteDBXUser(userID, dbxUserID string) error {
	query := `DELETE FROM dbx_users WHERE user_id = $1 AND dbx_user_id = $2`
	result, err := db.Conn.Exec(query, userID, dbxUserID)
	if err != nil {
		return fmt.Errorf("failed to delete DBX user: %w", err)
	}
	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return fmt.Errorf("user not found")
	}
	return nil
}
