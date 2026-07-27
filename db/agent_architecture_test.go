package db

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
)

func TestWorkflowMetadataSupportsMultipleCapabilitiesAndProtectsDestructiveActions(t *testing.T) {
	metadata := architectureMetadata()
	if err := ValidateWorkflowMetadata(metadata); err != nil {
		t.Fatalf("valid multi-capability metadata rejected: %v", err)
	}
	metadata.Capabilities[1].ConfirmationRequired = false
	if err := ValidateWorkflowMetadata(metadata); !errors.Is(err, ErrSpaceInvalid) {
		t.Fatalf("destructive capability without confirmation error = %v", err)
	}
	metadata = architectureMetadata()
	metadata.RequiredPermissions = []string{"made.up.permission"}
	if err := ValidateWorkflowMetadata(metadata); !errors.Is(err, ErrSpaceInvalid) {
		t.Fatalf("unknown permission declaration error = %v", err)
	}
}

func TestStructuredCapabilityRoutingScore(t *testing.T) {
	metadata := architectureMetadata()
	words := routingWords("Please organize the campaign folders")
	organize := routingScore(words, metadata.Capabilities[1])
	summarize := routingScore(words, metadata.Capabilities[0])
	if organize <= summarize {
		t.Fatalf("structured router scores organize=%d summarize=%d", organize, summarize)
	}
}

func TestWorkflowCapabilityInputAndRuntimeBoundaryValidation(t *testing.T) {
	capability := WorkflowCapability{Inputs: []WorkflowField{
		{Name: "prompt", Type: "string", Required: true},
		{Name: "limit", Type: "integer"},
		{Name: "options", Type: "object"},
	}}
	if err := validateCapabilityInput(capability, json.RawMessage(`{"prompt":"organize","limit":3,"options":{"dryRun":true},"context":"allowed"}`)); err != nil {
		t.Fatalf("valid structured input rejected: %v", err)
	}
	for _, raw := range []string{
		`{"limit":3}`,
		`{"prompt":"   "}`,
		`{"prompt":false}`,
		`{"prompt":"organize","limit":2.5}`,
		`{"prompt":"organize","options":[]}`,
	} {
		if err := validateCapabilityInput(capability, json.RawMessage(raw)); !errors.Is(err, ErrSpaceInvalid) {
			t.Fatalf("invalid capability input %s error = %v", raw, err)
		}
	}

	localDefinition := unifiedTestDefinition("read_file", "files.read", "read")
	cloud := architectureMetadata()
	if err := validateWorkflowVersionDefinition(cloud, localDefinition); !errors.Is(err, ErrSpaceInvalid) {
		t.Fatalf("workflow accepted an unregistered v1 node: %v", err)
	}
	validV2 := unifiedTestDefinition("changed_files", "files.read", "read")
	if err := validateWorkflowVersionDefinition(cloud, validV2); err != nil {
		t.Fatalf("registered v2 device-leased node rejected: %v", err)
	}
	if permission, ok := workflowPermissionSpacePermission("files.read"); !ok || permission != PermissionLibraryView {
		t.Fatalf("files.read permission mapping = %q, %v", permission, ok)
	}
	if permission, ok := workflowPermissionSpacePermission("files.write"); !ok || permission != PermissionLibraryEdit {
		t.Fatalf("files.write permission mapping = %q, %v", permission, ok)
	}
}

