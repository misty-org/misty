package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/kannachi323/misty/server/agent"
	"github.com/kannachi323/misty/server/db"
)

const maxAIJSONBodyBytes = 2 << 20

type AIService struct {
	database *db.Database
	runtime  *agent.Service
	guard    *AIRequestGuard
}

func NewAIService(database *db.Database, runtime *agent.Service) *AIService {
	return &AIService{database: database, runtime: runtime, guard: NewAIRequestGuard()}
}

func (s *AIService) Status() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		tier, err := s.mikaTierForUser(userID)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"configured": s.runtime.MikaConfigured(tier),
			"provider":   "misty",
			"model":      string(tier),
			"model_name": tier.DisplayName(),
			"running":    false,
			"session_id": nil,
			"error":      nil,
		})
	}
}

func (s *AIService) CreateSession() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		if allowed, retryAfter := s.guard.AllowSession(userID); !allowed {
			writeAIRateLimit(w, retryAfter)
			return
		}
		session := s.runtime.CreateSession(userID)
		writeJSON(w, http.StatusCreated, map[string]any{
			"session_id": session.ID,
		})
	}
}

func (s *AIService) Complete() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		var body struct {
			Prompt string `json:"prompt"`
		}
		if err := decodeAIJSON(w, r, &body); err != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		release, ok := s.acquireProviderCall(w, userID)
		if !ok {
			return
		}
		defer release()
		tier, err := s.mikaTierForUser(userID)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		text, usage, err := s.runtime.CompleteWithTierContext(r.Context(), userID, body.Prompt, db.CreditMeterAutomationAI, tier)
		if err != nil {
			writeAIError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"text": text, "model": string(tier), "credits_used": usage.CreditsUsed, "credits_remaining": usage.CreditsRemaining})
	}
}

func (s *AIService) SendMessage() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		sessionID := strings.TrimSpace(chi.URLParam(r, "sessionID"))
		var body agent.AgentMessageRequest
		if err := decodeAIJSON(w, r, &body); err != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		release, ok := s.acquireProviderCall(w, userID)
		if !ok {
			return
		}
		defer release()
		tier, err := s.mikaTierForUser(userID)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if err := s.runtime.SendMessageWithTierContext(r.Context(), sessionID, userID, body, tier); err != nil {
			writeAIError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}
}

func (s *AIService) Events() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		sessionID := strings.TrimSpace(chi.URLParam(r, "sessionID"))
		after, _ := strconv.ParseInt(strings.TrimSpace(r.URL.Query().Get("after")), 10, 64)
		events, err := s.runtime.Events(sessionID, userID, after)
		if err != nil {
			writeAIError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"events": events})
	}
}

func (s *AIService) SubmitToolResults() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		sessionID := strings.TrimSpace(chi.URLParam(r, "sessionID"))
		var body struct {
			Results []agent.ToolResult `json:"results"`
		}
		if err := decodeAIJSON(w, r, &body); err != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		release, ok := s.acquireProviderCall(w, userID)
		if !ok {
			return
		}
		defer release()
		tier, err := s.mikaTierForUser(userID)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if err := s.runtime.SubmitToolResultsWithTierContext(r.Context(), sessionID, userID, body.Results, tier); err != nil {
			writeAIError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}
}

func (s *AIService) acquireProviderCall(w http.ResponseWriter, userID string) (func(), bool) {
	release, retryAfter, allowed := s.guard.AcquireProviderCall(userID)
	if !allowed {
		writeAIRateLimit(w, retryAfter)
		return nil, false
	}
	return release, true
}

func writeAIRateLimit(w http.ResponseWriter, retryAfter time.Duration) {
	seconds := retryAfterSeconds(retryAfter)
	w.Header().Set("Retry-After", strconv.Itoa(seconds))
	writeJSON(w, http.StatusTooManyRequests, map[string]any{
		"code": "rate_limited", "message": "Mika request limit reached. Try again later.",
		"retry_after_seconds": seconds,
	})
}

func (s *AIService) mikaTierForUser(userID string) (agent.MikaTier, error) {
	license, err := s.database.GetLicenseByUserID(userID)
	if err != nil {
		return agent.MikaLow, err
	}
	if license == nil {
		return agent.MikaLow, nil
	}
	return mikaTierForLicenseTier(license.Tier), nil
}

func mikaTierForLicenseTier(tier db.Tier) agent.MikaTier {
	switch tier {
	case db.TierMax:
		return agent.MikaHigh
	case db.TierPro:
		return agent.MikaMed
	default:
		return agent.MikaLow
	}
}

func (s *AIService) Cancel() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		sessionID := strings.TrimSpace(chi.URLParam(r, "sessionID"))
		if err := s.runtime.Cancel(sessionID, userID); err != nil {
			writeAIError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}
}

func (s *AIService) requireUser(w http.ResponseWriter, r *http.Request) (string, bool) {
	userID, err := sessionUserID(r, s.database)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return "", false
	}
	if userID == "" {
		http.Error(w, "not authenticated", http.StatusUnauthorized)
		return "", false
	}
	return userID, true
}

func decodeAIJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	return decodeAIJSONWithLimit(w, r, dst, maxAIJSONBodyBytes)
}

func decodeAIJSONWithLimit(w http.ResponseWriter, r *http.Request, dst any, limit int64) error {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return errInvalidJSON
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errInvalidJSON
	}
	return nil
}

func writeAIError(w http.ResponseWriter, err error) {
	var exhausted agent.CreditsExhaustedError
	switch {
	case errors.Is(err, context.Canceled):
		writeJSON(w, 499, map[string]any{"code": "request_canceled", "message": "Mika request canceled."})
	case errors.As(err, &exhausted):
		writeJSON(w, http.StatusPaymentRequired, map[string]any{
			"code": "credits_exhausted", "required_credits": exhausted.Required,
			"available_credits": exhausted.Available, "reset_at": exhausted.ResetAt,
			"top_up_available": true,
		})
	case errors.Is(err, agent.ErrSessionNotFound):
		http.Error(w, "session not found", http.StatusNotFound)
	case isAIInvalidRequest(err):
		http.Error(w, err.Error(), http.StatusBadRequest)
	default:
		http.Error(w, "internal error", http.StatusInternalServerError)
	}
}

func isAIInvalidRequest(err error) bool {
	var invalid agent.ErrInvalidRequest
	return errors.As(err, &invalid)
}
