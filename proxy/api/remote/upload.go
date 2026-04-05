package remote

import (
	"encoding/json"
	"net/http"

	"github.com/kannachi323/misty/proxy/core/rclone"
)

func UploadFile() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		remoteName := r.URL.Query().Get("remote")
		dirPath := r.URL.Query().Get("path")
		fileName := r.Header.Get("X-File-Name")

		if remoteName == "" || dirPath == "" || fileName == "" {
			http.Error(w, "remote, path query params and X-File-Name header are required", http.StatusBadRequest)
			return
		}

		if !rclone.RemoteExists(remoteName) {
			http.Error(w, "remote not found", http.StatusNotFound)
			return
		}

		defer r.Body.Close()

		err := rclone.UploadFile(r.Context(), remoteName, dirPath, fileName, r.ContentLength, r.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "uploaded"})
	}
}
