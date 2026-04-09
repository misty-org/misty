package vault

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/kannachi323/misty/proxy/core/restic"
)

func (s *Service) ListRepos() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		repos, err := restic.LoadRegistry()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(repos)
	}
}

func (s *Service) CreateRepo() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Name     string `json:"name"`
			URL      string `json:"url"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if req.Name == "" || req.URL == "" || req.Password == "" {
			http.Error(w, "name, url, and password are required", http.StatusBadRequest)
			return
		}

		repos, err := restic.LoadRegistry()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		for _, existing := range repos {
			if existing.Name == req.Name {
				http.Error(w, "repo with this name already exists", http.StatusConflict)
				return
			}
		}

		repo := restic.RepoConfig{
			Name:      req.Name,
			URL:       req.URL,
			CreatedAt: time.Now(),
		}
		if err := restic.InitRepo(r.Context(), repo, req.Password); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		repos = append(repos, repo)
		if err := restic.SaveRegistry(repos); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(repo)
	}
}

func (s *Service) DeleteRepo() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := r.URL.Query().Get("name")
		if name == "" {
			http.Error(w, "name query parameter is required", http.StatusBadRequest)
			return
		}
		repos, err := restic.LoadRegistry()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		out := repos[:0]
		found := false
		for _, repo := range repos {
			if repo.Name == name {
				found = true
				continue
			}
			out = append(out, repo)
		}
		if !found {
			http.Error(w, "repo not found", http.StatusNotFound)
			return
		}
		if err := restic.SaveRegistry(out); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		// Best-effort: drop the password from both backends. Restic data
		// in the underlying repo is intentionally left intact (mirrors the
		// "we only forget the registry" copy in the UI confirm dialog).
		restic.DeletePassword(name)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})
	}
}

func (s *Service) RepoStats() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		repo, ok := s.lookupRepoByQuery(w, r)
		if !ok {
			return
		}
		stats, err := restic.RepoStats(r.Context(), *repo)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(stats)
	}
}

func (s *Service) CheckRepo() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		repo, ok := s.lookupRepoByQuery(w, r)
		if !ok {
			return
		}
		if err := restic.CheckRepo(r.Context(), *repo, false); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}
}

func (s *Service) UnlockRepo() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		repo, ok := s.lookupRepoByQuery(w, r)
		if !ok {
			return
		}
		if err := restic.Unlock(r.Context(), *repo); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "unlocked"})
	}
}
