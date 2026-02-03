package ms

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/kannachi323/misty/proxy/db"
)

func DeleteMSToken(db *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		userID := r.URL.Query().Get("user_id")
		msUserID := r.URL.Query().Get("ms_user_id")
		if userID == "" || msUserID == "" {
			http.Error(w, "user_id and ms_user_id parameters required", http.StatusBadRequest)
			return
		}

		if db == nil {
			http.Error(w, "Database not available", http.StatusInternalServerError)
			return
		}

		if err := db.DeleteMSUser(userID, msUserID); err != nil {
			fmt.Printf("[MS Token] Failed to delete token: %v\n", err)
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}

		fmt.Printf("[MS Token] Deleted token for user %s, ms_user %s\n", userID, msUserID)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"message": "Token deleted",
		})
	}
}
