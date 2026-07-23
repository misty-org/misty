package api

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	serveragent "github.com/kannachi323/misty/server/agent"
	"github.com/kannachi323/misty/server/db"
	workflowv2 "github.com/kannachi323/misty/server/workflow"
)

func (s *SpacesService) executeWorkflowV2(ctx context.Context, run *db.SpaceRun, agent *db.SpaceStudioResource, version *db.WorkflowVersion, prompt string) (*db.SpaceRun, error) {
	var definition workflowv2.Definition
	if json.Unmarshal(version.Definition, &definition) != nil {
		return s.finishFailedCanonicalRun(ctx, run, db.ErrSpaceInvalid)
	}
	registry := workflowv2.NewRegistry()
	toolProviders := map[string]workflowv2.NodeDescriptor{}
	declaredCapabilities := map[string]workflowv2.Risk{}
	for _, capability := range definition.Capabilities {
		declaredCapabilities[capability.Capability] = capability.Risk
	}
	for _, core := range workflowv2.CoreRegistry().Descriptors() {
		descriptor := core
		descriptor.Execute = func(ctx context.Context, invocation workflowv2.Invocation) (json.RawMessage, error) {
			return s.executeWorkflowNodeV2(ctx, run, agent, descriptor, invocation, prompt, toolProviders)
		}
		if descriptor.SupportsReconcile {
			descriptor.Reconcile = func(context.Context, workflowv2.Invocation) (json.RawMessage, bool, error) { return nil, false, nil }
		}
		if err := registry.Register(descriptor); err != nil {
			return s.finishFailedCanonicalRun(ctx, run, err)
		}
		if workflowToolEligible(descriptor, declaredCapabilities) {
			toolProviders["workflow."+descriptor.Kind] = descriptor
		}
	}
	resolver, err := s.workflowDependencyResolver(ctx, run, definition)
	if err != nil {
		return s.finishFailedCanonicalRun(ctx, run, err)
	}
	completedOutputs, err := s.database.CompletedWorkflowStepOutputs(ctx, run.RequestingMemberID, run.ID)
	if err != nil {
		return s.finishFailedCanonicalRun(ctx, run, err)
	}
	engine := workflowv2.Engine{
		Registry: registry,
		Resolver: resolver,
		Checkpoint: func(ctx context.Context, event workflowv2.StepEvent) error {
			return s.database.CheckpointWorkflowStep(ctx, run.ID, event)
		},
		Cooldown: func(ctx context.Context, _ workflowv2.StepEvent, seconds int) error {
			if seconds != 60 {
				return workflowv2.ErrInvalidDefinition
			}
			timer := time.NewTimer(time.Minute)
			defer timer.Stop()
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-timer.C:
				return nil
			}
		},
		ItemCheckpoint: func(itemCtx context.Context, _ string, item json.RawMessage, result workflowv2.ExecutionResult, itemErr error) error {
			provider, eventID := workflowEventIdentity(item)
			if provider == "" || eventID == "" {
				return nil
			}
			state := "completed"
			if itemErr != nil || result.State != workflowv2.RunCompleted {
				state = "failed"
			}
			return s.database.FinishWorkflowEventClaim(itemCtx, run.AgentInstanceID, run.WorkflowVersionID, provider, eventID, run.ID, state)
		},
	}
	// Bind the authorized tool catalog after registration so Agent-task nodes
	// use the same concrete providers, journaling, and permission context.
	for key, descriptor := range toolProviders {
		provider := descriptor
		provider.Execute = func(toolCtx context.Context, toolInvocation workflowv2.Invocation) (json.RawMessage, error) {
			return s.executeWorkflowNodeV2(toolCtx, run, agent, provider, toolInvocation, prompt, toolProviders)
		}
		toolProviders[key] = provider
	}
	result, err := engine.Execute(ctx, definition, workflowv2.ExecutionRequest{RunID: run.ID, UserID: run.RequestingMemberID, SpaceID: run.SpaceID, Input: run.Input, Completed: completedOutputs})
	if err != nil {
		if errors.Is(err, workflowv2.ErrAwaitingApproval) {
			return s.database.SpaceRun(ctx, run.RequestingMemberID, run.ID)
		}
		return s.finishFailedCanonicalRun(ctx, run, err)
	}
	serialized := mustAPIRawJSON(map[string]any{"nodes": result.Outputs, "errors": result.Errors})
	return s.database.FinishSpaceRun(ctx, run.ID, string(result.State), serialized, "")
}

type apiWorkflowDependency struct {
	workflowID, checksum string
	definition           workflowv2.Definition
}
type apiWorkflowResolver map[string]apiWorkflowDependency

func (resolver apiWorkflowResolver) ResolveWorkflowVersion(versionID string) (string, string, workflowv2.Definition, bool) {
	item, ok := resolver[versionID]
	return item.workflowID, item.checksum, item.definition, ok
}

func (s *SpacesService) workflowDependencyResolver(ctx context.Context, run *db.SpaceRun, root workflowv2.Definition) (apiWorkflowResolver, error) {
	resolver := apiWorkflowResolver{}
	var load func(workflowv2.Definition) error
	load = func(definition workflowv2.Definition) error {
		for _, dependency := range definition.Dependencies {
			if _, exists := resolver[dependency.VersionID]; exists {
				continue
			}
			version, err := s.database.WorkflowVersion(ctx, run.RequestingMemberID, run.SpaceID, dependency.VersionID)
			if err != nil {
				return err
			}
			var child workflowv2.Definition
			if json.Unmarshal(version.Definition, &child) != nil {
				return db.ErrSpaceInvalid
			}
			resolver[dependency.VersionID] = apiWorkflowDependency{workflowID: version.WorkflowID, checksum: version.ChecksumSHA256, definition: child}
			if err := load(child); err != nil {
				return err
			}
		}
		return nil
	}
	return resolver, load(root)
}

