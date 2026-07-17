package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	serveragent "github.com/kannachi323/misty/server/agent"
	"github.com/kannachi323/misty/server/db"
)

func (s *SpacesService) AgentCatalog() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		items, err := s.database.DiscoverAgentCatalog(r.Context(), userID)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"agents": items})
	}
}

func (s *SpacesService) MikaDelegation() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		var body struct {
			Prompt               string          `json:"prompt"`
			SpaceID              string          `json:"space_id"`
			AgentID              string          `json:"agent_id"`
			CapabilityID         string          `json:"capability_id"`
			SourceConversationID string          `json:"source_conversation_id"`
			Input                json.RawMessage `json:"input"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		body.Prompt = strings.TrimSpace(body.Prompt)
		if body.Prompt == "" {
			writeSpaceError(w, db.ErrSpaceInvalid)
			return
		}
		decision, err := s.database.RouteAgentRequest(r.Context(), userID, body.Prompt, body.SpaceID, body.AgentID, body.CapabilityID)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		if decision.NeedsClarification || decision.Selected == nil {
			writeJSON(w, http.StatusOK, map[string]any{"status": "needs_clarification", "routing": decision})
			return
		}
		if len(body.Input) == 0 {
			body.Input = mustAPIRawJSON(map[string]string{"prompt": body.Prompt})
		}
		run, err := s.database.CreateAgentRun(r.Context(), db.AgentRunRequest{
			RequestingMemberID: userID, SpaceID: decision.Selected.SpaceID, AgentID: decision.Selected.AgentID,
			SourceConversationID: body.SourceConversationID, SourceType: "mika", CapabilityID: decision.Selected.CapabilityID,
			Input: body.Input, TriggerKind: "mika",
		})
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		trace := fmt.Sprintf("Mika assigned this task to %s in %s.", decision.Selected.AgentName, decision.Selected.SpaceName)
		if run.State == "awaiting_approval" {
			writeJSON(w, http.StatusAccepted, map[string]any{"status": "awaiting_approval", "trace": trace, "routing": decision, "run": run})
			return
		}
		finished, err := s.executeCanonicalAgentRun(r, run, body.Prompt)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"status": finished.State, "trace": trace, "routing": decision, "run": finished})
	}
}

func (s *SpacesService) DirectAgentRun() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID, agentID := chi.URLParam(r, "spaceID"), chi.URLParam(r, "agentID")
		if r.Method == http.MethodGet {
			items, err := s.database.SpaceRuns(r.Context(), userID, spaceID, agentID, 100)
			if err != nil {
				writeSpaceError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"runs": items})
			return
		}
		var body struct {
			Prompt               string          `json:"prompt"`
			CapabilityID         string          `json:"capability_id"`
			SourceConversationID string          `json:"source_conversation_id"`
			Input                json.RawMessage `json:"input"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		body.Prompt = strings.TrimSpace(body.Prompt)
		if body.Prompt == "" {
			writeSpaceError(w, db.ErrSpaceInvalid)
			return
		}
		decision, err := s.database.RouteAgentRequest(r.Context(), userID, body.Prompt, spaceID, agentID, body.CapabilityID)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		if decision.NeedsClarification || decision.Selected == nil {
			writeJSON(w, http.StatusOK, map[string]any{"status": "needs_clarification", "routing": decision})
			return
		}
		if len(body.Input) == 0 {
			body.Input = mustAPIRawJSON(map[string]string{"prompt": body.Prompt})
		}
		run, err := s.database.CreateAgentRun(r.Context(), db.AgentRunRequest{RequestingMemberID: userID, SpaceID: spaceID, AgentID: agentID, SourceConversationID: body.SourceConversationID, SourceType: "direct", CapabilityID: decision.Selected.CapabilityID, Input: body.Input, TriggerKind: "manual"})
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		if run.State == "awaiting_approval" {
			writeJSON(w, http.StatusAccepted, run)
			return
		}
		finished, err := s.executeCanonicalAgentRun(r, run, body.Prompt)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, finished)
	}
}

