package ms

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/kannachi323/misty/proxy/core/ms"
)


func GetFiles() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		driveID := r.URL.Query().Get("drive_id")
		folderID := r.URL.Query().Get("folder_id")

		if driveID == "" {
			http.Error(w, "drive_id is required", http.StatusBadRequest)
			return
		}

	
		url := fmt.Sprintf("%s/drives/%s/items/%s/children", ms.GetConfig().GraphBase, driveID, folderID)
	

		graphReq, err := http.NewRequest(http.MethodGet, url, nil)
		if err != nil {
			http.Error(w, "Failed to create request", http.StatusInternalServerError)
			return
		}

		graphReq.Header.Set("Authorization", r.Header.Get("Authorization"))

		graphRes, err := http.DefaultClient.Do(graphReq)
		if err != nil {
			http.Error(w, "Failed to make request to Microsoft Graph", http.StatusInternalServerError)
			return
		}
		defer graphRes.Body.Close()

		if graphRes.StatusCode != http.StatusOK {
			http.Error(w, fmt.Sprintf("Graph API error: %d", graphRes.StatusCode), graphRes.StatusCode)
			return
		}

		var res DriveItemsResponse
		if err := json.NewDecoder(graphRes.Body).Decode(&res); err != nil {
			http.Error(w, "Failed to decode response", http.StatusInternalServerError)
			return
		}
		fmt.Println(res)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(res)
	}
}

func GetFile() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		driveID := r.URL.Query().Get("drive_id")
		fileID := r.URL.Query().Get("file_id")

		if driveID == "" {
			http.Error(w, "drive_id is required", http.StatusBadRequest)
			return
		}
		
		url := fmt.Sprintf("%s/drives/%s/items/%s", ms.GetConfig().GraphBase, driveID, fileID)
		graphReq, err := http.NewRequest(http.MethodGet, url, nil)
		if err != nil {
			http.Error(w, "Failed to create request", http.StatusInternalServerError)
			return
		}
		graphReq.Header.Set("Authorization", r.Header.Get("Authorization"))
		graphRes, err := http.DefaultClient.Do(graphReq)
		if err != nil {
			http.Error(w, "Failed to make request to Microsoft Graph", http.StatusInternalServerError)
			return
		}
		defer graphRes.Body.Close()
		if graphRes.StatusCode != http.StatusOK {
			http.Error(w, fmt.Sprintf("Graph API error: %d", graphRes.StatusCode), graphRes.StatusCode)
			return
		}
		var res DriveItem
		if err := json.NewDecoder(graphRes.Body).Decode(&res); err != nil {
			http.Error(w, "Failed to decode response", http.StatusInternalServerError)
			return
		}
		fmt.Println(res)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(res)
	}
}