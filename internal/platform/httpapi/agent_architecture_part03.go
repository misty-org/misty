package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	db "github.com/kannachi323/misty/server/internal/platform/postgres"
)

func (s *SpacesService) AgentInstanceWorkflow() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		var body struct {
			Enabled       bool            `json:"enabled"`
			TriggerConfig json.RawMessage `json:"trigger_config"`
			Consent       json.RawMessage `json:"consent"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		if len(body.TriggerConfig) == 0 {
			body.TriggerConfig = json.RawMessage(`{}`)
		}
		if len(body.Consent) == 0 {
			body.Consent = json.RawMessage(`{}`)
		}
		item, err := s.database.ConfigureInstanceWorkflow(r.Context(), userID, chi.URLParam(r, "instanceID"), chi.URLParam(r, "workflowVersionID"), body.Enabled, body.TriggerConfig, body.Consent)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, item)
	}
}

func (s *SpacesService) AgentInstanceConnections() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		var body struct {
			Bindings map[string]string `json:"bindings"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		item, err := s.database.UpdateAgentInstanceConnections(r.Context(), userID, chi.URLParam(r, "instanceID"), body.Bindings)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, item)
	}
}

func (s *SpacesService) WorkflowRuns() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		items, err := s.database.SpaceWorkflowRuns(r.Context(), userID, chi.URLParam(r, "spaceID"), chi.URLParam(r, "workflowID"), 100)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"runs": items})
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
		steps, _ := s.database.WorkflowRunSteps(r.Context(), userID, runID)
		writeJSON(w, http.StatusOK, map[string]any{"run": run, "actions": actions, "approvals": approvals, "steps": steps})
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
			_ = s.database.FinalizeWorkflowEventClaimsForRun(r.Context(), run.ID, "failed")
			writeJSON(w, http.StatusOK, run)
			return
		}
		prompt := TestingPromptFromRun(run)
		finished, err := s.executeCanonicalAgentRun(r, run, prompt)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		if err := s.publishResumedRunResponse(r, userID, finished); err != nil {
			writeSpaceError(w, err)
			return
		}
		if finished.State == "completed" || finished.State == "completed_with_errors" {
			_ = s.database.FinalizeWorkflowEventClaimsForRun(r.Context(), finished.ID, "completed")
		} else if finished.State != "awaiting_approval" {
			_ = s.database.FinalizeWorkflowEventClaimsForRun(r.Context(), finished.ID, "failed")
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
		if err := s.publishResumedRunResponse(r, userID, run); err != nil {
			writeSpaceError(w, err)
			return
		}
		_ = s.database.FinalizeWorkflowEventClaimsForRun(r.Context(), run.ID, "failed")
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
		if run.State == "awaiting_approval" {
			writeJSON(w, http.StatusAccepted, run)
			return
		}
		finished, err := s.executeCanonicalAgentRun(r, run, TestingPromptFromRun(run))
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		if err := s.publishResumedRunResponse(r, userID, finished); err != nil {
			writeSpaceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, finished)
	}
}

func (s *SpacesService) publishResumedRunResponse(r *http.Request, userID string, run *db.SpaceRun) error {
	return publishCanonicalRunResponse(r.Context(), s.database, s.agent, userID, run)
}
