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
