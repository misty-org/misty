package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	serveragent "github.com/kannachi323/misty/server/agent"
	"github.com/kannachi323/misty/server/db"
	workflowv2 "github.com/kannachi323/misty/server/workflow"
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

func (s *SpacesService) AgentDiscovery() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaces, err := s.database.ListSpaces(r.Context(), userID)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		agents, err := s.database.DiscoverAgentCatalog(r.Context(), userID)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"spaces": spaces, "agents": agents})
	}
}

func (s *SpacesService) AgentDelegation() http.HandlerFunc {
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
		trace := fmt.Sprintf("The agent system assigned this task to %s in %s.", decision.Selected.AgentName, decision.Selected.SpaceName)
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
	resource, workflow, err := s.database.AgentExecutionContext(r.Context(), run.RequestingMemberID, run.SpaceID, run.AgentID, run.AgentVersionID, run.WorkflowVersionID)
	if err != nil {
		return s.finishFailedCanonicalRun(r.Context(), run, err)
	}
	var selectedCapability *db.WorkflowCapability
	if workflow != nil {
		for index := range workflow.Metadata.Capabilities {
			if workflow.Metadata.Capabilities[index].ID == run.CapabilityID {
				selectedCapability = &workflow.Metadata.Capabilities[index]
				break
			}
		}
		if selectedCapability == nil {
			return s.finishFailedCanonicalRun(r.Context(), run, db.ErrSpaceInvalid)
		}
	}
	// Published workflows always use the unified coordinator, including Agents
	// that also have device resources. Device-bound nodes are leased by the v2
	// runtime; the legacy whole-Agent device planner is never used for them.
	if workflow != nil {
		return s.executeWorkflowV2(r.Context(), run, resource, workflow, prompt)
	}
	if resource.RuntimeKind == "device" {
		return s.finishFailedCanonicalRun(r.Context(), run, errors.New("device-backed Space Agents require a published v2 workflow with an exact device node"))
	}
	if s.agent == nil {
		return s.finishFailedCanonicalRun(r.Context(), run, errors.New("Space Agent runtime is unavailable"))
	}
	request := fmt.Sprintf("You are %s, an Agent in a Space. Follow these version-pinned instructions:\n%s\n\nUser request:\n%s", resource.Name, resource.Instructions, strings.TrimSpace(prompt))
	if selectedCapability != nil {
		capabilityDescription := selectedCapability.Name + ": " + selectedCapability.Description
		request = fmt.Sprintf("You are %s, an Agent in a Space. Follow these version-pinned instructions:\n%s\n\nExecute the pinned workflow capability %s. Use only its capability envelope.\n\nUser request:\n%s", resource.Name, resource.Instructions, capabilityDescription, strings.TrimSpace(prompt))
	}
	manifest := serveragent.ToolManifest{Tools: []serveragent.ToolDefinition{
		{Name: "space.search_messages", Risk: serveragent.RiskRead, InputSchema: mustAPIRawJSON(map[string]any{"type": "object", "properties": map[string]any{"query": map[string]any{"type": "string"}, "limit": map[string]any{"type": "integer"}}})},
		{Name: "library.search", Risk: serveragent.RiskRead, InputSchema: mustAPIRawJSON(map[string]any{"type": "object", "properties": map[string]any{"query": map[string]any{"type": "string"}, "limit": map[string]any{"type": "integer"}}})},
		{Name: "tasks.query", Risk: serveragent.RiskRead, InputSchema: taskAgentToolSchema(false)},
		{Name: "calendar.query", Risk: serveragent.RiskRead, InputSchema: taskAgentToolSchema(false)},
		{Name: "tasks.create", Risk: serveragent.RiskWrite, InputSchema: taskAgentToolSchema(true)},
		{Name: "tasks.update", Risk: serveragent.RiskWrite, InputSchema: taskAgentToolSchema(true)},
	}}
	seenProviders := map[string]bool{}
	if resources, resourceErr := s.database.ProviderSharedResources(r.Context(), run.RequestingMemberID, run.SpaceID); resourceErr == nil {
		for _, resource := range resources {
			if resource.Status != "active" || seenProviders[resource.Provider] {
				continue
			}
			seenProviders[resource.Provider] = true
			manifest.Tools = append(manifest.Tools, serveragent.ToolDefinition{Name: "provider." + resource.Provider + ".query", Risk: serveragent.RiskRead, InputSchema: providerAgentToolSchema(false)})
			if providerSupportsWrite(resource.Provider) {
				manifest.Tools = append(manifest.Tools, serveragent.ToolDefinition{Name: "provider." + resource.Provider + ".write", Risk: serveragent.RiskWrite, InputSchema: providerAgentToolSchema(true)})
			}
		}
	}
	if sources, sourceErr := s.database.SpaceCalendarSources(r.Context(), run.RequestingMemberID, run.SpaceID); sourceErr == nil && len(sources) > 0 && !seenProviders["google"] {
		manifest.Tools = append(manifest.Tools, serveragent.ToolDefinition{Name: "provider.google_calendar.query", Risk: serveragent.RiskRead, InputSchema: providerAgentToolSchema(false)})
	}
	completion, err := s.agent.CompleteWithToolsContext(r.Context(), run.RequestingMemberID, run.BillingUserID, request, serveragent.TierLow, manifest, func(toolCtx context.Context, tool serveragent.ToolRequest) (json.RawMessage, error) {
		return s.executeOrdinaryAgentTool(toolCtx, run, tool)
	})
	if err != nil {
		if errors.Is(err, workflowv2.ErrAwaitingApproval) {
			return s.database.SpaceRun(r.Context(), run.RequestingMemberID, run.ID)
		}
		code, message := spaceRunFailureFromError(err)
		destructive := selectedCapability != nil && selectedCapability.Destructive
		_ = s.database.RecordRunAction(r.Context(), run.ID, "capability", "Failed "+run.CapabilityID, mustAPIRawJSON(map[string]string{"workflow_version": run.WorkflowVersion, "error_code": code, "message": message}), destructive, "failed")
		return s.finishFailedCanonicalRun(r.Context(), run, err)
	}
	result := mustAPIRawJSON(map[string]any{"text": strings.TrimSpace(completion.Text), "citations": completion.Citations, "tool_calls": completion.ToolCalls})
	destructive := selectedCapability != nil && selectedCapability.Destructive
	_ = s.database.RecordRunAction(r.Context(), run.ID, "capability", "Executed "+run.CapabilityID, mustAPIRawJSON(map[string]string{"workflow_version": run.WorkflowVersion}), destructive, "completed")
	return s.database.FinishSpaceRun(r.Context(), run.ID, "completed", result, "")
}

