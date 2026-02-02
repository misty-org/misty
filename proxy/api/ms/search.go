package ms

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"

	"github.com/kannachi323/misty/proxy/core/ms"
	"github.com/kannachi323/misty/proxy/db"
)

func SearchFiles(database *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := r.URL.Query().Get("user_id")
		msUserID := r.URL.Query().Get("ms_user_id")
		driveID := r.URL.Query().Get("drive_id")
		q := r.URL.Query().Get("q")

		if userID == "" || msUserID == "" || driveID == "" || q == "" {
			http.Error(w, "user_id, ms_user_id, drive_id, and q are required", http.StatusBadRequest)
			return
		}

		searchURL := fmt.Sprintf(
			"%s/drives/%s/root/search(q='%s')?select=id,name,size,webUrl,lastModifiedDateTime,file,folder,parentReference&top=50",
			ms.GetConfig().GraphBase, driveID, url.QueryEscape(q),
		)

		graphRes, err := ms.ExecGraphRequest(database, userID, msUserID, http.MethodGet, searchURL, nil)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer graphRes.Body.Close()

		if graphRes.StatusCode != http.StatusOK {
			http.Error(w, fmt.Sprintf("Graph API error: %d", graphRes.StatusCode), graphRes.StatusCode)
			return
		}

		var res ms.DriveItemsResponse
		if err := json.NewDecoder(graphRes.Body).Decode(&res); err != nil {
			http.Error(w, "Failed to decode response", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(res)
	}
}
