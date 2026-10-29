package api

import (
	"errors"
	"net/http"
)

var (
	errAIDisabled       = errors.New("AI is turned off for this account")
	errVoiceUnavailable = errors.New("voice is unavailable on this server")
)

// writeModelError answers the errors any AI request can end with before a
// model runs. It reports false for every other error.
func writeModelError(w http.ResponseWriter, err error) bool {
	switch {
	case errors.Is(err, errAIDisabled):
		writeJSON(w, http.StatusForbidden, map[string]string{"code": "ai_disabled", "message": "AI is turned off for this account."})
	case errors.Is(err, errVoiceUnavailable):
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"code": "voice_unavailable", "message": "Voice isn't available on this server."})
	default:
		return false
	}
	return true
}
