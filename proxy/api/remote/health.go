package remote

import (
	"encoding/json"
	"net/http"

	"github.com/kannachi323/misty/proxy/core/rclone"
)

// Health godoc
// @Summary Check rclone remote subsystem health
// @Tags remotes
// @Produce json
// @Success 200 {object} map[string]any
// @Failure 503 {object} map[string]any
// @Router /remote/health [get]
func Health() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		status := rclone.GetHealthStatus(r.Context())
		if !status.Ready {
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(status)
			return
		}
		_ = json.NewEncoder(w).Encode(status)
	}
}
