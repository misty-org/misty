package remote

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/kannachi323/misty/proxy/core/rclone"
)

func MkDir() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Remote string `json:"remote"`
			Path   string `json:"path"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if req.Remote == "" || req.Path == "" {
			http.Error(w, "remote and path are required", http.StatusBadRequest)
			return
		}

		if !rclone.RemoteExists(req.Remote) {
			http.Error(w, "remote not found", http.StatusNotFound)
			return
		}

		if err := rclone.MkDir(r.Context(), req.Remote, req.Path); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "created"})
	}
}

func DeleteFile() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		remoteName := r.URL.Query().Get("remote")
		filePath := r.URL.Query().Get("path")

		if remoteName == "" || filePath == "" {
			http.Error(w, "remote and path query parameters are required", http.StatusBadRequest)
			return
		}

		if !rclone.RemoteExists(remoteName) {
			http.Error(w, "remote not found", http.StatusNotFound)
			return
		}

		if err := rclone.DeletePath(r.Context(), remoteName, filePath); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})
	}
}

func Search() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		remoteName := r.URL.Query().Get("remote")
		query := r.URL.Query().Get("q")
		basePath := r.URL.Query().Get("path")
		maxStr := r.URL.Query().Get("max")

		if remoteName == "" || query == "" {
			http.Error(w, "remote and q query parameters are required", http.StatusBadRequest)
			return
		}

		if !rclone.RemoteExists(remoteName) {
			http.Error(w, "remote not found", http.StatusNotFound)
			return
		}

		maxResults := 50
		if maxStr != "" {
			if n, err := strconv.Atoi(maxStr); err == nil && n > 0 {
				maxResults = n
			}
		}

		items, err := rclone.Search(r.Context(), remoteName, basePath, query, maxResults)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		resp := rclone.ListResponse{
			Items:  items,
			Remote: remoteName,
			Path:   basePath,
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}
}

func AboutRemote() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		remoteName := r.URL.Query().Get("remote")
		if remoteName == "" {
			http.Error(w, "remote query parameter is required", http.StatusBadRequest)
			return
		}

		if !rclone.RemoteExists(remoteName) {
			http.Error(w, "remote not found", http.StatusNotFound)
			return
		}

		info, err := rclone.About(r.Context(), remoteName)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(info)
	}
}