func (s *SpacesService) executeCanonicalAgentRun(r *http.Request, run *db.SpaceRun, prompt string) (*db.SpaceRun, error) {
	resource, err := s.database.SpaceStudioResourceByID(r.Context(), run.RequestingMemberID, run.SpaceID, "agent", run.AgentID)
	if err != nil {
		return nil, err
	}
	if resource.RuntimeKind == "device" {
		job, _, err := s.database.CreateAgentJob(run.RequestingMemberID, run.AgentID, "manual", run.ID, mustAPIRawJSON(map[string]any{"prompt": prompt, "space_run_id": run.ID, "capability_id": run.CapabilityID}))
		if err != nil {
			_, _ = s.database.FinishSpaceRun(r.Context(), run.ID, "failed", mustAPIRawJSON(map[string]string{"message": err.Error()}), "device_dispatch_failed")
			return nil, err
		}
		_ = s.database.RecordRunAction(r.Context(), run.ID, "delegate_device", "Queued isolated device execution", mustAPIRawJSON(map[string]string{"job_id": job.ID}), false, "completed")
		run.Result, run.Outputs = mustAPIRawJSON(map[string]any{"job_id": job.ID, "status": job.State}), mustAPIRawJSON(map[string]any{"job_id": job.ID, "status": job.State})
		return run, nil
	}
	if s.agent == nil {
		return nil, errors.New("Space Agent runtime is unavailable")
	}
	workflow := resource.ActiveWorkflow
	capabilityDescription := run.CapabilityID
	if workflow != nil {
		for _, capability := range workflow.Metadata.Capabilities {
			if capability.ID == run.CapabilityID {
				capabilityDescription = capability.Name + ": " + capability.Description
				break
			}
		}
	}
	request := fmt.Sprintf("You are %s, a shared agent in a Space. Follow these instructions:\n%s\n\nUse the pinned workflow capability %s. Do not claim capabilities outside it.\n\nUser request:\n%s", resource.Name, resource.Instructions, capabilityDescription, strings.TrimSpace(prompt))
	text, _, err := s.agent.CompleteWithTierContext(r.Context(), run.BillingUserID, request, "automation_ai", serveragent.MikaLow)
	if err != nil {
		failed, finishErr := s.database.FinishSpaceRun(r.Context(), run.ID, "failed", mustAPIRawJSON(map[string]string{"message": err.Error()}), "execution_failed")
		if finishErr != nil {
			return nil, finishErr
		}
		return failed, nil
	}
	result := mustAPIRawJSON(map[string]string{"text": strings.TrimSpace(text)})
	_ = s.database.RecordRunAction(r.Context(), run.ID, "capability", "Executed "+run.CapabilityID, mustAPIRawJSON(map[string]string{"workflow_version": run.WorkflowVersion}), false, "completed")
	return s.database.FinishSpaceRun(r.Context(), run.ID, "completed", result, "")
}

func (s *SpacesService) WorkflowVersions() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID, workflowID := chi.URLParam(r, "spaceID"), chi.URLParam(r, "workflowID")
		if r.Method == http.MethodGet {
			items, err := s.database.WorkflowVersions(r.Context(), userID, spaceID, workflowID)
			if err != nil {
				writeSpaceError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"versions": items})
			return
		}
		var body struct {
			Version    string              `json:"version"`
			Metadata   db.WorkflowMetadata `json:"metadata"`
			Definition json.RawMessage     `json:"definition"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		item, err := s.database.CreateWorkflowVersion(r.Context(), userID, spaceID, workflowID, body.Version, body.Metadata, body.Definition)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, item)
	}
}

func (s *SpacesService) ReplaceAgentWorkflow() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		var body struct {
			WorkflowVersionID string `json:"workflow_version_id"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		item, err := s.database.ReplaceAgentWorkflow(r.Context(), userID, chi.URLParam(r, "spaceID"), chi.URLParam(r, "agentID"), body.WorkflowVersionID)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, item)
	}
}

func (s *SpacesService) RunDetail() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		runID := chi.URLParam(r, "runID")
		run, err := s.database.SpaceRun(r.Context(), userID, runID)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		actions, _ := s.database.RunActions(r.Context(), userID, runID)
		approvals, _ := s.database.RunApprovals(r.Context(), userID, runID)
		writeJSON(w, http.StatusOK, map[string]any{"run": run, "actions": actions, "approvals": approvals})
	}
}

func (s *SpacesService) RunDecision() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		var body struct {
			Approved bool `json:"approved"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		run, err := s.database.DecideRunApproval(r.Context(), userID, chi.URLParam(r, "runID"), body.Approved)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		if !body.Approved {
			writeJSON(w, http.StatusOK, run)
			return
		}
		prompt := promptFromRun(run)
		finished, err := s.executeCanonicalAgentRun(r, run, prompt)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, finished)
	}
}

func (s *SpacesService) RunCancel() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		run, err := s.database.CancelSpaceRun(r.Context(), userID, chi.URLParam(r, "runID"))
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, run)
	}
}
func (s *SpacesService) RunRetry() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		run, err := s.database.RetrySpaceRun(r.Context(), userID, chi.URLParam(r, "runID"))
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		finished, err := s.executeCanonicalAgentRun(r, run, promptFromRun(run))
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, finished)
	}
}

func promptFromRun(run *db.SpaceRun) string {
	var input map[string]any
	_ = json.Unmarshal(run.Input, &input)
	prompt, _ := input["prompt"].(string)
	return prompt
}
func mustAPIRawJSON(value any) json.RawMessage { raw, _ := json.Marshal(value); return raw }