func TestSpaceAgentWorkflowPinningRoutingConcurrencyPrivacyAndApproval(t *testing.T) {
	t.Skip("v1 embedded-workflow coverage replaced by TestUnifiedAgentVersionsAndPerUserInstances")
	database := openTestDatabase(t)
	ctx := context.Background()
	owner, err := database.CreateUser("Architecture Owner", "architecture-owner@example.com", "correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	member, err := database.CreateUser("Architecture Member", "architecture-member@example.com", "correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	excludedMember, err := database.CreateUser("Architecture Excluded", "architecture-excluded@example.com", "correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	outsider, err := database.CreateUser("Architecture Outsider", "architecture-outsider@example.com", "correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	space := createTestSpace(t, database, ctx, owner.ID, "Agent architecture")
	invite, err := database.InviteToSpace(ctx, owner.ID, space.ID, member.Email)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.RespondToSpaceInvite(ctx, member.ID, invite.ID, true); err != nil {
		t.Fatal(err)
	}
	excludedInvite, err := database.InviteToSpace(ctx, owner.ID, space.ID, excludedMember.Email)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.RespondToSpaceInvite(ctx, excludedMember.ID, excludedInvite.ID, true); err != nil {
		t.Fatal(err)
	}

	definition := mustTestRaw(map[string]any{"metadata": architectureMetadata(), "nodes": []any{}, "edges": []any{}})
	workflow, err := database.SaveSpaceStudioResource(ctx, owner.ID, SpaceStudioResource{SpaceID: space.ID, Kind: "workflow", Name: "Workspace Operations", Description: "Summarize and organize files", Definition: definition, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	versions, err := database.WorkflowVersions(ctx, owner.ID, space.ID, workflow.ID)
	if err != nil || len(versions) != 1 || len(versions[0].Metadata.Capabilities) != 2 {
		t.Fatalf("workflow versions = %#v, %v", versions, err)
	}
	staleMetadata := workflow.ActiveWorkflow
	approvalMetadata := architectureMetadata()
	approvalMetadata.Capabilities[0].ReadOnly = false
	approvalMetadata.Capabilities[0].Destructive = true
	approvalMetadata.Capabilities[0].ConfirmationRequired = true
	workflow.Definition = mustTestRaw(map[string]any{"metadata": approvalMetadata, "nodes": []any{}, "edges": []any{}})
	workflow.ActiveWorkflow = staleMetadata
	workflow, err = database.SaveSpaceStudioResource(ctx, owner.ID, *workflow)
	if err != nil || workflow.ActiveWorkflow == nil || !workflow.ActiveWorkflow.Metadata.Capabilities[0].Destructive {
		t.Fatalf("definition metadata was not snapshotted over stale response metadata: %#v, %v", workflow, err)
	}
	agent, err := database.SaveSpaceStudioResource(ctx, owner.ID, SpaceStudioResource{SpaceID: space.ID, Kind: "agent", Name: "Operations Agent", Description: "Workspace operations", Icon: "sparkles", Instructions: "Use the requested capability.", Enabled: true, Status: "available", RuntimeKind: "device"})
	if err != nil {
		t.Fatal(err)
	}
	var defaultDefinition struct {
		Nodes []json.RawMessage `json:"nodes"`
	}
	if agent.ActiveWorkflow == nil || json.Unmarshal(agent.ActiveWorkflow.Definition, &defaultDefinition) != nil || len(defaultDefinition.Nodes) == 0 {
		t.Fatalf("default Agent workflow definition = %#v", agent.ActiveWorkflow)
	}
	if _, err := database.CreateSpaceRun(ctx, member.ID, space.ID, "workflow", agent.ActiveWorkflow.WorkflowID, "test", "default", json.RawMessage(`{"prompt":"must run through its Agent"}`)); !errors.Is(err, ErrSpaceInvalid) {
		t.Fatalf("direct device workflow run error = %v, want ErrSpaceInvalid", err)
	}
	listedWorkflows, err := database.SpaceStudioResources(ctx, member.ID, space.ID, "workflow")
	if err != nil || len(listedWorkflows) != 2 || listedWorkflows[0].ActiveWorkflow == nil {
		t.Fatalf("canonical Studio Workflow list = %#v, %v", listedWorkflows, err)
	}
	agent, err = database.ReplaceAgentWorkflow(ctx, owner.ID, space.ID, agent.ID, versions[0].ID)
	if err != nil || agent.ActiveWorkflowVersionID != versions[0].ID {
		t.Fatalf("ReplaceAgentWorkflow = %#v, %v", agent, err)
	}
	listedAgents, err := database.SpaceStudioResources(ctx, member.ID, space.ID, "agent")
	if err != nil || len(listedAgents) != 1 || listedAgents[0].ActiveWorkflow == nil || listedAgents[0].ActiveWorkflow.ID != versions[0].ID {
		t.Fatalf("canonical Studio Agent list = %#v, %v", listedAgents, err)
	}

	decision, err := database.RouteAgentRequest(ctx, member.ID, "Organize the campaign folders", space.ID, "", "")
	if err != nil || decision.Selected == nil || decision.Selected.AgentID != agent.ID || decision.Selected.CapabilityID != "organize-folders" {
		t.Fatalf("routing decision = %#v, %v", decision, err)
	}
	if outsiderCatalog, err := database.DiscoverAgentCatalog(ctx, outsider.ID); err != nil || len(outsiderCatalog) != 0 {
		t.Fatalf("outsider catalog = %#v, %v", outsiderCatalog, err)
	}

	firstRun, err := database.CreateAgentRun(ctx, AgentRunRequest{RequestingMemberID: member.ID, SpaceID: space.ID, AgentID: agent.ID, SourceType: "direct", CapabilityID: "summarize-files", Input: json.RawMessage(`{"prompt":"summarize"}`), TriggerKind: "manual"})
	if err != nil || firstRun.WorkflowVersionID != versions[0].ID || firstRun.State != "running" {
		t.Fatalf("first run = %#v, %v", firstRun, err)
	}
	group, err := database.CreateSpaceConversation(ctx, member.ID, space.ID, "Operations leads", []string{owner.ID})
	if err != nil {
		t.Fatal(err)
	}
	groupRun, err := database.CreateAgentRun(ctx, AgentRunRequest{RequestingMemberID: member.ID, SpaceID: space.ID, AgentID: agent.ID, SourceType: "group_mention", SourceConversationID: group.ID, CapabilityID: "summarize-files", Input: json.RawMessage(`{"prompt":"private group summary"}`), TriggerKind: "mention"})
	if err != nil {
		t.Fatal(err)
	}
	if visible, err := database.SpaceRun(ctx, owner.ID, groupRun.ID); err != nil || visible.ID != groupRun.ID {
		t.Fatalf("selected group member run = %#v, %v", visible, err)
	}
	if visible, err := database.SpaceRun(ctx, excludedMember.ID, groupRun.ID); !errors.Is(err, ErrSpaceForbidden) || visible != nil {
		t.Fatalf("excluded group member run = %#v, %v, want forbidden", visible, err)
	}
	if runs, err := database.SpaceRuns(ctx, excludedMember.ID, space.ID, agent.ID, 100); err != nil || containsSpaceRun(runs, groupRun.ID) {
		t.Fatalf("excluded group member run list = %#v, %v", runs, err)
	}
	excludedEvents, _, err := database.SpaceEventsAfter(ctx, excludedMember.ID, 0, 500)
	if err != nil {
		t.Fatal(err)
	}
	for _, event := range excludedEvents {
		if event.EntityID == groupRun.ID {
			t.Fatalf("excluded group member received run event %#v", event)
		}
	}

	updatedMetadata := architectureMetadata()
	updatedMetadata.Capabilities[0].Description = "Summarize files with concise citations"
	secondVersion, err := database.CreateWorkflowVersion(ctx, owner.ID, space.ID, workflow.ID, "2.0.0", updatedMetadata, mustTestRaw(map[string]any{"nodes": []any{}, "edges": []any{}}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.ReplaceAgentWorkflow(ctx, owner.ID, space.ID, agent.ID, secondVersion.ID); err != nil {
		t.Fatal(err)
	}
	retained, err := database.SpaceRun(ctx, member.ID, firstRun.ID)
	if err != nil || retained.WorkflowVersionID != versions[0].ID {
		t.Fatalf("historical run pin = %#v, %v", retained, err)
	}
	if _, err := database.FinishSpaceRun(ctx, firstRun.ID, "completed", json.RawMessage(`{"text":"done"}`), ""); err != nil {
		t.Fatal(err)
	}
	workflowRun, err := database.CreateSpaceRun(ctx, member.ID, space.ID, "workflow", workflow.ID, "test", "summarize-files", json.RawMessage(`{"prompt":"summarize"}`))
	if err != nil || workflowRun.ResourceID != workflow.ID || workflowRun.WorkflowVersionID != secondVersion.ID {
		t.Fatalf("CreateSpaceRun(workflow) = %#v, %v", workflowRun, err)
	}
	if runs, err := database.SpaceWorkflowRuns(ctx, member.ID, space.ID, workflow.ID, 100); err != nil || len(runs) != 1 || runs[0].ID != workflowRun.ID {
		t.Fatalf("SpaceWorkflowRuns(requester) = %#v, %v", runs, err)
	}
	if runs, err := database.SpaceWorkflowRuns(ctx, owner.ID, space.ID, workflow.ID, 100); err != nil || len(runs) != 0 {
		t.Fatalf("SpaceWorkflowRuns(other member) = %#v, %v, want private Studio test hidden", runs, err)
	}
	responseActionID, claimed, err := database.ClaimRunResponsePublication(ctx, firstRun.ID)
	if err != nil || !claimed || responseActionID == "" {
		t.Fatalf("first response publication claim = %q, %v, %v", responseActionID, claimed, err)
	}
	if _, claimed, err := database.ClaimRunResponsePublication(ctx, firstRun.ID); err != nil || claimed {
		t.Fatalf("concurrent response publication claim = %v, %v", claimed, err)
	}
	if err := database.FinishRunResponsePublication(ctx, responseActionID, "completed", json.RawMessage(`{"source_type":"direct"}`)); err != nil {
		t.Fatal(err)
	}
	if _, claimed, err := database.ClaimRunResponsePublication(ctx, firstRun.ID); err != nil || claimed {
		t.Fatalf("completed response publication claim = %v, %v", claimed, err)
	}

	const concurrent = 6
	ids := make(chan string, concurrent)
	errs := make(chan error, concurrent)
	var wait sync.WaitGroup
	for index := 0; index < concurrent; index++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			run, runErr := database.CreateAgentRun(ctx, AgentRunRequest{RequestingMemberID: member.ID, SpaceID: space.ID, AgentID: agent.ID, SourceType: "direct", CapabilityID: "summarize-files", Input: json.RawMessage(`{"prompt":"parallel"}`), TriggerKind: "manual"})
			if runErr != nil {
				errs <- runErr
				return
			}
			ids <- run.ID
		}()
	}
	wait.Wait()
	close(ids)
	close(errs)
	for runErr := range errs {
		t.Fatal(runErr)
	}
	unique := map[string]bool{}
	for id := range ids {
		unique[id] = true
	}
	if len(unique) != concurrent {
		t.Fatalf("concurrent isolated run IDs = %v", unique)
	}

	conversation, err := database.CreateAgentConversation(ctx, owner.ID, space.ID, agent.ID, "Agent operations")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.AppendAgentConversationEvent(ctx, owner.ID, conversation.ID, "user_message", json.RawMessage(`{"text":"owner secret"}`)); err != nil {
		t.Fatal(err)
	}
	if events, err := database.AgentConversationEvents(ctx, member.ID, conversation.ID); !errors.Is(err, ErrSpaceNotFound) || len(events) != 0 {
		t.Fatalf("private context leaked: %#v, %v", events, err)
	}

	destructive, err := database.CreateAgentRun(ctx, AgentRunRequest{RequestingMemberID: member.ID, SpaceID: space.ID, AgentID: agent.ID, SourceType: "group_mention", SourceConversationID: "msg_shared", CapabilityID: "organize-folders", Input: json.RawMessage(`{"prompt":"organize"}`), TriggerKind: "mention"})
	if err != nil || destructive.State != "awaiting_approval" {
		t.Fatalf("destructive run = %#v, %v", destructive, err)
	}
	if visible, err := database.SpaceRun(ctx, owner.ID, destructive.ID); err != nil || visible.ID != destructive.ID {
		t.Fatalf("Everyone chat run should remain Space-visible = %#v, %v", visible, err)
	}
	actions, err := database.RunActions(ctx, member.ID, destructive.ID)
	if err != nil || len(actions) != 1 || actions[0].State != "proposed" || !actions[0].Destructive {
		t.Fatalf("proposed destructive actions = %#v, %v", actions, err)
	}
	if _, err := database.DecideRunApproval(ctx, outsider.ID, destructive.ID, true); !errors.Is(err, ErrSpaceForbidden) {
		t.Fatalf("outsider approval error = %v", err)
	}
	approved, err := database.DecideRunApproval(ctx, member.ID, destructive.ID, true)
	if err != nil || approved.State != "running" {
		t.Fatalf("approved run = %#v, %v", approved, err)
	}
	actions, err = database.RunActions(ctx, member.ID, destructive.ID)
	if err != nil || len(actions) != 1 || actions[0].State != "approved" {
		t.Fatalf("approved destructive actions = %#v, %v", actions, err)
	}

}

func TestDirectWorkflowRunCreatesApproval(t *testing.T) {
	t.Skip("standalone workflow execution was intentionally removed in workflow v2")
	database := openTestDatabase(t)
	ctx := context.Background()
	owner, err := database.CreateUser("Workflow Approval Owner", "workflow-approval-owner@example.com", "correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	spaces, err := database.ListSpaces(ctx, owner.ID)
	if err != nil || len(spaces) != 1 {
		t.Fatalf("owner Spaces = %#v, %v", spaces, err)
	}
	metadata := architectureMetadata()
	metadata.Capabilities[0].ReadOnly = false
	metadata.Capabilities[0].Destructive = true
	metadata.Capabilities[0].ConfirmationRequired = true
	workflow, err := database.SaveSpaceStudioResource(ctx, owner.ID, SpaceStudioResource{SpaceID: spaces[0].ID, Kind: "workflow", Name: "Approval Workflow", Definition: mustTestRaw(map[string]any{"metadata": metadata, "nodes": []any{}, "edges": []any{}}), Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	run, err := database.CreateSpaceRun(ctx, owner.ID, spaces[0].ID, "workflow", workflow.ID, "test", metadata.Capabilities[0].ID, json.RawMessage(`{"prompt":"approve this"}`))
	if err != nil || run.State != "awaiting_approval" {
		t.Fatalf("direct workflow run = %#v, %v", run, err)
	}
	approvals, err := database.RunApprovals(ctx, owner.ID, run.ID)
	if err != nil || len(approvals) != 1 || approvals[0].State != "pending" {
		t.Fatalf("direct workflow approvals = %#v, %v", approvals, err)
	}
	actions, err := database.RunActions(ctx, owner.ID, run.ID)
	if err != nil || len(actions) != 1 || actions[0].State != "proposed" || !actions[0].Destructive {
		t.Fatalf("direct workflow actions = %#v, %v", actions, err)
	}
	if _, err := database.CancelSpaceRun(ctx, owner.ID, run.ID); err != nil {
		t.Fatal(err)
	}
	retry, err := database.RetrySpaceRun(ctx, owner.ID, run.ID)
	if err != nil || retry.State != "awaiting_approval" {
		t.Fatalf("destructive workflow retry = %#v, %v", retry, err)
	}
	retryApprovals, err := database.RunApprovals(ctx, owner.ID, retry.ID)
	if err != nil || len(retryApprovals) != 1 || retryApprovals[0].State != "pending" {
		t.Fatalf("destructive workflow retry approvals = %#v, %v", retryApprovals, err)
	}
	workflow.Enabled = false
	workflow, err = database.SaveSpaceStudioResource(ctx, owner.ID, *workflow)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.DecideRunApproval(ctx, owner.ID, retry.ID, true); !errors.Is(err, ErrSpaceInvalid) {
		t.Fatalf("disabled workflow approval error = %v", err)
	}
	if _, err := database.CancelSpaceRun(ctx, owner.ID, retry.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := database.RetrySpaceRun(ctx, owner.ID, retry.ID); !errors.Is(err, ErrSpaceInvalid) {
		t.Fatalf("disabled workflow retry error = %v", err)
	}
	if err := database.DeleteSpaceStudioResource(ctx, owner.ID, spaces[0].ID, "workflow", workflow.ID); err != nil {
		t.Fatalf("delete workflow with run history: %v", err)
	}
	retained, err := database.SpaceRun(ctx, owner.ID, retry.ID)
	if err != nil || retained.State != "canceled" || retained.WorkflowVersionID != "" || retained.WorkflowVersion == "" {
		t.Fatalf("retained run after workflow deletion = %#v, %v", retained, err)
	}
	retryApprovals, err = database.RunApprovals(ctx, owner.ID, retry.ID)
	if err != nil || len(retryApprovals) != 1 || retryApprovals[0].State != "canceled" {
		t.Fatalf("approval after workflow deletion = %#v, %v", retryApprovals, err)
	}
}

func architectureMetadata() WorkflowMetadata {
	return WorkflowMetadata{
		Capabilities: []WorkflowCapability{
			{ID: "summarize-files", Name: "Summarize files", Description: "Summarize documents and files", Inputs: []WorkflowField{{Name: "prompt", Type: "string", Required: true}}, Outputs: []WorkflowField{{Name: "summary", Type: "string"}}, ReadOnly: true, Tags: []string{"summarize", "documents"}},
			{ID: "organize-folders", Name: "Organize folders", Description: "Organize campaign folders and files", Inputs: []WorkflowField{{Name: "prompt", Type: "string", Required: true}}, Outputs: []WorkflowField{{Name: "actions", Type: "array"}}, Destructive: true, ConfirmationRequired: true, Tags: []string{"organize", "folders"}},
		},
		RequiredIntegrations: []string{}, RequiredPermissions: []string{}, Runtime: WorkflowRuntime{Kind: "misty-cloud", Compatibility: "1"}, Tags: []string{"operations"},
	}
}

func mustTestRaw(value any) json.RawMessage { raw, _ := json.Marshal(value); return raw }

func containsSpaceRun(items []SpaceRun, runID string) bool {
	for _, item := range items {
		if item.ID == runID {
			return true
		}
	}
	return false
}
