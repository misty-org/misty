package ms

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"

	"github.com/kannachi323/misty/proxy/core/ms"
	"github.com/kannachi323/misty/proxy/db"
)

func GetFiles(database *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := r.URL.Query().Get("user_id")
		msUserID := r.URL.Query().Get("ms_user_id")
		driveID := r.URL.Query().Get("drive_id")
		folderID := r.URL.Query().Get("folder_id")

		if userID == "" || msUserID == "" || driveID == "" {
			http.Error(w, "user_id, ms_user_id, and drive_id are required", http.StatusBadRequest)
			return
		}

		url := fmt.Sprintf("%s/drives/%s/items/%s/children", ms.GetConfig().GraphBase, driveID, folderID)
		graphRes, err := ms.ExecGraphRequest(database, userID, msUserID, http.MethodGet, url, nil)
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

func GetFile(database *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := r.URL.Query().Get("user_id")
		msUserID := r.URL.Query().Get("ms_user_id")
		driveID := r.URL.Query().Get("drive_id")
		fileID := r.URL.Query().Get("file_id")

		if userID == "" || msUserID == "" || driveID == "" {
			http.Error(w, "user_id, ms_user_id, and drive_id are required", http.StatusBadRequest)
			return
		}

		url := fmt.Sprintf("%s/drives/%s/items/%s", ms.GetConfig().GraphBase, driveID, fileID)
		graphRes, err := ms.ExecGraphRequest(database, userID, msUserID, http.MethodGet, url, nil)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer graphRes.Body.Close()

		if graphRes.StatusCode != http.StatusOK {
			http.Error(w, fmt.Sprintf("Graph API error: %d", graphRes.StatusCode), graphRes.StatusCode)
			return
		}

		var res ms.DriveItem
		if err := json.NewDecoder(graphRes.Body).Decode(&res); err != nil {
			http.Error(w, "Failed to decode response", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(res)
	}
}

// DownloadFile streams file content from OneDrive.
func DownloadFile(database *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := r.URL.Query().Get("user_id")
		msUserID := r.URL.Query().Get("ms_user_id")
		driveID := r.URL.Query().Get("drive_id")
		fileID := r.URL.Query().Get("file_id")

		if userID == "" || msUserID == "" || driveID == "" || fileID == "" {
			http.Error(w, "user_id, ms_user_id, drive_id, and file_id are required", http.StatusBadRequest)
			return
		}

		// Look up the access token from the DB (with auto-refresh)
		accessToken, err := ms.GetAccessToken(database, userID, msUserID)
		if err != nil {
			// Try refresh
			newToken, refreshErr := ms.RefreshToken(database, userID, msUserID)
			if refreshErr != nil {
				http.Error(w, "token lookup failed: "+err.Error(), http.StatusInternalServerError)
				return
			}
			accessToken = newToken
		}

		url := fmt.Sprintf("%s/drives/%s/items/%s/content", ms.GetConfig().GraphBase, driveID, fileID)
		graphReq, err := http.NewRequest(http.MethodGet, url, nil)
		if err != nil {
			http.Error(w, "Failed to create request", http.StatusInternalServerError)
			return
		}
		graphReq.Header.Set("Authorization", "Bearer "+accessToken)

		// Don't follow redirects so we can handle the 302
		client := &http.Client{
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				return http.ErrUseLastResponse
			},
		}

		graphRes, err := client.Do(graphReq)
		if err != nil {
			http.Error(w, "Failed to make request to Microsoft Graph", http.StatusInternalServerError)
			return
		}
		defer graphRes.Body.Close()

		// Handle 401 — refresh and retry
		if graphRes.StatusCode == http.StatusUnauthorized {
			graphRes.Body.Close()
			newToken, refreshErr := ms.RefreshToken(database, userID, msUserID)
			if refreshErr != nil {
				http.Error(w, "Token expired and refresh failed", http.StatusUnauthorized)
				return
			}
			graphReq, _ = http.NewRequest(http.MethodGet, url, nil)
			graphReq.Header.Set("Authorization", "Bearer "+newToken)
			graphRes, err = client.Do(graphReq)
			if err != nil {
				http.Error(w, "Failed to make request after refresh", http.StatusInternalServerError)
				return
			}
			defer graphRes.Body.Close()
		}

		// Handle 302 redirect — get the download URL and stream from it
		if graphRes.StatusCode == http.StatusFound || graphRes.StatusCode == http.StatusTemporaryRedirect {
			downloadURL := graphRes.Header.Get("Location")
			if downloadURL == "" {
				http.Error(w, "No download URL in redirect", http.StatusInternalServerError)
				return
			}

			downloadReq, err := http.NewRequest(http.MethodGet, downloadURL, nil)
			if err != nil {
				http.Error(w, "Failed to create download request", http.StatusInternalServerError)
				return
			}

			downloadRes, err := http.DefaultClient.Do(downloadReq)
			if err != nil {
				http.Error(w, "Failed to download file", http.StatusInternalServerError)
				return
			}
			defer downloadRes.Body.Close()

			if downloadRes.StatusCode != http.StatusOK {
				http.Error(w, fmt.Sprintf("Download failed: %d", downloadRes.StatusCode), downloadRes.StatusCode)
				return
			}

			if ct := downloadRes.Header.Get("Content-Type"); ct != "" {
				w.Header().Set("Content-Type", ct)
			}
			if cl := downloadRes.Header.Get("Content-Length"); cl != "" {
				w.Header().Set("Content-Length", cl)
			}

			_, err = io.Copy(w, downloadRes.Body)
			if err != nil {
				log.Printf("Error streaming file: %v", err)
			}
			return
		}

		if graphRes.StatusCode != http.StatusOK {
			http.Error(w, fmt.Sprintf("Graph API error: %d", graphRes.StatusCode), graphRes.StatusCode)
			return
		}

		if ct := graphRes.Header.Get("Content-Type"); ct != "" {
			w.Header().Set("Content-Type", ct)
		}
		if cl := graphRes.Header.Get("Content-Length"); cl != "" {
			w.Header().Set("Content-Length", cl)
		}
		io.Copy(w, graphRes.Body)
	}
}

