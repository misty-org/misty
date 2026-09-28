package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	envconfig "github.com/kannachi323/misty/server/internal/platform/config"
	db "github.com/kannachi323/misty/server/internal/platform/postgres"
)

// RecallConfig is Memory on the server. It is off unless MISTY_RECALL=true.
// The backlog cap bounds how much may wait for an embedding per person.
type RecallConfig struct {
	Enabled    bool
	BacklogCap int
}

func recallConfig() RecallConfig {
	limit := 2000
	if parsed, err := strconv.Atoi(strings.TrimSpace(envconfig.Getenv("MISTY_RECALL_BACKLOG_CAP"))); err == nil && parsed > 0 && parsed <= 100_000 {
		limit = parsed
	}
	return RecallConfig{Enabled: strings.EqualFold(strings.TrimSpace(envconfig.Getenv("MISTY_RECALL")), "true"), BacklogCap: limit}
}

const memoryBacklogMessage = "Memory is catching up, so new pages aren't being kept for now. It continues on its own once it has caught up."

func (s *SpacesService) memoryUser(w http.ResponseWriter, r *http.Request) (string, bool) {
	if !recallConfig().Enabled {
		writeJSON(w, http.StatusNotFound, map[string]string{"code": "memory_unavailable", "message": "Memory isn't available yet."})
		return "", false
	}
	return s.appsUser(w, r)
}

// MemoryEvents records one event from the person's own device (POST) or
// lists and searches their events (GET ?from&to&site&kind&q&limit).
func (s *SpacesService) MemoryEvents() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := s.memoryUser(w, r)
		if !ok {
			return
		}
		if r.Method == http.MethodGet {
			query, valid := memoryQueryFrom(r)
			if !valid {
				writeJSON(w, http.StatusBadRequest, map[string]string{"code": "invalid_memory_query"})
				return
			}
			events, err := s.database.MemoryEvents(r.Context(), user, query)
			if err != nil {
				writeAgentError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"events": events})
			return
		}
		var event db.MemoryEvent
		r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
		if decodeAIJSON(w, r, &event) != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"code": "invalid_memory_event"})
			return
		}
		event.ID = uuid.NewString()
		if event.OccurredAt.IsZero() || event.OccurredAt.After(time.Now().Add(5*time.Minute)) {
			event.OccurredAt = time.Now()
		}
		saved, err := s.database.RecordMemoryEvent(r.Context(), user, event, recallConfig().BacklogCap)
		switch {
		case errors.Is(err, db.ErrMemoryBacklogFull):
			writeJSON(w, http.StatusTooManyRequests, map[string]string{"code": "memory_backlog_full", "message": memoryBacklogMessage})
		case errors.Is(err, db.ErrSpaceInvalid):
			writeJSON(w, http.StatusBadRequest, map[string]string{"code": "invalid_memory_event"})
		case err != nil:
			writeAgentError(w, err)
		default:
			writeJSON(w, http.StatusCreated, map[string]string{"id": saved.ID, "same_as": saved.SameAs})
		}
	}
}

func memoryQueryFrom(r *http.Request) (db.MemoryQuery, bool) {
	values := r.URL.Query()
	query := db.MemoryQuery{Site: values.Get("site"), Kind: values.Get("kind"), Text: values.Get("q")}
	for key, target := range map[string]*time.Time{"from": &query.From, "to": &query.To} {
		if raw := values.Get(key); raw != "" {
			parsed, err := time.Parse(time.RFC3339, raw)
			if err != nil {
				return query, false
			}
			*target = parsed
		}
	}
	query.Limit, _ = strconv.Atoi(values.Get("limit"))
	return query, len(query.Text) <= 500 && len(query.Site) <= 255
}

// MemoryForget deletes everything, one site, or a time range.
// POST {all} | {site} | {from, to}.
func (s *SpacesService) MemoryForget() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := s.memoryUser(w, r)
		if !ok {
			return
		}
		var body struct {
			All  bool      `json:"all"`
			Site string    `json:"site"`
			From time.Time `json:"from"`
			To   time.Time `json:"to"`
		}
		r.Body = http.MaxBytesReader(w, r.Body, 4096)
		if decodeAIJSON(w, r, &body) != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"code": "invalid_forget"})
			return
		}
		n, err := s.database.ForgetMemory(r.Context(), user, db.MemoryForget{All: body.All, Site: body.Site, From: body.From, To: body.To})
		if errors.Is(err, db.ErrSpaceInvalid) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"code": "invalid_forget", "message": "Choose what to forget: everything, a site, or a time range."})
			return
		}
		if err != nil {
			writeAgentError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]int64{"forgotten": n})
	}
}

// MemoryStatus says whether Memory is keeping up.
func (s *SpacesService) MemoryStatus() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := s.memoryUser(w, r)
		if !ok {
			return
		}
		waiting, err := s.database.MemoryBacklogCount(r.Context(), user)
		if err != nil {
			writeAgentError(w, err)
			return
		}
		limit := recallConfig().BacklogCap
		status := map[string]any{"waiting": waiting, "cap": limit, "full": waiting >= limit}
		if waiting >= limit {
			status["message"] = memoryBacklogMessage
		}
		writeJSON(w, http.StatusOK, status)
	}
}
