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
// @Router /remotes/types [get]
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
// @Router /remotes/workflows [get]
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
// @Router /remotes/workflow [get]
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
// @Router /remotes [get]
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
