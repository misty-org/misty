package remote

import (
	"encoding/json"
	"net/http"

	"github.com/kannachi323/misty/proxy/core/rclone"
)

// ConfigStart godoc
// @Summary Start provider config flow
// @Tags remotes
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body providerConfigRequest true "Provider config start request"
// @Success 200 {object} rclone.ProviderStep
// @Failure 400 {object} map[string]any
// @Failure 401 {string} string
// @Failure 502 {object} map[string]any
// @Router /remotes/config/start [post]
func ConfigStart() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req providerConfigRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, errBadRequest("invalid request body"))
			return
		}
		step, err := rclone.StartProviderConfig(r.Context(), req.Name, req.Type, req.Parameters)
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(step)
	}
}

// ConfigContinue godoc
// @Summary Continue provider config flow
// @Tags remotes
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body providerConfigRequest true "Provider config continue request"
// @Success 200 {object} rclone.ProviderStep
// @Failure 400 {object} map[string]any
// @Failure 401 {string} string
// @Failure 502 {object} map[string]any
// @Router /remotes/config/continue [post]
func ConfigContinue() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req providerConfigRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, errBadRequest("invalid request body"))
			return
		}
		step, err := rclone.ContinueProviderConfig(r.Context(), req.Name, req.Type, req.Parameters, req.State, req.Result)
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(step)
	}
}
