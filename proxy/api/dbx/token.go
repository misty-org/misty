package dbx

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/kannachi323/misty/proxy/core/dropbox"
	"github.com/kannachi323/misty/proxy/db"
)

// DBXUserInfo is the public response for the /dbx/users endpoint — no tokens exposed.
type DBXUserInfo struct {
	DbxUserID   string `json:"dbx_user_id"`
	DisplayName string `json:"display_name"`
	Email       string `json:"email"`
	Connected   bool   `json:"connected"`
}

func GetDBXUsers(database *db.Database) http.HandlerFunc {
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

		users, err := database.GetDBXUsers(userID)
		if err != nil {
			http.Error(w, "Failed to get users: "+err.Error(), http.StatusInternalServerError)
			return
		}

		result := make([]DBXUserInfo, 0, len(users))
		for _, u := range users {
			info := DBXUserInfo{
				DbxUserID:   u.DbxUserID,
				DisplayName: u.DisplayName,
				Email:       u.Email,
				Connected:   false,
			}

			// Validate token by calling Dropbox get_current_account
			_, err := FetchDBXUserProfile(u.AccessToken)
			if err != nil {
				// Try refreshing the token
				newToken, refreshErr := dropbox.RefreshToken(database, userID, u.DbxUserID)
				if refreshErr == nil && newToken != "" {
					// Re-validate with refreshed token
					_, err2 := FetchDBXUserProfile(newToken)
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

func DeleteDBXToken(database *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		userID := r.URL.Query().Get("user_id")
		dbxUserID := r.URL.Query().Get("dbx_user_id")
		if userID == "" || dbxUserID == "" {
			http.Error(w, "user_id and dbx_user_id parameters required", http.StatusBadRequest)
			return
		}

		if database == nil {
			http.Error(w, "Database not available", http.StatusInternalServerError)
			return
		}

		if err := database.DeleteDBXUser(userID, dbxUserID); err != nil {
			fmt.Printf("[DBX Token] Failed to delete token: %v\n", err)
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}

		fmt.Printf("[DBX Token] Deleted token for user %s, dbx_user %s\n", userID, dbxUserID)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"message": "Token deleted",
		})
	}
}
