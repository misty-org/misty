// one simple auth middleware that validates JWT tokens using a secret key
// requires a revokedTokenStore to check for revoked tokens
// currently, the local database has the interface for storing revoked tokens
//
//
// Matthew Chen (kannachi323)

package auth

import (
	"context"
	"net/http"
	"strings"
	"time"

	tokens "github.com/kannachi323/misty/proxy/core/tokens"
)

type contextKey string

const (
	ContextUserID contextKey = "user_id"
	ContextEmail  contextKey = "email"
)

type revokedTokenStore interface {
	IsAccessTokenRevoked(tokenID string) (bool, error)
	GetUserTokenValidAfter(userID string) (*time.Time, error)
	GetCurrentUserID() (string, error)
}

func JWTMiddleware(store revokedTokenStore) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			header := r.Header.Get("Authorization")
			if header == "" || !strings.HasPrefix(header, "Bearer ") {
				http.Error(w, "Missing or invalid Authorization header", http.StatusUnauthorized)
				return
			}

			tokenString := strings.TrimPrefix(header, "Bearer ")

			claims, err := tokens.ValidateToken(tokenString)
			if err != nil {
				http.Error(w, "Invalid or expired token", http.StatusUnauthorized)
				return
			}

			if store != nil {
				currentUserID, err := store.GetCurrentUserID()
				if err != nil {
					http.Error(w, "Failed to validate token state", http.StatusInternalServerError)
					return
				}
				if currentUserID == "" || currentUserID != claims.UserID {
					http.Error(w, "Token does not match current local user", http.StatusUnauthorized)
					return
				}

				revoked, err := store.IsAccessTokenRevoked(claims.ID)
				if err != nil {
					http.Error(w, "Failed to validate token state", http.StatusInternalServerError)
					return
				}
				if revoked {
					http.Error(w, "Token has been revoked", http.StatusUnauthorized)
					return
				}

				tokenValidAfter, err := store.GetUserTokenValidAfter(claims.UserID)
				if err != nil {
					http.Error(w, "Failed to validate token state", http.StatusInternalServerError)
					return
				}
				if tokenValidAfter != nil && claims.IssuedAt != nil && claims.IssuedAt.Time.Before(*tokenValidAfter) {
					http.Error(w, "Token is no longer valid", http.StatusUnauthorized)
					return
				}
			}

			ctx := context.WithValue(r.Context(), ContextUserID, claims.UserID)
			ctx = context.WithValue(ctx, ContextEmail, claims.Email)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