func (s *SpacesService) executeWorkflowNodeV2(ctx context.Context, run *db.SpaceRun, agent *db.SpaceStudioResource, descriptor workflowv2.NodeDescriptor, invocation workflowv2.Invocation, prompt string, toolProviders map[string]workflowv2.NodeDescriptor) (json.RawMessage, error) {
	readResult := func() (json.RawMessage, error) {
		switch descriptor.Kind {
		case "manual_trigger", "chat_trigger", "cron_trigger", "file_changes", "library_changes", "message_trigger", "connector_trigger", "task_change_trigger", "transform", "join", "debounce", "for_each", "call_workflow":
			var value any
			if json.Unmarshal(invocation.Input, &value) != nil {
				return nil, workflowv2.ErrOutputInvalid
			}
			return mustAPIRawJSON(map[string]any{"value": value, "node": descriptor.Kind}), nil
		case "condition", "switch":
			return evaluateControlBranch(descriptor.Kind, invocation)
		case "delay":
			var config struct {
				Seconds int `json:"seconds"`
			}
			_ = json.Unmarshal(invocation.Config, &config)
			if config.Seconds < 0 || config.Seconds > 86400 {
				return nil, workflowv2.ErrOutputInvalid
			}
			if config.Seconds > 0 {
				timer := time.NewTimer(time.Duration(config.Seconds) * time.Second)
				defer timer.Stop()
				select {
				case <-ctx.Done():
					return nil, ctx.Err()
				case <-timer.C:
				}
			}
			return mustAPIRawJSON(map[string]any{"value": json.RawMessage(invocation.Input), "delayedSeconds": config.Seconds}), nil
		case "source_query":
			providerConfig := decodeProviderNodeConfig(invocation.Config)
			if providerConfig.Provider != "" {
				return s.providerQueryNode(ctx, run, invocation)
			}
			return s.sourceQueryNode(ctx, run, invocation)
		case "read_metadata":
			return s.readMetadataNode(ctx, run, invocation)
		case "task_query":
			return s.taskQueryNode(ctx, run, invocation)
		case "calendar_query":
			return s.calendarQueryNode(ctx, run, invocation)
		case "changed_files":
			return s.changedFilesNode(ctx, run, invocation)
		case "read_content":
			prepared, err := s.prepareContentInvocation(ctx, run, invocation)
			if err != nil {
				if errors.Is(err, workflowv2.ErrDeviceUnavailable) {
					return s.executeLeasedDeviceNode(ctx, run, descriptor, invocation)
				}
				return nil, err
			}
			return normalizeContentPage(run, prepared)
		case "agent_task":
			if s.agent == nil {
				return nil, errors.New("Agent runtime is unavailable")
			}
			var config struct {
				Instructions string `json:"instructions"`
			}
			_ = json.Unmarshal(invocation.Config, &config)
			request := fmt.Sprintf("You are %s. Follow the pinned Agent instructions:\n%s\n\nComplete workflow node %s. Required outcome:\n%s\n\nThe available capabilities are limited to the published workflow envelope. Return a concise result grounded in the supplied input.\n\nInput:\n%s\n\nOriginal user request:\n%s", agent.Name, agent.Instructions, invocation.NodeID, config.Instructions, string(invocation.Input), strings.TrimSpace(prompt))
			manifest := serveragent.ToolManifest{Tools: make([]serveragent.ToolDefinition, 0, len(toolProviders))}
			toolNames := make([]string, 0, len(toolProviders))
			for name := range toolProviders {
				toolNames = append(toolNames, name)
			}
			sort.Strings(toolNames)
			for _, name := range toolNames {
				provider := toolProviders[name]
				manifest.Tools = append(manifest.Tools, serveragent.ToolDefinition{Name: name, Risk: agentToolRisk(provider.Risk), InputSchema: mustAPIRawJSON(provider.ToolSchema)})
			}
			completion, err := s.agent.CompleteWithToolsContext(ctx, run.RequestingMemberID, run.BillingUserID, request, serveragent.MikaLow, manifest, func(toolCtx context.Context, tool serveragent.ToolRequest) (json.RawMessage, error) {
				provider, ok := toolProviders[tool.Name]
				if !ok {
					return nil, workflowv2.ErrCapabilityDenied
				}
				config, input := workflowToolArguments(tool.Arguments)
				if err := workflowv2.ValidateJSON(provider.ToolSchema, tool.Arguments); err != nil {
					return nil, err
				}
				digest := sha256.Sum256(append([]byte(tool.Name+":"), tool.Arguments...))
				toolInvocation := workflowv2.Invocation{RunID: run.ID, NodeID: invocation.NodeID + ".tool_" + fmt.Sprintf("%x", digest[:8]), Attempt: invocation.Attempt, IdempotencyKey: fmt.Sprintf("%x", digest[:]), UserID: run.RequestingMemberID, SpaceID: run.SpaceID, Config: config, Input: input}
				output, err := provider.Execute(toolCtx, toolInvocation)
				if err == nil {
					err = workflowv2.ValidateJSON(provider.OutputSchema, output)
				}
				return output, err
			})
			if err != nil {
				return nil, err
			}
			if structured := decodeJSONObject(completion.Text); structured != nil {
				return structured, nil
			}
			return mustAPIRawJSON(map[string]any{"text": strings.TrimSpace(completion.Text), "citations": completion.Citations, "toolCalls": completion.ToolCalls}), nil
		case "notify_private":
			eventID, err := s.database.NotifyWorkflowResult(ctx, run.ID, invocation.NodeID, invocation.Input)
			return mustAPIRawJSON(map[string]any{"notified": err == nil, "eventId": eventID}), err
		case "memory_write":
			id, err := s.database.WriteAgentMemoryEvent(ctx, run.AgentInstanceID, "workflow", invocation.Input)
			return mustAPIRawJSON(map[string]any{"written": err == nil, "memoryEventId": id}), err
		case "create_task":
			return s.createTaskNode(ctx, run, agent, invocation)
		case "update_task":
			return s.updateTaskNode(ctx, run, invocation)
		case "http_request":
			return s.executeOutboundHTTPNode(ctx, run, invocation)
		case "write_library_artifact":
			if s.library == nil {
				return nil, workflowv2.ErrProviderMissing
			}
			var config struct {
				Filename   string `json:"filename"`
				Provenance string `json:"provenance"`
			}
			_ = json.Unmarshal(invocation.Config, &config)
			if strings.TrimSpace(config.Filename) == "" {
				config.Filename = safeGeneratedArtifactName(agent.Name, invocation.NodeID)
			}
			item, err := s.library.WriteGeneratedTextArtifact(ctx, run.RequestingMemberID, run.SpaceID, config.Filename, extractWorkflowText(invocation.Input), map[string]any{
				"kind": config.Provenance, "runId": run.ID, "nodeId": invocation.NodeID, "agentVersionId": run.AgentVersionID, "workflowVersionId": run.WorkflowVersionID,
			})
			if err != nil {
				return nil, err
			}
			return mustAPIRawJSON(map[string]any{"written": true, "itemId": item.ID, "displayName": item.DisplayName, "version": item.Version}), nil
		case "update_metadata":
			return s.updateMetadataNode(ctx, run, invocation)
		case "exact_tool":
			var config struct {
				Operation string `json:"operation"`
				Provider  string `json:"provider"`
			}
			_ = json.Unmarshal(invocation.Config, &config)
			// Proposal-only tools intentionally do not mutate a provider. Any exact
			// operation that can change state must be backed by a registered adapter.
			if config.Operation == "propose_organization" {
				return mustAPIRawJSON(map[string]any{"executed": false, "proposal": json.RawMessage(invocation.Input), "approvalRequired": true}), nil
			}
			if config.Provider != "" {
				return s.providerWriteNode(ctx, run, invocation)
			}
			return nil, workflowv2.ErrProviderMissing
		case "post_reply":
			var config struct {
				Destination string `json:"destination"`
				Mode        string `json:"mode"`
			}
			_ = json.Unmarshal(invocation.Config, &config)
			if config.Mode == "draft" || config.Destination == "private" {
				return mustAPIRawJSON(map[string]any{"posted": false, "messageId": "", "draft": extractWorkflowText(invocation.Input)}), nil
			}
			if config.Destination != "space_chat" {
				return nil, workflowv2.ErrProviderMissing
			}
			message, err := s.database.CreateSpaceAgentMessage(ctx, run.BillingUserID, run.SpaceID, agent.ID, extractWorkflowText(invocation.Input))
			if err != nil {
				return nil, err
			}
			return mustAPIRawJSON(map[string]any{"posted": true, "messageId": message.ID}), nil
		default:
			if descriptor.Location == workflowv2.LocationDevice {
				return s.executeLeasedDeviceNode(ctx, run, descriptor, invocation)
			}
			// Never acknowledge a mutation that has no concrete provider adapter.
			// A false success here would poison the idempotency journal and make a
			// later retry appear completed even though no external state changed.
			if descriptor.Risk != workflowv2.RiskRead {
				return nil, workflowv2.ErrProviderMissing
			}
			return mustAPIRawJSON(map[string]any{"accepted": true, "node": descriptor.Kind, "input": json.RawMessage(invocation.Input)}), nil
		}
	}
	if descriptor.Risk == workflowv2.RiskRead {
		return readResult()
	}
	if descriptor.Risk == workflowv2.RiskDestructive {
		approvalInput := workflowApprovalEnvelope(run, descriptor.Kind, "", "", "", invocation.Input)
		approved, err := s.database.EnsureWorkflowNodeApproval(ctx, run.ID, invocation.NodeID, descriptor.Kind, approvalInput)
		if err != nil {
			return nil, err
		}
		if !approved {
			return nil, workflowv2.ErrAwaitingApproval
		}
	}
	if descriptor.Risk == workflowv2.RiskWrite && descriptor.Kind != "notify_private" && descriptor.Kind != "memory_write" {
		var config struct {
			Provider     string `json:"provider"`
			ConnectionID string `json:"connectionId"`
			Destination  string `json:"destination"`
		}
		_ = json.Unmarshal(invocation.Config, &config)
		if config.Destination == "" {
			var rawConfig map[string]any
			_ = json.Unmarshal(invocation.Config, &rawConfig)
			for _, key := range []string{"outputDirectory", "filename"} {
				if value, _ := rawConfig[key].(string); value != "" {
					config.Destination = value
					break
				}
			}
		}
		if config.ConnectionID == "" && config.Provider != "" {
			config.ConnectionID, _ = s.database.ResolveAgentProviderConnection(ctx, run.RequestingMemberID, run.SpaceID, run.AgentInstanceID, config.Provider)
		}
		authorized := false
		if config.Provider != "slack" && config.Provider != "discord" && descriptor.Kind != "update_task" {
			var authErr error
			authorized, authErr = s.database.WorkflowWritePreauthorized(ctx, run.RequestingMemberID, run.AgentInstanceID, run.WorkflowVersionID, invocation.NodeID, config.Provider, config.ConnectionID, config.Destination)
			if authErr != nil {
				return nil, authErr
			}
		}
		if !authorized {
			approvalInput := workflowApprovalEnvelope(run, descriptor.Kind, config.Provider, config.ConnectionID, config.Destination, invocation.Input)
			approved, approvalErr := s.database.EnsureWorkflowNodeApproval(ctx, run.ID, invocation.NodeID, descriptor.Kind, approvalInput)
			if approvalErr != nil {
				return nil, approvalErr
			}
			if !approved {
				return nil, workflowv2.ErrAwaitingApproval
			}
		}
	}
	resourceKey, fingerprint := workflowResourceIdentity(invocation.Config, invocation.Input)
	if resourceKey != "" {
		for {
			acquired, err := s.database.AcquireWorkflowResourceLease(ctx, run.ID, invocation.NodeID, resourceKey, fingerprint, 2*time.Minute)
			if err != nil {
				return nil, err
			}
			if acquired {
				break
			}
			timer := time.NewTimer(500 * time.Millisecond)
			select {
			case <-ctx.Done():
				timer.Stop()
				return nil, ctx.Err()
			case <-timer.C:
			}
		}
		defer func() {
			_ = s.database.ReleaseWorkflowResourceLease(context.Background(), run.ID, invocation.NodeID, resourceKey)
		}()
	}
	return s.database.JournalWorkflowAction(ctx, run.ID, invocation.NodeID, invocation.IdempotencyKey, descriptor.Kind, descriptor.Risk, invocation.Input, readResult)
}

