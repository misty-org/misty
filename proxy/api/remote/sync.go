package remote

import (
	"encoding/json"
	"net/http"

	"github.com/kannachi323/misty/proxy/core/syncindex"
)

func SyncRefetch(service *syncindex.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if service == nil {
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

		resp, err := service.RefetchDirectory(r.Context(), req.Remote, req.Path)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}

func SyncDirty(service *syncindex.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if service == nil {
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

		if err := service.MarkLocalDirty(r.Context(), req.Remote, req.Path,
			req.LocalExists, req.IsDir, req.MTime, req.Size); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

// SyncRunNow triggers an out-of-band refetch + reconcile pass without waiting
// for the 30s poll ticker. The body is optional; when a "remote" is provided,
// only that root is processed, which keeps latency low when the user hits
// Refresh while browsing a specific cloud. Response reports how much work was
// done so the UI can decide whether a toast/banner is warranted.
func SyncRunNow(poller *syncindex.Poller) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if poller == nil {
			http.Error(w, "sync service unavailable", http.StatusServiceUnavailable)
			return
		}

		var req struct {
			Remote string `json:"remote"`
		}
		// Empty body is fine — treat as "refresh everything".
		if r.Body != nil && r.ContentLength != 0 {
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "invalid request body", http.StatusBadRequest)
				return
			}
		}

		refetched, dirty, err := poller.RunNow(r.Context(), req.Remote)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		resp := struct {
			Refetched int `json:"refetched_dirs"`
			Dirty     int `json:"dirty_entries"`
		}{refetched, dirty}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
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