func (s *SpacesService) executeOrdinaryAgentTool(ctx context.Context, run *db.SpaceRun, tool serveragent.ToolRequest) (json.RawMessage, error) {
	if strings.HasPrefix(tool.Name, "tasks.") || tool.Name == "calendar.query" {
		invocation := workflowv2.Invocation{RunID: run.ID, NodeID: "chat_tool_" + tool.ID, Attempt: 1, IdempotencyKey: "chat:" + run.ID + ":" + tool.ID, UserID: run.RequestingMemberID, SpaceID: run.SpaceID, Input: tool.Arguments}
		switch tool.Name {
		case "tasks.query":
			return s.taskQueryNode(ctx, run, invocation)
		case "calendar.query":
			return s.calendarQueryNode(ctx, run, invocation)
		case "tasks.create", "tasks.update":
			approved, err := s.database.EnsureWorkflowNodeApproval(ctx, run.ID, invocation.NodeID, tool.Name, tool.Arguments)
			if err != nil {
				return nil, err
			}
			if !approved {
				return nil, workflowv2.ErrAwaitingApproval
			}
			return s.database.JournalWorkflowAction(ctx, run.ID, invocation.NodeID, invocation.IdempotencyKey, "space_tasks", workflowv2.RiskWrite, tool.Arguments, func() (json.RawMessage, error) {
				if tool.Name == "tasks.create" {
					return s.createTaskNode(ctx, run, &db.SpaceStudioResource{ID: run.AgentID}, invocation)
				}
				return s.updateTaskNode(ctx, run, invocation)
			})
		}
	}
	if strings.HasPrefix(tool.Name, "provider.") {
		parts := strings.Split(tool.Name, ".")
		if len(parts) != 3 || parts[1] == "" {
			return nil, workflowv2.ErrCapabilityDenied
		}
		provider, operation := parts[1], parts[2]
		var config map[string]any
		if json.Unmarshal(tool.Arguments, &config) != nil {
			return nil, db.ErrSpaceInvalid
		}
		config["provider"], config["operation"] = provider, operation
		invocation := workflowv2.Invocation{RunID: run.ID, NodeID: "chat_tool_" + tool.ID, Attempt: 1, IdempotencyKey: "chat:" + run.ID + ":" + tool.ID, UserID: run.RequestingMemberID, SpaceID: run.SpaceID, Config: mustAPIRawJSON(config), Input: tool.Arguments}
		if operation == "query" {
			return s.providerQueryNode(ctx, run, invocation)
		}
		if operation != "write" || !providerSupportsWrite(provider) {
			return nil, workflowv2.ErrCapabilityDenied
		}
		approvalInput := workflowApprovalEnvelope(run, "provider."+provider+".write", provider, findWorkflowString(config, "connectionId", "connection_id"), findWorkflowString(config, "destination", "channel", "channelId", "channel_id"), tool.Arguments)
		approved, approvalErr := s.database.EnsureWorkflowNodeApproval(ctx, run.ID, invocation.NodeID, "provider."+provider+".write", approvalInput)
		if approvalErr != nil {
			return nil, approvalErr
		}
		if !approved {
			return nil, workflowv2.ErrAwaitingApproval
		}
		return s.database.JournalWorkflowAction(ctx, run.ID, invocation.NodeID, invocation.IdempotencyKey, provider, workflowv2.RiskWrite, tool.Arguments, func() (json.RawMessage, error) { return s.providerWriteNode(ctx, run, invocation) })
	}
	var arguments struct {
		Query string `json:"query"`
		Limit int    `json:"limit"`
	}
	if json.Unmarshal(tool.Arguments, &arguments) != nil {
		return nil, db.ErrSpaceInvalid
	}
	arguments.Query = strings.TrimSpace(arguments.Query)
	if arguments.Limit < 1 || arguments.Limit > 50 {
		arguments.Limit = 20
	}
	switch tool.Name {
	case "space.search_messages":
		messages, err := s.database.SpaceMessages(ctx, run.RequestingMemberID, run.SpaceID, 0, 100)
		if err != nil {
			return nil, err
		}
		matches := make([]db.SpaceMessage, 0, arguments.Limit)
		query := strings.ToLower(arguments.Query)
		for _, message := range messages {
			raw, _ := json.Marshal(message.Content)
			if query == "" || strings.Contains(strings.ToLower(string(raw)), query) {
				matches = append(matches, message)
				if len(matches) == arguments.Limit {
					break
				}
			}
		}
		return mustAPIRawJSON(map[string]any{"messages": matches, "count": len(matches)}), nil
	case "library.search":
		items, err := s.database.LibraryItems(ctx, run.RequestingMemberID, run.SpaceID, db.LibraryItemQuery{Search: arguments.Query, Limit: arguments.Limit, Visibility: "visible"})
		if err != nil {
			return nil, err
		}
		return mustAPIRawJSON(map[string]any{"items": items, "count": len(items)}), nil
	default:
		return nil, workflowv2.ErrCapabilityDenied
	}
}

