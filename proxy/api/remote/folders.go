package remote

import (
	"encoding/json"
	"log"
	"net/http"
	"path"
	"path/filepath"

	"github.com/kannachi323/misty/proxy/core/rclone"
)

type folderDownloadRequest struct {
	Remote    string `json:"remote"`
	Path      string `json:"path"`
	LocalPath string `json:"local_path"`
}

type folderUploadRequest struct {
	Remote    string `json:"remote"`
	Path      string `json:"path"`
	LocalPath string `json:"local_path"`
}

type folderTransferRequest struct {
	SourceRemote string `json:"source_remote"`
	SourcePath   string `json:"source_path"`
	DestRemote   string `json:"dest_remote"`
	DestPath     string `json:"dest_path"`
}

func DownloadFolder() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req folderDownloadRequest
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

		localPath := req.LocalPath
		if localPath == "" {
			stagingRoot, err := rclone.NewMistyTmpDir("folder-download-")
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			localPath = filepath.Join(stagingRoot, path.Base(path.Clean(req.Path)))
		} else if ok, err := rclone.IsMistyTmpPath(localPath); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		} else if !ok {
			http.Error(w, "local_path must be inside ~/misty/tmp", http.StatusBadRequest)
			return
		}

		log.Printf("folder download: remote=%q path=%q local=%q", req.Remote, req.Path, localPath)
		if err := rclone.DownloadFolder(r.Context(), req.Remote, req.Path, localPath); err != nil {
			log.Printf("folder download: failed remote=%q path=%q local=%q: %v", req.Remote, req.Path, localPath, err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "downloaded", "local_path": localPath})
	}
}

func UploadFolder() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req folderUploadRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if req.Remote == "" || req.Path == "" || req.LocalPath == "" {
			http.Error(w, "remote, path, and local_path are required", http.StatusBadRequest)
			return
		}
		if !rclone.RemoteExists(req.Remote) {
			http.Error(w, "remote not found", http.StatusNotFound)
			return
		}
		if ok, err := rclone.IsMistyTmpPath(req.LocalPath); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		} else if !ok {
			http.Error(w, "local_path must be inside ~/misty/tmp", http.StatusBadRequest)
			return
		}

		log.Printf("folder upload: remote=%q path=%q local=%q", req.Remote, req.Path, req.LocalPath)
		if err := rclone.UploadFolder(r.Context(), req.Remote, req.Path, req.LocalPath); err != nil {
			log.Printf("folder upload: failed remote=%q path=%q local=%q: %v", req.Remote, req.Path, req.LocalPath, err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "uploaded"})
	}
}

func TransferFolder() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req folderTransferRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if req.SourceRemote == "" || req.SourcePath == "" || req.DestRemote == "" || req.DestPath == "" {
			http.Error(w, "source_remote, source_path, dest_remote, and dest_path are required", http.StatusBadRequest)
			return
		}
		if !rclone.RemoteExists(req.SourceRemote) || !rclone.RemoteExists(req.DestRemote) {
			http.Error(w, "remote not found", http.StatusNotFound)
			return
		}

		log.Printf("folder transfer: source=%q:%q dest=%q:%q", req.SourceRemote, req.SourcePath, req.DestRemote, req.DestPath)
		if err := rclone.TransferFolder(r.Context(), req.SourceRemote, req.SourcePath, req.DestRemote, req.DestPath); err != nil {
			log.Printf("folder transfer: failed source=%q:%q dest=%q:%q: %v", req.SourceRemote, req.SourcePath, req.DestRemote, req.DestPath, err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "transferred"})
	}
}
