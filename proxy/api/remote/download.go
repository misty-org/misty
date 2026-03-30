package remote

import (
	"fmt"
	"net/http"
	"path"

	"github.com/kannachi323/misty/proxy/core/rclone"
)

func DownloadFile() http.HandlerFunc {
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

		fileName := path.Base(filePath)
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, fileName))
		w.Header().Set("Content-Type", "application/octet-stream")

		written, err := rclone.DownloadFile(r.Context(), remoteName, filePath, w)
		if err != nil {
			// Only send error if we haven't started writing the body yet
			if written == 0 {
				http.Error(w, err.Error(), http.StatusInternalServerError)
			}
			return
		}
	}
}
