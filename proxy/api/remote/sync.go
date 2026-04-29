package remote

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/kannachi323/misty/proxy/core/syncindex"
)

func SyncRefetch(manager *syncindex.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if manager == nil {
			http.Error(w, "sync service unavailable", http.StatusServiceUnavailable)
			return
		}

		var req struct {
			Remote string `json:"remote"`
			Path   string `json:"path"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if req.Remote == "" {
			http.Error(w, "remote is required", http.StatusBadRequest)
			return
		}

		resp, err := manager.RefreshDirectory(r.Context(), req.Remote, req.Path)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}

func SyncDirty(manager *syncindex.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if manager == nil {
			http.Error(w, "sync service unavailable", http.StatusServiceUnavailable)
			return
		}

		var req struct {
			Remote      string `json:"remote"`
			Path        string `json:"path"`
			LocalExists bool   `json:"local_exists"`
			IsDir       bool   `json:"is_dir"`
			MTime       string `json:"mtime"`
			Size        int64  `json:"size"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if req.Remote == "" {
			http.Error(w, "remote is required", http.StatusBadRequest)
			return
		}
		if req.Path == "" {
			http.Error(w, "path is required", http.StatusBadRequest)
			return
		}

		if err := manager.MarkLocalDirty(r.Context(), req.Remote, req.Path,
			req.LocalExists, req.IsDir, req.MTime, req.Size); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

func SyncMarkSynced(manager *syncindex.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if manager == nil {
			http.Error(w, "sync service unavailable", http.StatusServiceUnavailable)
			return
		}

		var req struct {
			Remote string `json:"remote"`
			Path   string `json:"path"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if req.Remote == "" {
			http.Error(w, "remote is required", http.StatusBadRequest)
			return
		}
		if req.Path == "" {
			http.Error(w, "path is required", http.StatusBadRequest)
			return
		}

		if err := manager.MarkLocalSynced(r.Context(), req.Remote, req.Path); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

// SyncRunNow triggers an out-of-band poller pass without waiting for the
// periodic ticker. The body is optional; when a "remote" is provided, only
// that root is processed, which keeps latency low when the user hits Refresh
// while browsing a specific cloud.
func SyncRunNow(poller *syncindex.Poller) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if poller == nil {
			http.Error(w, "sync service unavailable", http.StatusServiceUnavailable)
			return
		}

		var req struct {
			Remote string `json:"remote"`
			Path   string `json:"path"`
		}
		if r.Body != nil && r.ContentLength != 0 {
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "invalid request body", http.StatusBadRequest)
				return
			}
		}
		runCtx, cancel := context.WithTimeout(context.Background(), syncindex.RunNowTimeout())
		defer cancel()
		refetchedDirs, dirtyBefore, err := poller.RunNow(runCtx, req.Remote)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"remote":         req.Remote,
			"path":           req.Path,
			"refetched_dirs": refetchedDirs,
			"dirty_before":   dirtyBefore,
		})
	}
}

func SyncList(service *syncindex.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if service == nil {
			http.Error(w, "sync service unavailable", http.StatusServiceUnavailable)
			return
		}

		remoteName := r.URL.Query().Get("remote")
		dirPath := r.URL.Query().Get("path")
		if remoteName == "" {
			http.Error(w, "remote query parameter is required", http.StatusBadRequest)
			return
		}

		resp, err := service.ListDirectory(r.Context(), remoteName, dirPath)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}

func SyncWatchDir(manager *syncindex.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if manager == nil {
			http.Error(w, "sync service unavailable", http.StatusServiceUnavailable)
			return
		}
		var req struct {
			Remote string `json:"remote"`
			Path   string `json:"path"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if req.Remote == "" {
			http.Error(w, "remote is required", http.StatusBadRequest)
			return
		}
		if err := manager.WatchDir(req.Remote, req.Path); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func SyncUnwatchDir(manager *syncindex.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if manager == nil {
			http.Error(w, "sync service unavailable", http.StatusServiceUnavailable)
			return
		}
		var req struct {
			Remote string `json:"remote"`
			Path   string `json:"path"`
		}
		if remote := r.URL.Query().Get("remote"); remote != "" {
			req.Remote = remote
			req.Path = r.URL.Query().Get("path")
		} else {
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "invalid request body", http.StatusBadRequest)
				return
			}
		}
		if req.Remote == "" {
			http.Error(w, "remote is required", http.StatusBadRequest)
			return
		}
		if err := manager.UnwatchDir(req.Remote, req.Path); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
