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

// ConfigStart begins an interactive rclone config flow. Returns the first
// user-facing step — typically after OAuth has completed transparently
// inside this call, so this request can block for a while.
func ConfigStart() http.HandlerFunc {
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
			http.Error(w, "config flow already in progress for this remote", http.StatusConflict)
			return
		}
		oauthPending[req.Name] = true
		oauthMu.Unlock()
		defer func() {
			oauthMu.Lock()
			delete(oauthPending, req.Name)
			oauthMu.Unlock()
		}()

		step, err := rclone.ConfigStart(r.Context(), req.Name, req.Type, req.Params)
		if err != nil {
			log.Printf("ConfigStart %q: %v", req.Name, err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(step)
	}
}

// ConfigContinue advances an in-progress config flow with a user-supplied
// answer. Payload: {name, state, result}.
func ConfigContinue() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Name   string `json:"name"`
			State  string `json:"state"`
			Result string `json:"result"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if req.Name == "" {
			http.Error(w, "name is required", http.StatusBadRequest)
			return
		}

		step, err := rclone.ConfigContinue(r.Context(), req.Name, req.State, req.Result)
		if err != nil {
			log.Printf("ConfigContinue %q: %v", req.Name, err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(step)
	}
}

// ConfigCancel removes a partially-created remote from rclone.conf so the
// user can retry. Safe to call even if the remote doesn't exist.
func ConfigCancel() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := r.URL.Query().Get("name")
		if name == "" {
			http.Error(w, "name query parameter is required", http.StatusBadRequest)
			return
		}
		rclone.DeleteRemote(name)
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "cancelled"})
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
