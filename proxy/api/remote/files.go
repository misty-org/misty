package remote

import (
	"encoding/json"
	"net/http"

	"github.com/kannachi323/misty/proxy/core/rclone"
)

func ListFiles() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		remoteName := r.URL.Query().Get("remote")
		dirPath := r.URL.Query().Get("path")

		if remoteName == "" {
			http.Error(w, "remote query parameter is required", http.StatusBadRequest)
			return
		}

		if !rclone.RemoteExists(remoteName) {
			http.Error(w, "remote not found", http.StatusNotFound)
			return
		}

		items, err := rclone.ListDir(r.Context(), remoteName, dirPath)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		resp := rclone.ListResponse{
			Items:  items,
			Remote: remoteName,
			Path:   dirPath,
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}
}
