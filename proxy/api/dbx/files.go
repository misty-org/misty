package dbx

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"

	"github.com/kannachi323/misty/proxy/core/dropbox"
	"github.com/kannachi323/misty/proxy/db"
)

func GetFiles(database *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := r.URL.Query().Get("user_id")
		dbxUserID := r.URL.Query().Get("dbx_user_id")
		folderPath := r.URL.Query().Get("folder_path")

		if userID == "" || dbxUserID == "" {
			http.Error(w, "user_id and dbx_user_id are required", http.StatusBadRequest)
			return
		}

		config := dropbox.GetConfig()
		if config == nil {
			http.Error(w, "Dropbox config not found", http.StatusInternalServerError)
			return
		}

		// Build list_folder request body
		reqBody := map[string]interface{}{
			"path":                                folderPath,
			"recursive":                           false,
			"include_media_info":                   false,
			"include_deleted":                      false,
			"include_has_explicit_shared_members":  false,
			"include_mounted_folders":              true,
		}
		reqBytes, _ := json.Marshal(reqBody)

		apiURL := fmt.Sprintf("%s/files/list_folder", config.APIBase)
		apiRes, err := dropbox.ExecAPIRequest(database, userID, dbxUserID, http.MethodPost, apiURL, bytes.NewReader(reqBytes))
		if err != nil {
			log.Printf("Dropbox API request failed: %v", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		if apiRes.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(apiRes.Body)
			apiRes.Body.Close()
			log.Printf("Dropbox API error status: %d, body: %s", apiRes.StatusCode, string(body))
			http.Error(w, fmt.Sprintf("Dropbox API error: %d", apiRes.StatusCode), apiRes.StatusCode)
			return
		}

		var page dropbox.ListFolderResult
		if err := json.NewDecoder(apiRes.Body).Decode(&page); err != nil {
			apiRes.Body.Close()
			log.Printf("Failed to decode response: %v", err)
			http.Error(w, "Failed to decode response", http.StatusInternalServerError)
			return
		}
		apiRes.Body.Close()

		allEntries := make([]dropbox.FileMetadata, 0)
		allEntries = append(allEntries, page.Entries...)

		// Paginate using cursor
		for page.HasMore {
			continueBody := map[string]string{"cursor": page.Cursor}
			continueBytes, _ := json.Marshal(continueBody)

			continueURL := fmt.Sprintf("%s/files/list_folder/continue", config.APIBase)
			continueRes, err := dropbox.ExecAPIRequest(database, userID, dbxUserID, http.MethodPost, continueURL, bytes.NewReader(continueBytes))
			if err != nil {
				log.Printf("Dropbox list_folder/continue failed: %v", err)
				break
			}

			if continueRes.StatusCode != http.StatusOK {
				continueRes.Body.Close()
				break
			}

			if err := json.NewDecoder(continueRes.Body).Decode(&page); err != nil {
				continueRes.Body.Close()
				break
			}
			continueRes.Body.Close()

			allEntries = append(allEntries, page.Entries...)
		}

		log.Printf("Dropbox: Total entries fetched: %d", len(allEntries))

		result := dropbox.ListFolderResult{Entries: allEntries}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)
	}
}

func GetFile(database *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := r.URL.Query().Get("user_id")
		dbxUserID := r.URL.Query().Get("dbx_user_id")
		filePath := r.URL.Query().Get("file_path")

		if userID == "" || dbxUserID == "" || filePath == "" {
			http.Error(w, "user_id, dbx_user_id, and file_path are required", http.StatusBadRequest)
			return
		}

		config := dropbox.GetConfig()
		if config == nil {
			http.Error(w, "Dropbox config not found", http.StatusInternalServerError)
			return
		}

		reqBody := map[string]string{"path": filePath}
		reqBytes, _ := json.Marshal(reqBody)

		apiURL := fmt.Sprintf("%s/files/get_metadata", config.APIBase)
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

		var res dropbox.FileMetadata
		if err := json.NewDecoder(apiRes.Body).Decode(&res); err != nil {
			http.Error(w, "Failed to decode response", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(res)
	}
}

// DownloadFile streams file content from Dropbox.
// Dropbox uses content.dropboxapi.com with Dropbox-API-Arg header.
func DownloadFile(database *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := r.URL.Query().Get("user_id")
		dbxUserID := r.URL.Query().Get("dbx_user_id")
		filePath := r.URL.Query().Get("file_path")

		if userID == "" || dbxUserID == "" || filePath == "" {
			http.Error(w, "user_id, dbx_user_id, and file_path are required", http.StatusBadRequest)
			return
		}

		config := dropbox.GetConfig()
		if config == nil {
			http.Error(w, "Dropbox config not found", http.StatusInternalServerError)
			return
		}

		apiURL := fmt.Sprintf("%s/files/download", config.ContentBase)

		accessToken, err := dropbox.GetAccessToken(database, userID, dbxUserID)
		if err != nil {
			newToken, refreshErr := dropbox.RefreshToken(database, userID, dbxUserID)
			if refreshErr != nil {
				http.Error(w, "token lookup failed: "+err.Error(), http.StatusInternalServerError)
				return
			}
			accessToken = newToken
		}

		// Dropbox-API-Arg header with path
		apiArg, _ := json.Marshal(map[string]string{"path": filePath})

		req, err := http.NewRequest(http.MethodPost, apiURL, nil)
		if err != nil {
			http.Error(w, "Failed to create request", http.StatusInternalServerError)
			return
		}
		req.Header.Set("Authorization", "Bearer "+accessToken)
		req.Header.Set("Dropbox-API-Arg", string(apiArg))

		apiRes, err := http.DefaultClient.Do(req)
		if err != nil {
			http.Error(w, "Failed to make request to Dropbox", http.StatusInternalServerError)
			return
		}
		defer apiRes.Body.Close()

		// Handle 401 — refresh and retry
		if apiRes.StatusCode == http.StatusUnauthorized {
			apiRes.Body.Close()
			newToken, refreshErr := dropbox.RefreshToken(database, userID, dbxUserID)
			if refreshErr != nil {
				http.Error(w, "Token expired and refresh failed", http.StatusUnauthorized)
				return
			}
			req, _ = http.NewRequest(http.MethodPost, apiURL, nil)
			req.Header.Set("Authorization", "Bearer "+newToken)
			req.Header.Set("Dropbox-API-Arg", string(apiArg))
			apiRes, err = http.DefaultClient.Do(req)
			if err != nil {
				http.Error(w, "Failed to make request after refresh", http.StatusInternalServerError)
				return
			}
			defer apiRes.Body.Close()
		}

		if apiRes.StatusCode != http.StatusOK {
			http.Error(w, fmt.Sprintf("Dropbox API error: %d", apiRes.StatusCode), apiRes.StatusCode)
			return
		}

		if ct := apiRes.Header.Get("Content-Type"); ct != "" {
			w.Header().Set("Content-Type", ct)
		}
		if cl := apiRes.Header.Get("Content-Length"); cl != "" {
			w.Header().Set("Content-Length", cl)
		}

		_, err = io.Copy(w, apiRes.Body)
		if err != nil {
			log.Printf("Error streaming file: %v", err)
		}
	}
}

