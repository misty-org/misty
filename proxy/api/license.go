package api

import (
	"encoding/json"
	"net/http"

	"github.com/kannachi323/misty/proxy/core/auth"
	"github.com/kannachi323/misty/proxy/core/license"
)

// GetLicense reports the cached entitlement for the authenticated user. The
// settings Account section calls this once per render to show plan tier and
// signed-in identity. The handler relies on JWTMiddleware to populate the
// user_id/email context keys; without auth, the route never reaches us.
func GetLicense(lm *license.Manager) http.HandlerFunc {
	type response struct {
		Tier   string `json:"tier"`
		UserID string `json:"user_id"`
		Email  string `json:"email"`
	}

	return func(w http.ResponseWriter, r *http.Request) {
		userID, _ := r.Context().Value(auth.ContextUserID).(string)
		email, _ := r.Context().Value(auth.ContextEmail).(string)

		resp := response{
			Tier:   lm.GetTierForIdentity(userID, email),
			UserID: userID,
			Email:  email,
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}
