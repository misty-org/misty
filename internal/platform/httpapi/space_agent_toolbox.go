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

const (
	toolboxMessagesSearch = "messages.search"
	toolboxLibrarySearch  = "library.search"
	toolboxTasksQuery     = "tasks.query"
	toolboxTasksCreate    = "tasks.create"
	toolboxTasksUpdate    = "tasks.update"
	toolboxSpacesRename   = "spaces.rename"
	toolboxAgentsDelegate = "agents.delegate"
)

func spaceAgentToolbox(database *db.Database, delegationHandlers ...agenttools.Handler) *agenttools.Registry {
	delegationHandler := agenttools.Handler(func(context.Context, agenttools.Invocation, serveragent.ToolRequest) (json.RawMessage, error) {
		return nil, workflowv2.ErrCapabilityDenied
	})
	if len(delegationHandlers) > 0 && delegationHandlers[0] != nil {
		delegationHandler = delegationHandlers[0]
	}
	messageTriggers := []string{"message"}
	legacyHandler := func(ctx context.Context, invocation agenttools.Invocation, request serveragent.ToolRequest) (json.RawMessage, error) {
		if request.Name == toolboxMessagesSearch {
			request.Name = "space.search_messages"
		}
		return executeSpaceConversationTool(ctx, database, spaceConversationToolActor{
			userID: invocation.UserID, spaceID: invocation.SpaceID, agentID: invocation.AgentID, runID: invocation.RunID,
		}, invocation.OriginalInput, request)
	}
	return agenttools.MustNew(
		agenttools.Registration{Descriptor: withToolTriggers(messagesSearchToolDescriptor(), messageTriggers), Handler: legacyHandler},
		agenttools.Registration{Descriptor: withToolTriggers(messagesSendToolDescriptor(), messageTriggers), Handler: legacyHandler},
		agenttools.Registration{Descriptor: withToolTriggers(librarySearchToolDescriptor(), messageTriggers), Handler: legacyHandler},
		agenttools.Registration{Descriptor: withToolTriggers(tasksQueryToolDescriptor(), messageTriggers), Handler: legacyHandler},
		agenttools.Registration{Descriptor: withToolTriggers(tasksCreateToolDescriptor(), messageTriggers), Handler: legacyHandler},
		agenttools.Registration{Descriptor: withToolTriggers(tasksUpdateToolDescriptor(), messageTriggers), Handler: legacyHandler},
		agenttools.Registration{Descriptor: agentDelegationToolDescriptor(), Handler: delegationHandler},
		agenttools.Registration{Descriptor: agenttools.Descriptor{
			Name: toolboxSpacesRename, Version: 1, Description: "Rename the current Space when its owner explicitly provides the new name.",
			Risk: serveragent.RiskWrite, InputSchema: spaceRenameAgentToolSchema(), OutputSchema: agentToolObjectOutputSchema(), OwnerOnly: true, AllowCustomAgent: false,
			Approval: agenttools.ApprovalExplicitIntent, Locality: agenttools.LocalityServer, Idempotent: true, AuditEvent: "space.updated",
			Sources: []string{"space_conversation"}, Triggers: messageTriggers,
		}, Handler: func(ctx context.Context, invocation agenttools.Invocation, request serveragent.ToolRequest) (json.RawMessage, error) {
			var input struct {
				Name string `json:"name"`
			}
			if json.Unmarshal(request.Arguments, &input) != nil {
				return nil, db.ErrSpaceInvalid
			}
			input.Name = strings.TrimSpace(input.Name)
			if input.Name == "" || !spaceRenameIsGrounded(invocation.OriginalInput, input.Name) {
				return nil, workflowv2.ErrCapabilityDenied
			}
			space, err := database.RenameSpace(ctx, invocation.UserID, invocation.SpaceID, input.Name)
			if err != nil {
				return nil, err
			}
			return TestingMustAPIRawJSON(space), nil
		}},
	)
}

func agentDelegationToolDescriptor() agenttools.Descriptor {
	return agenttools.Descriptor{
		Name: toolboxAgentsDelegate, Version: 1,
		Description: "Delegate an explicit request to an installed, enabled Agent in the current Space and return its audited run result.",
		Risk:        serveragent.RiskWrite,
		InputSchema: TestingMustAPIRawJSON(map[string]any{
			"type": "object", "required": []string{"prompt"},
			"properties": map[string]any{
				"prompt":     map[string]any{"type": "string", "minLength": 1, "maxLength": 16_000},
				"agent_id":   map[string]any{"type": "string", "maxLength": 200},
				"agent_name": map[string]any{"type": "string", "maxLength": 200},
			},
		}),
		OutputSchema: agentToolObjectOutputSchema(), RequiredPermission: db.PermissionAgentsRun,
		AllowCustomAgent: false, Approval: agenttools.ApprovalExplicitIntent,
		Locality: agenttools.LocalityServer, Idempotent: false, AuditEvent: "agent.run.started",
		Sources: []string{"space_conversation"}, Triggers: []string{"message"},
	}
}

func withToolTriggers(descriptor agenttools.Descriptor, triggers []string) agenttools.Descriptor {
	descriptor.Triggers = triggers
	return descriptor
}