func workflowApprovalEnvelope(run *db.SpaceRun, actionKind, provider, connectionID, destination string, input json.RawMessage) json.RawMessage {
	var decoded any
	_ = json.Unmarshal(input, &decoded)
	reason := findWorkflowString(decoded, "reason", "rationale", "completionCriteria", "completion_criteria")
	if reason == "" {
		reason = "The Agent needs this action to continue the pinned workflow run."
	}
	return mustAPIRawJSON(map[string]any{
		"agent_id":            run.AgentID,
		"agent_version_id":    run.AgentVersionID,
		"workflow_version_id": run.WorkflowVersionID,
		"run_id":              run.ID,
		"action_kind":         actionKind,
		"provider":            provider,
		"connection_id":       connectionID,
		"destination":         destination,
		"bot_identity":        map[string]string{"name": "Misty", "provider": provider},
		"content_preview":     extractWorkflowText(input),
		"reason":              reason,
		"affected_resources":  []string{destination},
		"citations":           findWorkflowValue(decoded, "citations"),
		"input":               json.RawMessage(input),
		"reversibility":       "Provider actions may not be reversible after execution.",
	})
}

func findWorkflowValue(value any, key string) any {
	switch item := value.(type) {
	case map[string]any:
		if found, ok := item[key]; ok {
			return found
		}
		for _, child := range item {
			if found := findWorkflowValue(child, key); found != nil {
				return found
			}
		}
	case []any:
		for _, child := range item {
			if found := findWorkflowValue(child, key); found != nil {
				return found
			}
		}
	}
	return nil
}

