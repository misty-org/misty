package remote

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/kannachi323/misty/proxy/core/rclone"
)

// in-flight OAuth tracking
var (
	oauthMu      sync.Mutex
	oauthPending = map[string]bool{}               // remote name -> in progress
	oauthCancels = map[string]context.CancelFunc{} // remote name -> cancel active flow
)

func beginOAuthFlow(name string, cancel context.CancelFunc) bool {
	oauthMu.Lock()
	defer oauthMu.Unlock()
	if len(oauthPending) != 0 {
		return false
	}
	oauthPending[name] = true
	if cancel != nil {
		oauthCancels[name] = cancel
	}
	return true
}

func endOAuthFlow(name string) {
	oauthMu.Lock()
	defer oauthMu.Unlock()
	delete(oauthPending, name)
	delete(oauthCancels, name)
}

func cancelOAuthFlow(name string) {
	oauthMu.Lock()
	cancel := oauthCancels[name]
	delete(oauthPending, name)
	delete(oauthCancels, name)
	oauthMu.Unlock()

	if cancel != nil {
		cancel()
	}
	stopOAuthWebserver()
}

func stopOAuthWebserver() {
	client := &http.Client{Timeout: 2 * time.Second}
	req, err := http.NewRequest(http.MethodGet, "http://127.0.0.1:53682/?error=cancelled", nil)
	if err != nil {
		return
	}
	_, _ = client.Do(req)
}

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

		ctx, cancel := context.WithCancel(context.Background())
		if !beginOAuthFlow(req.Name, cancel) {
			cancel()
			http.Error(w, "OAuth already in progress for this remote", http.StatusConflict)
			return
		}

		// Run OAuth in a goroutine — it blocks until the user completes the browser flow.
		// Client should poll GET /api/remotes to detect when the remote appears.
		go func() {
			defer endOAuthFlow(req.Name)

			params := req.Params
			if params == nil {
				params = map[string]string{}
			}
			if err := rclone.CreateRemote(ctx, req.Name, req.Type, params); err != nil {
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

// ConfigStart begins external rclone setup. With the CLI-backed rclone
// implementation this usually returns DONE after rclone config create
// completes; the request can still block while rclone handles browser auth.
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

		ctx, cancel := context.WithCancel(r.Context())
		if !beginOAuthFlow(req.Name, cancel) {
			cancel()
			http.Error(w, "config flow already in progress for this remote", http.StatusConflict)
			return
		}
		defer endOAuthFlow(req.Name)

		step, err := rclone.ConfigStart(ctx, req.Name, req.Type, req.Params)
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

		ctx, cancel := context.WithCancel(r.Context())
		if !beginOAuthFlow(req.Name, cancel) {
			cancel()
			http.Error(w, "config flow already in progress for this remote", http.StatusConflict)
			return
		}
		defer endOAuthFlow(req.Name)

		step, err := rclone.ConfigContinue(ctx, req.Name, req.State, req.Result)
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
		cancelOAuthFlow(name)
		rclone.DeleteRemote(name)
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "cancelled"})
	}
}

func ListTypes() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(rclone.ListProviderTypes())
	}
}
