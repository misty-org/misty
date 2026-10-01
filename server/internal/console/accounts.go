package console

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"

	"github.com/a-h/templ"
	"github.com/go-chi/chi/v5"

	db "github.com/kannachi323/misty/server/internal/platform/postgres"
)

type accountsView struct {
	Config   Config
	Search   string
	Accounts []db.ConsoleAccount
	Selected string
	Detail   *accountDetailView
	Err      string
}

type accountDetailView struct {
	Config  Config
	Account db.ConsoleAccountDetail
	Flash   string
	Err     string
}

func (v accountDetailView) actionPath(action string) string {
	return "/accounts/" + v.Account.ID + "/" + action
}

func accountStatus(a db.ConsoleAccount) string {
	switch {
	case a.Disabled:
		return "disabled"
	case a.State != "active":
		return a.State
	default:
		return "active"
	}
}

func (s *Server) accountsPage(r *http.Request) templ.Component {
	if s.db == nil {
		return databaseUnavailable("Accounts")
	}
	view := accountsView{
		Config:   s.cfg,
		Search:   strings.TrimSpace(r.URL.Query().Get("q")),
		Selected: r.URL.Query().Get("id"),
	}
	accounts, err := s.db.ConsoleListAccounts(r.Context(), view.Search, 100)
	if err != nil {
		view.Err = "Couldn't load accounts: " + err.Error()
		return accountsPage(view)
	}
	view.Accounts = accounts
	if view.Selected == "" && len(accounts) > 0 {
		view.Selected = accounts[0].ID
	}
	if view.Selected != "" {
		detail := s.loadAccountDetail(r.Context(), view.Selected)
		view.Detail = &detail
	}
	return accountsPage(view)
}

func (s *Server) loadAccountDetail(ctx context.Context, userID string) accountDetailView {
	view := accountDetailView{Config: s.cfg}
	detail, err := s.db.ConsoleAccountDetail(ctx, userID)
	if errors.Is(err, sql.ErrNoRows) {
		view.Err = "That account no longer exists."
	} else if err != nil {
		view.Err = "Couldn't load the account: " + err.Error()
	}
	view.Account = detail
	return view
}

// renderAccountAction re-renders the detail panel after an action with a
// confirmation or the error that stopped it.
func (s *Server) renderAccountAction(w http.ResponseWriter, r *http.Request, flash string, actionErr error) {
	view := s.loadAccountDetail(r.Context(), chi.URLParam(r, "id"))
	if actionErr != nil {
		view.Err = actionErr.Error()
	} else {
		view.Flash = flash
	}
	render(w, r, accountDetail(view))
}

func (s *Server) accountEmail(r *http.Request) (string, error) {
	if s.db == nil {
		return "", errors.New("database unavailable")
	}
	detail, err := s.db.ConsoleAccountDetail(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		return "", errors.New("account not found")
	}
	return detail.Email, nil
}

func (s *Server) revokeSessions(w http.ResponseWriter, r *http.Request) {
	email, err := s.accountEmail(r)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	revoked, err := s.db.ConsoleRevokeSessions(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		s.renderAccountAction(w, r, "", errors.New("Couldn't revoke sessions: "+err.Error()))
		return
	}
	s.audit(r, "Revoked sessions for", email, plural(int(revoked), "session", "sessions"))
	s.renderAccountAction(w, r, "Signed out of "+plural(int(revoked), "session", "sessions"), nil)
}

func (s *Server) setDisabled(disabled bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		email, err := s.accountEmail(r)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		if err := s.db.ConsoleSetSelfHostDisabled(r.Context(), chi.URLParam(r, "id"), disabled); err != nil {
			s.renderAccountAction(w, r, "", errors.New("Couldn't update the account: "+err.Error()))
			return
		}
		action, flash := "Enabled account", "Account enabled"
		if disabled {
			action, flash = "Disabled account", "Account disabled and signed out everywhere"
		}
		s.audit(r, action, email, "")
		s.renderAccountAction(w, r, flash, nil)
	}
}

func (s *Server) resetPassword(w http.ResponseWriter, r *http.Request) {
	email, err := s.accountEmail(r)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	password := r.PostFormValue("password")
	if len(password) < 8 {
		s.renderAccountAction(w, r, "", errors.New("Passwords need at least 8 characters."))
		return
	}
	if err := s.db.ResetSelfHostPassword(r.Context(), email, password); err != nil {
		s.renderAccountAction(w, r, "", errors.New("Couldn't reset the password: "+err.Error()))
		return
	}
	s.audit(r, "Reset password for", email, "sessions revoked")
	s.renderAccountAction(w, r, "Password reset; existing sessions were signed out", nil)
}

type bootstrapView struct {
	Bootstrapped bool
	Token        string
	Err          string
}

func (s *Server) bootstrapPage(r *http.Request) templ.Component {
	if s.db == nil {
		return databaseUnavailable("Bootstrap")
	}
	view := bootstrapView{}
	bootstrapped, err := s.db.ConsoleInstanceBootstrapped(r.Context())
	if err != nil {
		view.Err = "Couldn't read bootstrap state: " + err.Error()
	}
	view.Bootstrapped = bootstrapped
	return bootstrapPage(view)
}
