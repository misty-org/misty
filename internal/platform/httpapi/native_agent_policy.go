package api

import (
	"context"
	"encoding/json"
	serveragent "github.com/kannachi323/misty/server/internal/agents"
	"github.com/kannachi323/misty/server/internal/agenttools"
	db "github.com/kannachi323/misty/server/internal/platform/postgres"
	"strings"
)

// App ownership is independent of language, role names, and model planning.
func nativeAgentToolApp(name string) string {
	switch strings.Split(name, ".")[0] {
	case "tasks", "calendar", "roadmaps", "roadmap":
		return "planner"
	case "notes", "drawings":
		return "journal"
	case "library":
		return "library"
	case "messages", "space":
		return "chat"
	case "mail":
		return "inbox"
	case "files":
		return "files"
	case "terminal":
		return "terminal"
	case "code":
		return "code"
	}
	return ""
}

func nativeAgentManagementTool(name string) bool {
	return strings.HasPrefix(name, "agents.") || strings.HasPrefix(name, "memory.")
}

func nativeAgentToolAllowed(name, risk, mode string, apps map[string]bool) bool {
	if strings.HasPrefix(name, "agents.") {
		return risk == serveragent.RiskRead || mode == "user"
	}
	if strings.HasPrefix(name, "memory.") {
		return true
	}
	if name == "ask.delegate" || strings.HasPrefix(name, "mcp.") {
		return false
	}
	if risk != serveragent.RiskRead && mode == "user" {
		return false
	}
	if app := nativeAgentToolApp(name); app != "" {
		return apps[app]
	}
	return name == "members.list" || name == "members.resolve" || name == "weather.current" || strings.HasPrefix(name, "browser.")
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
	apps, err := database.AgentAppAssignments(ctx, record.UserID, body.AgentID, record.SpaceID)
	if err != nil {
		return true, false, err
	}
	allowed := map[string]bool{}
	for _, id := range apps {
		allowed[id] = true
	}
	if descriptor.ProviderBinding != nil {
		return true, false, nil
	} // Browser/native app tools are the v1 execution path.
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
			if json.Unmarshal(item.Metadata, &metadata) == nil && allowed[metadata.AppID] {
				permitted = true
			}
		}
		if !permitted {
			return true, false, nil
		}
	}
	return true, nativeAgentToolAllowed(descriptor.Name, descriptor.Risk, body.ExecutionMode, allowed), nil
}

func nativeAgentContextApp(kind string) string {
	switch kind {
	case "note", "notes", "drawing":
		return "journal"
	case "task", "planner.task", "roadmap", "planner.roadmap":
		return "planner"
	case "space.chat":
		return "chat"
	case "library.item":
		return "library"
	case "mail.thread":
		return "inbox"
	}
	return ""
}

func filterNativeAgentContext(refs []aiContextReference, apps []string) []aiContextReference {
	allowed := map[string]bool{}
	for _, id := range apps {
		allowed[id] = true
	}
	result := []aiContextReference{}
	for _, ref := range refs {
		app := nativeAgentContextApp(ref.Kind)
		if ref.Kind == "browser-tab" {
			app, _ = ref.Metadata["app_id"].(string)
		}
		if app != "" && allowed[app] {
			result = append(result, ref)
			continue
		}
		// Space references identify the boundary; broad workspace retrieval is not an assignment.
		if ref.Kind == "space" {
			ref.Metadata = nil
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
	apps, err := database.AgentAppAssignments(ctx, record.UserID, body.AgentID, record.SpaceID)
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
		for _, app := range apps {
			if app == metadata.AppID {
				return nil
			}
		}
	}
	return db.ErrSpaceForbidden
}
