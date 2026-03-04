package license

import (
	"net/http"
)

// RequirePro is middleware that blocks access to paid routes if the cached
// license tier is not "pro". Falls back to free if no valid license is cached.
func (m *Manager) RequirePro(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if m.GetTier() != "pro" {
			http.Error(w, "pro subscription required", http.StatusPaymentRequired)
			return
		}
		next.ServeHTTP(w, r)
	})
}
