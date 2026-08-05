package api

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	serveragent "github.com/kannachi323/misty/server/internal/agents"
	"github.com/kannachi323/misty/server/internal/agenttools"
	db "github.com/kannachi323/misty/server/internal/platform/postgres"
	workflowv2 "github.com/kannachi323/misty/server/internal/workflows"
)

func (s *AIService) mistyAgentTeamContext(ctx context.Context, userID, spaceID string) (string, error) {
	memberships, err := s.database.SpaceAgentMemberships(ctx, userID, spaceID)
	if err != nil {
		return "", err
	}
	lines := []string{}
	for _, membership := range memberships {
		if !membership.Enabled {
			continue
		}
		lines = append(lines, "- "+membership.Name+" (agent_id: "+membership.AgentID+") — "+membership.SpaceRole)
	}
	return strings.Join(lines, "\n"), nil
}

func (s *AIService) executeMistyAgentDelegation(ctx context.Context, invocation agenttools.Invocation, tool serveragent.ToolRequest, tier serveragent.AgentTier) (json.RawMessage, error) {
	var input struct {
		Prompt    string `json:"prompt"`
		AgentID   string `json:"agent_id"`
		AgentName string `json:"agent_name"`
	}
	if json.Unmarshal(tool.Arguments, &input) != nil {
		return nil, db.ErrSpaceInvalid
	}
	input.Prompt, input.AgentID, input.AgentName = strings.TrimSpace(input.Prompt), strings.TrimSpace(input.AgentID), strings.TrimSpace(input.AgentName)
	if input.Prompt == "" {
		return nil, db.ErrSpaceInvalid
	}
	membership, choices, err := s.resolveMistyDelegationTarget(ctx, invocation.UserID, invocation.SpaceID, input.AgentID, input.AgentName, invocation.OriginalInput)
	if err != nil {
		return nil, err
	}
	if membership == nil {
		return TestingMustAPIRawJSON(map[string]any{
			"status": "needs_clarification", "question": "Which installed Agent should handle this?", "agents": choices,
		}), nil
	}
	if !delegatedAgentTargetGrounded(invocation.OriginalInput, membership) {
		return nil, workflowv2.ErrCapabilityDenied
	}
	return s.runDelegatedPersonalAgent(ctx, invocation, membership, input.Prompt, tier)
}

func (s *AIService) resolveMistyDelegationTarget(ctx context.Context, userID, spaceID, requestedID, requestedName, originalPrompt string) (*db.SpaceAgentMembership, []map[string]string, error) {
	return resolveMistyDelegationTarget(ctx, s.database, userID, spaceID, requestedID, requestedName, originalPrompt)
}

func resolveMistyDelegationTarget(ctx context.Context, database *db.Database, userID, spaceID, requestedID, requestedName, originalPrompt string) (*db.SpaceAgentMembership, []map[string]string, error) {
	memberships, err := database.SpaceAgentMemberships(ctx, userID, spaceID)
	if err != nil {
		return nil, nil, err
	}
	active := []db.SpaceAgentMembership{}
	for _, membership := range memberships {
		if !membership.Enabled {
			continue
		}
		// Roster visibility is broader than invocation access. A teammate can be
		// visible in Team while its owner has granted use only to selected members;
		// Misty must not offer or route to it for anyone outside that grant.
		if _, accessErr := database.PersonalAgentForSpace(ctx, userID, spaceID, membership.AgentID); accessErr != nil {
			if errors.Is(accessErr, db.ErrPersonalAgentNotFound) || errors.Is(accessErr, db.ErrSpaceForbidden) {
				continue
			}
			return nil, nil, accessErr
		}
		active = append(active, membership)
	}
	for index := range active {
		if requestedID != "" && active[index].AgentID == requestedID || requestedName != "" && strings.EqualFold(active[index].Name, requestedName) {
			return &active[index], nil, nil
		}
	}
	if requestedID != "" || requestedName != "" {
		return nil, nil, workflowv2.ErrCapabilityDenied
	}
	matched := []db.SpaceAgentMembership{}
	for _, membership := range active {
		if containsGroundingPhrase(originalPrompt, membership.Name) || containsGroundingPhrase(originalPrompt, membership.AgentID) {
			matched = append(matched, membership)
		}
	}
	if len(matched) == 1 {
		return &matched[0], nil, nil
	}
	if len(active) == 1 {
		return &active[0], nil, nil
	}
	choices := make([]map[string]string, 0, len(active))
	for _, membership := range active {
		choices = append(choices, map[string]string{"agent_id": membership.AgentID, "name": membership.Name, "role": membership.SpaceRole})
	}
	return nil, choices, nil
}

