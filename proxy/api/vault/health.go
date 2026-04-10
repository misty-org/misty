package vault

import (
	"encoding/json"
	"net/http"

	"github.com/kannachi323/misty/proxy/core/restic"
)

// Health reports the runtime status of the restic toolchain so the C++
// settings panel can show "vault ready / not ready" without having to scrape
// proxy startup logs. Always returns 200 with a status object — failure modes
// are encoded in the body, not the HTTP code, because "restic missing" is a
// configuration condition the UI surfaces, not a request-level error.
func (s *Service) Health() http.HandlerFunc {
	type response struct {
		Ready          bool   `json:"ready"`
		ResticPath     string `json:"restic_path"`
		ResticVersion  string `json:"restic_version"`
		MinResticVersion string `json:"min_restic_version"`
		HelperPath     string `json:"helper_path"`
		HelperPresent  bool   `json:"helper_present"`
		RegistryDir    string `json:"registry_dir"`
		Error          string `json:"error,omitempty"`
	}

	return func(w http.ResponseWriter, r *http.Request) {
		// Init is idempotent — calling it here means a vault Health check
		// will surface a freshly-fixed install without requiring a proxy
		// restart, even though the result of the *first* successful Init is
		// cached.
		err := restic.Init()
		helper := restic.HelperBinaryPath()

		resp := response{
			Ready:            err == nil,
			ResticPath:       restic.BinaryPath(),
			ResticVersion:    restic.Version(),
			MinResticVersion: restic.MinResticVersion,
			HelperPath:       helper,
			HelperPresent:    helper != "",
			RegistryDir:      restic.RegistryDir(),
		}
		if err != nil {
			resp.Error = err.Error()
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}
