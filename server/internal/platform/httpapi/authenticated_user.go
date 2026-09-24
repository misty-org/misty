package api

import (
	"errors"
	db "github.com/kannachi323/misty/server/internal/platform/postgres"
	"net/http"
)

func authenticatedUser(w http.ResponseWriter, r *http.Request, database *db.Database) (string, bool) {
	userID, err := sessionUserID(r, database)
	if err != nil {
		if errors.Is(err, db.ErrAppRuntimeForbidden) {
			writeJSON(w, http.StatusForbidden, map[string]string{"code": "app_scope_forbidden"})
			return "", false
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"code": "internal_error"})
		return "", false
	}
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"code": "not_authenticated"})
		return "", false
	}
	return userID, true
}