func providerAgentToolSchema(write bool) json.RawMessage {
	properties := map[string]any{"query": map[string]any{"type": "string"}, "limit": map[string]any{"type": "integer"}, "resource": map[string]any{"type": "string"}}
	if write {
		properties["destination"] = map[string]any{"type": "string"}
		properties["payload"] = map[string]any{"type": "object"}
		properties["mode"] = map[string]any{"type": "string", "enum": []string{"draft", "send"}}
	}
	return mustAPIRawJSON(map[string]any{"type": "object", "properties": properties})
}

func providerSupportsWrite(provider string) bool {
	switch provider {
	case "slack", "discord":
		return true
	}
	return false
}

func taskAgentToolSchema(write bool) json.RawMessage {
	properties := map[string]any{"query": map[string]any{"type": "string"}, "status": map[string]any{"type": "string"}, "assigneeUserId": map[string]any{"type": "string"}, "from": map[string]any{"type": "string"}, "to": map[string]any{"type": "string"}}
	if write {
		properties["id"] = map[string]any{"type": "string"}
		properties["title"] = map[string]any{"type": "string"}
		properties["notes"] = map[string]any{"type": "string"}
		properties["dueAt"] = map[string]any{"type": "string"}
		properties["dueTimezone"] = map[string]any{"type": "string"}
		properties["version"] = map[string]any{"type": "integer"}
	}
	return mustAPIRawJSON(map[string]any{"type": "object", "properties": properties})
}