func (s *SpacesService) prepareContentInvocation(ctx context.Context, run *db.SpaceRun, invocation workflowv2.Invocation) (workflowv2.Invocation, error) {
	var input map[string]any
	if json.Unmarshal(invocation.Input, &input) != nil {
		return invocation, workflowv2.ErrOutputInvalid
	}
	target := findContentInput(input)
	if target == nil {
		target = input
	}
	if _, hasText := target["text"]; hasText {
		return invocation, nil
	}
	refValue, _ := target["contentRef"].(map[string]any)
	if refValue == nil {
		refValue, _ = target["content"].(map[string]any)
	}
	if refValue == nil {
		return invocation, nil
	}
	sourceKind, _ := refValue["sourceKind"].(string)
	providerID, _ := refValue["providerId"].(string)
	resourceID, _ := refValue["resourceId"].(string)
	if sourceKind == "local_file" || providerID == "device" {
		return invocation, workflowv2.ErrDeviceUnavailable
	}
	if sourceKind != "library" && providerID != "library" {
		return s.providerReadContent(ctx, run, invocation, providerID, resourceID, refValue)
	}
	if s.library == nil || resourceID == "" {
		return invocation, workflowv2.ErrProviderMissing
	}
	var config struct {
		MaximumBytes int64 `json:"maximumBytes"`
	}
	_ = json.Unmarshal(invocation.Config, &config)
	data, download, err := s.library.ReadTextItem(ctx, run.RequestingMemberID, run.SpaceID, resourceID, config.MaximumBytes)
	if err != nil {
		return invocation, err
	}
	target["text"] = string(data)
	refValue["displayName"] = download.Filename
	refValue["mimeType"] = download.MIMEType
	refValue["fingerprint"] = download.SHA256
	refValue["version"] = download.SHA256
	target["contentRef"] = refValue
	invocation.Input = mustAPIRawJSON(input)
	return invocation, nil
}

