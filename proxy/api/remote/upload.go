package remote

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/kannachi323/misty/proxy/core/rclone"
)

func UploadFile() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		remoteName := r.URL.Query().Get("remote")
		dirPath := r.URL.Query().Get("path")
		fileName := r.Header.Get("X-File-Name")

		if remoteName == "" || dirPath == "" || fileName == "" {
			log.Printf("upload: bad request remote=%q path=%q file=%q", remoteName, dirPath, fileName)
			http.Error(w, "remote, path query params and X-File-Name header are required", http.StatusBadRequest)
			return
		}

		if !rclone.RemoteExists(remoteName) {
			log.Printf("upload: remote %q not found", remoteName)
			http.Error(w, "remote not found", http.StatusNotFound)
			return
		}

		defer r.Body.Close()

		log.Printf("upload: remote=%q dir=%q file=%q size=%d", remoteName, dirPath, fileName, r.ContentLength)

		err := rclone.UploadFile(r.Context(), remoteName, dirPath, fileName, r.ContentLength, r.Body)
		if err != nil {
			log.Printf("upload: rclone failed remote=%q dir=%q file=%q: %v", remoteName, dirPath, fileName, err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		log.Printf("upload: ok remote=%q dir=%q file=%q", remoteName, dirPath, fileName)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "uploaded"})
	}
}
