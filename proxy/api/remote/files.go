package remote

import (
	"encoding/json"
	"io"
	"net/http"
	"path"

	"github.com/kannachi323/misty/proxy/core/rclone"
)

// DownloadFile godoc
// @Summary Download a file from a configured remote
// @Tags files
// @Produce application/octet-stream
// @Security BearerAuth
// @Param remote query string true "Remote name"
// @Param path query string true "Remote path"
// @Success 200 {file} binary
// @Failure 400 {object} map[string]any
// @Failure 401 {string} string
// @Failure 502 {object} map[string]any
// @Router /remote/file/download [get]
func DownloadFile() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		req := downloadFileRequest{
			Remote: r.URL.Query().Get("remote"),
			Path:   r.URL.Query().Get("path"),
		}
		if req.Remote == "" || req.Path == "" {
			writeError(w, http.StatusBadRequest, errBadRequest("remote and path are required"))
			return
		}

		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Disposition", `attachment; filename="`+rclone.DownloadFileName(req.Path)+`"`)

		_, err := rclone.DownloadFile(r.Context(), req.Remote, req.Path, w)
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
	}
}

// ListFiles godoc
// @Summary List files in a configured remote directory
// @Tags files
// @Produce json
// @Security BearerAuth
// @Param remote query string true "Remote name"
// @Param path query string false "Remote directory path"
// @Success 200 {array} rclone.FileItem
// @Failure 400 {object} map[string]any
// @Failure 401 {string} string
// @Failure 502 {object} map[string]any
// @Router /remote/file/list [get]
func ListFiles() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		req := listFilesRequest{
			Remote: r.URL.Query().Get("remote"),
			Path:   r.URL.Query().Get("path"),
		}
		if req.Remote == "" {
			writeError(w, http.StatusBadRequest, errBadRequest("remote is required"))
			return
		}

		items, err := rclone.ListDir(r.Context(), req.Remote, req.Path)
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(items)
	}
}

// UploadFile godoc
// @Summary Upload a file to a configured remote directory
// @Tags files
// @Accept mpfd
// @Produce json
// @Security BearerAuth
// @Param remote formData string true "Remote name"
// @Param path formData string false "Remote directory path"
// @Param file formData file true "File to upload"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {string} string
// @Failure 502 {object} map[string]any
// @Router /remote/file/upload [post]
func UploadFile() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		req := uploadFileRequest{
			Remote: r.FormValue("remote"),
			Path:   r.FormValue("path"),
		}
		if req.Remote == "" {
			writeError(w, http.StatusBadRequest, errBadRequest("remote is required"))
			return
		}

		file, header, err := r.FormFile("file")
		if err != nil {
			writeError(w, http.StatusBadRequest, errBadRequest("file is required"))
			return
		}
		defer file.Close()

		size := header.Size
		if size < 0 {
			size = 0
		}

		req.FileName = path.Base(header.Filename)
		if err := rclone.UploadFile(r.Context(), req.Remote, req.Path, req.FileName, size, file); err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":   true,
			"name": req.FileName,
		})
	}
}

// DeleteFile godoc
// @Summary Delete a file or directory from a configured remote
// @Tags files
// @Produce json
// @Security BearerAuth
// @Param remote query string true "Remote name"
// @Param path query string true "Remote file or directory path"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {string} string
// @Failure 502 {object} map[string]any
// @Router /remote/file [delete]
func DeleteFile() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		req := deleteFileRequest{
			Remote: r.URL.Query().Get("remote"),
			Path:   r.URL.Query().Get("path"),
		}
		if req.Remote == "" || req.Path == "" {
			writeError(w, http.StatusBadRequest, errBadRequest("remote and path are required"))
			return
		}

		if err := rclone.DeletePath(r.Context(), req.Remote, req.Path); err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
	}
}

// RenameFile godoc
// @Summary Rename or move a file within a configured remote
// @Tags files
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body renameFileRequest true "Rename file request"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {string} string
// @Failure 502 {object} map[string]any
// @Router /remote/file/rename [post]
func RenameFile() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req renameFileRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && err != io.EOF {
			writeError(w, http.StatusBadRequest, errBadRequest("invalid request body"))
			return
		}
		if req.Remote == "" || req.OldPath == "" || req.NewPath == "" {
			writeError(w, http.StatusBadRequest, errBadRequest("remote, old_path, and new_path are required"))
			return
		}

		if err := rclone.RenameFile(r.Context(), req.Remote, req.OldPath, req.NewPath); err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
	}
}
