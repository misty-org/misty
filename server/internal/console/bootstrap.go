package console

import (
	"errors"
	"net/http"
	"time"

	db "github.com/kannachi323/misty/server/internal/platform/postgres"
	"github.com/kannachi323/misty/server/internal/platform/security"
)

// mintBootstrapToken issues the single-use token a new self-hosted instance
// needs to create its first administrator, same as `misty-admin
// bootstrap-token`. The token is shown once and only its hash is stored.
func (s *Server) mintBootstrapToken(w http.ResponseWriter, r *http.Request) {
	view := bootstrapView{}
	if s.db == nil {
		view.Err = "Database unavailable."
		render(w, r, bootstrapPanel(view))
		return
	}
	token, err := security.GenerateSecureToken()
	if err != nil {
		view.Err = "Couldn't generate a token."
		render(w, r, bootstrapPanel(view))
		return
	}
	expiresAt := time.Now().UTC().Add(30 * time.Minute)
	switch err := s.db.CreateSelfHostBootstrapToken(r.Context(), security.HashToken(token), expiresAt); {
	case errors.Is(err, db.ErrSelfHostBootstrapInvalid):
		view.Bootstrapped = true
	case err != nil:
		view.Err = "Couldn't store the token: " + err.Error()
	default:
		view.Token = token
		s.audit(r, "Issued bootstrap token", "", "expires "+expiresAt.Format(time.RFC3339))
	}
	render(w, r, bootstrapPanel(view))
}
