package remote

import (
	"encoding/json"
	"net/http"
)

type remoteError struct {
	Message string
}

func (e *remoteError) Error() string { return e.Message }

func writeError(w http.ResponseWriter, status int, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": err.Error(),
	})
}

func errBadRequest(message string) error {
	return &remoteError{Message: message}
}
