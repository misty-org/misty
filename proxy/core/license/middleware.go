package license

import (
	"net/http"

	"github.com/kannachi323/misty/proxy/core/auth"
)

// RequirePro is middleware that blocks access to paid routes if the license
// tier is not "pro". Validates the X-License-Token header sent by the client
// first; falls back to the locally cached license if the header is absent.
func (m *Manager) RequirePro(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID, _ := r.Context().Value(auth.ContextUserID).(string)
		email, _ := r.Context().Value(auth.ContextEmail).(string)

		if headerToken := r.Header.Get("X-License-Token"); headerToken != "" {
			if claims, err := m.validateToken(headerToken); err == nil &&
				claims.Tier == "pro" &&
				identityMatches(claims, userID, email) {
				next.ServeHTTP(w, r)
				return
			}
		}
		// Fall back to the locally cached license (e.g. older clients).
		if m.GetTierForIdentity(userID, email) != "pro" {
			http.Error(w, "pro subscription required", http.StatusPaymentRequired)
			return
		}
		next.ServeHTTP(w, r)
	})
}