func TestingResolveMistyDelegationTarget(ctx context.Context, database *db.Database, userID, spaceID, requestedID, requestedName, originalPrompt string) (*db.SpaceAgentMembership, []map[string]string, error) {
	return resolveMistyDelegationTarget(ctx, database, userID, spaceID, requestedID, requestedName, originalPrompt)
}

func delegatedAgentTargetGrounded(prompt string, membership *db.SpaceAgentMembership) bool {
	if membership == nil || !explicitAgentDelegationIntent(strings.ToLower(prompt)) {
		return false
	}
	return containsGroundingPhrase(prompt, membership.Name) || containsGroundingPhrase(prompt, membership.AgentID) || strings.Contains(strings.ToLower(prompt), "the agent") || strings.Contains(strings.ToLower(prompt), "the teammate")
}

func (s *AIService) runDelegatedPersonalAgent(ctx context.Context, invocation agenttools.Invocation, membership *db.SpaceAgentMembership, prompt string, tier serveragent.AgentTier) (json.RawMessage, error) {
	toolbox, agentInvocation, manifest, err := resolveSpaceAgentToolbox(ctx, s.database, spaceConversationToolActor{
		userID: invocation.UserID, spaceID: invocation.SpaceID, agentID: membership.AgentID, sessionID: invocation.SessionID,
	}, prompt, true, false)
	if err != nil {
		return nil, err
	}
	envelope := TestingMustAPIRawJSON(map[string]any{
		"trigger": "misty_delegation", "source_session_id": invocation.SessionID,
		"agent_membership_id": membership.ID, "approved_agent_version_id": membership.ApprovedVersionID,
		"allowed_tools": manifestToolNames(manifest), "approval_mode": "explicit_message_intent",
	})
	run, err := s.database.CreatePersonalAgentSpaceRun(ctx, invocation.UserID, invocation.SpaceID, membership.AgentID, invocation.SessionID, db.RunSourceAgentConsole, db.RunSourceAgentConsole, TestingMustAPIRawJSON(map[string]any{"prompt": prompt, "source_session_id": invocation.SessionID}), envelope)
	if err != nil {
		return nil, err
	}
	agentInvocation.RunID = run.ID
	failRun := func(runErr error) (json.RawMessage, error) {
		_, _ = s.database.FinishSpaceRun(ctx, run.ID, "failed", TestingMustAPIRawJSON(map[string]string{"message": runErr.Error()}), "agent_delegation_failed")
		return nil, runErr
	}
	contextPermissions, err := s.database.EffectivePersonalAgentContextPermissions(ctx, invocation.UserID, invocation.SpaceID, membership.AgentID)
	if err != nil {
		return failRun(err)
	}
	spaceContext, err := s.database.PersonalAgentSpaceContext(ctx, invocation.UserID, invocation.SpaceID, contextPermissions)
	if err != nil {
		return failRun(err)
	}
	memory, err := s.database.PersonalAgentMemoryContext(ctx, invocation.UserID, invocation.SpaceID, membership.AgentID)
	if err != nil {
		return failRun(err)
	}
	toolPermissions, err := s.database.EffectivePersonalAgentToolPermissions(ctx, invocation.UserID, invocation.SpaceID, membership.AgentID)
	if err != nil {
		return failRun(err)
	}
	groundedPrompt := buildPersonalSpaceAgentPrompt(membership, toolPermissions, manifest, spaceContext, memory, prompt)
	completion, err := s.runtime.CompleteWithModelToolsContext(ctx, invocation.UserID, invocation.UserID, groundedPrompt, membership.ModelID, tier, manifest, func(toolCtx context.Context, request serveragent.ToolRequest) (json.RawMessage, error) {
		return executeSpaceAgentToolbox(toolCtx, toolbox, agentInvocation, s.database, request)
	})
	if err != nil {
		return failRun(err)
	}
	result := TestingMustAPIRawJSON(map[string]any{"status": "completed", "agent_id": membership.AgentID, "agent_name": membership.Name, "run_id": run.ID, "text": completion.Text, "tool_calls": completion.ToolCalls})
	if _, err := s.database.FinishSpaceRun(ctx, run.ID, "completed", result, ""); err != nil {
		return nil, err
	}
	_ = s.database.AppendPersonalAgentMemory(ctx, invocation.UserID, invocation.SpaceID, membership.AgentID, prompt, completion.Text)
	return result, nil
}
