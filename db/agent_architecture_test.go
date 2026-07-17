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

func TestSpaceAgentWorkflowPinningRoutingConcurrencyPrivacyAndApproval(t *testing.T) {
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
	outsider, err := database.CreateUser("Architecture Outsider", "architecture-outsider@example.com", "correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	spaces, err := database.ListSpaces(ctx, owner.ID)
	if err != nil || len(spaces) != 1 {
		t.Fatalf("owner Spaces = %#v, %v", spaces, err)
	}
	space := spaces[0]
	invite, err := database.InviteToSpace(ctx, owner.ID, space.ID, member.Email)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.RespondToSpaceInvite(ctx, member.ID, invite.ID, true); err != nil {
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
	agent, err := database.SaveSpaceStudioResource(ctx, owner.ID, SpaceStudioResource{SpaceID: space.ID, Kind: "agent", Name: "Operations Agent", Description: "Workspace operations", Icon: "sparkles", Instructions: "Use the requested capability.", Enabled: true, Status: "available"})
	if err != nil {
		t.Fatal(err)
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

	private, err := database.CreatePrivateAgentConversation(ctx, owner.ID, space.ID, agent.ID, "Private operations")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.AppendPrivateConversationEvent(ctx, owner.ID, private.ID, "user_message", json.RawMessage(`{"text":"owner secret"}`)); err != nil {
		t.Fatal(err)
	}
	if events, err := database.PrivateConversationEvents(ctx, member.ID, private.ID); !errors.Is(err, ErrSpaceNotFound) || len(events) != 0 {
		t.Fatalf("private context leaked: %#v, %v", events, err)
	}

	destructive, err := database.CreateAgentRun(ctx, AgentRunRequest{RequestingMemberID: member.ID, SpaceID: space.ID, AgentID: agent.ID, SourceType: "group_mention", SourceConversationID: "msg_shared", CapabilityID: "organize-folders", Input: json.RawMessage(`{"prompt":"organize"}`), TriggerKind: "mention"})
	if err != nil || destructive.State != "awaiting_approval" {
		t.Fatalf("destructive run = %#v, %v", destructive, err)
	}
	if _, err := database.DecideRunApproval(ctx, outsider.ID, destructive.ID, true); !errors.Is(err, ErrSpaceForbidden) {
		t.Fatalf("outsider approval error = %v", err)
	}
	approved, err := database.DecideRunApproval(ctx, member.ID, destructive.ID, true)
	if err != nil || approved.State != "running" {
		t.Fatalf("approved run = %#v, %v", approved, err)
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
