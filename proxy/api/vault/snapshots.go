package vault

import (
	"encoding/json"
	"net/http"

	"github.com/kannachi323/misty/proxy/core/restic"
)

func (s *Service) ListSnapshots() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		repo, ok := s.lookupRepoByQuery(w, r)
		if !ok {
			return
		}
		snaps, err := restic.Snapshots(r.Context(), *repo)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(snaps)
	}
}

func (s *Service) BrowseSnapshot() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		repo, ok := s.lookupRepoByQuery(w, r)
		if !ok {
			return
		}
		snapshotID := r.URL.Query().Get("snapshot")
		if snapshotID == "" {
			http.Error(w, "snapshot query parameter is required", http.StatusBadRequest)
			return
		}
		path := r.URL.Query().Get("path")
		nodes, err := restic.Ls(r.Context(), *repo, snapshotID, path)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(nodes)
	}
}
