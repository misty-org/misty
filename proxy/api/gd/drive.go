package gd

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/kannachi323/misty/proxy/core/gd"
	"github.com/kannachi323/misty/proxy/db"
)

func GetAbout(database *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := r.URL.Query().Get("user_id")
		gdUserID := r.URL.Query().Get("gd_user_id")
		if userID == "" || gdUserID == "" {
			http.Error(w, "user_id and gd_user_id are required", http.StatusBadRequest)
			return
		}

		config := gd.GetConfig()
		if config == nil {
			http.Error(w, "Google Drive config not found", http.StatusInternalServerError)
			return
		}

		url := fmt.Sprintf("%s/drive/v3/about?fields=user,storageQuota", config.APIBase)
		apiRes, err := gd.ExecAPIRequest(database, userID, gdUserID, http.MethodGet, url, nil)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer apiRes.Body.Close()

		if apiRes.StatusCode != http.StatusOK {
			http.Error(w, fmt.Sprintf("Google Drive API error: %d", apiRes.StatusCode), apiRes.StatusCode)
			return
		}

		var about gd.GDriveAbout
		if err := json.NewDecoder(apiRes.Body).Decode(&about); err != nil {
			http.Error(w, "Failed to decode response", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(about)
	}
}

func GetDriveRoot(database *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := r.URL.Query().Get("user_id")
		gdUserID := r.URL.Query().Get("gd_user_id")
		if userID == "" || gdUserID == "" {
			http.Error(w, "user_id and gd_user_id are required", http.StatusBadRequest)
			return
		}

		config := gd.GetConfig()
		if config == nil {
			http.Error(w, "Google Drive config not found", http.StatusInternalServerError)
			return
		}

		url := fmt.Sprintf("%s/drive/v3/files/root?fields=id,name,mimeType", config.APIBase)
		apiRes, err := gd.ExecAPIRequest(database, userID, gdUserID, http.MethodGet, url, nil)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer apiRes.Body.Close()

		if apiRes.StatusCode != http.StatusOK {
			http.Error(w, fmt.Sprintf("Google Drive API error: %d", apiRes.StatusCode), apiRes.StatusCode)
			return
		}

		var file gd.GDriveFile
		if err := json.NewDecoder(apiRes.Body).Decode(&file); err != nil {
			http.Error(w, "Failed to decode response", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(file)
	}
}