func (s *SpacesService) finishFailedCanonicalRun(ctx context.Context, run *db.SpaceRun, runErr error) (*db.SpaceRun, error) {
	code, message := spaceRunFailureFromError(runErr)
	failed, err := s.database.FinishSpaceRun(ctx, run.ID, "failed", mustAPIRawJSON(map[string]string{"message": message}), code)
	if err != nil {
		return nil, err
	}
	return failed, nil
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

func (s *SpacesService) AgentVersions() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID, agentID := chi.URLParam(r, "spaceID"), chi.URLParam(r, "agentID")
		if r.Method == http.MethodGet {
			items, err := s.database.PublishedAgentVersions(r.Context(), userID, spaceID, agentID)
			if err != nil {
				writeSpaceError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"versions": items})
			return
		}
		var body struct {
			Workflows []db.AgentVersionWorkflow `json:"workflows"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		item, err := s.database.PublishAgentVersion(r.Context(), userID, spaceID, agentID, body.Workflows)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, item)
	}
}

func (s *SpacesService) AgentInstance() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID, agentID := chi.URLParam(r, "spaceID"), chi.URLParam(r, "agentID")
		instance, err := s.database.EnsureAgentInstance(r.Context(), userID, spaceID, agentID)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		if r.Method == http.MethodPost {
			instance, err = s.database.UpdateAgentInstance(r.Context(), userID, instance.ID)
			if err != nil {
				writeSpaceError(w, err)
				return
			}
		}
		writeJSON(w, http.StatusOK, instance)
	}
}

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
		prompt := promptFromRun(run)
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
		finished, err := s.executeCanonicalAgentRun(r, run, promptFromRun(run))
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

func publishCanonicalRunResponse(ctx context.Context, database *db.Database, runtime *serveragent.Service, userID string, run *db.SpaceRun) error {
	if run == nil || run.SourceConversationID == "" || run.State != "completed" && run.State != "completed_with_errors" && run.State != "failed" && run.State != "canceled" && run.State != "rejected" {
		return nil
	}
	actionID, claimed, err := database.ClaimRunResponsePublication(ctx, run.ID)
	if err != nil || !claimed {
		return err
	}
	eventType, text := canonicalRunResponse(run)
	details := map[string]string{"source_type": run.SourceType, "source_conversation_id": run.SourceConversationID}
	finish := func(deliveryErr error) error {
		state := "completed"
		if deliveryErr != nil {
			state = "failed"
			details["error"] = deliveryErr.Error()
		}
		if updateErr := database.FinishRunResponsePublication(ctx, actionID, state, mustAPIRawJSON(details)); updateErr != nil && deliveryErr == nil {
			return updateErr
		}
		return deliveryErr
	}
	switch run.SourceType {
	case "direct":
		_, err = database.AppendAgentConversationEvent(ctx, userID, run.SourceConversationID, eventType, mustAPIRawJSON(map[string]any{"text": text, "run_id": run.ID}))
		if errors.Is(err, db.ErrSpaceNotFound) {
			err = nil // Caller-owned correlation IDs are valid direct sources.
		}
	case "group_mention":
		runes := []rune(text)
		if len(runes) > db.MaxMessageChars {
			runes = runes[:db.MaxMessageChars]
		}
		var reply *db.SpaceMessage
		var selectedGroup bool
		selectedGroup, err = database.IsSpaceConversationForMember(ctx, userID, run.SpaceID, run.SourceConversationID)
		if err == nil && selectedGroup {
			reply, err = database.CreateSpaceConversationAgentMessage(ctx, userID, run.SpaceID, run.SourceConversationID, run.AgentID, string(runes))
		} else if err == nil {
			reply, err = database.CreateSpaceAgentMessage(ctx, userID, run.SpaceID, run.AgentID, string(runes))
		}
		if err == nil {
			details["message_id"] = reply.ID
		}
	case "mika":
		if runtime == nil {
			err = errors.New("Agent runtime is unavailable")
		} else {
			_, err = runtime.AppendExternalAssistantMessage(ctx, run.SourceConversationID, userID, run.ID, text)
		}
	default:
		details["status"] = "no_conversation_delivery_required"
	}
	return finish(err)
}

func canonicalRunResponse(run *db.SpaceRun) (string, string) {
	if run.State == "failed" {
		message := strings.TrimSpace(run.ErrorMessage)
		if message == "" {
			message = "The agent run failed."
		}
		return "error", message
	}
	if run.State == "canceled" {
		return "agent_message", "The isolated run was canceled."
	}
	if run.State == "rejected" {
		return "agent_message", "The requested action was rejected, so the Agent stopped the run."
	}
	var output map[string]any
	_ = json.Unmarshal(run.Outputs, &output)
	if text, ok := output["text"].(string); ok && strings.TrimSpace(text) != "" {
		return "agent_message", strings.TrimSpace(text)
	}
	if run.State == "running" || run.State == "cooldown" || run.State == "queued" {
		return "agent_message", "The isolated run is in progress. Track run " + run.ID + " in Studio."
	}
	if run.State == "completed_with_errors" {
		return "agent_message", "The isolated run completed with item errors. Open run " + run.ID + " in Studio for the successful outputs and failed items."
	}
	return "agent_message", "The isolated run completed. Open run " + run.ID + " in Studio to inspect its output and actions."
}

func promptFromRun(run *db.SpaceRun) string {
	var input map[string]any
	_ = json.Unmarshal(run.Input, &input)
	prompt, _ := input["prompt"].(string)
	return prompt
}
func mustAPIRawJSON(value any) json.RawMessage { raw, _ := json.Marshal(value); return raw }
