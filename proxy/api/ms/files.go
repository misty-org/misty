package ms

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
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

		log.Println(res)

		if res.DownloadURL != "" {
			log.Println("Download URL: " + res.DownloadURL);
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(res)
	}
}

// DownloadFile streams file content from OneDrive
// GET /api/ms/file/download?drive_id=xxx&file_id=xxx
func DownloadFile() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		driveID := r.URL.Query().Get("drive_id")
		fileID := r.URL.Query().Get("file_id")

		if driveID == "" || fileID == "" {
			http.Error(w, "drive_id and file_id are required", http.StatusBadRequest)
			return
		}

		// Request the file content from Microsoft Graph
		// This endpoint returns a 302 redirect to the download URL
		url := fmt.Sprintf("%s/drives/%s/items/%s/content", ms.GetConfig().GraphBase, driveID, fileID)

		graphReq, err := http.NewRequest(http.MethodGet, url, nil)
		if err != nil {
			http.Error(w, "Failed to create request", http.StatusInternalServerError)
			return
		}
		graphReq.Header.Set("Authorization", r.Header.Get("Authorization"))

		// Create a client that doesn't follow redirects so we can handle the 302
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

		// Handle 302 redirect - get the download URL and stream from it
		if graphRes.StatusCode == http.StatusFound || graphRes.StatusCode == http.StatusTemporaryRedirect {
			downloadURL := graphRes.Header.Get("Location")
			if downloadURL == "" {
				http.Error(w, "No download URL in redirect", http.StatusInternalServerError)
				return
			}

			// Fetch the actual file content
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

			// Copy headers for content type and length
			if ct := downloadRes.Header.Get("Content-Type"); ct != "" {
				w.Header().Set("Content-Type", ct)
			}
			if cl := downloadRes.Header.Get("Content-Length"); cl != "" {
				w.Header().Set("Content-Length", cl)
			}

			// Stream the file content to the client
			_, err = io.Copy(w, downloadRes.Body)
			if err != nil {
				log.Printf("Error streaming file: %v", err)
			}
			return
		}

		// If not a redirect, check for errors
		if graphRes.StatusCode != http.StatusOK {
			http.Error(w, fmt.Sprintf("Graph API error: %d", graphRes.StatusCode), graphRes.StatusCode)
			return
		}

		// Direct content response (unlikely but handle it)
		if ct := graphRes.Header.Get("Content-Type"); ct != "" {
			w.Header().Set("Content-Type", ct)
		}
		if cl := graphRes.Header.Get("Content-Length"); cl != "" {
			w.Header().Set("Content-Length", cl)
		}
		io.Copy(w, graphRes.Body)
	}
}