// Just to make sure i can reach my backend at any time XD

package remote

import (
	"encoding/json"
	"net/http"

	"github.com/kannachi323/misty/proxy/core/rclone"
)

// Health reports the runtime status of the external rclone toolchain so the
// client can surface configuration issues without scraping proxy logs.
func Health() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(rclone.Health())
	}
}