// GetUploadSession creates an upload session with Dropbox.
// Returns the session ID that the client can use for chunked uploads.
func GetUploadSession(database *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := r.URL.Query().Get("user_id")
		dbxUserID := r.URL.Query().Get("dbx_user_id")
		if userID == "" || dbxUserID == "" {
			http.Error(w, "user_id and dbx_user_id query params are required", http.StatusBadRequest)
			return
		}

		config := dropbox.GetConfig()
		if config == nil {
			http.Error(w, "Dropbox config not found", http.StatusInternalServerError)
			return
		}

		accessToken, err := dropbox.GetAccessToken(database, userID, dbxUserID)
		if err != nil {
			newToken, refreshErr := dropbox.RefreshToken(database, userID, dbxUserID)
			if refreshErr != nil {
				http.Error(w, "token lookup failed: "+err.Error(), http.StatusInternalServerError)
				return
			}
			accessToken = newToken
		}

		// Start upload session
		apiURL := fmt.Sprintf("%s/files/upload_session/start", config.ContentBase)

		req, err := http.NewRequest(http.MethodPost, apiURL, nil)
		if err != nil {
			http.Error(w, "Failed to create request", http.StatusInternalServerError)
			return
		}
		req.Header.Set("Authorization", "Bearer "+accessToken)
		req.Header.Set("Dropbox-API-Arg", `{"close": false}`)
		req.Header.Set("Content-Type", "application/octet-stream")

		apiRes, err := http.DefaultClient.Do(req)
		if err != nil {
			http.Error(w, "Failed to create upload session", http.StatusInternalServerError)
			return
		}
		defer apiRes.Body.Close()

		if apiRes.StatusCode != http.StatusOK {
			http.Error(w, fmt.Sprintf("Failed to create upload session: %d", apiRes.StatusCode), apiRes.StatusCode)
			return
		}

		var sessionResp struct {
			SessionID string `json:"session_id"`
		}
		if err := json.NewDecoder(apiRes.Body).Decode(&sessionResp); err != nil {
			http.Error(w, "Failed to parse session response", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(dropbox.UploadSessionResponse{
			SessionID: sessionResp.SessionID,
		})
	}
}

func CreateFolder(database *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := r.URL.Query().Get("user_id")
		dbxUserID := r.URL.Query().Get("dbx_user_id")
		if userID == "" || dbxUserID == "" {
			http.Error(w, "user_id and dbx_user_id query params are required", http.StatusBadRequest)
			return
		}

		var req struct {
			Path       string `json:"path"`
			AutoRename bool   `json:"autorename"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Failed to decode request body", http.StatusBadRequest)
			return
		}

		config := dropbox.GetConfig()
		payload, _ := json.Marshal(map[string]interface{}{
			"path":       req.Path,
			"autorename": req.AutoRename,
		})

		apiURL := fmt.Sprintf("%s/files/create_folder_v2", config.APIBase)

		apiRes, err := dropbox.ExecAPIRequest(database, userID, dbxUserID, http.MethodPost, apiURL, bytes.NewReader(payload))
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer apiRes.Body.Close()

		if apiRes.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(apiRes.Body)
			http.Error(w, fmt.Sprintf("Failed to create folder: %d %s", apiRes.StatusCode, string(body)), apiRes.StatusCode)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		io.Copy(w, apiRes.Body)
	}
}
