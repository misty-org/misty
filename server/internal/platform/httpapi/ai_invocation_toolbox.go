package api

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	serveragent "github.com/kannachi323/misty/server/internal/agents"
	"github.com/kannachi323/misty/server/internal/agenttools"
	db "github.com/kannachi323/misty/server/internal/platform/postgres"
)

// aiInvocationToolbox resolves one chat run's complete catalog: Misty data
// tools, attached browser tools and the agent's connected tools. The runtime
// context, the MCP server and every tool call use this same resolution.
func (s *SpacesService) aiInvocationToolbox(ctx context.Context, record *db.AIInvocationRecord, agentID, prompt string) (*agenttools.Registry, agenttools.Invocation, serveragent.ToolManifest, error) {
	actor := spaceConversationToolActor{userID: record.UserID, agentID: agentID, runID: record.ID, sessionID: record.ConversationID}
	return resolveAIInvocationSpaceToolbox(ctx, s.database, actor, prompt, s.aiInvocationConnectedTools(ctx, record, agentID)...)
}

// aiInvocationConnectedTools are the user's connected apps, plus an agent's
// MCP connectors.
func (s *SpacesService) aiInvocationConnectedTools(ctx context.Context, record *db.AIInvocationRecord, agentID string) []agenttools.Registration {
	registrations := append(s.appsToolRegistrations(), s.screenToolRegistrations(record)...)
	if agentID == "" {
		return registrations
	}
	run := &db.SpaceRun{ID: record.ID, OwnerUserID: record.UserID, RequestingMemberID: record.UserID, AgentID: agentID}
	mcpHandler := func(toolCtx context.Context, _ agenttools.Invocation, tool serveragent.ToolRequest) (json.RawMessage, error) {
		return s.executeMCPAgentTool(toolCtx, run, tool, false, "space_conversation")
	}
	registrations, _ = s.appendPersonalAgentMCPTools(ctx, record.UserID, agentID, registrations, nil, mcpHandler)
	return registrations
}

func resolveAIInvocationSpaceToolbox(ctx context.Context, database *db.Database, actor spaceConversationToolActor, prompt string, connected ...agenttools.Registration) (*agenttools.Registry, agenttools.Invocation, serveragent.ToolManifest, error) {
	browserTabs, browserCapabilities := aiInvocationBrowserGrants(ctx, database, actor.userID, actor.runID)
	options := agentToolboxOptions{
		accountLevel: actor.spaceID == "", browserTabs: browserTabs, browserCapabilities: browserCapabilities, extra: connected,
	}
	if actor.agentID == "" {
		options.delegation = func(ctx context.Context, invocation agenttools.Invocation, request serveragent.ToolRequest) (json.RawMessage, error) {
			var input struct {
				Prompt string `json:"prompt"`
			}
			if json.Unmarshal(request.Arguments, &input) != nil || strings.TrimSpace(input.Prompt) == "" {
				return nil, db.ErrSpaceInvalid
			}
			identity, err := database.EnsureAskIdentity(ctx, actor.userID, serveragent.InitialSelectedModelID)
			if err != nil {
				return nil, err
			}
			child, err := database.CreateCreatorAgentRun(ctx, actor.userID, actor.spaceID, identity.ID, db.CreatorAgentRunInput{Instruction: input.Prompt, Mode: "auto", ParentInvocationID: actor.runID, AIConversationID: actor.sessionID})
			if err != nil {
				return nil, err
			}
			return json.Marshal(map[string]any{"run_id": child.ID, "state": child.State, "worker": "background"})
		}
	}
	toolbox := buildAgentToolbox(database, options)
	names := make([]string, 0, len(toolbox.Descriptors()))
	for _, descriptor := range toolbox.Descriptors() {
		names = append(names, descriptor.Name)
	}
	invocation := agenttools.Invocation{
		UserID: actor.userID, SpaceID: actor.spaceID, AgentID: actor.agentID,
		RunID: actor.runID, SessionID: actor.sessionID, Source: "space_conversation",
		Trigger: "message", OriginalInput: prompt, ConversationScopeKind: db.ConversationScopeEveryone,
	}
	manifest, err := toolbox.Resolve(ctx, invocation, names, authorizeSpaceAgentTool(database))
	return toolbox, invocation, manifest, err
}

