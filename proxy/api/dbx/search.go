package dbx

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/kannachi323/misty/proxy/core/dropbox"
	"github.com/kannachi323/misty/proxy/db"
)

// dbxSearchResponse is the raw Dropbox search_v2 response shape.
type dbxSearchResponse struct {
	Matches []struct {
		Metadata struct {
			Metadata dropbox.FileMetadata `json:"metadata"`
		} `json:"metadata"`
	} `json:"matches"`
	HasMore bool `json:"has_more"`
}

func SearchFiles(database *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := r.URL.Query().Get("user_id")
		dbxUserID := r.URL.Query().Get("dbx_user_id")
		q := r.URL.Query().Get("q")

		if userID == "" || dbxUserID == "" || q == "" {
			http.Error(w, "user_id, dbx_user_id, and q are required", http.StatusBadRequest)
			return
		}

		config := dropbox.GetConfig()
		if config == nil {
			http.Error(w, "Dropbox config not found", http.StatusInternalServerError)
			return
		}

		reqBody := map[string]interface{}{
			"query": q,
			"options": map[string]interface{}{
				"max_results": 50,
			},
		}
		reqBytes, _ := json.Marshal(reqBody)

		apiURL := fmt.Sprintf("%s/files/search_v2", config.APIBase)
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

		var raw dbxSearchResponse
		if err := json.NewDecoder(apiRes.Body).Decode(&raw); err != nil {
			http.Error(w, "Failed to decode response", http.StatusInternalServerError)
			return
		}

		// Flatten nested match metadata into the standard ListFolderResult shape.
		entries := make([]dropbox.FileMetadata, 0, len(raw.Matches))
		for _, m := range raw.Matches {
			entries = append(entries, m.Metadata.Metadata)
		}

		result := dropbox.ListFolderResult{Entries: entries}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)
	}
}