func findContentInput(value any) map[string]any {
	switch item := value.(type) {
	case map[string]any:
		if _, ok := item["contentRef"]; ok {
			return item
		}
		for _, child := range item {
			if found := findContentInput(child); found != nil {
				return found
			}
		}
	case []any:
		for _, child := range item {
			if found := findContentInput(child); found != nil {
				return found
			}
		}
	}
	return nil
}

func (s *SpacesService) sourceQueryNode(ctx context.Context, run *db.SpaceRun, invocation workflowv2.Invocation) (json.RawMessage, error) {
	var config struct {
		Source string `json:"source"`
		Query  string `json:"query"`
		Limit  int    `json:"limit"`
	}
	_ = json.Unmarshal(invocation.Config, &config)
	if config.Limit < 1 || config.Limit > 100 {
		config.Limit = 50
	}
	if config.Query == "" {
		var value any
		_ = json.Unmarshal(invocation.Input, &value)
		config.Query = findWorkflowString(value, "query", "search", "text")
	}
	if config.Source == "" {
		config.Source = "all"
	}
	results := make([]any, 0, config.Limit)
	if config.Source == "all" || config.Source == "library" {
		items, err := s.database.LibraryItems(ctx, run.RequestingMemberID, run.SpaceID, db.LibraryItemQuery{Search: config.Query, Limit: config.Limit, Visibility: "visible"})
		if err != nil {
			return nil, err
		}
		for _, item := range items {
			results = append(results, map[string]any{
				"contentRef": map[string]any{"sourceKind": "library", "providerId": "library", "resourceId": item.ID, "version": strconv.FormatInt(item.Version, 10), "displayName": item.DisplayName, "permissionScope": "space:" + run.SpaceID},
				"metadata":   map[string]any{"caption": item.Caption, "tags": item.Tags, "updatedAt": item.UpdatedAt},
			})
			if len(results) == config.Limit {
				break
			}
		}
	}
	if len(results) < config.Limit && (config.Source == "all" || config.Source == "messages") {
		messages, err := s.database.SpaceMessages(ctx, run.RequestingMemberID, run.SpaceID, 0, 100)
		if err != nil {
			return nil, err
		}
		query := strings.ToLower(strings.TrimSpace(config.Query))
		for _, message := range messages {
			raw, _ := json.Marshal(message.Content)
			if query != "" && !strings.Contains(strings.ToLower(string(raw)), query) {
				continue
			}
			results = append(results, map[string]any{
				"contentRef": map[string]any{"sourceKind": "message", "providerId": "space_chat", "resourceId": message.ID, "version": strconv.FormatInt(message.Seq, 10), "displayName": "Message from " + message.SenderName, "permissionScope": "space:" + run.SpaceID},
				"text":       string(raw),
			})
			if len(results) == config.Limit {
				break
			}
		}
	}
	return mustAPIRawJSON(map[string]any{"items": results, "count": len(results), "query": config.Query, "source": config.Source}), nil
}

func (s *SpacesService) readMetadataNode(ctx context.Context, run *db.SpaceRun, invocation workflowv2.Invocation) (json.RawMessage, error) {
	var value any
	if json.Unmarshal(invocation.Input, &value) != nil {
		return nil, workflowv2.ErrOutputInvalid
	}
	provider := findWorkflowString(value, "providerId")
	resourceID := findWorkflowString(value, "resourceId", "itemId")
	if provider != "library" || resourceID == "" {
		return mustAPIRawJSON(map[string]any{"metadata": value}), nil
	}
	item, err := s.database.LibraryItem(ctx, run.RequestingMemberID, run.SpaceID, resourceID)
	if err != nil {
		return nil, err
	}
	return mustAPIRawJSON(map[string]any{"contentRef": map[string]any{"sourceKind": "library", "providerId": "library", "resourceId": item.ID, "version": strconv.FormatInt(item.Version, 10), "displayName": item.DisplayName, "permissionScope": "space:" + run.SpaceID}, "metadata": map[string]any{"caption": item.Caption, "tags": item.Tags, "favorite": item.Favorite, "hidden": item.Hidden, "updatedAt": item.UpdatedAt}}), nil
}

