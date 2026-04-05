package remote

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/kannachi323/misty/proxy/core/rclone"
)

// in-flight OAuth tracking
var (
	oauthMu      sync.Mutex
	oauthPending = map[string]bool{} // remote name -> in progress
)

func ListRemotes() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		remotes := rclone.ListRemotes()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(remotes)
	}
}

func CreateRemote() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Name   string            `json:"name"`
			Type   string            `json:"type"`
			Params map[string]string `json:"params,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if req.Name == "" || req.Type == "" {
			http.Error(w, "name and type are required", http.StatusBadRequest)
			return
		}

		if rclone.RemoteExists(req.Name) {
			http.Error(w, "remote already exists", http.StatusConflict)
			return
		}

		oauthMu.Lock()
		if oauthPending[req.Name] {
			oauthMu.Unlock()
			http.Error(w, "OAuth already in progress for this remote", http.StatusConflict)
			return
		}
		oauthPending[req.Name] = true
		oauthMu.Unlock()

		// Run OAuth in a goroutine — it blocks until the user completes the browser flow.
		// Client should poll GET /api/remotes to detect when the remote appears.
		go func() {
			defer func() {
				oauthMu.Lock()
				delete(oauthPending, req.Name)
				oauthMu.Unlock()
			}()

			params := req.Params
			if params == nil {
				params = map[string]string{}
			}
			if err := rclone.CreateRemote(r.Context(), req.Name, req.Type, params); err != nil {
				log.Printf("Failed to create remote %q: %v", req.Name, err)
			}
		}()

		w.WriteHeader(http.StatusAccepted)
		json.NewEncoder(w).Encode(map[string]string{
			"status":  "oauth_started",
			"message": "Complete authorization in your browser. Poll GET /api/remotes to detect completion.",
		})
	}
}

func DeleteRemote() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := r.URL.Query().Get("name")
		if name == "" {
			http.Error(w, "name query parameter is required", http.StatusBadRequest)
			return
		}

		if !rclone.RemoteExists(name) {
			http.Error(w, "remote not found", http.StatusNotFound)
			return
		}

		rclone.DeleteRemote(name)
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})
	}
}

func ListTypes() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Supported provider types (matching our imported backends)
		types := []map[string]string{
			{"type": "onedrive", "name": "Microsoft OneDrive"},
			{"type": "drive", "name": "Google Drive"},
			{"type": "dropbox", "name": "Dropbox"},
			{"type": "s3", "name": "Amazon S3"},
			{"type": "sftp", "name": "SFTP"},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(types)
	}
}