func TestingResolveAIInvocationSpaceToolNames(ctx context.Context, database *db.Database, userID, spaceID, invocationID, prompt string) ([]string, error) {
	if err := testingAdmitToolInvocation(ctx, database, userID, spaceID, invocationID, prompt); err != nil {
		return nil, err
	}
	_, _, manifest, err := resolveAIInvocationSpaceToolbox(ctx, database, spaceConversationToolActor{
		userID: userID, spaceID: spaceID, runID: invocationID,
	}, prompt)
	return manifestToolNames(manifest), err
}

func TestingResolveAIInvocationSpaceToolNamesWithConversation(ctx context.Context, database *db.Database, userID, spaceID, conversationID, invocationID, prompt string) ([]string, error) {
	if err := testingAdmitToolInvocation(ctx, database, userID, spaceID, invocationID, prompt); err != nil {
		return nil, err
	}
	_, _, manifest, err := resolveAIInvocationSpaceToolbox(ctx, database, spaceConversationToolActor{
		userID: userID, spaceID: spaceID, runID: invocationID, sessionID: conversationID,
	}, prompt)
	return manifestToolNames(manifest), err
}

func TestingExecuteAIInvocationSpaceTool(ctx context.Context, database *db.Database, userID, spaceID, invocationID, prompt, name string, arguments json.RawMessage) (json.RawMessage, error) {
	return TestingExecuteAIInvocationSpaceToolWithConversation(ctx, database, userID, spaceID, "", invocationID, prompt, name, arguments)
}

func TestingExecuteAIInvocationSpaceToolWithConversation(ctx context.Context, database *db.Database, userID, spaceID, conversationID, invocationID, prompt, name string, arguments json.RawMessage) (json.RawMessage, error) {
	if err := testingAdmitToolInvocation(ctx, database, userID, spaceID, invocationID, prompt); err != nil {
		return nil, err
	}
	toolbox, invocation, manifest, err := resolveAIInvocationSpaceToolbox(ctx, database, spaceConversationToolActor{
		userID: userID, spaceID: spaceID, runID: invocationID, sessionID: conversationID,
	}, prompt)
	if err != nil {
		return nil, err
	}
	if !agentManifestHasTool(manifest, name) {
		return nil, agenttools.ErrCapabilityDenied
	}
	return executeSpaceAgentToolbox(ctx, toolbox, invocation, database, serveragent.ToolRequest{
		ID: "testing-" + name, Name: name, Arguments: arguments,
	})
}

func aiInvocationBrowserGrants(ctx context.Context, database *db.Database, userID, invocationID string) ([]string, map[string]bool) {
	labels := []string{}
	capabilities := map[string]bool{}
	if database == nil || !isAIInvocationRuntimeID(invocationID) {
		return labels, capabilities
	}
	contexts, err := database.AIInvocationContexts(ctx, userID, invocationID)
	if err != nil {
		return labels, capabilities
	}
	for _, item := range contexts {
		var granted []string
		if json.Unmarshal(item.Capabilities, &granted) != nil {
			continue
		}
		for _, capability := range granted {
			capabilities[capability] = true
		}
		label := strings.TrimSpace(item.DisplayName)
		if label == "" {
			label = "Misty browser"
		}
		labels = append(labels, label+" (scopeId "+item.OpaqueRef+")")
	}
	if capabilities["browser.inspect"] {
		capabilities["browser.request_user_action"] = true
	}
	return labels, capabilities
}

func agentToolNameAllowed(allowed []string, name string) bool {
	for _, candidate := range allowed {
		if candidate == name {
			return true
		}
	}
	return false
}

func agentManifestHasTool(manifest serveragent.ToolManifest, name string) bool {
	for _, tool := range manifest.Tools {
		if tool.Name == name {
			return true
		}
	}
	return false
}

// Test adapters use admitted identities just like the public invocation path.
func testingAdmitToolInvocation(ctx context.Context, database *db.Database, userID, spaceID, id, prompt string) error {
	if database == nil || id == "" {
		return nil
	}
	if _, err := database.AIInvocationByID(ctx, userID, id); err == nil {
		return nil
	} else if !errors.Is(err, db.ErrSpaceNotFound) {
		return err
	}
	_, _, err := database.CreateAIInvocationRecord(ctx, db.AIInvocationRecord{ID: id, UserID: userID, SpaceID: spaceID, SurfaceID: "notes", Mode: "quick", Trigger: "selection", State: "running", IdempotencyKey: id, RequestPayload: TestingMustAPIRawJSON(map[string]any{"prompt": prompt}), ExpiresAt: time.Now().Add(time.Hour)})
	return err
}
