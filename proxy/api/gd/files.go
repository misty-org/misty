package gd

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"

	"github.com/kannachi323/misty/proxy/core/gd"
	"github.com/kannachi323/misty/proxy/db"
)

func GetFiles(database *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := r.URL.Query().Get("user_id")
		gdUserID := r.URL.Query().Get("gd_user_id")
		folderID := r.URL.Query().Get("folder_id")

		if userID == "" || gdUserID == "" {
			http.Error(w, "user_id and gd_user_id are required", http.StatusBadRequest)
			return
		}
		if folderID == "" {
			folderID = "root"
		}

		config := gd.GetConfig()
		if config == nil {
			http.Error(w, "Google Drive config not found", http.StatusInternalServerError)
			return
		}

		query := url.Values{
			"q":        {fmt.Sprintf("'%s' in parents and trashed = false", folderID)},
			"fields":   {"files(id,name,mimeType,size,webViewLink,createdTime,modifiedTime,parents,iconLink),nextPageToken"},
			"orderBy":  {"folder,name"},
			"pageSize": {"1000"},
		}

		var allFiles []gd.GDriveFile
		pageToken := ""

		for i := 0; i < 50; i++ { // safety cap
			if pageToken != "" {
				query.Set("pageToken", pageToken)
			}

			// log.Printf("GDrive: Fetching page %d for folder %s (token: %s)", i+1, folderID, pageToken)

			apiURL := fmt.Sprintf("%s/drive/v3/files?%s", config.APIBase, query.Encode())
			apiRes, err := gd.ExecAPIRequest(database, userID, gdUserID, http.MethodGet, apiURL, nil)
			if err != nil {
				log.Printf("GDrive API request failed: %v", err)
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}

			if apiRes.StatusCode != http.StatusOK {
				apiRes.Body.Close()
				log.Printf("GDrive API error status: %d", apiRes.StatusCode)
				http.Error(w, fmt.Sprintf("Google Drive API error: %d", apiRes.StatusCode), apiRes.StatusCode)
				return
			}

			var page gd.GDriveFileList
			if err := json.NewDecoder(apiRes.Body).Decode(&page); err != nil {
				apiRes.Body.Close()
				log.Printf("Failed to decode response: %v", err)
				http.Error(w, "Failed to decode response", http.StatusInternalServerError)
				return
			}
			apiRes.Body.Close()

			log.Printf("GDrive: Page %d fetched %d items. Next token: %s", i+1, len(page.Files), page.NextPageToken)
			allFiles = append(allFiles, page.Files...)

			if page.NextPageToken == "" {
				break
			}
			pageToken = page.NextPageToken
		}
		
		log.Printf("GDrive: Total files fetched: %d", len(allFiles))

		result := gd.GDriveFileList{Files: allFiles}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)
	}
}

