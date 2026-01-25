package ms

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/kannachi323/misty/proxy/core/ms"
)


func GetDrive() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		msUserID := r.URL.Query().Get("ms_user_id")
		if msUserID == "" {
			http.Error(w, "MS User ID is required", http.StatusBadRequest)
			return
		}

		//http request to get the drive 
		url := fmt.Sprintf("%s/users/%s/drive", ms.GetConfig().GraphBase, msUserID)
		graphReq, err := http.NewRequest(http.MethodGet, url, nil)
		if err != nil {
			http.Error(w, "Failed to create request", http.StatusInternalServerError)
			return
		}
		graphReq.Header.Set("Authorization", r.Header.Get("Authorization"))
		graphReq.Header.Set("Content-Type", "application/json")

		graphRes, err := http.DefaultClient.Do(graphReq)
		if err != nil {	
			http.Error(w, "Failed to make request to Microsoft Graph", http.StatusInternalServerError)
			return
		}
		defer graphRes.Body.Close()

		if graphRes.StatusCode != http.StatusOK {
			http.Error(w, "Failed to get drive", http.StatusInternalServerError)
			return
		}

		var drive Drive
		if err := json.NewDecoder(graphRes.Body).Decode(&drive); err != nil {
			http.Error(w, "Failed to decode response", http.StatusInternalServerError)
			return
		}
		fmt.Println(drive)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(drive)
	}
}

func GetDriveRoot() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		msUserID := r.URL.Query().Get("ms_user_id")
		if msUserID == "" {
			http.Error(w, "MS User ID is required", http.StatusBadRequest)
			return
		}

		//http request to get the drive root
		url := fmt.Sprintf("%s/users/%s/drive/root", ms.GetConfig().GraphBase, msUserID)
		graphReq, err := http.NewRequest(http.MethodGet, url, nil)
		if err != nil {
			http.Error(w, "Failed to create request", http.StatusInternalServerError)
			return
		}
		graphReq.Header.Set("Authorization", r.Header.Get("Authorization"))
		graphReq.Header.Set("Content-Type", "application/json")

		graphRes, err := http.DefaultClient.Do(graphReq)
		if err != nil {	
			http.Error(w, "Failed to make request to Microsoft Graph", http.StatusInternalServerError)
			return
		}
		defer graphRes.Body.Close()

		if graphRes.StatusCode != http.StatusOK {
			http.Error(w, "Failed to get drive root", http.StatusInternalServerError)
			return
		}
		var driveItem DriveItem
		if err := json.NewDecoder(graphRes.Body).Decode(&driveItem); err != nil {
			http.Error(w, "Failed to decode response", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(driveItem)
	}
}