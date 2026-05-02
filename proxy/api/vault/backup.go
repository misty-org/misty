package vault

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/kannachi323/misty/proxy/core/restic"
	jobutil "github.com/kannachi323/misty/proxy/core/utils"
)

func (s *Service) StartBackup() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Repo     string   `json:"repo"`
			Paths    []string `json:"paths"`
			Tags     []string `json:"tags,omitempty"`
			Excludes []string `json:"excludes,omitempty"`
			Hostname string   `json:"hostname,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if req.Repo == "" || len(req.Paths) == 0 {
			http.Error(w, "repo and paths are required", http.StatusBadRequest)
			return
		}
		repo, ok := s.lookupRepoByName(req.Repo, w)
		if !ok {
			return
		}

		opts := restic.BackupOpts{
			Tags:     req.Tags,
			Excludes: req.Excludes,
			Hostname: req.Hostname,
		}
		repoCopy := *repo
		job := s.Jobs.Start("backup", req.Repo, func(ctx context.Context, emit func(jobutil.Event)) error {
			_, err := restic.Backup(ctx, repoCopy, req.Paths, opts, func(e restic.ProgressEvent) {
				emit(jobutil.Event{Payload: e})
			})
			return err
		})

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		json.NewEncoder(w).Encode(map[string]string{"job_id": job.ID})
	}
}

func (s *Service) StartRestore() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Repo       string `json:"repo"`
			SnapshotID string `json:"snapshot_id"`
			Target     string `json:"target"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if req.Repo == "" || req.SnapshotID == "" || req.Target == "" {
			http.Error(w, "repo, snapshot_id, and target are required", http.StatusBadRequest)
			return
		}
		repo, ok := s.lookupRepoByName(req.Repo, w)
		if !ok {
			return
		}
		repoCopy := *repo
		job := s.Jobs.Start("restore", req.Repo, func(ctx context.Context, emit func(jobutil.Event)) error {
			return restic.Restore(ctx, repoCopy, req.SnapshotID, req.Target, func(e restic.ProgressEvent) {
				emit(jobutil.Event{Payload: e})
			})
		})
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		json.NewEncoder(w).Encode(map[string]string{"job_id": job.ID})
	}
}

func (s *Service) StartForget() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Repo   string                 `json:"repo"`
			Policy restic.RetentionPolicy `json:"policy"`
			Prune  bool                   `json:"prune"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if req.Repo == "" {
			http.Error(w, "repo is required", http.StatusBadRequest)
			return
		}
		repo, ok := s.lookupRepoByName(req.Repo, w)
		if !ok {
			return
		}
		repoCopy := *repo
		job := s.Jobs.Start("forget", req.Repo, func(ctx context.Context, emit func(jobutil.Event)) error {
			return restic.Forget(ctx, repoCopy, req.Policy, req.Prune)
		})
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		json.NewEncoder(w).Encode(map[string]string{"job_id": job.ID})
	}
}
