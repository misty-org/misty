package dbx

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/kannachi323/misty/proxy/core/dropbox"
	"github.com/kannachi323/misty/proxy/db"
)

func GetSpaceUsage(database *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := r.URL.Query().Get("user_id")
		dbxUserID := r.URL.Query().Get("dbx_user_id")
		if userID == "" || dbxUserID == "" {
			http.Error(w, "user_id and dbx_user_id are required", http.StatusBadRequest)
			return
		}

		config := dropbox.GetConfig()
		if config == nil {
			http.Error(w, "Dropbox config not found", http.StatusInternalServerError)
			return
		}

		apiURL := fmt.Sprintf("%s/users/get_space_usage", config.APIBase)
		apiRes, err := dropbox.ExecAPIRequest(database, userID, dbxUserID, http.MethodPost, apiURL, nil)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer apiRes.Body.Close()

		if apiRes.StatusCode != http.StatusOK {
			http.Error(w, fmt.Sprintf("Dropbox API error: %d", apiRes.StatusCode), apiRes.StatusCode)
			return
		}

		var usage dropbox.SpaceUsage
		if err := json.NewDecoder(apiRes.Body).Decode(&usage); err != nil {
			http.Error(w, "Failed to decode response", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(usage)
	}
}

func GetDriveRoot(database *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := r.URL.Query().Get("user_id")
		dbxUserID := r.URL.Query().Get("dbx_user_id")
		if userID == "" || dbxUserID == "" {
			http.Error(w, "user_id and dbx_user_id are required", http.StatusBadRequest)
			return
		}

		config := dropbox.GetConfig()
		if config == nil {
			http.Error(w, "Dropbox config not found", http.StatusInternalServerError)
			return
		}

		// List root folder (empty string path = root in Dropbox)
		reqBody := map[string]interface{}{
			"path":      "",
			"recursive": false,
		}
		reqBytes, _ := json.Marshal(reqBody)

		apiURL := fmt.Sprintf("%s/files/list_folder", config.APIBase)
		apiRes, err := dropbox.ExecAPIRequest(database, userID, dbxUserID, http.MethodPost, apiURL, bytes.NewReader(reqBytes))
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer apiRes.Body.Close()

		if apiRes.StatusCode != http.StatusOK {
			http.Error(w, fmt.Sprintf("Dropbox API error: %d", apiRes.StatusCode), apiRes.StatusCode)
			return
		}

		var result dropbox.ListFolderResult
		if err := json.NewDecoder(apiRes.Body).Decode(&result); err != nil {
			http.Error(w, "Failed to decode response", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)
	}
}
