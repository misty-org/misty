package license

import (
	"net/http"

	"github.com/kannachi323/misty/proxy/core/auth"
	"github.com/kannachi323/misty/proxy/core/rclone"
)

func hasPaidTier(tier string) bool {
	return tier == "pro" || tier == "max"
}

func (m *Manager) tierForRequest(r *http.Request, userID, email string) string {
	if headerToken := r.Header.Get("X-License-Token"); headerToken != "" {
		if claims, err := m.validateToken(headerToken); err == nil && identityMatches(claims, userID, email) {
			return claims.Tier
		}
	}

	return m.GetTierForIdentity(userID, email)
}

// RequirePro is middleware that blocks access to paid routes if the license
// tier is not paid. Validates the X-License-Token header sent by the client
// first; falls back to the locally cached license if the header is absent.
func (m *Manager) RequirePro(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID, _ := r.Context().Value(auth.ContextUserID).(string)
		email, _ := r.Context().Value(auth.ContextEmail).(string)

		if !hasPaidTier(m.tierForRequest(r, userID, email)) {
			http.Error(w, "pro subscription required", http.StatusPaymentRequired)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequireRemoteQuota allows paid users unlimited remotes and caps free users
// at maxFree connected remotes.
func (m *Manager) RequireRemoteQuota(maxFree int, countRemotes func() int) func(http.Handler) http.Handler {
	if countRemotes == nil {
		countRemotes = func() int { return len(rclone.ListRemotes()) }
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userID, _ := r.Context().Value(auth.ContextUserID).(string)
			email, _ := r.Context().Value(auth.ContextEmail).(string)

			if hasPaidTier(m.tierForRequest(r, userID, email)) {
				next.ServeHTTP(w, r)
				return
			}

			if countRemotes() >= maxFree {
				http.Error(w, "free tier is limited to 3 connected remotes", http.StatusPaymentRequired)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