func GetFile(database *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := r.URL.Query().Get("user_id")
		gdUserID := r.URL.Query().Get("gd_user_id")
		fileID := r.URL.Query().Get("file_id")

		if userID == "" || gdUserID == "" || fileID == "" {
			http.Error(w, "user_id, gd_user_id, and file_id are required", http.StatusBadRequest)
			return
		}

		config := gd.GetConfig()
		if config == nil {
			http.Error(w, "Google Drive config not found", http.StatusInternalServerError)
			return
		}

		apiURL := fmt.Sprintf("%s/drive/v3/files/%s?fields=id,name,mimeType,size,webViewLink,createdTime,modifiedTime,parents,iconLink", config.APIBase, fileID)
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

		var res gd.GDriveFile
		if err := json.NewDecoder(apiRes.Body).Decode(&res); err != nil {
			http.Error(w, "Failed to decode response", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(res)
	}
}

// DownloadFile streams file content from Google Drive.
// Only handles binary files (alt=media). Google Workspace files (Docs, Sheets,
// etc.) should be opened in the browser via webViewLink instead.
func DownloadFile(database *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := r.URL.Query().Get("user_id")
		gdUserID := r.URL.Query().Get("gd_user_id")
		fileID := r.URL.Query().Get("file_id")

		if userID == "" || gdUserID == "" || fileID == "" {
			http.Error(w, "user_id, gd_user_id, and file_id are required", http.StatusBadRequest)
			return
		}

		config := gd.GetConfig()
		if config == nil {
			http.Error(w, "Google Drive config not found", http.StatusInternalServerError)
			return
		}

		// Use alt=media to get file content directly
		apiURL := fmt.Sprintf("%s/drive/v3/files/%s?alt=media", config.APIBase, fileID)

		accessToken, err := gd.GetAccessToken(database, userID, gdUserID)
		if err != nil {
			newToken, refreshErr := gd.RefreshToken(database, userID, gdUserID)
			if refreshErr != nil {
				http.Error(w, "token lookup failed: "+err.Error(), http.StatusInternalServerError)
				return
			}
			accessToken = newToken
		}

		req, err := http.NewRequest(http.MethodGet, apiURL, nil)
		if err != nil {
			http.Error(w, "Failed to create request", http.StatusInternalServerError)
			return
		}
		req.Header.Set("Authorization", "Bearer "+accessToken)

		apiRes, err := http.DefaultClient.Do(req)
		if err != nil {
			http.Error(w, "Failed to make request to Google Drive", http.StatusInternalServerError)
			return
		}
		defer apiRes.Body.Close()

		// Handle 401 — refresh and retry
		if apiRes.StatusCode == http.StatusUnauthorized {
			apiRes.Body.Close()
			newToken, refreshErr := gd.RefreshToken(database, userID, gdUserID)
			if refreshErr != nil {
				http.Error(w, "Token expired and refresh failed", http.StatusUnauthorized)
				return
			}
			req, _ = http.NewRequest(http.MethodGet, apiURL, nil)
			req.Header.Set("Authorization", "Bearer "+newToken)
			apiRes, err = http.DefaultClient.Do(req)
			if err != nil {
				http.Error(w, "Failed to make request after refresh", http.StatusInternalServerError)
				return
			}
			defer apiRes.Body.Close()
		}

		if apiRes.StatusCode != http.StatusOK {
			http.Error(w, fmt.Sprintf("Google Drive API error: %d", apiRes.StatusCode), apiRes.StatusCode)
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

// GetUploadSession creates a resumable upload session with Google Drive.
// Returns the upload URL that the client can use for chunked uploads.
func GetUploadSession(database *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := r.URL.Query().Get("user_id")
		gdUserID := r.URL.Query().Get("gd_user_id")
		if userID == "" || gdUserID == "" {
			http.Error(w, "user_id and gd_user_id query params are required", http.StatusBadRequest)
			return
		}

		var uploadReq gd.UploadRequest
		if err := json.NewDecoder(r.Body).Decode(&uploadReq); err != nil {
			http.Error(w, "Failed to decode request body", http.StatusBadRequest)
			return
		}

		config := gd.GetConfig()
		if config == nil {
			http.Error(w, "Google Drive config not found", http.StatusInternalServerError)
			return
		}

		parentID := uploadReq.ParentID
		if parentID == "" {
			parentID = "root"
		}

		// Build metadata for the file
		metadata := map[string]interface{}{
			"name":    uploadReq.FileName,
			"parents": []string{parentID},
		}
		metadataBytes, _ := json.Marshal(metadata)

		// Create resumable upload session
		apiURL := fmt.Sprintf("%s/upload/drive/v3/files?uploadType=resumable", config.APIBase)

		accessToken, err := gd.GetAccessToken(database, userID, gdUserID)
		if err != nil {
			newToken, refreshErr := gd.RefreshToken(database, userID, gdUserID)
			if refreshErr != nil {
				http.Error(w, "token lookup failed: "+err.Error(), http.StatusInternalServerError)
				return
			}
			accessToken = newToken
		}

		req, err := http.NewRequest(http.MethodPost, apiURL, bytes.NewReader(metadataBytes))
		if err != nil {
			http.Error(w, "Failed to create request", http.StatusInternalServerError)
			return
		}
		req.Header.Set("Authorization", "Bearer "+accessToken)
		req.Header.Set("Content-Type", "application/json; charset=UTF-8")
		req.Header.Set("X-Upload-Content-Type", "application/octet-stream")
		if uploadReq.FileSize > 0 {
			req.Header.Set("X-Upload-Content-Length", fmt.Sprintf("%d", uploadReq.FileSize))
		}

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

		// The resumable upload URI is in the Location header
		uploadURL := apiRes.Header.Get("Location")
		if uploadURL == "" {
			http.Error(w, "No upload URL in response", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(gd.UploadSessionResponse{
			UploadURL: uploadURL,
		})
	}
}
