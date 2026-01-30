package ms

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/kannachi323/misty/proxy/core/ms"
	"github.com/kannachi323/misty/proxy/db"
)

func GetDrive(database *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := r.URL.Query().Get("user_id")
		msUserID := r.URL.Query().Get("ms_user_id")
		if userID == "" || msUserID == "" {
			http.Error(w, "user_id and ms_user_id are required", http.StatusBadRequest)
			return
		}

		url := fmt.Sprintf("%s/users/%s/drive", ms.GetConfig().GraphBase, msUserID)
		graphRes, err := ms.ExecGraphRequest(database, userID, msUserID, http.MethodGet, url, nil)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer graphRes.Body.Close()

		if graphRes.StatusCode != http.StatusOK {
			http.Error(w, "Failed to get drive", graphRes.StatusCode)
			return
		}

		var drive ms.Drive
		if err := json.NewDecoder(graphRes.Body).Decode(&drive); err != nil {
			http.Error(w, "Failed to decode response", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(drive)
	}
}

func GetDriveRoot(database *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := r.URL.Query().Get("user_id")
		msUserID := r.URL.Query().Get("ms_user_id")
		if userID == "" || msUserID == "" {
			http.Error(w, "user_id and ms_user_id are required", http.StatusBadRequest)
			return
		}

		url := fmt.Sprintf("%s/users/%s/drive/root", ms.GetConfig().GraphBase, msUserID)
		graphRes, err := ms.ExecGraphRequest(database, userID, msUserID, http.MethodGet, url, nil)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer graphRes.Body.Close()

		if graphRes.StatusCode != http.StatusOK {
			http.Error(w, "Failed to get drive root", graphRes.StatusCode)
			return
		}

		var driveItem ms.DriveItem
		if err := json.NewDecoder(graphRes.Body).Decode(&driveItem); err != nil {
			http.Error(w, "Failed to decode response", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(driveItem)
	}
}
