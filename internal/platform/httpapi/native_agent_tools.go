package api

import (
	"context"
	"encoding/json"
	serveragent "github.com/kannachi323/misty/server/internal/agents"
	"github.com/kannachi323/misty/server/internal/agenttools"
	db "github.com/kannachi323/misty/server/internal/platform/postgres"
	"strings"
)

func nativeAgentToolDescriptors() []agenttools.Descriptor {
	schema := func(properties map[string]any, required []string) json.RawMessage {
		// JSON Schema requires an array. A nil Go slice serializes as null and
		// prevents the runtime from compiling the entire tool catalog.
		if required == nil {
			required = []string{}
		}
		return TestingMustAPIRawJSON(map[string]any{"type": "object", "properties": properties, "required": required, "additionalProperties": false})
	}
	text := map[string]any{"type": "string", "maxLength": 16000}
	base := agenttools.Descriptor{Version: 1, OutputSchema: agentToolObjectOutputSchema(), Locality: agenttools.LocalityServer, Sources: agentToolboxSpaceSources, Triggers: []string{"message"}, AllowCustomAgent: true, Idempotent: true}
	list := base
	list.Name = "agents.list"
	list.Description = "List this user's personal agents, their current Space app assignments, and installed apps. Social has app ID chat. These agents are private to this user."
	list.Risk = serveragent.RiskRead
	list.InputSchema = schema(map[string]any{}, nil)
	list.Approval = agenttools.ApprovalNone
	manage := base
	manage.Name = "agents.configure"
	manage.Description = "Create, update, or delete a personal agent only when the user explicitly requests agent setup or configuration. Do not expand app assignments to complete an ordinary task. For update, provide the current version from agents.list. app_ids replaces the assignments in this Space; omit it to leave assignments unchanged. Creating without app_ids assigns no apps. Return the actual saved profile and assignments. Use model IDs from agents.list; automatic clears a pinned preference. Never delete the default Misty agent. Deletion is only for an explicit request to delete that named agent, not to stop a task."
	manage.Risk = serveragent.RiskWrite
	manage.Approval = agenttools.ApprovalExplicitIntent
	manage.AuditEvent = "agents.configured"
	manage.InputSchema = schema(map[string]any{"operation": map[string]any{"type": "string", "enum": []string{"create", "update", "delete"}}, "agent_id": text, "version": map[string]any{"type": "integer", "minimum": 1}, "name": text, "role": text, "description": text, "instructions": text, "avatar_emoji": map[string]any{"type": "string", "maxLength": 32}, "enabled": map[string]any{"type": "boolean"}, "model_mode": map[string]any{"type": "string", "enum": []string{"automatic", "pinned"}}, "model_id": map[string]any{"type": "string", "maxLength": 200}, "reasoning_effort": map[string]any{"type": "string", "maxLength": 32}, "app_ids": map[string]any{"type": "array", "maxItems": 200, "items": map[string]any{"type": "string", "maxLength": 128}}}, []string{"operation"})
	return []agenttools.Descriptor{list, manage}
}

func executeNativeAgentTool(ctx context.Context, database *db.Database, i agenttools.Invocation, r serveragent.ToolRequest) (json.RawMessage, error) {
	agents, err := database.PersonalAgents(ctx, i.UserID)
	if err != nil {
		return nil, err
	}
	if r.Name == "agents.list" {
		apps, err := database.UserApps(ctx, i.UserID)
		if err != nil {
			return nil, err
		}
		assignments := map[string][]string{}
		for _, a := range agents {
			ids, err := database.AgentAppAssignments(ctx, i.UserID, a.ID, i.SpaceID)
			if err != nil {
				return nil, err
			}
			assignments[a.ID] = ids
		}
		models, err := serveragent.FrontierGatewayModels(ctx)
		if err != nil {
			return nil, err
		}
		return json.Marshal(map[string]any{"models": models, "agents": agents, "assignments": assignments, "installed_apps": apps, "app_labels": map[string]string{"chat": "Social", "planner": "Planner", "journal": "Journal", "library": "Library"}})
	}
	var input struct {
		Operation       string    `json:"operation"`
		AgentID         string    `json:"agent_id"`
		Version         int64     `json:"version"`
		Name            *string   `json:"name"`
		Role            *string   `json:"role"`
		Description     *string   `json:"description"`
		Instructions    *string   `json:"instructions"`
		AppIDs          *[]string `json:"app_ids"`
		AvatarEmoji     *string   `json:"avatar_emoji"`
		Enabled         *bool     `json:"enabled"`
		ModelMode       *string   `json:"model_mode"`
		ModelID         *string   `json:"model_id"`
		ReasoningEffort *string   `json:"reasoning_effort"`
	}
	if json.Unmarshal(r.Arguments, &input) != nil || input.Operation != "create" && input.Operation != "update" && input.Operation != "delete" {
		return nil, db.ErrSpaceInvalid
	}
	if input.Operation == "delete" {
		if err := database.DeletePersonalAgent(ctx, i.UserID, input.AgentID); err != nil {
			return nil, err
		}
		return json.Marshal(map[string]any{"deleted_agent_id": input.AgentID})
	}
	profile := db.AgentProfileInput{Enabled: true, ModelMode: "automatic", Icon: "sparkles"}
	if input.Operation == "update" {
		a, err := database.AskIdentityByID(ctx, i.UserID, input.AgentID)
		if err != nil {
			return nil, err
		}
		profile = db.AgentProfileInput{Name: a.Name, Role: a.Role, Description: a.Description, Instructions: a.Instructions, Icon: a.Icon, Avatar: a.Avatar, ModelMode: a.ModelMode, ModelID: a.ModelID, ReasoningEffort: a.ReasoningEffort, Enabled: a.Enabled, Version: input.Version}
	} else {
		input.AgentID = ""
	}
	if input.Name != nil {
		profile.Name = strings.TrimSpace(*input.Name)
	}
	if input.Role != nil {
		profile.Role = *input.Role
	}
	if input.Description != nil {
		profile.Description = *input.Description
	}
	if input.Instructions != nil {
		profile.Instructions = *input.Instructions
	}
	if input.AvatarEmoji != nil {
		profile.Avatar, _ = json.Marshal(map[string]string{"emoji": *input.AvatarEmoji})
	}
	if input.Enabled != nil {
		profile.Enabled = *input.Enabled
	}
	if input.ModelMode != nil {
		profile.ModelMode = *input.ModelMode
	}
	if input.ModelID != nil {
		profile.ModelID = *input.ModelID
	}
	if input.ReasoningEffort != nil {
		profile.ReasoningEffort = *input.ReasoningEffort
	}
	if profile.ModelMode == "automatic" {
		profile.ModelID = ""
		profile.ReasoningEffort = ""
	}
	if profile.ModelMode == "pinned" && (!serveragent.FrontierModelAvailable(ctx, profile.ModelID) || !serveragent.FrontierModelReasoningAvailable(ctx, profile.ModelID, profile.ReasoningEffort)) {
		return nil, db.ErrSpaceInvalid
	}
	if input.AppIDs != nil {
		profile.Assignment = &db.AgentAppAssignmentInput{SpaceID: i.SpaceID, AppIDs: *input.AppIDs}
	}
	saved, err := database.SavePersonalAgent(ctx, i.UserID, input.AgentID, profile)
	if err != nil {
		return nil, err
	}
	assignments, err := database.AgentAppAssignments(ctx, i.UserID, saved.ID, i.SpaceID)
	if err != nil {
		return nil, err
	}
	return json.Marshal(map[string]any{"agent": saved, "app_ids": assignments, "space_id": i.SpaceID})
}