func resolveSpaceAgentToolbox(ctx context.Context, database *db.Database, actor spaceConversationToolActor, prompt string, includeMessages, includeLibrary bool, delegationHandlers ...agenttools.Handler) (*agenttools.Registry, agenttools.Invocation, serveragent.ToolManifest, error) {
	requested := TestingCompileAgentIntent(prompt)
	if includeMessages {
		requested = append([]string{toolboxMessagesSearch}, requested...)
	}
	if includeLibrary {
		requested = append([]string{toolboxLibrarySearch}, requested...)
	}
	toolbox := spaceAgentToolbox(database, delegationHandlers...)
	if actor.planOnly {
		requested = readOnlyToolRequests(toolbox, requested)
	}
	explicit := make(map[string]bool, len(requested))
	for _, name := range requested {
		explicit[name] = true
	}
	invocation := agenttools.Invocation{
		UserID: actor.userID, SpaceID: actor.spaceID, AgentID: actor.agentID, RunID: actor.runID,
		SessionID: actor.sessionID, Source: "space_conversation", Trigger: "message", OriginalInput: prompt, ExplicitTools: explicit,
	}
	manifest, err := toolbox.Resolve(ctx, invocation, requested, authorizeSpaceAgentTool(database))
	return toolbox, invocation, manifest, err
}

func readOnlyToolRequests(toolbox *agenttools.Registry, requested []string) []string {
	readable := map[string]bool{}
	for _, descriptor := range toolbox.Descriptors() {
		if descriptor.Risk != serveragent.RiskRead {
			continue
		}
		readable[descriptor.Name] = true
		for _, alias := range descriptor.Aliases {
			readable[alias] = true
		}
	}
	filtered := make([]string, 0, len(requested))
	for _, name := range requested {
		if readable[name] {
			filtered = append(filtered, name)
		}
	}
	return filtered
}

func authorizeSpaceAgentTool(database *db.Database) agenttools.Authorizer {
	return func(ctx context.Context, invocation agenttools.Invocation, descriptor agenttools.Descriptor) (bool, error) {
		if invocation.AgentID != "" && !descriptor.AllowCustomAgent {
			return false, nil
		}
		if invocation.AgentID != "" {
			policy, err := database.EffectivePersonalAgentToolPermissions(ctx, invocation.UserID, invocation.SpaceID, invocation.AgentID)
			if err != nil || !personalAgentToolPolicyAllows(policy, descriptor) {
				return false, err
			}
		}
		if descriptor.OwnerOnly {
			space, err := database.SpaceByID(ctx, invocation.UserID, invocation.SpaceID)
			if err != nil {
				return false, err
			}
			if space.OwnerUserID != invocation.UserID {
				return false, nil
			}
		}
		if descriptor.RequiredPermission == "" {
			return true, nil
		}
		allowed, err := database.HasSpacePermission(ctx, invocation.UserID, invocation.SpaceID, descriptor.RequiredPermission)
		if err != nil || !allowed {
			return allowed, err
		}
		if invocation.AgentID != "" && descriptor.AgentPermission != "" {
			return database.EffectiveAgentSpacePermission(ctx, invocation.UserID, invocation.SpaceID, invocation.AgentID, descriptor.AgentPermission)
		}
		return true, nil
	}
}

func executeSpaceAgentToolbox(ctx context.Context, toolbox *agenttools.Registry, invocation agenttools.Invocation, database *db.Database, request serveragent.ToolRequest) (json.RawMessage, error) {
	result, err := toolbox.ExecuteWithMiddleware(ctx, invocation, request, authorizeSpaceAgentTool(database), agentToolboxExecutionJournal(database))
	if errors.Is(err, agenttools.ErrCapabilityDenied) || errors.Is(err, agenttools.ErrToolNotFound) || errors.Is(err, agenttools.ErrApprovalRequired) {
		return nil, workflowv2.ErrCapabilityDenied
	}
	return result, err
}

func spaceRenameAgentToolSchema() json.RawMessage {
	return TestingMustAPIRawJSON(map[string]any{
		"type": "object", "required": []string{"name"},
		"properties": map[string]any{"name": map[string]any{"type": "string", "minLength": 1, "maxLength": 80}},
	})
}

func spaceRenameIsGrounded(prompt, name string) bool {
	requested := strings.ToLower(requestedSpaceRenameName(prompt))
	name = strings.ToLower(strings.Trim(strings.TrimSpace(name), "\"'` .?!"))
	return requested != "" && requested == name
}

func requestedSpaceRenameName(prompt string) string {
	lower := strings.ToLower(prompt)
	for _, marker := range []string{" space name to ", " space called ", " space named ", " space to ", " space as "} {
		index := strings.Index(lower, marker)
		if index < 0 {
			continue
		}
		value := strings.TrimSpace(prompt[index+len(marker):])
		if lineEnd := strings.IndexAny(value, "\r\n"); lineEnd >= 0 {
			value = value[:lineEnd]
		}
		return strings.Trim(strings.TrimSpace(value), "\"'` .?!")
	}
	return ""
}

func manifestToolNames(manifest serveragent.ToolManifest) []string {
	names := make([]string, 0, len(manifest.Tools))
	for _, tool := range manifest.Tools {
		names = append(names, tool.Name)
	}
	return names
}

func TestingSpaceAgentToolboxDescriptors() []agenttools.Descriptor {
	return spaceAgentToolbox(nil).Descriptors()
}
