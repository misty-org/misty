package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	agent "github.com/kannachi323/misty/server/internal/agents"

	"github.com/go-chi/chi/v5"
	db "github.com/kannachi323/misty/server/internal/platform/postgres"
)

const (
	TestingMaxAIJSONBodyBytes = 2 << 20
	maxAIToolJSONBodyBytes    = 8 << 20
	maxAISessionTitleRunes    = 120
)

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
		tier, err := s.agentTierForUser(userID)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"configured":            s.runtime.AgentConfigured(tier),
			"provider":              "misty",
			"model":                 agent.InitialSelectedModelID,
			"model_name":            agent.InitialSelectedModelName,
			"running":               false,
			"session_id":            nil,
			"error":                 nil,
			"space_scoped_sessions": true,
			"capabilities": map[string]bool{
				"space_scoped_sessions": true,
			},
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
			TestingWriteAIRateLimit(w, retryAfter)
			return
		}
		var body struct {
			AgentID         string `json:"agent_id"`
			AgentJobID      string `json:"agent_job_id"`
			SpaceID         string `json:"space_id"`
			ModelID         string `json:"model_id"`
			ReasoningEffort string `json:"reasoning_effort"`
		}
		if r.ContentLength > 0 && decodeAIJSON(w, r, &body) != nil {
			return
		}
		body.AgentID, body.SpaceID, body.ModelID = strings.TrimSpace(body.AgentID), strings.TrimSpace(body.SpaceID), strings.TrimSpace(body.ModelID)
		// A per-chat effort override (sent by the composer) wins over the agent default.
		requestedReasoningEffort := strings.TrimSpace(body.ReasoningEffort)
		// A chat may pin its own model, distinct from the agent's configured
		// default. When the client sends a model_id it overrides the agent's
		// model for this session only; the agent's stored model is never touched.
		requestedModelID := body.ModelID
		systemPrompt := ""
		reasoningEffort := ""
		allowTools := true
		allowWriteTools := true
		if body.AgentID != "" {
			if body.SpaceID != "" {
				if _, lookupErr := s.database.PersonalAgentForSpace(r.Context(), userID, body.SpaceID, body.AgentID); lookupErr != nil {
					writeAgentError(w, lookupErr)
					return
				}
				membership, lookupErr := s.database.SpaceAgentMembership(r.Context(), userID, body.SpaceID, body.AgentID)
				if lookupErr != nil {
					writeAgentError(w, lookupErr)
					return
				}
				// Space Agents always run the immutable version approved by this
				// Space. Per-chat model and reasoning overrides cannot bypass it.
				body.ModelID = membership.ModelID
				reasoningEffort = membership.ReasoningEffort
				allowTools, allowWriteTools = false, false
				systemPrompt = "You are " + membership.Name + ". Follow these approved, version-pinned instructions:\n" + membership.Instructions + "\n" + membership.SpaceInstructions
			} else {
				personal, lookupErr := s.database.PersonalAgentByID(r.Context(), userID, body.AgentID)
				if lookupErr != nil {
					writeAgentError(w, lookupErr)
					return
				}
				if requestedModelID != "" {
					body.ModelID = requestedModelID
				} else {
					if personal.ModelMode != "pinned" || strings.TrimSpace(personal.ModelID) == "" {
						writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"code": "agent_model_required"})
						return
					}
					body.ModelID = personal.ModelID
				}
				var toolPolicy struct {
					Write bool `json:"write"`
				}
				if json.Unmarshal(personal.ToolPermissions, &toolPolicy) == nil {
					allowWriteTools = toolPolicy.Write
				}
				reasoningEffort = personal.ReasoningEffort
				systemPrompt = "You are " + personal.Name + ". Follow these owner-provided instructions:\n" + personal.Instructions
			}
		} else if body.SpaceID != "" {
			if err := s.database.ValidateAgentSpaceAccess(r.Context(), userID, body.SpaceID, ""); err != nil {
				writeAISessionAccessError(w, err)
				return
			}
			contextText, contextErr := s.database.PersonalAgentSpaceContext(r.Context(), userID, body.SpaceID, json.RawMessage(`{"space_chat":true,"library":true,"notes":true,"tasks":true,"members":true}`))
			if contextErr != nil {
				writeSpaceError(w, contextErr)
				return
			}
			systemPrompt = "Use this permission-filtered Space context when relevant:\n" + contextText
		}
		if body.ModelID == "" {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"code": "agent_model_required"})
			return
		}
		if !agent.GatewayModelAvailable(r.Context(), body.ModelID) {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"code": "agent_model_unavailable"})
			return
		}
		allowTools = agent.GatewayModelSupportsTools(r.Context(), body.ModelID)
		if requestedReasoningEffort != "" {
			reasoningEffort = requestedReasoningEffort
		}
		session := s.runtime.CreateSessionWithModel(userID, userID, body.ModelID)
		_ = s.runtime.ConfigureSession(session.ID, userID, systemPrompt, allowTools, allowWriteTools)
		if reasoningEffort != "" {
			_ = s.runtime.SetSessionReasoningEffort(session.ID, userID, reasoningEffort)
		}
		if err := s.database.BindAgentSessionContext(r.Context(), userID, session.ID, body.AgentID, body.SpaceID, body.ModelID, agent.GatewayModelCatalogVersion); err != nil {
			TestingWriteAIError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{
			"session_id": session.ID, "agent_id": body.AgentID, "space_id": body.SpaceID, "model_id": body.ModelID,
			"model_catalog_version": agent.GatewayModelCatalogVersion,
		})
	}
}

// Sessions lists the account's retained agent sessions so a client can rebuild
// its session list on a new device, or after losing local state.
func (s *AIService) Sessions() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		sessions, err := s.database.ListAgentSessions(r.Context(), userID)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"sessions": sessions})
	}
}

// Transcript returns a session's messages so a device that has never seen the
// session can render it. Read-only: it neither resumes generation nor replays
// tool requests.
func (s *AIService) Transcript() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		sessionID := strings.TrimSpace(chi.URLParam(r, "sessionID"))
		if _, err := s.database.ValidateAgentSessionAccess(r.Context(), userID, sessionID); err != nil {
			writeAISessionAccessError(w, err)
			return
		}
		messages, err := s.runtime.Transcript(r.Context(), sessionID, userID)
		if err != nil {
			TestingWriteAIError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"messages": messages})
	}
}

// RenameSession labels a session. Titles are display-only, so an over-long or
// blank title is normalised rather than rejected.
func (s *AIService) RenameSession() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		sessionID := strings.TrimSpace(chi.URLParam(r, "sessionID"))
		var body struct {
			Title string `json:"title"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, TestingMaxAIJSONBodyBytes)).Decode(&body); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		title := strings.TrimSpace(body.Title)
		if len([]rune(title)) > maxAISessionTitleRunes {
			title = string([]rune(title)[:maxAISessionTitleRunes])
		}
		if err := s.database.RenameAgentSession(r.Context(), userID, sessionID, title); err != nil {
			if errors.Is(err, agent.ErrPersistedSessionNotFound) {
				http.Error(w, "session not found", http.StatusNotFound)
				return
			}
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"id": sessionID, "title": title})
	}
}
