package api

import (
	"errors"
	"net/http"
	"strconv"

	db "github.com/kannachi323/misty/server/internal/platform/postgres"
)

// readAccountPreferences answers a refresh. With ?since=<revision> it returns
// 204 and no body when the client already holds that revision, so an idle
// refresh costs a status line instead of the whole settings document.
func (s *AIService) readAccountPreferences(w http.ResponseWriter, r *http.Request, user string) {
	p, err := s.database.AccountPreferences(r.Context(), user)
	if errors.Is(err, db.ErrSettingsProfileNotFound) {
		settingsProfileError(w, http.StatusNotFound, "Settings not initialized")
		return
	}
	if err != nil {
		TestingWriteAIError(w, err)
		return
	}
	if since, parseErr := strconv.ParseInt(r.URL.Query().Get("since"), 10, 64); parseErr == nil && since == p.Revision {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	writeJSON(w, http.StatusOK, p)
}
