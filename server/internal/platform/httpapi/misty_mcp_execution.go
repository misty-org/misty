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
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// executeAIInvocationMCPTool runs one chat tool call through the run's catalog.
func (s *SpacesService) executeAIInvocationMCPTool(ctx context.Context, access *mcpRuntimeAccess, call agentRuntimeToolCall) (json.RawMessage, error) {
	if access == nil || access.record == nil || access.prepared == nil || !agentToolNameAllowed(access.prepared.allowedTools, call.Name) {
		return nil, workflowv2.ErrCapabilityDenied
	}
	ctx = withAgentExecutionRuntime(ctx, call.RuntimeRunID)
	if call.Name == "browser.request_user_action" {
		if !access.claims.InterventionWaits {
			return nil, db.ErrSpaceForbidden
		}
		return s.requestAIUserAction(ctx, access.record.UserID, access.record.ID, call)
	}
	if strings.HasPrefix(call.Name, "browser.") {
		if err := s.aiBrowserDeviceWait(ctx, access, call, false); err != nil {
			return nil, err
		}
	}
	if access.prepared.toolbox == nil {
		return nil, workflowv2.ErrCapabilityDenied
	}
	bounded, cancel, err := boundedAgentExecutionContext(ctx, s.database, access.record.UserID, access.record.ID)
	if err != nil {
		return nil, err
	}
	defer cancel()
	result, err := executeSpaceAgentToolbox(bounded, access.prepared.toolbox, access.prepared.toolInvocation, s.database, serveragent.ToolRequest{
		ID: call.CallID, Name: call.Name, Arguments: call.Arguments,
	})
	if errors.Is(err, workflowv2.ErrDeviceUnavailable) && errors.Is(err, db.ErrAgentToolboxNotAttempted) {
		return nil, s.aiBrowserDeviceWait(ctx, access, call, true)
	}
	if errors.Is(err, db.ErrAgentToolboxActionUnknown) {
		return TestingMustAPIRawJSON(map[string]any{"status": "uncertain", "effect_id": call.CallID, "reason": "The action may have happened. Review its observed outcome before retrying."}), nil
	}
	if err != nil {
		return nil, err
	}
	_ = s.database.TouchAIInvocationRuntime(ctx, access.record.ID, access.claims.RuntimeRunID)
	return result, nil
}

func mcpRunToolDefinition(descriptor agenttools.Descriptor) *mcp.Tool {
	definition := mcpToolDefinition(descriptor)
	if descriptor.ProviderBinding != nil {
		definition.OutputSchema = map[string]any{"oneOf": []any{
			map[string]any{"type": "object", "required": []string{"status", "result", "evidence", "partial"}, "properties": map[string]any{"status": map[string]any{"const": "success"}, "result": descriptor.OutputSchema, "evidence": map[string]any{"type": "array"}, "partial": map[string]any{"type": "boolean"}}},
			map[string]any{"type": "object", "required": []string{"status", "effectId", "reason", "evidence"}, "properties": map[string]any{"status": map[string]any{"const": "uncertain"}}},
		}}
	}
	return definition
}

func mcpSDKToolError(err error) *mcp.CallToolResult {
	var intervention *aiInterventionRequired
	if errors.As(err, &intervention) {
		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: "User action is required in the original browser target."}}, Meta: mcp.Meta{"misty/intervention_wait": intervention.wait}}
	}
	return mcpToolError(err)
}