func (s *SpacesService) updateMetadataNode(ctx context.Context, run *db.SpaceRun, invocation workflowv2.Invocation) (json.RawMessage, error) {
	var value any
	if json.Unmarshal(invocation.Input, &value) != nil {
		return nil, workflowv2.ErrOutputInvalid
	}
	itemID := findWorkflowString(value, "resourceId", "itemId")
	if itemID == "" {
		return nil, workflowv2.ErrOutputInvalid
	}
	item, err := s.database.LibraryItem(ctx, run.RequestingMemberID, run.SpaceID, itemID)
	if err != nil {
		return nil, err
	}
	tags := findWorkflowStrings(value, "tags")
	merged := append([]string{}, item.Tags...)
	seen := map[string]bool{}
	for _, tag := range merged {
		seen[strings.ToLower(tag)] = true
	}
	for _, tag := range tags {
		tag = strings.TrimSpace(tag)
		if tag != "" && !seen[strings.ToLower(tag)] {
			merged = append(merged, tag)
			seen[strings.ToLower(tag)] = true
		}
	}
	caption := findWorkflowString(value, "caption", "summary")
	if caption == "" {
		caption = item.Caption
	}
	updated, err := s.database.UpdateLibraryItem(ctx, run.RequestingMemberID, run.SpaceID, item.ID, item.Version, item.DisplayName, caption, merged, item.Favorite, item.Hidden)
	if err != nil {
		return nil, err
	}
	return mustAPIRawJSON(map[string]any{"updated": true, "itemId": updated.ID, "version": updated.Version, "tags": updated.Tags}), nil
}

func findWorkflowString(value any, keys ...string) string {
	wanted := map[string]bool{}
	for _, key := range keys {
		wanted[key] = true
	}
	var find func(any) string
	find = func(current any) string {
		switch item := current.(type) {
		case map[string]any:
			for key, child := range item {
				if wanted[key] {
					if text, ok := child.(string); ok && strings.TrimSpace(text) != "" {
						return strings.TrimSpace(text)
					}
				}
			}
			for _, child := range item {
				if found := find(child); found != "" {
					return found
				}
			}
		case []any:
			for _, child := range item {
				if found := find(child); found != "" {
					return found
				}
			}
		}
		return ""
	}
	return find(value)
}

func findWorkflowStrings(value any, key string) []string {
	var find func(any) []string
	find = func(current any) []string {
		switch item := current.(type) {
		case map[string]any:
			if values, ok := item[key].([]any); ok {
				out := make([]string, 0, len(values))
				for _, value := range values {
					if text, ok := value.(string); ok {
						out = append(out, text)
					}
				}
				return out
			}
			for _, child := range item {
				if found := find(child); len(found) > 0 {
					return found
				}
			}
		case []any:
			for _, child := range item {
				if found := find(child); len(found) > 0 {
					return found
				}
			}
		}
		return nil
	}
	return find(value)
}

func evaluateControlBranch(kind string, invocation workflowv2.Invocation) (json.RawMessage, error) {
	var input any
	if json.Unmarshal(invocation.Input, &input) != nil {
		return nil, workflowv2.ErrOutputInvalid
	}
	var config struct {
		Path     string         `json:"path"`
		Operator string         `json:"operator"`
		Value    any            `json:"value"`
		Cases    map[string]any `json:"cases"`
	}
	if json.Unmarshal(invocation.Config, &config) != nil {
		return nil, workflowv2.ErrOutputInvalid
	}
	selected := input
	if strings.TrimSpace(config.Path) != "" {
		var found bool
		selected, found = workflowPath(input, config.Path)
		if !found && kind == "condition" && config.Operator != "not_exists" {
			selected = nil
		}
	}
	if kind == "switch" {
		caseNames := make([]string, 0, len(config.Cases))
		for name := range config.Cases {
			caseNames = append(caseNames, name)
		}
		sort.Strings(caseNames)
		port := "default"
		for _, name := range caseNames {
			if workflowValuesEqual(selected, config.Cases[name]) {
				port = name
				break
			}
		}
		return mustAPIRawJSON(map[string]any{"selected": port, port: input}), nil
	}
	operator := config.Operator
	if operator == "" {
		operator = "equals"
	}
	matched := false
	switch operator {
	case "exists":
		matched = selected != nil
	case "not_exists":
		matched = selected == nil
	case "equals":
		matched = workflowValuesEqual(selected, config.Value)
	case "not_equals":
		matched = !workflowValuesEqual(selected, config.Value)
	case "contains":
		matched = strings.Contains(fmt.Sprint(selected), fmt.Sprint(config.Value))
	case "gt", "gte", "lt", "lte":
		left, leftOK := selected.(float64)
		right, rightOK := config.Value.(float64)
		if leftOK && rightOK {
			switch operator {
			case "gt":
				matched = left > right
			case "gte":
				matched = left >= right
			case "lt":
				matched = left < right
			case "lte":
				matched = left <= right
			}
		}
	default:
		return nil, workflowv2.ErrOutputInvalid
	}
	port := "false"
	if matched {
		port = "true"
	}
	return mustAPIRawJSON(map[string]any{"matched": matched, port: input}), nil
}

func workflowPath(root any, path string) (any, bool) {
	path = strings.Trim(strings.ReplaceAll(path, "/", "."), ".")
	if path == "" {
		return root, true
	}
	current := root
	for _, segment := range strings.Split(path, ".") {
		switch item := current.(type) {
		case map[string]any:
			var ok bool
			current, ok = item[segment]
			if !ok {
				return nil, false
			}
		case []any:
			index, err := strconv.Atoi(segment)
			if err != nil || index < 0 || index >= len(item) {
				return nil, false
			}
			current = item[index]
		default:
			return nil, false
		}
	}
	return current, true
}

func workflowValuesEqual(left, right any) bool {
	leftJSON, _ := json.Marshal(left)
	rightJSON, _ := json.Marshal(right)
	return string(leftJSON) == string(rightJSON)
}

