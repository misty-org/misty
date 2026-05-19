package remote

import (
	"encoding/json"
	"net/http"

	"github.com/kannachi323/misty/proxy/core/rclone"
)

// ListTypes godoc
// @Summary List supported provider types
// @Tags remotes
// @Produce json
// @Security BearerAuth
// @Success 200 {array} rclone.ProviderType
// @Failure 401 {string} string
// @Router /remote/types [get]
func ListTypes() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(rclone.ListProviderTypes())
	}
}

// ListProviderWorkflows godoc
// @Summary List provider workflows
// @Tags remotes
// @Produce json
// @Security BearerAuth
// @Success 200 {array} rclone.ProviderWorkflow
// @Failure 401 {string} string
// @Failure 502 {object} map[string]any
// @Router /remote/workflows [get]
func ListProviderWorkflows() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		workflows, err := rclone.ListProviderWorkflows(r.Context())
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(workflows)
	}
}

// GetProviderWorkflow godoc
// @Summary Get one provider workflow
// @Tags remotes
// @Produce json
// @Security BearerAuth
// @Param type query string true "Provider type" Enums(drive,onedrive,dropbox)
// @Success 200 {object} rclone.ProviderWorkflow
// @Failure 401 {string} string
// @Failure 404 {object} map[string]any
// @Router /remote/workflow [get]
func GetProviderWorkflow() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		providerType := r.URL.Query().Get("type")
		workflow, err := rclone.GetProviderWorkflow(r.Context(), providerType)
		if err != nil {
			writeError(w, http.StatusNotFound, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(workflow)
	}
}

// ListRemotes godoc
// @Summary List configured remotes
// @Tags remotes
// @Produce json
// @Security BearerAuth
// @Success 200 {array} rclone.RemoteInfo
// @Failure 401 {string} string
// @Failure 502 {object} map[string]any
// @Router /remote [get]
func ListRemotes() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		remotes, err := rclone.ListRemotes(r.Context())
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(remotes)
	}
}

// ListRemoteStatuses godoc
// @Summary List configured remotes with connection status
// @Tags remotes
// @Produce json
// @Security BearerAuth
// @Success 200 {array} rclone.RemoteStatus
// @Failure 401 {string} string
// @Failure 502 {object} map[string]any
// @Router /remote/status [get]
func ListRemoteStatuses() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		statuses, err := rclone.ListRemoteStatuses(r.Context())
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(statuses)
	}
}

// DeleteRemote godoc
// @Summary Delete a configured remote
// @Tags remotes
// @Produce json
// @Security BearerAuth
// @Param name query string true "Remote name"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {string} string
// @Failure 502 {object} map[string]any
// @Router /remote [delete]
func DeleteRemote() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := r.URL.Query().Get("name")
		if name == "" {
			writeError(w, http.StatusBadRequest, errBadRequest("name is required"))
			return
		}
		if err := rclone.DeleteRemote(name); err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
	}
}
