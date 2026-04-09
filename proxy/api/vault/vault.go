// Package vault hosts the HTTP handlers that expose misty's restic-backed
// "MVault" backup feature. The handlers are thin — all real work happens in
// proxy/core/restic; vault.Service holds the long-lived job manager and
// implements per-handler request/response plumbing.
package vault

import (
	"net/http"

	"github.com/kannachi323/misty/proxy/core/restic"

	"github.com/kannachi323/misty/proxy/core/jobs"
)

// Service is the long-lived state shared across MVault HTTP handlers.
type Service struct {
	Jobs *jobs.Manager
}

func NewService() *Service {
	return &Service{Jobs: jobs.NewManager()}
}

// lookupRepoByQuery resolves the repo from the "repo" query parameter and
// writes an HTTP error if it can't find it. Returns (repo, true) on success.
func (s *Service) lookupRepoByQuery(w http.ResponseWriter, r *http.Request) (*restic.RepoConfig, bool) {
	name := r.URL.Query().Get("repo")
	if name == "" {
		http.Error(w, "repo query parameter is required", http.StatusBadRequest)
		return nil, false
	}
	return s.lookupRepoByName(name, w)
}

// lookupRepoByName is shared between query-string and body-driven handlers.
func (s *Service) lookupRepoByName(name string, w http.ResponseWriter) (*restic.RepoConfig, bool) {
	repos, err := restic.LoadRegistry()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return nil, false
	}
	for i := range repos {
		if repos[i].Name == name {
			return &repos[i], true
		}
	}
	http.Error(w, "repo not found", http.StatusNotFound)
	return nil, false
}