func safeGeneratedArtifactName(agentName, nodeID string) string {
	clean := func(value string) string {
		value = strings.ToLower(strings.TrimSpace(value))
		var out strings.Builder
		for _, char := range value {
			if char >= 'a' && char <= 'z' || char >= '0' && char <= '9' {
				out.WriteRune(char)
			} else if out.Len() > 0 && !strings.HasSuffix(out.String(), "-") {
				out.WriteByte('-')
			}
		}
		return strings.Trim(out.String(), "-")
	}
	name := clean(agentName)
	if name == "" {
		name = "agent"
	}
	node := clean(nodeID)
	if node == "" {
		node = "result"
	}
	return name + "-" + node + ".md"
}

func (s *SpacesService) changedFilesNode(ctx context.Context, run *db.SpaceRun, invocation workflowv2.Invocation) (json.RawMessage, error) {
	if run.AgentInstanceID == "" || run.WorkflowVersionID == "" {
		return nil, workflowv2.ErrOutputInvalid
	}
	var input map[string]any
	if json.Unmarshal(invocation.Input, &input) != nil {
		return nil, workflowv2.ErrOutputInvalid
	}
	rawItems := findWorkflowItems(input)
	claimed := make([]any, 0, len(rawItems))
	for _, raw := range rawItems {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		eventID, _ := item["eventId"].(string)
		if eventID == "" {
			eventID, _ = item["event_id"].(string)
		}
		provider, _ := item["provider"].(string)
		fingerprint, _ := item["fingerprint"].(string)
		path, _ := item["relativePath"].(string)
		provenance, _ := item["provenance"].(string)
		if eventID == "" || provider == "" || provenance == "workflow_generated" || strings.HasPrefix(strings.TrimPrefix(path, "./"), ".summaries/") {
			continue
		}
		ok, err := s.database.ClaimWorkflowEvent(ctx, run.AgentInstanceID, run.WorkflowVersionID, provider, eventID, fingerprint, run.ID)
		if err == nil && !ok && run.TriggerKind == "retry" {
			ok, err = s.database.ReclaimFailedWorkflowEvent(ctx, run.AgentInstanceID, run.WorkflowVersionID, provider, eventID, fingerprint, run.ID)
		}
		if err != nil {
			return nil, err
		}
		if ok {
			item["claimedByRunId"] = run.ID
			claimed = append(claimed, item)
		}
	}
	return mustAPIRawJSON(map[string]any{"items": claimed, "claimed": len(claimed), "provenance": map[string]any{"instanceId": run.AgentInstanceID, "workflowVersionId": run.WorkflowVersionID}}), nil
}

func findWorkflowItems(value any) []any {
	switch item := value.(type) {
	case []any:
		return item
	case map[string]any:
		for _, key := range []string{"events", "items"} {
			if values, ok := item[key].([]any); ok {
				return values
			}
		}
		for _, child := range item {
			if values := findWorkflowItems(child); values != nil {
				return values
			}
		}
	}
	return nil
}

func normalizeContentPage(run *db.SpaceRun, invocation workflowv2.Invocation) (json.RawMessage, error) {
	var input map[string]any
	if json.Unmarshal(invocation.Input, &input) != nil {
		return nil, workflowv2.ErrOutputInvalid
	}
	ref, text := findContentRefAndText(input)
	if strings.TrimSpace(text) == "" {
		return nil, workflowv2.ErrUnsupportedContent
	}
	digest := fmt.Sprintf("%x", sha256.Sum256([]byte(text)))
	if ref.SourceKind == "" {
		ref = workflowv2.ContentRef{SourceKind: "inline", ProviderID: "misty", ResourceID: run.ID + ":" + invocation.NodeID, Fingerprint: digest, DisplayName: "Workflow input", MIMEType: "text/plain", PermissionScope: "run:" + run.ID}
	}
	pageSize := 50
	var config struct {
		PageSize int `json:"pageSize"`
	}
	_ = json.Unmarshal(invocation.Config, &config)
	if config.PageSize > 0 && config.PageSize <= 100 {
		pageSize = config.PageSize
	}
	cursor := 0
	if raw, ok := input["cursor"].(string); ok {
		cursor, _ = strconv.Atoi(raw)
	}
	chunks := chunkWorkflowText(text, 4000)
	if cursor < 0 || cursor > len(chunks) {
		return nil, workflowv2.ErrOutputInvalid
	}
	end := cursor + pageSize
	if end > len(chunks) {
		end = len(chunks)
	}
	sections := make([]workflowv2.ContentSection, 0, end-cursor)
	citations := make([]workflowv2.Citation, 0, end-cursor)
	for index := cursor; index < end; index++ {
		locator := fmt.Sprintf("section:%d", index+1)
		sections = append(sections, workflowv2.ContentSection{Kind: "text", Locator: locator, Text: chunks[index]})
		citations = append(citations, workflowv2.Citation{Content: ref, Kind: "section", Locator: locator})
	}
	next := ""
	if end < len(chunks) {
		next = strconv.Itoa(end)
	}
	page := workflowv2.ContentPage{Content: ref, Sections: sections, Citations: citations, NextCursor: next, Truncated: next != "", SourceChanged: ref.Fingerprint != "" && ref.Fingerprint != digest}
	return mustAPIRawJSON(page), nil
}

