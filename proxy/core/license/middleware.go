package license

import (
	"net/http"
)

// RequirePro is middleware that blocks access to paid routes if the license
// tier is not "pro". Validates the X-License-Token header sent by the client
// first; falls back to the locally cached license if the header is absent.
func (m *Manager) RequirePro(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if headerToken := r.Header.Get("X-License-Token"); headerToken != "" {
			if claims, err := m.validateToken(headerToken); err == nil && claims.Tier == "pro" {
				next.ServeHTTP(w, r)
				return
			}
		}
		// Fall back to the locally cached license (e.g. older clients).
		if m.GetTier() != "pro" {
			http.Error(w, "pro subscription required", http.StatusPaymentRequired)
			return
		}
		next.ServeHTTP(w, r)
	})
}
