package gd

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/kannachi323/misty/proxy/core/gd"
	"github.com/kannachi323/misty/proxy/db"
)

// GDUserInfo is the public response for the /gd/users endpoint — no tokens exposed.
type GDUserInfo struct {
	GdUserID    string `json:"gd_user_id"`
	DisplayName string `json:"display_name"`
	Email       string `json:"email"`
	Connected   bool   `json:"connected"`
}

func GetGDUsers(database *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := r.URL.Query().Get("user_id")
		if userID == "" {
			http.Error(w, "user_id parameter is required", http.StatusBadRequest)
			return
		}

		if database == nil {
			http.Error(w, "Database not available", http.StatusInternalServerError)
			return
		}

		users, err := database.GetGDUsers(userID)
		if err != nil {
			http.Error(w, "Failed to get users: "+err.Error(), http.StatusInternalServerError)
			return
		}

		result := make([]GDUserInfo, 0, len(users))
		for _, u := range users {
			info := GDUserInfo{
				GdUserID:    u.GdUserID,
				DisplayName: u.DisplayName,
				Email:       u.Email,
				Connected:   false,
			}

			// Validate token by calling Google userinfo
			_, err := FetchGDUserProfile(u.AccessToken)
			if err != nil {
				// Try refreshing the token
				newToken, refreshErr := gd.RefreshToken(database, userID, u.GdUserID)
				if refreshErr == nil && newToken != "" {
					// Re-validate with refreshed token
					_, err2 := FetchGDUserProfile(newToken)
					if err2 == nil {
						info.Connected = true
					}
				}
			} else {
				info.Connected = true
			}

			result = append(result, info)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)
	}
}

func DeleteGDToken(database *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		userID := r.URL.Query().Get("user_id")
		gdUserID := r.URL.Query().Get("gd_user_id")
		if userID == "" || gdUserID == "" {
			http.Error(w, "user_id and gd_user_id parameters required", http.StatusBadRequest)
			return
		}

		if database == nil {
			http.Error(w, "Database not available", http.StatusInternalServerError)
			return
		}

		if err := database.DeleteGDUser(userID, gdUserID); err != nil {
			fmt.Printf("[GD Token] Failed to delete token: %v\n", err)
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}

		fmt.Printf("[GD Token] Deleted token for user %s, gd_user %s\n", userID, gdUserID)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"message": "Token deleted",
		})
	}
}
