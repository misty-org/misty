package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/kannachi323/misty/server/db"
)

func (s *SpacesService) AgentConversations() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		if r.Method == http.MethodGet {
			items, err := s.database.AgentConversations(r.Context(), userID)
			if err != nil {
				writeSpaceError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"conversations": items})
			return
		}
		var body struct {
			SpaceID string `json:"space_id"`
			AgentID string `json:"agent_id"`
			Title   string `json:"title"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		item, err := s.database.CreateAgentConversation(r.Context(), userID, body.SpaceID, body.AgentID, body.Title)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, item)
	}
}

func (s *SpacesService) AgentConversationEvents() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		conversationID := chi.URLParam(r, "conversationID")
		if r.Method == http.MethodGet {
			items, err := s.database.AgentConversationEvents(r.Context(), userID, conversationID)
			if err != nil {
				writeSpaceError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"events": items})
			return
		}
		conversation, err := s.database.AgentConversationByID(r.Context(), userID, conversationID)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		var body struct {
			Prompt       string          `json:"prompt"`
			CapabilityID string          `json:"capability_id"`
			Input        json.RawMessage `json:"input"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		body.Prompt = strings.TrimSpace(body.Prompt)
		if body.Prompt == "" {
			writeSpaceError(w, db.ErrSpaceInvalid)
			return
		}
		_, err = s.database.AppendAgentConversationEvent(r.Context(), userID, conversationID, "user_message", mustAPIRawJSON(map[string]string{"text": body.Prompt}))
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		decision, err := s.database.RouteAgentRequest(r.Context(), userID, body.Prompt, conversation.SpaceID, conversation.AgentID, body.CapabilityID)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		if decision.NeedsClarification || decision.Selected == nil {
			event, _ := s.database.AppendAgentConversationEvent(r.Context(), userID, conversationID, "agent_message", mustAPIRawJSON(map[string]string{"text": decision.Question}))
			writeJSON(w, http.StatusOK, map[string]any{"status": "needs_clarification", "routing": decision, "event": event})
			return
		}
		if len(body.Input) == 0 {
			body.Input = mustAPIRawJSON(map[string]string{"prompt": body.Prompt})
		}
		run, err := s.database.CreateAgentRun(r.Context(), db.AgentRunRequest{RequestingMemberID: userID, SpaceID: conversation.SpaceID, AgentID: conversation.AgentID, SourceConversationID: conversationID, SourceType: "direct", CapabilityID: decision.Selected.CapabilityID, Input: body.Input, TriggerKind: "manual"})
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		_, _ = s.database.AppendAgentConversationEvent(r.Context(), userID, conversationID, "run", mustAPIRawJSON(map[string]string{"run_id": run.ID}))
		if run.State == "awaiting_approval" {
			writeJSON(w, http.StatusAccepted, map[string]any{"run": run})
			return
		}
		finished, err := s.executeCanonicalAgentRun(r, run, body.Prompt)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		eventType, text := canonicalRunResponse(finished)
		event, _ := s.database.AppendAgentConversationEvent(r.Context(), userID, conversationID, eventType, mustAPIRawJSON(map[string]any{"text": text, "run_id": finished.ID}))
		writeJSON(w, http.StatusOK, map[string]any{"run": finished, "event": event})
	}
}

func (s *SpacesService) SpaceIntegrations() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID := chi.URLParam(r, "spaceID")
		if r.Method == http.MethodGet {
			items, err := s.database.SpaceIntegrations(r.Context(), userID, spaceID)
			if err != nil {
				writeSpaceError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{
				"integrations": items,
				"providers":    providerOAuthAvailabilityCatalog(),
			})
			return
		}
		var body struct {
			ID                  string   `json:"id"`
			Provider            string   `json:"provider"`
			DisplayName         string   `json:"display_name"`
			CredentialReference string   `json:"credential_reference"`
			GrantedPermissions  []string `json:"granted_permissions"`
			Status              string   `json:"status"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		item := db.SpaceIntegration{ID: body.ID, SpaceID: spaceID, Provider: body.Provider, DisplayName: body.DisplayName, CredentialReference: body.CredentialReference, GrantedPermissions: body.GrantedPermissions, Status: body.Status}
		saved, err := s.database.SaveSpaceIntegration(r.Context(), userID, item)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, saved)
	}
}