func findContentRefAndText(input map[string]any) (workflowv2.ContentRef, string) {
	var ref workflowv2.ContentRef
	for _, key := range []string{"contentRef", "ref", "content"} {
		if object, ok := input[key].(map[string]any); ok {
			raw, _ := json.Marshal(object)
			_ = json.Unmarshal(raw, &ref)
		}
	}
	for _, key := range []string{"text", "body", "message", "content"} {
		if value, ok := input[key].(string); ok && strings.TrimSpace(value) != "" {
			return ref, value
		}
	}
	for _, value := range input {
		if object, ok := value.(map[string]any); ok {
			nestedRef, nestedText := findContentRefAndText(object)
			if ref.SourceKind == "" {
				ref = nestedRef
			}
			if nestedText != "" {
				return ref, nestedText
			}
		}
	}
	return ref, ""
}

func chunkWorkflowText(value string, maximum int) []string {
	runes := []rune(value)
	if len(runes) == 0 {
		return nil
	}
	out := make([]string, 0, (len(runes)+maximum-1)/maximum)
	for start := 0; start < len(runes); start += maximum {
		end := start + maximum
		if end > len(runes) {
			end = len(runes)
		}
		out = append(out, string(runes[start:end]))
	}
	return out
}

func decodeJSONObject(value string) json.RawMessage {
	trimmed := strings.TrimSpace(value)
	trimmed = strings.TrimPrefix(trimmed, "```json")
	trimmed = strings.TrimPrefix(trimmed, "```JSON")
	trimmed = strings.TrimPrefix(trimmed, "```")
	trimmed = strings.TrimSuffix(trimmed, "```")
	trimmed = strings.TrimSpace(trimmed)
	var object map[string]any
	if json.Unmarshal([]byte(trimmed), &object) != nil || object == nil {
		return nil
	}
	return json.RawMessage(trimmed)
}

func extractWorkflowText(raw json.RawMessage) string {
	var value any
	if json.Unmarshal(raw, &value) != nil {
		return ""
	}
	var find func(any) string
	find = func(current any) string {
		switch item := current.(type) {
		case string:
			return strings.TrimSpace(item)
		case map[string]any:
			for _, key := range []string{"text", "answer", "summary", "body"} {
				if result := find(item[key]); result != "" {
					return result
				}
			}
		case []any:
			for _, child := range item {
				if result := find(child); result != "" {
					return result
				}
			}
		}
		return ""
	}
	return find(value)
}

func workflowToolEligible(descriptor workflowv2.NodeDescriptor, declared map[string]workflowv2.Risk) bool {
	granted, ok := declared[descriptor.Capability]
	if !ok || workflowRiskRank(granted) < workflowRiskRank(descriptor.Risk) || descriptor.Risk == workflowv2.RiskDestructive {
		return false
	}
	switch descriptor.Kind {
	case "manual_trigger", "chat_trigger", "cron_trigger", "file_changes", "library_changes", "message_trigger", "connector_trigger", "transform", "for_each", "condition", "switch", "join", "debounce", "delay", "call_workflow", "agent_task":
		return false
	default:
		return true
	}
}

func workflowRiskRank(risk workflowv2.Risk) int {
	if risk == workflowv2.RiskDestructive {
		return 3
	}
	if risk == workflowv2.RiskWrite {
		return 2
	}
	return 1
}

func agentToolRisk(risk workflowv2.Risk) string {
	if risk == workflowv2.RiskDestructive {
		return serveragent.RiskDangerous
	}
	if risk == workflowv2.RiskWrite {
		return serveragent.RiskWrite
	}
	return serveragent.RiskRead
}

func workflowToolArguments(raw json.RawMessage) (json.RawMessage, json.RawMessage) {
	config := json.RawMessage(`{}`)
	input := raw
	var object map[string]any
	if json.Unmarshal(raw, &object) != nil {
		return config, input
	}
	if value, ok := object["config"].(map[string]any); ok {
		config, _ = json.Marshal(value)
	}
	if value, exists := object["input"]; exists {
		input, _ = json.Marshal(value)
	}
	return config, input
}

func workflowResourceIdentity(config, input json.RawMessage) (string, string) {
	var configValue, inputValue any
	_ = json.Unmarshal(config, &configValue)
	_ = json.Unmarshal(input, &inputValue)
	var find func(any) (string, string)
	find = func(value any) (string, string) {
		switch item := value.(type) {
		case map[string]any:
			provider, _ := item["providerId"].(string)
			resource, _ := item["resourceId"].(string)
			fingerprint, _ := item["fingerprint"].(string)
			if resource != "" {
				return provider + ":" + resource, fingerprint
			}
			for _, key := range []string{"destination", "relativePath", "channelId", "threadId"} {
				if text, ok := item[key].(string); ok && strings.TrimSpace(text) != "" {
					return key + ":" + strings.TrimSpace(text), fingerprint
				}
			}
			for _, child := range item {
				if key, childFingerprint := find(child); key != "" {
					return key, childFingerprint
				}
			}
		case []any:
			for _, child := range item {
				if key, childFingerprint := find(child); key != "" {
					return key, childFingerprint
				}
			}
		}
		return "", ""
	}
	if key, fingerprint := find(inputValue); key != "" {
		return key, fingerprint
	}
	return find(configValue)
}

func workflowEventIdentity(raw json.RawMessage) (string, string) {
	var item map[string]any
	if json.Unmarshal(raw, &item) != nil {
		return "", ""
	}
	provider, _ := item["provider"].(string)
	eventID, _ := item["eventId"].(string)
	if eventID == "" {
		eventID, _ = item["event_id"].(string)
	}
	return provider, eventID
}
