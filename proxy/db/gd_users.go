package db

import (
	"fmt"
)

type GDUserRecord struct {
	UserID       string `json:"user_id"`
	GdUserID     string `json:"gd_user_id"`
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	DisplayName  string `json:"display_name"`
	Email        string `json:"email"`
}

// StoreGDUser upserts a user by (user_id, gd_user_id). Use gd_user_id from Google People API /me to allow multiple Google accounts per user.
func (db *Database) StoreGDUser(userID, gdUserID, accessToken, refreshToken, displayName, email string) error {
	if gdUserID == "" {
		return fmt.Errorf("gd_user_id is required")
	}
	query := `INSERT INTO gd_users (user_id, gd_user_id, access_token, refresh_token, display_name, email)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT (user_id, gd_user_id) DO UPDATE SET
			access_token = EXCLUDED.access_token,
			refresh_token = EXCLUDED.refresh_token,
			display_name = EXCLUDED.display_name,
			email = EXCLUDED.email`
	_, err := db.Conn.Exec(query, userID, gdUserID, accessToken, refreshToken, displayName, email)
	if err != nil {
		return fmt.Errorf("failed to store GD user: %w", err)
	}
	return nil
}

// GetGDUsers returns all user records for a specific user_id
func (db *Database) GetGDUsers(userID string) ([]GDUserRecord, error) {
	query := `SELECT user_id, gd_user_id, access_token, refresh_token, COALESCE(display_name, ''), COALESCE(email, '') FROM gd_users WHERE user_id = ?`
	rows, err := db.Conn.Query(query, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get GD users: %w", err)
	}
	defer rows.Close()

	users := make([]GDUserRecord, 0)
	for rows.Next() {
		var t GDUserRecord
		if err := rows.Scan(&t.UserID, &t.GdUserID, &t.AccessToken, &t.RefreshToken, &t.DisplayName, &t.Email); err != nil {
			return users, fmt.Errorf("failed to scan GD user: %w", err)
		}
		users = append(users, t)
	}
	if err = rows.Err(); err != nil {
		return users, fmt.Errorf("error iterating users: %w", err)
	}
	return users, nil
}

// DeleteGDUser deletes the user record for (user_id, gd_user_id).
func (db *Database) DeleteGDUser(userID, gdUserID string) error {
	query := `DELETE FROM gd_users WHERE user_id = ? AND gd_user_id = ?`
	result, err := db.Conn.Exec(query, userID, gdUserID)
	if err != nil {
		return fmt.Errorf("failed to delete GD user: %w", err)
	}
	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return fmt.Errorf("user not found")
	}
	return nil
}
