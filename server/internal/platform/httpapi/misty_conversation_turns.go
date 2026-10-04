package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	agent "github.com/kannachi323/misty/server/internal/agents"
	db "github.com/kannachi323/misty/server/internal/platform/postgres"
)

func (s *AIService) MistyConversationTurn() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		conversationID := strings.TrimSpace(chi.URLParam(r, "conversationID"))
		var body struct {
			Mode     string                  `json:"mode"`
			Prompt   string                  `json:"prompt"`
			Context  []mistyContextReference `json:"context"`
			Timezone string                  `json:"timezone,omitempty"`
		}
		if err := decodeAIJSON(w, r, &body); err != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		body.Prompt = strings.TrimSpace(body.Prompt)
		if conversationID == "" || body.Prompt == "" {
			http.Error(w, "conversation and prompt are required", http.StatusBadRequest)
			return
		}
		_, accessErr := s.database.AgentConversationIdentity(r.Context(), userID, conversationID)
		if accessErr != nil {
			writeSpaceError(w, accessErr)
			return
		}
		if body.Mode == "action" {
			s.mistyActionProposal(w, r, userID, conversationID, body.Prompt)
			return
		}
		if body.Mode != "ask" {
			http.Error(w, "mode must be ask or action", http.StatusBadRequest)
			return
		}
		available, err := s.database.AIActionAvailable(r.Context(), userID, "global", "ask", agent.InitialSelectedModelID)
		if err != nil {
			TestingWriteAIError(w, err)
			return
		}
		if !available {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"code": "ai_surface_unavailable", "message": "Misty Ask is temporarily unavailable."})
			return
		}
		if !s.agentRuntime.Enabled() {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"code": "agent_runtime_unavailable", "message": "Misty's agent runtime is not configured."})
			return
		}
		invocationBody := aiInvocationInput{
			Mode: "drawer", SurfaceID: "global", Trigger: "explicit", Prompt: body.Prompt,
			Context: mistyAIContextReferences(body.Context), ConversationID: conversationID,
			IdempotencyKey: "misty-turn:" + uuid.NewString(), Timezone: body.Timezone,
		}
		if err := validateAIInvocationInput(&invocationBody); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"code": "invalid_invocation", "message": err.Error()})
			return
		}
		payload, _ := json.Marshal(invocationBody)
		now := time.Now().UTC()
		_, err = s.database.ValidateAgentSessionAccess(r.Context(), userID, conversationID)
		if err != nil {
			TestingWriteAIError(w, err)
			return
		}
		spaceID := ""
		stored, _, err := s.database.CreateAIInvocationRecord(r.Context(), db.AIInvocationRecord{
			ID: "invocation_" + uuid.NewString(), UserID: userID, SpaceID: spaceID, ConversationID: conversationID,
			SurfaceID: "global", Mode: "drawer", Trigger: "explicit", State: "queued",
			IdempotencyKey: invocationBody.IdempotencyKey, RequestPayload: payload, ExpiresAt: now.Add(aiInvocationTTL),
		})
		if err != nil {
			TestingWriteAIError(w, err)
			return
		}
		if _, err := s.invocations.restoreDurable(r.Context(), stored); err != nil {
			TestingWriteAIError(w, err)
			return
		}
		if _, err := s.agentRuntime.Start(r.Context(), stored.ID); err != nil {
			s.invocations.fail(stored.ID, "Misty could not start the agent runtime. Please try again.")
			TestingWriteAIError(w, err)
			return
		}
		answer, citations, err := s.awaitAIInvocationAnswer(r, userID, stored.ID)
		if err != nil {
			TestingWriteAIError(w, err)
			return
		}
		_ = s.database.RenameAgentSession(r.Context(), userID, conversationID, cleanMistyTitle(body.Prompt))
		message := mistyConversationMessage{
			ID: "message_" + uuid.NewString(), Role: "assistant", Mode: "ask",
			Content: answer, CreatedAt: time.Now().UTC().Format(time.RFC3339Nano),
		}
		writeJSON(w, http.StatusOK, map[string]any{"text": answer, "message": message, "citations": citations})
	}
}

func (s *AIService) mistyActionProposal(w http.ResponseWriter, r *http.Request, userID, conversationID, prompt string) {
	readOnly := mistyReadOnlyAction(prompt)
	title := "Review this action"
	risk := "write"
	summary := "Misty will delegate this request after you confirm."
	if readOnly {
		title = "Run with Misty"
		risk = "read"
		summary = "Misty will delegate this read-only request now."
	}
	proposalID := "proposal_" + uuid.NewString()
	_ = s.database.RenameAgentSession(r.Context(), userID, conversationID, cleanMistyTitle(prompt))
	writeJSON(w, http.StatusOK, map[string]any{
		"action": map[string]any{
			"id": proposalID, "title": title, "summary": summary, "prompt": prompt,
			"risk": risk, "state": "proposed", "requiresConfirmation": !readOnly,
		},
	})
}

func mistyReadOnlyAction(prompt string) bool {
	first, _, _ := strings.Cut(strings.ToLower(strings.TrimSpace(prompt)), " ")
	switch strings.Trim(first, ",.:;!?") {
	case "find", "search", "show", "list", "summarize", "summarise", "explain", "review", "check":
		return true
	default:
		return false
	}
}
