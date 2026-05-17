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
// @Router /remotes/health [get]
func Health() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		if err := rclone.Init(); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ready": false,
				"error": err.Error(),
			})
			return
		}
		if err := rclone.StartManagedDaemon(r.Context()); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ready": false,
				"error": err.Error(),
			})
			return
		}

		_ = json.NewEncoder(w).Encode(map[string]any{"ready": true})
	}
}
