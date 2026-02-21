package db

import (
	"fmt"
)

type MSUserRecord struct {
	UserID       string `json:"user_id"`
	MsUserID     string `json:"ms_user_id"`
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	DisplayName  string `json:"display_name"`
	Email        string `json:"email"`
}

// StoreMSUser upserts a user by (user_id, ms_user_id). Use ms_user_id from Graph /me to allow multiple MS accounts per user.
func (db *Database) StoreMSUser(userID, msUserID, accessToken, refreshToken, displayName, email string) error {
	if msUserID == "" {
		return fmt.Errorf("ms_user_id is required")
	}
	query := `INSERT INTO ms_users (user_id, ms_user_id, access_token, refresh_token, display_name, email)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (user_id, ms_user_id) DO UPDATE SET
			access_token = EXCLUDED.access_token,
			refresh_token = EXCLUDED.refresh_token,
			display_name = EXCLUDED.display_name,
			email = EXCLUDED.email`
	_, err := db.Conn.Exec(query, userID, msUserID, accessToken, refreshToken, displayName, email)
	if err != nil {
		return fmt.Errorf("failed to store MS user: %w", err)
	}
	return nil
}

// GetMSUsers returns all user records for a specific user_id
func (db *Database) GetMSUsers(userID string) ([]MSUserRecord, error) {
	query := `SELECT user_id, ms_user_id, access_token, refresh_token, COALESCE(display_name, ''), COALESCE(email, '') FROM ms_users WHERE user_id = $1`
	rows, err := db.Conn.Query(query, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get MS users: %w", err)
	}
	defer rows.Close()

	users := make([]MSUserRecord, 0)
	for rows.Next() {
		var t MSUserRecord
		if err := rows.Scan(&t.UserID, &t.MsUserID, &t.AccessToken, &t.RefreshToken, &t.DisplayName, &t.Email); err != nil {
			return users, fmt.Errorf("failed to scan MS user: %w", err)
		}
		users = append(users, t)
	}
	if err = rows.Err(); err != nil {
		return users, fmt.Errorf("error iterating users: %w", err)
	}
	return users, nil
}

// DeleteMSUser deletes the user record for (user_id, ms_user_id).
func (db *Database) DeleteMSUser(userID, msUserID string) error {
	query := `DELETE FROM ms_users WHERE user_id = $1 AND ms_user_id = $2`
	result, err := db.Conn.Exec(query, userID, msUserID)
	if err != nil {
		return fmt.Errorf("failed to delete MS user: %w", err)
	}
	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return fmt.Errorf("user not found")
	}
	return nil
}
