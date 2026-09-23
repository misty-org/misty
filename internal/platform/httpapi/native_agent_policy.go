package api

import (
	"context"
	"encoding/json"
	serveragent "github.com/kannachi323/misty/server/internal/agents"
	"github.com/kannachi323/misty/server/internal/agenttools"
	db "github.com/kannachi323/misty/server/internal/platform/postgres"
	"strings"
)

func nativeAgentManagementTool(name string) bool {
	return strings.HasPrefix(name, "agents.") || strings.HasPrefix(name, "memory.")
}

func nativeAgentToolAllowed(name, risk, mode string, tools map[string]bool) bool {
	if strings.HasPrefix(name, "browser.workspace.") {
		return mode == "agent" && tools["browser"]
	}
	if strings.HasPrefix(name, "agents.") {
		return true
	}
	if strings.HasPrefix(name, "memory.") {
		return true
	}
	if name == "ask.delegate" {
		return false
	}
	if strings.HasPrefix(name, "mcp.") {
		return true
	}
	if strings.HasPrefix(name, "browser.") {
		return tools["browser"]
	}
	if strings.HasPrefix(name, "files.") {
		return tools["files"]
	}
	return name == "weather.current"
}

func nativeAgentInvocationPolicy(ctx context.Context, database *db.Database, invocation agenttools.Invocation, descriptor agenttools.Descriptor) (bool, bool, error) {
	if database == nil || !isAIInvocationRuntimeID(invocation.RunID) {
		return false, false, nil
	}
	record, err := database.AIInvocationByID(ctx, invocation.UserID, invocation.RunID)
	if err != nil {
		return true, false, err
	}
	var body aiInvocationInput
	if json.Unmarshal(record.RequestPayload, &body) != nil {
		return true, false, db.ErrSpaceInvalid
	}
	if body.AgentID == "" {
		return false, false, nil
	} // Existing admitted runtime records retain their protocol.
	if err := database.ValidateNativeAgentExecution(ctx, record); err != nil {
		return true, false, err
	}
	visibleAutopilot := false
	for _, target := range body.DeviceContexts {
		var metadata map[string]any
		_ = json.Unmarshal(target.Metadata, &metadata)
		if metadata["workspace_control"] == true {
			visibleAutopilot = true
		}
	}
	if visibleAutopilot && descriptor.Risk != serveragent.RiskRead && descriptor.Name != "browser.workspace.interact" {
		return true, false, nil
	}
	tools, err := database.AgentWorkspaceTools(ctx, record.UserID, body.AgentID)
	if err != nil {
		return true, false, err
	}
	allowed := map[string]bool{}
	for _, id := range tools {
		allowed[id] = true
	}
	if descriptor.ProviderBinding != nil {
		if descriptor.ProviderBinding.ProviderID != "" && allowed[descriptor.ProviderBinding.ProviderID] {
			return true, nativeAgentToolAllowed(descriptor.Name, descriptor.Risk, body.ExecutionMode, allowed), nil
		}
		return true, false, nil
	}
	if strings.HasPrefix(descriptor.Name, "mcp.") {
		authorized, err := authorizeMCPAgentTool(ctx, database, invocation, descriptor)
		if err != nil {
			return true, false, err
		}
		if !authorized {
			return true, false, nil
		}
		return true, nativeAgentToolAllowed(descriptor.Name, descriptor.Risk, body.ExecutionMode, allowed), nil
	}
	if strings.HasPrefix(descriptor.Name, "browser.workspace.") && (body.ExecutionMode != "agent" || body.WindowLabel != "main" || body.TaskID == "") {
		return true, false, nil
	}
	if strings.HasPrefix(descriptor.Name, "browser.") {
		contexts, err := database.AIInvocationContexts(ctx, record.UserID, record.ID)
		if err != nil {
			return true, false, err
		}
		permitted := false
		for _, item := range contexts {
			var metadata struct {
				AppID string `json:"app_id"`
			}
			if json.Unmarshal(item.Metadata, &metadata) == nil && metadata.AppID == "browser" && allowed["browser"] {
				permitted = true
			}
		}
		if !permitted {
			return true, false, nil
		}
	}
	return true, nativeAgentToolAllowed(descriptor.Name, descriptor.Risk, body.ExecutionMode, allowed), nil
}

func filterNativeAgentContext(refs []aiContextReference, tools []string) []aiContextReference {
	browser := false
	for _, tool := range tools {
		if tool == "browser" {
			browser = true
		}
	}
	result := []aiContextReference{}
	for _, ref := range refs {
		switch ref.Kind {
		case "browser-tab":
			if browser && ref.Metadata["app_id"] == "browser" {
				result = append(result, ref)
			}
		case "workspace-view", "workspace.scope":
			// The context broker separately validates ownership and members.
			result = append(result, ref)
		}
	}
	return result
}

// Recheck the exact target immediately before dispatch; another assigned scope is not authority.
func authorizeNativeAgentBrowserScope(ctx context.Context, database *db.Database, invocation agenttools.Invocation, scopeID string) error {
	if !isAIInvocationRuntimeID(invocation.RunID) {
		return nil
	}
	record, err := database.AIInvocationByID(ctx, invocation.UserID, invocation.RunID)
	if err != nil {
		return err
	}
	var body aiInvocationInput
	if json.Unmarshal(record.RequestPayload, &body) != nil {
		return db.ErrSpaceInvalid
	}
	if body.AgentID == "" {
		return nil
	}
	tools, err := database.AgentWorkspaceTools(ctx, record.UserID, body.AgentID)
	if err != nil {
		return err
	}
	contexts, err := database.AIInvocationContexts(ctx, record.UserID, record.ID)
	if err != nil {
		return err
	}
	for _, item := range contexts {
		if item.OpaqueRef != scopeID || item.SpaceID != record.SpaceID {
			continue
		}
		var metadata struct {
			AppID       string `json:"app_id"`
			WindowLabel string `json:"window_label"`
		}
		if json.Unmarshal(item.Metadata, &metadata) != nil || metadata.WindowLabel != body.WindowLabel {
			return db.ErrSpaceForbidden
		}
		for _, tool := range tools {
			if tool == "browser" && metadata.AppID == "browser" {
				return nil
			}
		}
	}
	return db.ErrSpaceForbidden
}
