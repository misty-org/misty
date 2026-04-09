package vault

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
)

func (s *Service) ListJobs() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(s.Jobs.List())
	}
}

func (s *Service) GetJob() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		if id == "" {
			http.Error(w, "job id is required", http.StatusBadRequest)
			return
		}
		job, ok := s.Jobs.Get(id)
		if !ok {
			http.Error(w, "job not found", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(job)
	}
}

// StreamJob streams a job's progress events as Server-Sent Events. The client
// keeps a long-lived chunked GET open; each progress emission becomes a
// "progress" event, and a final "state" event is sent when the job ends.
func (s *Service) StreamJob() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		if id == "" {
			http.Error(w, "job id is required", http.StatusBadRequest)
			return
		}
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming not supported", http.StatusInternalServerError)
			return
		}
		ch, unsub, err := s.Jobs.Subscribe(id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		defer unsub()

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.WriteHeader(http.StatusOK)
		flusher.Flush()

		// Send the initial state so the client knows where it's joining from.
		if job, ok := s.Jobs.Get(id); ok {
			payload, _ := json.Marshal(job)
			fmt.Fprintf(w, "event: state\ndata: %s\n\n", payload)
			flusher.Flush()
		}

		for {
			select {
			case <-r.Context().Done():
				return
			case ev, more := <-ch:
				if !more {
					// Channel closed = job finished. Final state event for client.
					if job, ok := s.Jobs.Get(id); ok {
						payload, _ := json.Marshal(job)
						fmt.Fprintf(w, "event: state\ndata: %s\n\n", payload)
						flusher.Flush()
					}
					return
				}
				payload, _ := json.Marshal(ev)
				fmt.Fprintf(w, "event: progress\ndata: %s\n\n", payload)
				flusher.Flush()
			}
		}
	}
}

func (s *Service) CancelJob() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		if id == "" {
			http.Error(w, "job id is required", http.StatusBadRequest)
			return
		}
		if err := s.Jobs.Cancel(id); err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "cancelled"})
	}
}
