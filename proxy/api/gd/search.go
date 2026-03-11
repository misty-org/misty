package gd

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"

	"github.com/kannachi323/misty/proxy/core/gd"
	"github.com/kannachi323/misty/proxy/db"
)

func SearchFiles(database *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := r.URL.Query().Get("user_id")
		gdUserID := r.URL.Query().Get("gd_user_id")
		q := r.URL.Query().Get("q")

		if userID == "" || gdUserID == "" || q == "" {
			http.Error(w, "user_id, gd_user_id, and q are required", http.StatusBadRequest)
			return
		}

		config := gd.GetConfig()
		if config == nil {
			http.Error(w, "Google Drive config not found", http.StatusInternalServerError)
			return
		}

		query := url.Values{
			"q":        {fmt.Sprintf("name contains '%s' and trashed = false", q)},
			"fields":   {"files(id,name,mimeType,size,webViewLink,modifiedTime,parents)"},
			"pageSize": {"50"},
		}

		apiURL := fmt.Sprintf("%s/drive/v3/files?%s", config.APIBase, query.Encode())
		apiRes, err := gd.ExecAPIRequest(database, userID, gdUserID, http.MethodGet, apiURL, nil)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer apiRes.Body.Close()

		if apiRes.StatusCode != http.StatusOK {
			http.Error(w, fmt.Sprintf("Google Drive API error: %d", apiRes.StatusCode), apiRes.StatusCode)
			return
		}

		var res gd.GDriveFileList
		if err := json.NewDecoder(apiRes.Body).Decode(&res); err != nil {
			http.Error(w, "Failed to decode response", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(res)
	}
}