func GetUploadSession(database *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := r.URL.Query().Get("user_id")
		msUserID := r.URL.Query().Get("ms_user_id")
		if userID == "" || msUserID == "" {
			http.Error(w, "user_id and ms_user_id query params are required", http.StatusBadRequest)
			return
		}

		var req ms.UploadRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Failed to decode request body", http.StatusBadRequest)
			return
		}

		url := fmt.Sprintf("%s/drives/%s/items/%s:/%s:/createUploadSession",
			ms.GetConfig().GraphBase, req.DriveID, req.ParentID, req.FileName)

		payload, _ := json.Marshal(map[string]interface{}{
			"item": map[string]interface{}{
				"@microsoft.graph.conflictBehavior": "rename",
				"name": req.FileName,
			},
		})

		graphRes, err := ms.ExecGraphRequest(database, userID, msUserID, http.MethodPost, url, bytes.NewBuffer(payload))
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer graphRes.Body.Close()

		if graphRes.StatusCode != http.StatusOK {
			http.Error(w, "Failed to create upload session", graphRes.StatusCode)
			return
		}

		var session ms.UploadSession
		if err := json.NewDecoder(graphRes.Body).Decode(&session); err != nil {
			http.Error(w, "Failed to decode response", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(session)
	}
}

func CreateFolder(database *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := r.URL.Query().Get("user_id")
		msUserID := r.URL.Query().Get("ms_user_id")
		if userID == "" || msUserID == "" {
			http.Error(w, "user_id and ms_user_id query params are required", http.StatusBadRequest)
			return
		}

		var req struct {
			DriveID    string `json:"drive_id"`
			ParentID   string `json:"parent_id"`
			FolderName string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Failed to decode request body", http.StatusBadRequest)
			return
		}

		payload, _ := json.Marshal(map[string]interface{}{
			"name":   req.FolderName,
			"folder": map[string]interface{}{},
			"@microsoft.graph.conflictBehavior": "rename",
		})

		url := fmt.Sprintf("%s/drives/%s/items/%s/children",
			ms.GetConfig().GraphBase, req.DriveID, req.ParentID)

		graphRes, err := ms.ExecGraphRequest(database, userID, msUserID, http.MethodPost, url, bytes.NewBuffer(payload))
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer graphRes.Body.Close()

		if graphRes.StatusCode != http.StatusCreated && graphRes.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(graphRes.Body)
			http.Error(w, fmt.Sprintf("Failed to create folder: %d %s", graphRes.StatusCode, string(body)), graphRes.StatusCode)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		io.Copy(w, graphRes.Body)
	}
}
